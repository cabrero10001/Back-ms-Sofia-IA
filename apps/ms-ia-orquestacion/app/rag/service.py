from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from openai import OpenAI
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.core.logger import get_logger
from app.rag.prompting import build_grounded_prompt
from app.rag.reranker import rerank_candidates, should_reject_by_threshold
from app.rag.retriever import ChunkCandidate, retrieve_candidates


logger = get_logger("ms-ia-orquestacion.rag.pipeline")

NO_SUPPORT_MESSAGE = "No encontre suficiente soporte en el documento para responder con seguridad."
NO_INFO_MESSAGE = "No tengo suficiente informacion en el documento"


def _is_no_info_answer(answer: str) -> bool:
    normalized = " ".join((answer or "").strip().lower().split())
    return normalized.rstrip(".") == NO_INFO_MESSAGE.lower()


@dataclass(frozen=True)
class PipelineRunConfig:
    candidate_topk: int
    final_k: int
    score_threshold: float
    rerank_mode: str
    rerank_enabled: bool
    temperature: float
    source_filter: str | None
    version_filter: str | None
    dry_run: bool


def _build_retrieval_filters(
    incoming_filters: dict[str, Any] | None,
    source_filter: str | None,
    version_filter: str | None,
) -> dict[str, Any] | None:
    settings = get_settings()
    final_filters: dict[str, Any] = {}

    if incoming_filters:
        for key in ("source", "version", "docId"):
            value = incoming_filters.get(key)
            if value:
                final_filters[key] = value

    selected_source = source_filter if source_filter is not None else settings.rag_filter_source
    selected_version = version_filter if version_filter is not None else settings.rag_filter_version
    if selected_source and "source" not in final_filters:
        final_filters["source"] = selected_source
    if selected_version and "version" not in final_filters:
        final_filters["version"] = selected_version

    return final_filters or None


