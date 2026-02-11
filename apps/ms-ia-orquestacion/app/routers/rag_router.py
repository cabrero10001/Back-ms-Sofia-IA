"""
Router para endpoints RAG (Retrieval Augmented Generation).
Fase actual: stubs que retornan datos de ejemplo.
Fase siguiente: integración con pgvector + embeddings + reranker.
"""
import uuid
from fastapi import APIRouter
from app.schemas.rag_schemas import (
    RagIngestRequest, RagIngestResponse, RagIngestResult,
    RagRetrieveRequest, RagRetrieveResponse, RagFragmento,
    RagRerankRequest, RagRerankResponse,
)

router = APIRouter()


@router.post("/ingest", response_model=RagIngestResponse)
async def ingest(body: RagIngestRequest):
    """
    Stub: ingesta un documento al pipeline RAG.
    Fase 2: chunking + embedding + inserción en pgvector.
    """
    doc_id = str(uuid.uuid4())
    # Simulación: se "crearon" fragmentos proporcionales al largo del contenido
    num_fragmentos = max(1, len(body.contenido) // 500)

    return RagIngestResponse(
        data=RagIngestResult(
            documento_id=doc_id,
            fragmentos_creados=num_fragmentos,
            message=f"Stub: documento '{body.titulo}' registrado con {num_fragmentos} fragmento(s). Implementar embedding real en Fase 2.",
        )
    )


@router.post("/retrieve", response_model=RagRetrieveResponse)
async def retrieve(body: RagRetrieveRequest):
    """
    Stub: busca fragmentos relevantes dado un query.
    Fase 2: embedding del query + búsqueda coseno en pgvector.
    """
    # Retorna lista vacía — no hay documentos indexados aún
    return RagRetrieveResponse(data=[])


@router.post("/rerank", response_model=RagRerankResponse)
async def rerank(body: RagRerankRequest):
    """
    Stub: re-rankea fragmentos usando un modelo de cross-encoding.
    Fase 2: integrar con cross-encoder (Cohere, sentence-transformers, etc).
    """
    # Pasamanos: devuelve los mismos fragmentos truncados a top_k
    return RagRerankResponse(data=body.fragmentos[: body.top_k])
