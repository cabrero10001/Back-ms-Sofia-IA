from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient, models

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
    client: QdrantClient,
    collection_name: str,
    query_embedding: list[float],
    topk: int,
    filters: dict[str, Any] | None,
    include_embedding: bool,
) -> list[ChunkCandidate]:
    qdrant_filter: models.Filter | None = None
    if filters:
        qdrant_filter = models.Filter(
            must=[
                models.FieldCondition(
                    key=str(key),
                    match=models.MatchValue(value=value),
                )
                for key, value in filters.items()
                if value is not None
            ]
        )

    response = client.query_points(
        collection_name=collection_name,
        query=query_embedding,
        query_filter=qdrant_filter,
        limit=topk,
        with_payload=True,
        with_vectors=include_embedding,
    )
    docs = list(response.points or [])

    candidates: list[ChunkCandidate] = []
    for doc in docs:
        payload = dict(doc.payload or {})
        vector = doc.vector if include_embedding else None
        if isinstance(vector, dict):
            vector = None

        candidates.append(
            ChunkCandidate(
                chunk_id=str(doc.id),
                source=str(payload.get("source") or ""),
                version=str(payload.get("version") or ""),
                title=str(payload.get("title") or payload.get("docName") or ""),
                chunk_index=int(payload.get("chunkIndex") or 0),
                text=str(payload.get("chunkText") or payload.get("text") or ""),
                metadata=dict(payload.get("metadata") or {}),
                mongo_score=float(doc.score or 0.0),
                embedding=vector if isinstance(vector, list) else None,
                page_start=payload.get("pageStart"),
                page_end=payload.get("pageEnd"),
            )
        )
    return candidates
