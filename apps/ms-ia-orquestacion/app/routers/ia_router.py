import logging
from fastapi import APIRouter, Request
from app.schemas.ia_schemas import IaRespondRequest, IaRespondResponse
from app.services.ia_service import ia_service

logger = logging.getLogger("ms-ia-orquestacion")
router = APIRouter()


@router.post("/respond", response_model=IaRespondResponse)
async def respond(body: IaRespondRequest, request: Request):
    """
    Recibe texto del usuario y devuelve respuesta.
    Fase 1: mock con detección de intención por keywords.
    Fase 2: RAG + reranker + LLM.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    logger.info(f"[{request_id}] /ia/respond telefono={body.telefono} sesion={body.sesionId}")

    result = await ia_service.respond(body)
    return result
