from app.schemas.ia_schemas import IaRespondRequest, IaRespondResponse, IaResponseData
from app.services.rag_interface import RAGProvider, MockRAGProvider


class IAService:
    def __init__(self, rag_provider: RAGProvider | None = None):
        self.rag: RAGProvider = rag_provider or MockRAGProvider()

    async def respond(self, request: IaRespondRequest) -> IaRespondResponse:
        """
        Fase 1: respuesta mock basada en keywords.
        Fase 2: self.rag.query() + reranker + LLM.
        """
        texto = request.textoUsuario.lower()

        # Detección básica de intención (mock)
        if any(w in texto for w in ["cita", "agendar", "agenda", "horario"]):
            intencion = "AGENDAR_CITA"
            respuesta = (
                "Entiendo que deseas agendar una cita. "
                "Por favor indícame tu nombre completo y un horario de tu preferencia. "
                "Nuestro horario de atención es de lunes a viernes, 8:00 AM a 5:00 PM."
            )
        elif any(w in texto for w in ["consulta", "caso", "problema", "legal", "demanda"]):
            intencion = "CONSULTA_JURIDICA"
            respuesta = (
                "Gracias por contactar el consultorio jurídico. "
                "Para poder orientarte mejor, ¿podrías describir brevemente tu situación legal? "
                "Toda la información que compartas es confidencial."
            )
        elif any(w in texto for w in ["hola", "buenos", "buenas", "hi"]):
            intencion = "SALUDO"
            respuesta = (
                "¡Hola! Bienvenido al Consultorio Jurídico de la Universidad del Valle. "
                "Soy SOFIA, tu asistente virtual. ¿En qué puedo ayudarte hoy?\n\n"
                "Puedo ayudarte con:\n"
                "- Consultas jurídicas\n"
                "- Agendar citas\n"
                "- Información sobre tus derechos"
            )
        else:
            intencion = "GENERAL"
            respuesta = (
                "Gracias por tu mensaje. Estoy procesando tu solicitud. "
                "¿Podrías darme más detalles para poder ayudarte mejor?"
            )

        return IaRespondResponse(
            data=IaResponseData(
                textoRespuesta=respuesta,
                intencion=intencion,
                confianza=0.85,
                metadata={"modelo": "mock-v1", "rag_used": False},
            )
        )


ia_service = IAService()
