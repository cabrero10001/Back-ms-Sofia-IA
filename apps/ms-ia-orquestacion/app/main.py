import uuid
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from app.routers import ia_router, rag_router

app = FastAPI(
    title="SOFIA - MS IA Orquestación",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Propaga o genera X-Request-Id en cada petición."""
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    response: Response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.get("/health")
def health():
    return {"status": "ok", "service": "ms-ia-orquestacion"}


app.include_router(ia_router.router, prefix="/ia", tags=["IA"])
app.include_router(rag_router.router, prefix="/rag", tags=["RAG"])
