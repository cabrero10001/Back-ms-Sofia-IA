from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    chunk_index: int
    text: str
    normalized_text: str
    start_char: int
    end_char: int
    page_start: int | None
    page_end: int | None


def normalize_text(text: str) -> str:
    text = text.replace("\r", "\n")
    text = text.replace("-\n", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _infer_page_range(spans: list[tuple[int, int, int]], start: int, end: int) -> tuple[int | None, int | None]:
    pages: list[int] = []
    for page, p_start, p_end in spans:
        overlaps = (p_start < end) and (start < p_end)
        if overlaps:
            pages.append(page)

    if not pages:
        return None, None
    return min(pages), max(pages)


def _find_split_point(text: str, start: int, target_end: int, hard_end: int) -> int:
    window = text[start:hard_end]
    sentence_breaks = [m.start() for m in re.finditer(r"[\.!?]\s", window)]
    line_breaks = [m.start() for m in re.finditer(r"\n", window)]
    spaces = [m.start() for m in re.finditer(r"\s", window)]

    candidates = sentence_breaks or line_breaks or spaces
    if not candidates:
        return hard_end

    absolute_candidates = [start + c + 1 for c in candidates]
    near = [c for c in absolute_candidates if c <= hard_end and c >= start + 1]
    if not near:
        return hard_end

    return min(near, key=lambda c: abs(c - target_end))


def chunk_text(
    text: str,
    page_spans: list[tuple[int, int, int]],
    chunk_size: int,
    overlap: int,
    min_chunk_size: int,
) -> list[Chunk]:
    if chunk_size <= 0:
        raise ValueError("chunk_size debe ser > 0")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap debe ser >= 0 y menor que chunk_size")

    normalized = normalize_text(text)
    if not normalized:
        return []

    chunks: list[Chunk] = []
    start = 0
    index = 0
    text_len = len(normalized)

    while start < text_len:
        target_end = min(start + chunk_size, text_len)
        hard_end = min(start + int(chunk_size * 1.15), text_len)
        end = _find_split_point(normalized, start, target_end, hard_end)

        if end <= start:
            end = min(start + chunk_size, text_len)

        chunk_text_raw = normalized[start:end].strip()
        if len(chunk_text_raw) < min_chunk_size and end < text_len:
            end = min(text_len, start + chunk_size)
            chunk_text_raw = normalized[start:end].strip()

        if chunk_text_raw:
            page_start, page_end = _infer_page_range(page_spans, start, end)
            chunks.append(
                Chunk(
                    chunk_index=index,
                    text=chunk_text_raw,
                    normalized_text=normalize_text(chunk_text_raw),
                    start_char=start,
                    end_char=end,
                    page_start=page_start,
                    page_end=page_end,
                )
            )
            index += 1

        if end >= text_len:
            break
        start = max(0, end - overlap)

    return chunks
