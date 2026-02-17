from __future__ import annotations

import json
import math
from typing import Any

from openai import OpenAI

from app.rag.retriever import ChunkCandidate


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def rerank_cosine(
    query_embedding: list[float],
    candidates: list[ChunkCandidate],
    mongo_weight: float = 0.7,
    cosine_weight: float = 0.3,
) -> list[ChunkCandidate]:
    scored: list[ChunkCandidate] = []
    for candidate in candidates:
        cosine_score = _cosine_similarity(query_embedding, candidate.embedding) if candidate.embedding else candidate.mongo_score
        combined = (mongo_weight * candidate.mongo_score) + (cosine_weight * cosine_score)
        candidate.rerank_score = float(combined)
        scored.append(candidate)

    return sorted(scored, key=lambda c: c.rerank_score or 0.0, reverse=True)


def rerank_llm(
    client: OpenAI,
    query: str,
    candidates: list[ChunkCandidate],
    model: str,
    max_candidates: int = 12,
) -> list[ChunkCandidate]:
    if not candidates:
        return []

    clipped = candidates[:max_candidates]
    snippets = []
    for idx, candidate in enumerate(clipped):
        text = candidate.text[:450]
        snippets.append(f"[{idx}] {text}")

    system_prompt = (
        "Eres un reranker. Ordena los fragmentos por relevancia a la pregunta. "
        "Responde SOLO JSON valido: {\"ranking\": [{\"index\": 0, \"score\": 0.93}]}."
    )
    user_prompt = f"Pregunta: {query}\n\nFragmentos:\n" + "\n\n".join(snippets)

    completion = client.with_options(timeout=20, max_retries=1).chat.completions.create(
        model=model,
        temperature=0.0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = completion.choices[0].message.content or "{}"
    parsed = json.loads(raw.strip().strip("`").replace("json", "", 1).strip())
    ranking = parsed.get("ranking", [])

    reranked: list[ChunkCandidate] = []
    for item in ranking:
        idx = item.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(clipped):
            continue
        candidate = clipped[idx]
        score = float(item.get("score", candidate.mongo_score))
        candidate.rerank_score = score
        reranked.append(candidate)

    if not reranked:
        return rerank_cosine([], clipped)

    seen = {candidate.chunk_id for candidate in reranked}
    for candidate in clipped:
        if candidate.chunk_id in seen:
            continue
        candidate.rerank_score = candidate.mongo_score
        reranked.append(candidate)
    return reranked


def rerank_candidates(
    mode: str,
    query: str,
    query_embedding: list[float],
    candidates: list[ChunkCandidate],
    openai_client: OpenAI | None,
    llm_model: str,
) -> list[ChunkCandidate]:
    selected_mode = (mode or "cosine").lower()
    if selected_mode == "llm" and openai_client is not None:
        try:
            return rerank_llm(openai_client, query, candidates, model=llm_model)
        except Exception:
            return rerank_cosine(query_embedding, candidates)
    return rerank_cosine(query_embedding, candidates)


def should_reject_by_threshold(best_score: float | None, threshold: float) -> bool:
    if best_score is None:
        return True
    return best_score < threshold
