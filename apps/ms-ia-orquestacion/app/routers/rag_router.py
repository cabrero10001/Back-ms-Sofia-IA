"""
Router para endpoints RAG (Retrieval Augmented Generation).
Endpoints bajo /v1/ai: rag-ingest, rag-answer.
"""
import asyncio
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import PyMongoError

from app.schemas.rag_schemas import (
    RagAnswerRequest,
    RagAnswerResponse,
    RagIngestRequest,
    RagIngestResponse,
)
from app.services.rag_service import get_rag_service
from app.services.rag_service import get_runtime_env_summary

logger = logging.getLogger("ms-ia-orquestacion")
REQUEST_TIMEOUT_SECONDS = 60

router = APIRouter()


def _is_debug_enabled() -> bool:
    node_env = os.getenv("NODE_ENV", "development").lower()
    force_debug = os.getenv("RAG_DEBUG_ENDPOINTS", "").lower() in {"1", "true", "yes", "on"}
    return force_debug or node_env != "production"


# ---------------------------------------------------------------------------
# Helpers para mapear excepciones a HTTP
# ---------------------------------------------------------------------------

def _is_openai_error(exc: Exception) -> bool:
    """Detecta si una excepcion proviene del SDK de OpenAI."""
    module = getattr(type(exc), "__module__", "")
    return "openai" in module.lower()


def _error_payload(code: str, message: str, detail: object | None = None) -> dict:
    payload = {"code": code, "message": message}
    if detail is not None:
        payload["detail"] = detail
    return payload


# ---------------------------------------------------------------------------
# POST /rag-ingest
# ---------------------------------------------------------------------------

@router.post("/rag-ingest", response_model=RagIngestResponse)
async def rag_ingest(body: RagIngestRequest, request: Request) -> RagIngestResponse:
    """
    Ingesta un documento al pipeline RAG.
    Si ya existe el source, elimina chunks previos y reinserta (upsert por source).
    """
    request_id = getattr(request.state, "request_id", "unknown")
    correlation_id = getattr(request.state, "correlation_id", request_id)
    logger.info("[%s][corr:%s] rag_ingest source='%s'", request_id, correlation_id, body.source)

    try:
        service = get_rag_service()
        result = service.ingest(
            source=body.source,
            text=body.text,
            title=body.title,
            metadata=body.metadata,
        )
        return RagIngestResponse(**result)

    except ValueError as exc:
        logger.error("[%s] rag_ingest config_error: %s", request_id, exc)
        raise HTTPException(
            status_code=400,
            detail=_error_payload("CONFIG_ERROR", str(exc)),
        ) from exc

    except RuntimeError as exc:
        error_msg = str(exc)
        logger.error("[%s] rag_ingest runtime_error: %s", request_id, error_msg)
        if "auth failed" in error_msg.lower() or "authentication failed" in error_msg.lower() or "bad auth" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail=_error_payload("MONGO_AUTH_ERROR", "Autenticacion MongoDB fallida", error_msg),
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=_error_payload("MONGO_ERROR", "Error de MongoDB", error_msg),
        ) from exc

    except PyMongoError as exc:
        logger.error("[%s] rag_ingest mongo_error: %s", request_id, exc)
        raise HTTPException(
            status_code=502,
            detail=_error_payload("MONGO_ERROR", "Error de MongoDB", str(exc)),
        ) from exc

    except Exception as exc:
        logger.exception("[%s] rag_ingest unhandled_error", request_id)
        if _is_openai_error(exc):
            raise HTTPException(
                status_code=502,
                detail=_error_payload("OPENAI_ERROR", "Error al comunicarse con OpenAI", str(exc)),
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=_error_payload("INTERNAL_ERROR", "Error interno del servidor", str(exc)),
        ) from exc


# ---------------------------------------------------------------------------
# POST /rag-answer
# ---------------------------------------------------------------------------


