from pydantic import BaseModel
from typing import Optional


class IaRespondRequest(BaseModel):
    telefono: str
    sesionId: str
    textoUsuario: str
    contexto: Optional[dict] = None


class IaRespondResponse(BaseModel):
    data: "IaResponseData"


class IaResponseData(BaseModel):
    textoRespuesta: str
    intencion: Optional[str] = None
    confianza: Optional[float] = None
    metadata: Optional[dict] = None
