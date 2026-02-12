import json
import logging
import os
import re

from openai import OpenAI

from app.schemas.ia_schemas import (
    ClassifyExtractEntities,
    ClassifyExtractResponse,
)

logger = logging.getLogger("ms-ia-orquestacion")


def _detect_intent_rule(text: str) -> str:
    lowered = text.lower()
    if any(token in lowered for token in ["laboral", "trabajo", "empleo"]):
        return "consulta_laboral"
    if any(token in lowered for token in ["soporte", "error", "problema"]):
        return "soporte"
    return "general"


def _extract_age_rule(text: str) -> int | None:
    match = re.search(r"\b(\d{1,3})\b", text)
    if not match:
        return None

    age = int(match.group(1))
    if 0 <= age <= 120:
        return age
    return None


def _extract_city_rule(text: str) -> str | None:
    match = re.search(r"\ben\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,50})", text)
    if not match:
        return None

    city = match.group(1).strip(" .,!?:;")
    return city if city else None


class IAService:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY no está configurada; se usará fallback")
            self.client = None
        else:
            self.client = OpenAI(api_key=api_key)
        self.model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    def _build_prompt(self, text: str) -> str:
        return (
            "Devuelve SOLO un JSON válido con esta forma exacta: "
            "{\"intent\":\"general|consulta_laboral|soporte\",\"confidence\":number,"
            "\"entities\":{\"city\":string|null,\"age\":number|null},\"shouldReset\":boolean}. "
            "No incluyas texto fuera del JSON.\n"
            "Reglas de negocio obligatorias:\n"
            "1) Si el texto contiene 'menu' o 'cambiar', shouldReset=true e intent='general'.\n"
            "2) Si contiene señales de trabajo/empleo/laboral => intent='consulta_laboral'.\n"
            "3) Si contiene soporte/error/problema => intent='soporte'.\n"
            "4) Si no está claro => intent='general'.\n"
            "5) Extrae city si aparece (ej. Bogota, Cali, Medellin).\n"
            "6) Extrae age si aparece número de edad (ej. tengo 29 años).\n"
            f"Texto de usuario: {text}"
        )

    def _fallback_response(self) -> ClassifyExtractResponse:
        return ClassifyExtractResponse(
            intent="general",
            confidence=0.0,
            entities=ClassifyExtractEntities(),
            shouldReset=False,
        )

    def _parse_model_json(self, content: str) -> ClassifyExtractResponse:
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json", "", 1).strip()

        parsed = json.loads(cleaned)
        return ClassifyExtractResponse.model_validate(parsed)

    def classify_extract(self, text: str) -> ClassifyExtractResponse:
        if not self.client:
            return self._fallback_response()

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "Eres un clasificador. Devuelves solo JSON válido.",
                    },
                    {
                        "role": "user",
                        "content": self._build_prompt(text),
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0,
            )
        except Exception as exc:
            logger.exception("openai_request_failed: %s", exc)
            return self._fallback_response()

        try:
            content = response.choices[0].message.content or "{}"
            output = self._parse_model_json(content)
        except Exception as exc:
            logger.exception("openai_invalid_output: %s", exc)
            return self._fallback_response()

        lowered = text.lower()
        should_reset = ("menu" in lowered) or ("cambiar" in lowered)
        output.shouldReset = should_reset
        output.intent = "general" if should_reset else _detect_intent_rule(text)

        entities = output.entities or ClassifyExtractEntities()

        if entities.age is None:
            entities.age = _extract_age_rule(text)

        if entities.city is None:
            entities.city = _extract_city_rule(text)

        output.entities = entities
        output.confidence = max(0.0, min(1.0, float(output.confidence)))
        return output

_ia_service_instance = None


def get_ia_service() -> IAService:
    global _ia_service_instance
    if _ia_service_instance is None:
        _ia_service_instance = IAService()
    return _ia_service_instance
