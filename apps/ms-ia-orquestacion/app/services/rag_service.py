"""
Servicio RAG (Retrieval Augmented Generation) con MongoDB Atlas Vector Search.

Pipeline:
  Ingest  -> chunk(255) -> embed(1064) -> upsert Mongo (por source)
  Answer  -> embed query -> $vectorSearch(topK) -> rerank(k) -> generate
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import find_dotenv, load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI
from pymongo import MongoClient
from pymongo.errors import OperationFailure, PyMongoError

try:
    import certifi
except Exception:  # pragma: no cover
    certifi = None

logger = logging.getLogger("ms-ia-orquestacion")

from app.rag.service import RetrievalPipelineService

# Carga .env de forma explicita para evitar diferencias por working directory.
SERVICE_ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
_fallback_env_path = find_dotenv(".env", usecwd=True)
if os.path.exists(SERVICE_ENV_PATH):
    load_dotenv(dotenv_path=SERVICE_ENV_PATH, override=False)
elif _fallback_env_path:
    load_dotenv(dotenv_path=_fallback_env_path, override=False)

# ---------------------------------------------------------------------------
# Configuracion desde variables de entorno
# ---------------------------------------------------------------------------

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "sofia")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "rag_documents")
MONGODB_VECTOR_INDEX = os.getenv("MONGODB_VECTOR_INDEX", "vector_index_float32_ann")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

RAG_EMBED_MODEL = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-small")
RAG_EMBED_DIM = int(os.getenv("RAG_EMBED_DIM", "1064"))
RAG_CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "255"))
RAG_CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "50"))
RAG_TOPK = int(os.getenv("RAG_TOPK", "20"))
RAG_RERANK_TOP_K = int(os.getenv("RAG_RERANK_TOP_K", os.getenv("RAG_RERANK_K", "5")))
RAG_RERANK_ENABLED = os.getenv("RAG_RERANK_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
RAG_OPENAI_TEMPERATURE = float(os.getenv("RAG_OPENAI_TEMPERATURE", os.getenv("RAG_TEMPERATURE", "0.3")))
RAG_OPENAI_TIMEOUT_S = float(os.getenv("RAG_OPENAI_TIMEOUT_S", "30"))
RAG_OPENAI_CONNECT_TIMEOUT_S = float(os.getenv("RAG_OPENAI_CONNECT_TIMEOUT_S", "5"))
RAG_OPENAI_READ_TIMEOUT_S = float(os.getenv("RAG_OPENAI_READ_TIMEOUT_S", "25"))
RAG_OPENAI_WRITE_TIMEOUT_S = float(os.getenv("RAG_OPENAI_WRITE_TIMEOUT_S", "25"))
RAG_OPENAI_POOL_TIMEOUT_S = float(os.getenv("RAG_OPENAI_POOL_TIMEOUT_S", "5"))
RAG_OPENAI_MAX_RETRIES = int(os.getenv("RAG_OPENAI_MAX_RETRIES", "2"))

MONGO_SERVER_SELECTION_TIMEOUT_MS = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000"))
MONGO_SOCKET_TIMEOUT_MS = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "20000"))
MONGO_CONNECT_TIMEOUT_MS = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "5000"))
MONGO_TLS_CA_FILE = os.getenv("MONGO_TLS_CA_FILE", "")
MONGO_TLS_ALLOW_INVALID_CERTS = os.getenv("MONGO_TLS_ALLOW_INVALID_CERTS", "false").lower() in {"1", "true", "yes", "on"}
MONGO_TLS_DISABLE_OCSP_ENDPOINT_CHECK = os.getenv("MONGO_TLS_DISABLE_OCSP_ENDPOINT_CHECK", "true").lower() in {"1", "true", "yes", "on"}

# ---------------------------------------------------------------------------
# Flashrank (reranker local) – carga opcional, fallback a OpenAI rerank
# ---------------------------------------------------------------------------

_flashrank_available = False
_ranker = None

try:
    from flashrank import Ranker, RerankRequest as FlashRerankRequest  # type: ignore[import-untyped]
    _ranker = Ranker()
    _flashrank_available = True
    logger.info("flashrank disponible – reranker local activado")
except Exception:
    logger.info("flashrank no disponible – se usara rerank via OpenAI (prompt-based)")


# ---------------------------------------------------------------------------
# Instrucciones del indice vectorial
# ---------------------------------------------------------------------------

def ensure_index_notes() -> str:
    """
    Imprime las instrucciones para crear el indice vectorial en MongoDB Atlas.
    NO crea el indice automaticamente (requiere Atlas UI o Atlas Admin API).
    """
    instructions = (
        "\n"
        "=== INDICE VECTORIAL REQUERIDO EN MONGODB ATLAS ===\n"
        f"  Coleccion : {MONGODB_DB}.{MONGODB_COLLECTION}\n"
        f"  Nombre    : {MONGODB_VECTOR_INDEX}\n"
        "  Definicion JSON (Atlas Search -> Create Index -> JSON Editor):\n"
        "  {\n"
        '    "fields": [\n'
        "      {\n"
        '        "type": "vector",\n'
        '        "path": "embedding",\n'
        f'        "numDimensions": {RAG_EMBED_DIM},\n'
        '        "similarity": "cosine"\n'
        "      }\n"
        "    ]\n"
        "  }\n"
        "====================================================\n"
    )
    logger.info(instructions)
    return instructions


def _safe_mongo_target(uri: str) -> str:
    """Retorna host/db sanitizado para logs (sin credenciales)."""
    try:
        parsed = urlparse(uri)
        host = parsed.netloc.split("@")[-1] if parsed.netloc else "unknown-host"
    except Exception:
        host = "unknown-host"
    return f"{host}/{MONGODB_DB}"


def _safe_mongo_summary(uri: str) -> dict[str, Any]:
    """Retorna URI de Mongo sanitizado para logs/diagnostico."""
    if not uri:
        return {
            "uriExists": False,
            "user": None,
            "host": None,
            "db": MONGODB_DB,
            "collection": MONGODB_COLLECTION,
            "index": MONGODB_VECTOR_INDEX,
        }

    parsed = urlparse(uri)
    host = parsed.netloc.split("@")[-1] if parsed.netloc else None
    user = None
    if parsed.username:
        user = parsed.username
    elif "@" in parsed.netloc:
        user = parsed.netloc.split("@", 1)[0].split(":", 1)[0]

    return {
        "uriExists": True,
        "user": user,
        "host": host,
        "db": MONGODB_DB,
        "collection": MONGODB_COLLECTION,
        "index": MONGODB_VECTOR_INDEX,
    }


def get_runtime_env_summary() -> dict[str, Any]:
    summary = _safe_mongo_summary(MONGODB_URI)
    summary["envPath"] = SERVICE_ENV_PATH
    summary["envPathExists"] = os.path.exists(SERVICE_ENV_PATH)
    return summary


# ===========================================================================
# RAGService
# ===========================================================================

class RAGService:
    """Servicio principal de RAG con MongoDB Atlas Vector Search."""

    def __init__(self) -> None:
        # ── Validar config critica ──
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY no configurada. El servicio RAG requiere OpenAI.")
        if not MONGODB_URI:
            raise ValueError("MONGODB_URI no configurada. El servicio RAG requiere MongoDB.")

        timeout = httpx.Timeout(
            timeout=RAG_OPENAI_TIMEOUT_S,
            connect=RAG_OPENAI_CONNECT_TIMEOUT_S,
            read=RAG_OPENAI_READ_TIMEOUT_S,
            write=RAG_OPENAI_WRITE_TIMEOUT_S,
            pool=RAG_OPENAI_POOL_TIMEOUT_S,
        )
        self._openai = OpenAI(
            api_key=OPENAI_API_KEY,
            max_retries=RAG_OPENAI_MAX_RETRIES,
            timeout=timeout,
        )

        # ── MongoDB ──
        mongo_kwargs: dict[str, Any] = {
            "serverSelectionTimeoutMS": MONGO_SERVER_SELECTION_TIMEOUT_MS,
            "socketTimeoutMS": MONGO_SOCKET_TIMEOUT_MS,
            "connectTimeoutMS": MONGO_CONNECT_TIMEOUT_MS,
        }
        if MONGO_TLS_ALLOW_INVALID_CERTS:
            mongo_kwargs["tlsAllowInvalidCertificates"] = True
        if MONGO_TLS_DISABLE_OCSP_ENDPOINT_CHECK:
            mongo_kwargs["tlsDisableOCSPEndpointCheck"] = True
        elif MONGO_TLS_CA_FILE:
            mongo_kwargs["tlsCAFile"] = MONGO_TLS_CA_FILE
        elif certifi is not None:
            mongo_kwargs["tlsCAFile"] = certifi.where()

        self._mongo_client = MongoClient(MONGODB_URI, **mongo_kwargs)
        self._db = self._mongo_client[MONGODB_DB]
        self._collection = self._db[MONGODB_COLLECTION]

        # Fuerza handshake temprano para fallar rapido si hay problema de red/DNS/auth
        try:
            self._mongo_client.admin.command("ping")
        except OperationFailure as exc:
            error_msg = str(exc)
            if "authentication failed" in error_msg.lower() or "bad auth" in error_msg.lower():
                raise RuntimeError("MongoDB auth failed: revisa usuario/password/db en MONGODB_URI") from exc
            raise RuntimeError(f"MongoDB ping failed: {error_msg}") from exc
        except PyMongoError as exc:
            raise RuntimeError(f"MongoDB ping failed: {exc}") from exc

        # ── Text splitter (LangChain) ──
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=RAG_CHUNK_SIZE,
            chunk_overlap=RAG_CHUNK_OVERLAP,
            length_function=len,
            is_separator_regex=False,
        )

        ensure_index_notes()
        logger.info(
            "RAGService inicializado (mongo=%s, mongo_tls_ca=%s, insecure_tls=%s, ocsp_disabled=%s, embed_model=%s, dims=%d, chunk=%d, topk=%d, rerank_enabled=%s, rerank_top_k=%d, openai_timeout_s=%.1f)",
            _safe_mongo_target(MONGODB_URI),
            "set" if (MONGO_TLS_CA_FILE or certifi is not None) else "not-set",
            MONGO_TLS_ALLOW_INVALID_CERTS,
            MONGO_TLS_DISABLE_OCSP_ENDPOINT_CHECK,
            RAG_EMBED_MODEL,
            RAG_EMBED_DIM,
            RAG_CHUNK_SIZE,
            RAG_TOPK,
            RAG_RERANK_ENABLED,
            RAG_RERANK_TOP_K,
            RAG_OPENAI_TIMEOUT_S,
        )
        mongo_summary = _safe_mongo_summary(MONGODB_URI)
        logger.info(
            "RAGService mongo_summary user=%s host=%s db=%s collection=%s index=%s",
            mongo_summary.get("user"),
            mongo_summary.get("host"),
            mongo_summary.get("db"),
            mongo_summary.get("collection"),
            mongo_summary.get("index"),
        )

        self._pipeline = RetrievalPipelineService(
            collection=self._collection,
            openai_client=self._openai,
            embedding_model=RAG_EMBED_MODEL,
            answer_model=OPENAI_MODEL,
        )

    def diagnostics(self) -> dict[str, Any]:
        info = get_runtime_env_summary()
        try:
            ping_result = self._mongo_client.admin.command("ping")
            info["ping"] = {"ok": bool(ping_result.get("ok", 0) == 1)}
        except Exception as exc:  # pragma: no cover
            info["ping"] = {"ok": False, "error": str(exc)}
        return info

    # ─── Embeddings ───────────────────────────────────────────────────────

    def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Genera embeddings via OpenAI con dimensions=RAG_EMBED_DIM."""
        response = self._openai.embeddings.create(
            model=RAG_EMBED_MODEL,
            input=texts,
            dimensions=RAG_EMBED_DIM,
        )
        sorted_data = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in sorted_data]

    def _embed_query(self, text: str) -> list[float]:
        """Genera embedding para un solo query."""
        return self._embed_texts([text])[0]

    # ─── Ingest (upsert por source) ───────────────────────────────────────

    def ingest(
        self,
        source: str,
        text: str,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Ingesta un documento: chunk -> embed -> upsert en MongoDB.

        Si ya existen chunks con el mismo `source`, se eliminan primero
        y se reinsertan los nuevos (upsert por source).

        Retorna { source, title, chunks_deleted, chunks_inserted }.
        """
        # 1) Eliminar chunks previos de este source
        delete_result = self._collection.delete_many({"source": source})
        chunks_deleted = delete_result.deleted_count
        if chunks_deleted > 0:
            logger.info("RAG ingest: %d chunks previos eliminados para source='%s'", chunks_deleted, source)

        # 2) Chunking
        chunks = self._splitter.split_text(text)
        if not chunks:
            return {
                "source": source,
                "title": title,
                "chunks_deleted": chunks_deleted,
                "chunks_inserted": 0,
            }

        # 3) Embeddings (batch)
        embeddings = self._embed_texts(chunks)

        # 4) Preparar documentos Mongo
        now = datetime.now(timezone.utc)
        records: list[dict[str, Any]] = []
        for idx, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
            records.append({
                "source": source,
                "title": title or "",
                "chunkText": chunk_text,
                "chunkIndex": idx,
                "metadata": metadata or {},
                "embedding": embedding,
                "createdAt": now,
            })

        # 5) Insertar
        result = self._collection.insert_many(records)
        chunks_inserted = len(result.inserted_ids)
        logger.info(
            "RAG ingest: %d chunks insertados para source='%s' (title='%s')",
            chunks_inserted, source, title or "",
        )

        return {
            "source": source,
            "title": title,
            "chunks_deleted": chunks_deleted,
            "chunks_inserted": chunks_inserted,
        }

    # ─── Retrieve ($vectorSearch) ─────────────────────────────────────────

    def _retrieve(self, query: str, topk: int | None = None) -> list[dict[str, Any]]:
        """
        Ejecuta busqueda vectorial en MongoDB Atlas usando $vectorSearch.
        Retorna hasta `topk` resultados con score.
        """
        topk = topk or RAG_TOPK
        retrieve_started = time.perf_counter()
        query_embedding = self._embed_query(query)

        pipeline = [
            {
                "$vectorSearch": {
                    "index": MONGODB_VECTOR_INDEX,
                    "path": "embedding",
                    "queryVector": query_embedding,
                    "numCandidates": 100,
                    "limit": topk,
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "source": 1,
                    "title": 1,
                    "chunkText": 1,
                    "chunkIndex": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

        try:
            results = list(self._collection.aggregate(pipeline))
            retrieve_ms = round((time.perf_counter() - retrieve_started) * 1000, 2)
            logger.info("RAG retrieve: %d candidatos obtenidos para topk=%d (%.2f ms)", len(results), topk, retrieve_ms)
            return results
        except OperationFailure as exc:
            error_msg = str(exc)
            if "authentication failed" in error_msg.lower() or "bad auth" in error_msg.lower():
                raise RuntimeError("MongoDB auth failed durante retrieve: revisa usuario/password/db en MONGODB_URI") from exc
            if "index not found" in error_msg.lower() or "atlas" in error_msg.lower():
                raise RuntimeError(
                    f"Indice vectorial '{MONGODB_VECTOR_INDEX}' no encontrado en la coleccion "
                    f"'{MONGODB_COLLECTION}'. Crea el indice en Atlas Search. "
                    f"Ver ensure_index_notes() para instrucciones."
                ) from exc
            raise
        except PyMongoError as exc:
            raise RuntimeError(f"Error de MongoDB durante retrieve: {exc}") from exc

    # ─── Rerank ───────────────────────────────────────────────────────────

    def _rerank(self, query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Re-rankea candidatos.
        Prioridad: flashrank (si disponible) -> OpenAI prompt-based -> fallback por score vectorial.
        """
        if not candidates:
            return []

        k = RAG_RERANK_TOP_K

        if not RAG_RERANK_ENABLED:
            logger.info("RAG rerank: deshabilitado por RAG_RERANK_ENABLED=false")
            return candidates[:k]

        # Opcion B: flashrank si esta disponible
        if _flashrank_available and _ranker is not None:
            try:
                return self._rerank_flashrank(query, candidates, k)
            except Exception as exc:
                logger.warning("flashrank rerank fallo, intentando OpenAI rerank: %s", exc)

        # Opcion A (preferida): rerank via OpenAI prompt-based
        try:
            return self._rerank_openai(query, candidates, k)
        except Exception as exc:
            logger.warning("OpenAI rerank fallo, usando fallback por score vectorial: %s", exc)

        # Fallback final: simplemente los primeros k por score vectorial
        return candidates[:k]

    def _rerank_flashrank(
        self, query: str, candidates: list[dict[str, Any]], k: int
    ) -> list[dict[str, Any]]:
        """Rerank usando flashrank (local, sin llamada a API)."""
        flash_passages = [
            {"id": str(i), "text": c["chunkText"]}
            for i, c in enumerate(candidates)
        ]
        rerank_request = FlashRerankRequest(query=query, passages=flash_passages)
        flash_results = _ranker.rerank(rerank_request)  # type: ignore[union-attr]

        reranked: list[dict[str, Any]] = []
        for fr in flash_results[:k]:
            idx = int(fr.get("id", 0))
            if 0 <= idx < len(candidates):
                entry = candidates[idx].copy()
                entry["score"] = float(fr.get("score", entry.get("score", 0.0)))
                reranked.append(entry)

        logger.info("RAG rerank (flashrank): %d resultados", len(reranked))
        return reranked if reranked else candidates[:k]

    def _rerank_openai(
        self, query: str, candidates: list[dict[str, Any]], k: int
    ) -> list[dict[str, Any]]:
        """
        Rerank via OpenAI: pide al modelo que ordene los chunks por relevancia
        y devuelva un JSON con indices ordenados y scores.
        """
        # Preparar la lista de chunks numerados para el prompt
        chunks_text = ""
        for i, c in enumerate(candidates):
            chunks_text += f"[{i}] {c['chunkText'][:300]}\n\n"

        system_prompt = (
            "Eres un evaluador de relevancia. Dada una pregunta y una lista de fragmentos "
            "de texto numerados, debes ordenarlos por relevancia respecto a la pregunta.\n"
            "Responde SOLO con un JSON valido (sin markdown, sin explicacion) con este formato:\n"
            '{"ranking": [{"index": 0, "score": 0.95}, {"index": 2, "score": 0.80}, ...]}\n'
            f"Devuelve MAXIMO {k} fragmentos, ordenados de mas a menos relevante.\n"
            "El score debe estar entre 0.0 y 1.0."
        )
        user_prompt = f"Pregunta: {query}\n\nFragmentos:\n{chunks_text}"

        completion = self._openai.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )

        raw = completion.choices[0].message.content or ""
        # Limpiar posibles backticks markdown
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        parsed = json.loads(cleaned)
        ranking = parsed.get("ranking", [])

        reranked: list[dict[str, Any]] = []
        for item in ranking[:k]:
            idx = item.get("index", -1)
            score = float(item.get("score", 0.0))
            if 0 <= idx < len(candidates):
                entry = candidates[idx].copy()
                entry["score"] = score
                reranked.append(entry)

        logger.info("RAG rerank (openai): %d resultados", len(reranked))
        return reranked if reranked else candidates[:k]

    # ─── Answer (pipeline completo) ───────────────────────────────────────

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


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_rag_service_instance: RAGService | None = None


def get_rag_service() -> RAGService:
    """Factory singleton para RAGService."""
    global _rag_service_instance
    if _rag_service_instance is None:
        _rag_service_instance = RAGService()
    return _rag_service_instance
