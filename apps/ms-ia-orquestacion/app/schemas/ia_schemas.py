from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Intent = Literal["general", "consulta_laboral", "soporte"]


class ClassifyExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ClassifyExtractEntities(BaseModel):
    city: str | None = None
    age: int | None = Field(default=None, ge=0, le=120)

    model_config = ConfigDict(extra="forbid")


class ClassifyExtractResponse(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0.0, le=1.0)
    entities: ClassifyExtractEntities
    shouldReset: bool = False

    model_config = ConfigDict(extra="forbid")


OUTPUT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["intent", "confidence", "entities"],
    "properties": {
        "intent": {"type": "string", "enum": ["general", "consulta_laboral", "soporte"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "entities": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "city": {"type": ["string", "null"]},
                "age": {"type": ["integer", "null"], "minimum": 0, "maximum": 120},
            },
        },
        "shouldReset": {"type": "boolean"},
    },
}
