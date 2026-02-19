"""Servicio RAG usando Qdrant como vector store."""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI
from qdrant_client import models

from app.core.config import get_settings
from app.db.qdrant import ensure_rag_collection, get_qdrant_client, get_qdrant_runtime_summary, qdrant_ping
from app.rag.service import RetrievalPipelineService


logger = logging.getLogger("ms-ia-orquestacion")


class RAGService:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY no configurada. El servicio RAG requiere OpenAI.")
        if not settings.qdrant_url:
            raise ValueError("QDRANT_URL no configurada. El servicio RAG requiere Qdrant.")

        timeout = httpx.Timeout(
            timeout=float(os.getenv("RAG_OPENAI_TIMEOUT_S", "30")),
            connect=float(os.getenv("RAG_OPENAI_CONNECT_TIMEOUT_S", "5")),
            read=float(os.getenv("RAG_OPENAI_READ_TIMEOUT_S", "25")),
            write=float(os.getenv("RAG_OPENAI_WRITE_TIMEOUT_S", "25")),
            pool=float(os.getenv("RAG_OPENAI_POOL_TIMEOUT_S", "5")),
        )
        self._openai = OpenAI(
            api_key=settings.openai_api_key,
            max_retries=int(os.getenv("RAG_OPENAI_MAX_RETRIES", "2")),
            timeout=timeout,
        )
        self._qdrant = get_qdrant_client()
        self._qdrant_collection = settings.qdrant_collection
        ensure_rag_collection()

        chunk_size = int(os.getenv("RAG_CHUNK_SIZE", "255"))
        chunk_overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "50"))
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            is_separator_regex=False,
        )

        logger.info(
            "RAGService inicializado (qdrant=%s collection=%s embed_model=%s dims=%d)",
            settings.qdrant_url,
            settings.qdrant_collection,
            settings.embedding_model,
            settings.embedding_dimensions,
        )

        self._pipeline = RetrievalPipelineService(
            qdrant_client=self._qdrant,
            qdrant_collection=self._qdrant_collection,
            openai_client=self._openai,
            embedding_model=settings.embedding_model,
            answer_model=settings.openai_model,
        )

    def diagnostics(self) -> dict[str, Any]:
        info = get_runtime_env_summary()
        info["ping"] = qdrant_ping()
        return info

    def _embed_texts(self, texts: list[str], dimensions: int) -> list[list[float]]:
        response = self._openai.embeddings.create(
            model=get_settings().embedding_model,
            input=texts,
            dimensions=dimensions,
        )
        return [item.embedding for item in sorted(response.data, key=lambda item: item.index)]

    def ingest(
        self,
        source: str,
        text: str,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        settings = get_settings()
        metadata = metadata or {}
        chunks = self._splitter.split_text(text)
        if not chunks:
            return {
                "source": source,
                "title": title,
                "chunks_deleted": 0,
                "chunks_inserted": 0,
            }

        source_filter = models.Filter(
            must=[models.FieldCondition(key="source", match=models.MatchValue(value=source))]
        )
        existing, _ = self._qdrant.scroll(
            collection_name=self._qdrant_collection,
            scroll_filter=source_filter,
            with_payload=False,
            with_vectors=False,
            limit=10_000,
        )
        chunks_deleted = len(existing)
        if chunks_deleted:
            self._qdrant.delete(
                collection_name=self._qdrant_collection,
                points_selector=models.FilterSelector(filter=source_filter),
            )

        vectors = self._embed_texts(chunks, settings.embedding_dimensions)
        now = datetime.now(timezone.utc).isoformat()
        points: list[models.PointStruct] = []
        for idx, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
            hash_id = hashlib.sha256(f"{source}|{idx}|{chunk_text}".encode("utf-8")).hexdigest()
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, hash_id))
            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "source": source,
                        "version": str(metadata.get("version", get_settings().version_default)),
                        "title": title or "",
                        "chunkText": chunk_text,
                        "chunkIndex": idx,
                        "metadata": metadata,
                        "pageStart": metadata.get("pageStart"),
                        "pageEnd": metadata.get("pageEnd"),
                        "createdAt": now,
                        "updatedAt": now,
                    },
                )
            )

        self._qdrant.upsert(collection_name=self._qdrant_collection, points=points)
        return {
            "source": source,
            "title": title,
            "chunks_deleted": chunks_deleted,
            "chunks_inserted": len(points),
        }

    def rag_answer(self, query: str, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._pipeline.answer(query=query, incoming_filters=filters)

    def rag_evaluate(
        self,
        query: str,
        filters: dict[str, Any] | None = None,
        overrides: dict[str, Any] | None = None,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        return self._pipeline.evaluate(
            query=query,
            incoming_filters=filters,
            overrides=overrides,
            dry_run=dry_run,
        )


def get_runtime_env_summary() -> dict[str, Any]:
    summary = get_qdrant_runtime_summary()
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    summary["envPath"] = env_path
    summary["envPathExists"] = os.path.exists(env_path)
    return summary


_rag_service_instance: RAGService | None = None


def get_rag_service() -> RAGService:
    global _rag_service_instance
    if _rag_service_instance is None:
        _rag_service_instance = RAGService()
    return _rag_service_instance
