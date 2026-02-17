from __future__ import annotations

import random
import time
from functools import lru_cache
from typing import Iterable

import tiktoken
from openai import OpenAI

from app.core.config import get_settings
from app.core.logger import get_logger


logger = get_logger("ms-ia-orquestacion.embeddings")


@lru_cache(maxsize=1)
def get_openai_client() -> OpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY no configurada")
    return OpenAI(api_key=settings.openai_api_key)


def estimate_tokens(texts: Iterable[str], model: str | None = None) -> int:
    settings = get_settings()
    model_name = model or settings.embedding_model
    try:
        encoding = tiktoken.encoding_for_model(model_name)
    except Exception:
        encoding = tiktoken.get_encoding("cl100k_base")

    total = 0
    for text in texts:
        total += len(encoding.encode(text))
    return total


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for idx in range(0, len(items), size):
        yield items[idx: idx + size]


def embed_texts(texts: list[str], batch_size: int | None = None, max_retries: int | None = None) -> list[list[float]]:
    settings = get_settings()
    client = get_openai_client()
    if not texts:
        return []

    requested_batch_size = batch_size or settings.embedding_batch_size
    retries = max_retries if max_retries is not None else settings.embedding_max_retries
    embedded: list[list[float]] = []

    for batch in _chunks(texts, requested_batch_size):
        attempt = 0
        while True:
            attempt += 1
            try:
                response = client.embeddings.create(
                    model=settings.embedding_model,
                    input=batch,
                    dimensions=settings.embedding_dimensions,
                )

                ordered = sorted(response.data, key=lambda x: x.index)
                vectors = [item.embedding for item in ordered]

                for vector in vectors:
                    if len(vector) != settings.embedding_dimensions:
                        raise ValueError(
                            f"Embedding dimension mismatch: esperado={settings.embedding_dimensions}, recibido={len(vector)}"
                        )

                embedded.extend(vectors)
                break

            except Exception as exc:
                if attempt > retries:
                    raise RuntimeError(f"Error embedding batch tras {retries} reintentos: {exc}") from exc

                wait_s = min(8.0, (2 ** (attempt - 1)) + random.uniform(0.1, 0.7))
                logger.warning(
                    "embedding_batch_retry attempt=%d/%d wait=%.2fs reason=%s",
                    attempt,
                    retries,
                    wait_s,
                    exc,
                )
                time.sleep(wait_s)

    return embedded
