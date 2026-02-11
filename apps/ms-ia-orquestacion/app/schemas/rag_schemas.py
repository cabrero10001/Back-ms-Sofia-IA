from pydantic import BaseModel
from typing import Optional


# ── Ingest (cargar documentos al pipeline RAG) ──────
class RagIngestRequest(BaseModel):
    titulo: str
    contenido: str
    fuente_url: Optional[str] = None
    tipo: Optional[str] = None
    metadata: Optional[dict] = None


class RagIngestResponse(BaseModel):
    data: "RagIngestResult"


class RagIngestResult(BaseModel):
    documento_id: str
    fragmentos_creados: int
    message: str


# ── Retrieve (buscar fragmentos relevantes) ─────────
class RagRetrieveRequest(BaseModel):
    query: str
    top_k: int = 5
    filtros: Optional[dict] = None


class RagFragmento(BaseModel):
    fragmento_id: str
    contenido: str
    score: float
    documento_titulo: Optional[str] = None
    metadata: Optional[dict] = None


class RagRetrieveResponse(BaseModel):
    data: list[RagFragmento]


# ── Rerank ──────────────────────────────────────────
class RagRerankRequest(BaseModel):
    query: str
    fragmentos: list[RagFragmento]
    top_k: int = 3


class RagRerankResponse(BaseModel):
    data: list[RagFragmento]
