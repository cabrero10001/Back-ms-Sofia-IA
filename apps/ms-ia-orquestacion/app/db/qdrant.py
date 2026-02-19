from __future__ import annotations

from functools import lru_cache
from typing import Any

from qdrant_client import QdrantClient, models

from app.core.config import get_settings
from app.core.logger import get_logger


logger = get_logger("ms-ia-orquestacion.qdrant")


def _ensure_payload_index(client: QdrantClient, collection_name: str, field_name: str) -> None:
    try:
        client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
        logger.info("qdrant_payload_index_ready collection=%s field=%s", collection_name, field_name)
    except Exception as exc:
        message = str(exc).lower()
        if "already exists" in message or "exists" in message:
            logger.info("qdrant_payload_index_exists collection=%s field=%s", collection_name, field_name)
            return
        raise


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
        collection_info = client.get_collection(settings.qdrant_collection)
        vectors_cfg = collection_info.config.params.vectors
        current_dim: int | None = None

        if isinstance(vectors_cfg, dict):
            first_cfg = next(iter(vectors_cfg.values()), None)
            current_dim = int(first_cfg.size) if first_cfg is not None else None
        else:
            current_dim = int(vectors_cfg.size)

        if current_dim != settings.embedding_dimensions:
            logger.warning(
                "qdrant_collection_dim_mismatch collection=%s current_dim=%s target_dim=%d recreating=true",
                settings.qdrant_collection,
                current_dim,
                settings.embedding_dimensions,
            )
            client.recreate_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=models.VectorParams(
                    size=settings.embedding_dimensions,
                    distance=models.Distance.COSINE,
                ),
            )
            logger.info(
                "qdrant_collection_recreated name=%s dim=%d",
                settings.qdrant_collection,
                settings.embedding_dimensions,
            )

        _ensure_payload_index(client, settings.qdrant_collection, "source")
        _ensure_payload_index(client, settings.qdrant_collection, "version")
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
    _ensure_payload_index(client, settings.qdrant_collection, "source")
    _ensure_payload_index(client, settings.qdrant_collection, "version")


def qdrant_ping() -> dict[str, Any]:
    try:
        get_qdrant_client().get_collections()
        return {"ok": True}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "error": str(exc)}
