import logging

from fastapi import APIRouter, HTTPException, Request

from app.schemas.ia_schemas import ClassifyExtractRequest, ClassifyExtractResponse
from app.services.ia_service import get_ia_service

logger = logging.getLogger("ms-ia-orquestacion")
router = APIRouter()


@router.post("/classify-extract", response_model=ClassifyExtractResponse, response_model_exclude_none=True)
def classify_extract(body: ClassifyExtractRequest, request: Request) -> ClassifyExtractResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.info("[%s] classify_extract received", request_id)

    try:
        service = get_ia_service()
        result = service.classify_extract(body.text)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[%s] classify_extract_unhandled_error", request_id)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Error interno del servidor",
                "details": str(exc),
            },
        ) from exc