class RetrievalPipelineService:
    def __init__(self, qdrant_client: QdrantClient, qdrant_collection: str, openai_client: OpenAI, embedding_model: str, answer_model: str) -> None:
        self.qdrant_client = qdrant_client
        self.qdrant_collection = qdrant_collection
        self.openai_client = openai_client
        self.embedding_model = embedding_model
        self.answer_model = answer_model

    def _embed_query(self, query: str, dimensions: int) -> list[float]:
        result = self.openai_client.embeddings.create(
            model=self.embedding_model,
            input=[query],
            dimensions=dimensions,
        )
        return result.data[0].embedding

    def _build_output(self, chunks: list[ChunkCandidate], answer: str) -> dict[str, Any]:
        citations = [{"source": c.source, "chunkIndex": c.chunk_index} for c in chunks]
        used_chunks = [
            {
                "source": c.source,
                "chunkIndex": c.chunk_index,
                "chunkText": c.text,
                "score": round(float(c.rerank_score if c.rerank_score is not None else c.mongo_score), 4),
                "title": c.title,
            }
            for c in chunks
        ]
        return {"answer": answer, "citations": citations, "usedChunks": used_chunks}

    def _default_run_config(self, dry_run: bool = False) -> PipelineRunConfig:
        settings = get_settings()
        return PipelineRunConfig(
            candidate_topk=settings.rag_candidate_topk,
            final_k=settings.rag_final_k,
            score_threshold=settings.rag_score_threshold,
            rerank_mode=settings.rag_rerank_mode,
            rerank_enabled=settings.rerank_enabled,
            temperature=settings.rag_temperature,
            source_filter=settings.rag_filter_source,
            version_filter=settings.rag_filter_version,
            dry_run=dry_run,
        )

    def _merge_run_config(self, overrides: dict[str, Any] | None, dry_run: bool = False) -> PipelineRunConfig:
        base = self._default_run_config(dry_run=dry_run)
        if not overrides:
            return base

        return PipelineRunConfig(
            candidate_topk=int(overrides.get("candidate_topk", base.candidate_topk)),
            final_k=int(overrides.get("final_k", base.final_k)),
            score_threshold=float(overrides.get("score_threshold", base.score_threshold)),
            rerank_mode=str(overrides.get("rerank_mode", base.rerank_mode)).lower(),
            rerank_enabled=bool(overrides.get("rerank_enabled", base.rerank_enabled)),
            temperature=float(overrides.get("temperature", base.temperature)),
            source_filter=overrides.get("source_filter", base.source_filter),
            version_filter=overrides.get("version_filter", base.version_filter),
            dry_run=bool(overrides.get("dry_run", base.dry_run)),
        )

    def evaluate(
        self,
        query: str,
        incoming_filters: dict[str, Any] | None,
        overrides: dict[str, Any] | None = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        settings = get_settings()
        run_config = self._merge_run_config(overrides=overrides, dry_run=dry_run)
        overall_started = time.perf_counter()

        embed_started = time.perf_counter()
        query_embedding = self._embed_query(query, settings.embedding_dimensions)
        embed_ms = round((time.perf_counter() - embed_started) * 1000, 2)

        filters = _build_retrieval_filters(
            incoming_filters,
            source_filter=run_config.source_filter,
            version_filter=run_config.version_filter,
        )
        retrieval_started = time.perf_counter()

        include_embedding = run_config.rerank_enabled and run_config.rerank_mode == "cosine"
        candidates = retrieve_candidates(
            client=self.qdrant_client,
            collection_name=self.qdrant_collection,
            query_embedding=query_embedding,
            topk=run_config.candidate_topk,
            filters=filters,
            include_embedding=include_embedding,
        )
        retrieval_ms = round((time.perf_counter() - retrieval_started) * 1000, 2)

        sample_scores = [round(c.mongo_score, 4) for c in candidates[:5]]
        logger.info(
            "rag_pipeline retrieval query_len=%d candidate_topk=%d returned=%d filters=%s top_mongo_scores=%s duration_ms=%.2f",
            len(query),
            run_config.candidate_topk,
            len(candidates),
            filters,
            sample_scores,
            retrieval_ms,
        )

        if not candidates:
            total_ms = round((time.perf_counter() - overall_started) * 1000, 2)
            return {
                "response": {"answer": NO_SUPPORT_MESSAGE, "citations": [], "usedChunks": []},
                "metrics": {
                    "answerable": False,
                    "thresholdTriggered": True,
                    "top1Score": None,
                    "top5Scores": [],
                    "usedChunkIds": [],
                    "usedChunksCount": 0,
                    "latencyMs": {
                        "embed": embed_ms,
                        "retrieval": retrieval_ms,
                        "rerank": 0.0,
                        "generate": 0.0,
                        "total": total_ms,
                    },
                    "config": {
                        "candidateTopK": run_config.candidate_topk,
                        "finalK": run_config.final_k,
                        "threshold": run_config.score_threshold,
                        "rerankMode": run_config.rerank_mode,
                        "rerankEnabled": run_config.rerank_enabled,
                        "temperature": run_config.temperature,
                        "sourceFilter": run_config.source_filter,
                        "versionFilter": run_config.version_filter,
                        "dryRun": run_config.dry_run,
                    },
                },
            }

        rerank_started = time.perf_counter()
        ranked = rerank_candidates(
            mode=run_config.rerank_mode if run_config.rerank_enabled else "cosine",
            query=query,
            query_embedding=query_embedding,
            candidates=candidates,
            openai_client=self.openai_client if run_config.rerank_enabled and run_config.rerank_mode == "llm" else None,
            llm_model=self.answer_model,
        )
        top_chunks = ranked[: run_config.final_k]
        rerank_ms = round((time.perf_counter() - rerank_started) * 1000, 2)

        top_scores = [round(float(c.rerank_score if c.rerank_score is not None else c.mongo_score), 4) for c in top_chunks]
        logger.info(
            "rag_pipeline rerank mode=%s enabled=%s final_k=%d top_scores=%s duration_ms=%.2f",
            run_config.rerank_mode,
            run_config.rerank_enabled,
            run_config.final_k,
            top_scores,
            rerank_ms,
        )

        best_score = top_scores[0] if top_scores else None
        threshold_triggered = should_reject_by_threshold(best_score, run_config.score_threshold)
        if threshold_triggered:
            logger.info(
                "rag_pipeline low_confidence best_score=%s threshold=%.3f; proceeding_with_generation",
                best_score,
                run_config.score_threshold,
            )

        if run_config.dry_run:
            total_ms = round((time.perf_counter() - overall_started) * 1000, 2)
            response = self._build_output(top_chunks, answer="DRY_RUN: generation skipped")
            return {
                "response": response,
                "metrics": {
                    "answerable": True,
                    "thresholdTriggered": False,
                    "top1Score": best_score,
                    "top5Scores": top_scores,
                    "usedChunkIds": [chunk.chunk_id for chunk in top_chunks],
                    "usedChunksCount": len(top_chunks),
                    "latencyMs": {
                        "embed": embed_ms,
                        "retrieval": retrieval_ms,
                        "rerank": rerank_ms,
                        "generate": 0.0,
                        "total": total_ms,
                    },
                    "config": {
                        "candidateTopK": run_config.candidate_topk,
                        "finalK": run_config.final_k,
                        "threshold": run_config.score_threshold,
                        "rerankMode": run_config.rerank_mode,
                        "rerankEnabled": run_config.rerank_enabled,
                        "temperature": run_config.temperature,
                        "sourceFilter": run_config.source_filter,
                        "versionFilter": run_config.version_filter,
                        "dryRun": run_config.dry_run,
                    },
                },
            }

        generation_started = time.perf_counter()
        system_prompt, user_prompt = build_grounded_prompt(query, top_chunks)
        completion = self.openai_client.chat.completions.create(
            model=self.answer_model,
            temperature=run_config.temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        answer = (completion.choices[0].message.content or "").strip()
        generation_ms = round((time.perf_counter() - generation_started) * 1000, 2)
        total_ms = round((time.perf_counter() - overall_started) * 1000, 2)
        logger.info("rag_pipeline generate answer_len=%d duration_ms=%.2f total_ms=%.2f", len(answer), generation_ms, total_ms)

        if not answer:
            answer = NO_INFO_MESSAGE

        answerable = not _is_no_info_answer(answer)

        response = self._build_output(top_chunks, answer)
        return {
            "response": response,
            "metrics": {
                "answerable": answerable,
                "thresholdTriggered": threshold_triggered,
                "top1Score": best_score,
                "top5Scores": top_scores,
                "usedChunkIds": [chunk.chunk_id for chunk in top_chunks],
                "usedChunksCount": len(top_chunks),
                "answerLength": len(answer),
                "latencyMs": {
                    "embed": embed_ms,
                    "retrieval": retrieval_ms,
                    "rerank": rerank_ms,
                    "generate": generation_ms,
                    "total": total_ms,
                },
                "config": {
                    "candidateTopK": run_config.candidate_topk,
                    "finalK": run_config.final_k,
                    "threshold": run_config.score_threshold,
                    "rerankMode": run_config.rerank_mode,
                    "rerankEnabled": run_config.rerank_enabled,
                    "temperature": run_config.temperature,
                    "sourceFilter": run_config.source_filter,
                    "versionFilter": run_config.version_filter,
                    "dryRun": run_config.dry_run,
                },
            },
        }

    def answer(self, query: str, incoming_filters: dict[str, Any] | None) -> dict[str, Any]:
        result = self.evaluate(query=query, incoming_filters=incoming_filters, dry_run=False)
        return result["response"]
