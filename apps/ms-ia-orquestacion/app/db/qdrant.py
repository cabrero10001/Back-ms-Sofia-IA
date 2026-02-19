from __future__ import annotations

from functools import lru_cache
from typing import Any

from qdrant_client import QdrantClient, models

from app.core.config import get_settings
from app.core.logger import get_logger


logger = get_logger("ms-ia-orquestacion.qdrant")


def get_qdrant_runtime_summary() -> dict[str, Any]:
    settings = get_settings()
    return {
        "url": settings.qdrant_url,
        "collection": settings.qdrant_collection,
        "apiKeyConfigured": bool(settings.qdrant_api_key),
        "timeoutSeconds": settings.qdrant_timeout_s,
    }


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    settings = get_settings()
    if not settings.qdrant_url:
        raise ValueError("QDRANT_URL no configurada")

    client = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key or None,
        timeout=settings.qdrant_timeout_s,
    )
    client.get_collections()
    logger.info("qdrant_client_ready url=%s collection=%s", settings.qdrant_url, settings.qdrant_collection)
    return client


def ensure_rag_collection() -> None:
    settings = get_settings()
    client = get_qdrant_client()
    collections = client.get_collections().collections
    exists = any(item.name == settings.qdrant_collection for item in collections)
    if exists:
        return

    client.create_collection(
        collection_name=settings.qdrant_collection,
        vectors_config=models.VectorParams(
            size=settings.embedding_dimensions,
            distance=models.Distance.COSINE,
        ),
    )
    logger.info(
        "qdrant_collection_created name=%s dim=%d",
        settings.qdrant_collection,
        settings.embedding_dimensions,
    )


def qdrant_ping() -> dict[str, Any]:
    try:
        get_qdrant_client().get_collections()
        return {"ok": True}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "error": str(exc)}
