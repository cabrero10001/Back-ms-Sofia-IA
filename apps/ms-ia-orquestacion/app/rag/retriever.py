from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pymongo.collection import Collection
from pymongo.errors import OperationFailure

from app.core.logger import get_logger


logger = get_logger("ms-ia-orquestacion.rag.retriever")


@dataclass
class ChunkCandidate:
    chunk_id: str
    source: str
    version: str
    title: str
    chunk_index: int
    text: str
    metadata: dict[str, Any]
    mongo_score: float
    embedding: list[float] | None
    page_start: int | None
    page_end: int | None
    rerank_score: float | None = None


def retrieve_candidates(
    collection: Collection,
    query_embedding: list[float],
    topk: int,
    filters: dict[str, Any] | None,
    include_embedding: bool,
    vector_index_name: str,
) -> list[ChunkCandidate]:
    vector_stage_base: dict[str, Any] = {
        "index": vector_index_name,
        "path": "embedding",
        "queryVector": query_embedding,
        "numCandidates": max(100, topk * 4),
        "limit": topk,
    }

    project_stage = {
        "_id": 1,
        "source": 1,
        "version": 1,
        "title": {"$ifNull": ["$title", "$docName", ""]},
        "chunkText": {"$ifNull": ["$chunkText", "$text", ""]},
        "chunkIndex": 1,
        "metadata": 1,
        "pageStart": 1,
        "pageEnd": 1,
        "score": {"$meta": "vectorSearchScore"},
    }
    if include_embedding:
        project_stage["embedding"] = 1

    def _run_pipeline(use_vector_filter: bool) -> list[dict[str, Any]]:
        vector_stage = dict(vector_stage_base)
        pipeline = [{"$vectorSearch": vector_stage}]
        if use_vector_filter and filters:
            vector_stage["filter"] = filters
        elif filters:
            pipeline.append({"$match": filters})
            pipeline.append({"$limit": topk})
        pipeline.append({"$project": project_stage})
        return list(collection.aggregate(pipeline))

    try:
        docs = _run_pipeline(use_vector_filter=True)
    except OperationFailure as exc:
        message = str(exc).lower()
        if filters and "needs to be indexed as filter" in message:
            logger.warning("vector_filter_not_indexed fallback_to_post_match filters=%s", list(filters.keys()))
            docs = _run_pipeline(use_vector_filter=False)
        else:
            raise
    candidates: list[ChunkCandidate] = []
    for doc in docs:
        candidates.append(
            ChunkCandidate(
                chunk_id=str(doc.get("_id")),
                source=str(doc.get("source") or ""),
                version=str(doc.get("version") or ""),
                title=str(doc.get("title") or ""),
                chunk_index=int(doc.get("chunkIndex") or 0),
                text=str(doc.get("chunkText") or ""),
                metadata=dict(doc.get("metadata") or {}),
                mongo_score=float(doc.get("score") or 0.0),
                embedding=doc.get("embedding") if include_embedding else None,
                page_start=doc.get("pageStart"),
                page_end=doc.get("pageEnd"),
            )
        )
    return candidates
