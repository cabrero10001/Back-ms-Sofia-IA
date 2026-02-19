from __future__ import annotations

from app.rag.retriever import ChunkCandidate


def build_grounded_prompt(query: str, top_chunks: list[ChunkCandidate]) -> tuple[str, str]:
    evidence = []
    for idx, chunk in enumerate(top_chunks, start=1):
        evidence.append(
            f"[E{idx}] source={chunk.source} chunk={chunk.chunk_index} page={chunk.page_start}-{chunk.page_end}\n"
            f"{chunk.text}"
        )

    context = "\n\n---\n\n".join(evidence)

    system_prompt = (
        "Eres un asistente juridico. Responde exclusivamente con evidencia del contexto. "
        "No inventes datos ni cites informacion fuera de los fragmentos. "
        "Solo responde con 'No tengo suficiente informacion en el documento' cuando ningun fragmento aporte evidencia util para la pregunta. "
        "Si hay evidencia parcial, responde con lo que si esta respaldado y aclara brevemente el limite. "
        "Si no hay evidencia suficiente responde exactamente: 'No tengo suficiente informacion en el documento'. "
        "Siempre escribe en espanol claro."
    )
    user_prompt = (
        f"Pregunta: {query}\n\n"
        f"Contexto verificable:\n{context}\n\n"
        "Da una respuesta breve, clara y sin mencionar fuentes, chunkIndex ni referencias tecnicas."
    )
    return system_prompt, user_prompt
