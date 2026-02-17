from __future__ import annotations

from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.core.config import get_settings
from app.core.logger import get_logger


logger = get_logger("ms-ia-orquestacion.mongo")


def _safe_mongo_target(uri: str, db_name: str) -> str:
    if not uri:
        return "not-configured"
    try:
        parsed = urlparse(uri)
        host = parsed.netloc.split("@")[-1] if parsed.netloc else "unknown-host"
    except Exception:
        host = "unknown-host"
    return f"{host}/{db_name}"


def get_mongo_runtime_summary() -> dict[str, Any]:
    settings = get_settings()
    if not settings.mongodb_uri:
        return {
            "uriExists": False,
            "user": None,
            "host": None,
            "db": settings.mongodb_db,
            "collection": settings.mongodb_collection,
            "index": settings.mongodb_vector_index,
        }

    parsed = urlparse(settings.mongodb_uri)
    host = parsed.netloc.split("@")[-1] if parsed.netloc else None
    user = parsed.username if parsed.username else None
    return {
        "uriExists": True,
        "user": user,
        "host": host,
        "db": settings.mongodb_db,
        "collection": settings.mongodb_collection,
        "index": settings.mongodb_vector_index,
    }


@lru_cache(maxsize=1)
def get_mongo_client() -> MongoClient:
    settings = get_settings()
    if not settings.mongodb_uri:
        raise ValueError("MONGODB_URI no configurada")

    client = MongoClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=settings.mongo_server_selection_timeout_ms,
        connectTimeoutMS=settings.mongo_connect_timeout_ms,
        socketTimeoutMS=settings.mongo_socket_timeout_ms,
    )

    try:
        client.admin.command("ping")
    except PyMongoError as exc:
        raise RuntimeError(f"MongoDB ping failed: {exc}") from exc

    logger.info("mongo_client_ready target=%s", _safe_mongo_target(settings.mongodb_uri, settings.mongodb_db))
    return client


def get_mongo_database() -> Database:
    settings = get_settings()
    return get_mongo_client()[settings.mongodb_db]


def get_rag_collection() -> Collection:
    settings = get_settings()
    return get_mongo_database()[settings.mongodb_collection]


def ensure_rag_indexes() -> None:
    collection = get_rag_collection()
    try:
        collection.create_index(
            "textHash",
            unique=True,
            name="uniq_text_hash",
            partialFilterExpression={"textHash": {"$type": "string"}},
        )
    except DuplicateKeyError as exc:
        logger.warning("ensure_rag_indexes skip uniq_text_hash: %s", exc)

    try:
        collection.create_index(
            [("docId", 1), ("chunkIndex", 1), ("version", 1)],
            unique=True,
            name="uniq_doc_chunk_version",
            partialFilterExpression={
                "docId": {"$exists": True},
                "chunkIndex": {"$exists": True},
                "version": {"$exists": True},
            },
        )
    except DuplicateKeyError as exc:
        logger.warning("ensure_rag_indexes skip uniq_doc_chunk_version: %s", exc)

    collection.create_index([("source", 1), ("docId", 1)], name="idx_source_doc")


def mongo_ping() -> dict[str, Any]:
    try:
        result = get_mongo_client().admin.command("ping")
        return {"ok": bool(result.get("ok", 0) == 1)}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "error": str(exc)}