@router.get("/env-check")
async def env_check(request: Request):
    """Endpoint temporal de diagnostico. Disponible solo en DEBUG."""
    request_id = getattr(request.state, "request_id", "unknown")
    if not _is_debug_enabled():
        raise HTTPException(status_code=404, detail=_error_payload("NOT_FOUND", "Endpoint no disponible"))

    summary = get_runtime_env_summary()
    try:
        service = get_rag_service()
        return {
            "requestId": request_id,
            **service.diagnostics(),
            "sameSingleton": True,
        }
    except Exception as exc:
        logger.warning("[%s] env_check service_init_failed: %s", request_id, exc)
        return {
            "requestId": request_id,
            **summary,
            "ping": {"ok": False, "error": str(exc)},
            "sameSingleton": False,
        }

@router.post("/rag-answer", response_model=RagAnswerResponse)
async def rag_answer(body: RagAnswerRequest, request: Request) -> RagAnswerResponse:
    """
    Pipeline RAG completo: retrieve(topK=5) -> rerank(k=5) -> generate answer.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    correlation_id = getattr(request.state, "correlation_id", request_id)
    resolved_query = body.query or ""
    request_filters = dict(body.filters or {})
    if body.source and "source" not in request_filters:
        request_filters["source"] = body.source
    if body.tenantId and "tenantId" not in request_filters:
        request_filters["tenantId"] = body.tenantId

    source_applied = request_filters.get("source")
    tenant_applied = request_filters.get("tenantId")
    top_k = os.getenv("RAG_CANDIDATE_TOPK", os.getenv("RAG_TOPK", "20"))
    threshold = os.getenv("RAG_SCORE_THRESHOLD", "0.6")

    logger.info(
        "[rag-answer] corr=%s query=\"%s\" source=\"%s\" tenant=\"%s\" top_k=%s threshold=%s",
        correlation_id,
        resolved_query[:80],
        source_applied if source_applied is not None else "",
        tenant_applied if tenant_applied is not None else "",
        top_k,
        threshold,
    )

    try:
        service = get_rag_service()
        result = await asyncio.wait_for(
            asyncio.to_thread(service.rag_answer, query=resolved_query, filters=(request_filters or None)),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        return RagAnswerResponse(**result)

    except TimeoutError as exc:
        logger.error("[%s] rag_answer timeout_after_%ss", request_id, REQUEST_TIMEOUT_SECONDS)
        raise HTTPException(
            status_code=502,
            detail=_error_payload(
                code="UPSTREAM_TIMEOUT",
                message=f"RAG excedio el timeout de {REQUEST_TIMEOUT_SECONDS}s",
            ),
        ) from exc

    except ValueError as exc:
        logger.error("[%s] rag_answer config_error: %s", request_id, exc)
        raise HTTPException(
            status_code=400,
            detail=_error_payload("CONFIG_ERROR", str(exc)),
        ) from exc

    except RuntimeError as exc:
        error_msg = str(exc)
        logger.error("[%s] rag_answer runtime_error: %s", request_id, error_msg)
        if "auth failed" in error_msg.lower() or "authentication failed" in error_msg.lower() or "bad auth" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail=_error_payload("MONGO_AUTH_ERROR", "Autenticacion MongoDB fallida", error_msg),
            ) from exc
        if "indice" in error_msg.lower() or "index" in error_msg.lower():
            raise HTTPException(
                status_code=400,
                detail=_error_payload("INDEX_ERROR", error_msg),
            ) from exc
        if "ssl" in error_msg.lower() or "tls" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail=_error_payload("MONGO_SSL_ERROR", "Fallo de handshake TLS con MongoDB Atlas", error_msg),
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=_error_payload("MONGO_ERROR", error_msg),
        ) from exc

    except PyMongoError as exc:
        logger.error("[%s] rag_answer mongo_error: %s", request_id, exc)
        raise HTTPException(
            status_code=502,
            detail=_error_payload("MONGO_ERROR", "Error de MongoDB", str(exc)),
        ) from exc

    except Exception as exc:
        logger.exception("[%s] rag_answer unhandled_error", request_id)
        if _is_openai_error(exc):
            raise HTTPException(
                status_code=502,
                detail=_error_payload("OPENAI_ERROR", "Error al comunicarse con OpenAI", str(exc)),
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=_error_payload("INTERNAL_ERROR", "Error interno del servidor", str(exc)),
        ) from exc
