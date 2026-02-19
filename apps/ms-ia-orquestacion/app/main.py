import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", ".env"))

load_dotenv(dotenv_path=ENV_PATH)

from app.routers import ia_router, rag_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("ms-ia-orquestacion")


def _safe_qdrant_target(url: str) -> str:
    if not url:
        return "not-configured"
    collection = os.getenv("QDRANT_COLLECTION", "rag_documents")
    return f"{url}/{collection}"

app = FastAPI(
    title="SOFIA - MS IA Orquestacion",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id")
    request_id = correlation_id or request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    request.state.correlation_id = correlation_id or request_id
    response: Response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Correlation-Id"] = str(getattr(request.state, "correlation_id", request_id))
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.warning("[%s] validation_error %s", request_id, exc.errors())
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Payload inválido",
                "detail": exc.errors(),
                "details": exc.errors(),
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.warning("[%s] http_error status=%s detail=%s", request_id, exc.status_code, exc.detail)
    detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("[%s] unhandled_error", request_id)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Error interno del servidor",
                "detail": str(exc),
                "details": str(exc),
            }
        },
    )


@app.on_event("startup")
def startup_debug_summary() -> None:
    logger.info(
        "startup_config env_path=%s env_exists=%s cwd=%s openai_key=%s openai_model=%s rag_topk=%s rerank_enabled=%s rerank_top_k=%s temperature=%s qdrant=%s",
        ENV_PATH,
        os.path.exists(ENV_PATH),
        os.getcwd(),
        bool(os.getenv("OPENAI_API_KEY")),
        os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        os.getenv("RAG_TOPK", "20"),
        os.getenv("RAG_RERANK_ENABLED", "true"),
        os.getenv("RAG_RERANK_TOP_K", os.getenv("RAG_RERANK_K", "5")),
        os.getenv("RAG_OPENAI_TEMPERATURE", os.getenv("RAG_TEMPERATURE", "0.3")),
        _safe_qdrant_target(os.getenv("QDRANT_URL", "")),
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ms-ia-orquestacion",
        "port": int(os.getenv("PORT", "3040")),
    }


app.include_router(ia_router.router, prefix="/v1/ai", tags=["IA"])
app.include_router(rag_router.router, prefix="/v1/ai", tags=["RAG"])
