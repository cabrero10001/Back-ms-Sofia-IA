from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import find_dotenv, load_dotenv


SERVICE_ROOT = Path(__file__).resolve().parents[2]
SERVICE_ENV_PATH = SERVICE_ROOT / ".env"


def _load_env() -> str:
    if SERVICE_ENV_PATH.exists():
        load_dotenv(dotenv_path=SERVICE_ENV_PATH, override=False)
        return str(SERVICE_ENV_PATH)

    fallback = find_dotenv(".env", usecwd=True)
    if fallback:
        load_dotenv(dotenv_path=fallback, override=False)
        return fallback

    return str(SERVICE_ENV_PATH)


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    return int(raw)


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    return float(raw)


@dataclass(frozen=True)
class Settings:
    env_path: str
    node_env: str
    openai_api_key: str
    openai_model: str
    embedding_model: str
    embedding_dimensions: int
    embedding_batch_size: int
    embedding_max_retries: int

    mongodb_uri: str
    mongodb_db: str
    mongodb_collection: str
    mongodb_vector_index: str
    mongo_server_selection_timeout_ms: int
    mongo_connect_timeout_ms: int
    mongo_socket_timeout_ms: int

    qdrant_url: str
    qdrant_api_key: str
    qdrant_collection: str
    qdrant_timeout_s: int

    chunk_size: int
    chunk_overlap: int
    min_chunk_size: int
    source_default: str
    version_default: str
    rerank_enabled: bool
    rag_candidate_topk: int
    rag_final_k: int
    rag_score_threshold: float
    rag_rerank_mode: str
    rag_filter_source: str | None
    rag_filter_version: str | None
    rag_temperature: float


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    env_path = _load_env()
    return Settings(
        env_path=env_path,
        node_env=os.getenv("NODE_ENV", "development"),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        embedding_model=os.getenv("RAG_EMBED_MODEL", "text-embedding-3-small"),
        embedding_dimensions=_get_int("RAG_EMBED_DIM", 1536),
        embedding_batch_size=_get_int("RAG_EMBED_BATCH_SIZE", 64),
        embedding_max_retries=_get_int("RAG_EMBED_MAX_RETRIES", 4),
        mongodb_uri=os.getenv("MONGODB_URI", ""),
        mongodb_db=os.getenv("MONGODB_DB", "sofia"),
        mongodb_collection=os.getenv("MONGODB_COLLECTION", "rag_documents"),
        mongodb_vector_index=os.getenv("MONGODB_VECTOR_INDEX", "vector_index_float32_ann"),
        mongo_server_selection_timeout_ms=_get_int("MONGO_SERVER_SELECTION_TIMEOUT_MS", 5000),
        mongo_connect_timeout_ms=_get_int("MONGO_CONNECT_TIMEOUT_MS", 5000),
        mongo_socket_timeout_ms=_get_int("MONGO_SOCKET_TIMEOUT_MS", 20000),
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        qdrant_api_key=os.getenv("QDRANT_API_KEY", ""),
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "rag_documents"),
        qdrant_timeout_s=_get_int("QDRANT_TIMEOUT_S", 20),
        chunk_size=_get_int("RAG_INGEST_CHUNK_SIZE", 1000),
        chunk_overlap=_get_int("RAG_INGEST_CHUNK_OVERLAP", 150),
        min_chunk_size=_get_int("RAG_INGEST_MIN_CHUNK_SIZE", 300),
        source_default=os.getenv("RAG_INGEST_SOURCE", "consultorio_juridico"),
        version_default=os.getenv("RAG_INGEST_VERSION", "v1"),
        rerank_enabled=_get_bool("RAG_RERANK_ENABLED", True),
        rag_candidate_topk=_get_int("RAG_CANDIDATE_TOPK", 30),
        rag_final_k=_get_int("RAG_FINAL_K", 5),
        rag_score_threshold=_get_float("RAG_SCORE_THRESHOLD", 0.72),
        rag_rerank_mode=os.getenv("RAG_RERANK_MODE", "cosine").strip().lower(),
        rag_filter_source=(os.getenv("RAG_FILTER_SOURCE", "").strip() or None),
        rag_filter_version=(os.getenv("RAG_FILTER_VERSION", "").strip() or None),
        rag_temperature=_get_float("RAG_TEMPERATURE", 0.3),
    )
