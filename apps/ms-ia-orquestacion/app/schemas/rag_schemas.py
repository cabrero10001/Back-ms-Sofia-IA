"""
Schemas Pydantic para los endpoints RAG (rag-ingest + rag-answer).
"""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Ingest ────────────────────────────────────────────────────────────────


class RagIngestRequest(BaseModel):
    """Body del POST /v1/ai/rag-ingest."""

    source: str = Field(..., min_length=1, description="Identificador unico del documento/fuente")
    title: Optional[str] = Field(default=None, description="Titulo opcional del documento")
    text: str = Field(..., min_length=1, description="Texto completo del documento")
    metadata: Optional[dict[str, Any]] = Field(default=None, description="Metadata adicional")

    model_config = ConfigDict(extra="forbid")


class RagIngestResponse(BaseModel):
    """Respuesta del POST /v1/ai/rag-ingest."""

    source: str
    title: Optional[str] = None
    chunks_deleted: int
    chunks_inserted: int


# ── RAG Answer ────────────────────────────────────────────────────────────


class RagAnswerRequest(BaseModel):
    """Body del POST /v1/ai/rag-answer."""

    query: str = Field(..., min_length=1, max_length=4000)
    filters: Optional[dict[str, Any]] = Field(default=None, description="Filtros opcionales")

    model_config = ConfigDict(extra="forbid")


class RagCitation(BaseModel):
    """Referencia a un chunk usado en la respuesta."""

    source: str
    chunkIndex: int


class RagUsedChunk(BaseModel):
    """Chunk completo con detalles usado en la respuesta."""

    source: str
    chunkIndex: int
    chunkText: str
    score: float
    title: str = ""


class RagAnswerResponse(BaseModel):
    """Respuesta del POST /v1/ai/rag-answer."""

    answer: str
    citations: list[RagCitation]
    usedChunks: list[RagUsedChunk]
