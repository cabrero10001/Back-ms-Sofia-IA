from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


@dataclass(frozen=True)
class PageText:
    page: int
    text: str


def _normalize_line_for_repetition(line: str) -> str:
    compact = " ".join(line.strip().split())
    return compact.lower()


def _clean_page_text(text: str) -> str:
    text = text.replace("\r", "\n")
    text = text.replace("-\n", "")
    lines = [" ".join(line.split()) for line in text.split("\n")]
    cleaned_lines = [line for line in lines if line]
    return "\n".join(cleaned_lines)


def load_pdf_pages(file_path: str) -> list[PageText]:
    pdf_path = Path(file_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF no encontrado: {pdf_path}")

    reader = PdfReader(str(pdf_path))
    raw_pages: list[PageText] = []
    edge_lines: list[str] = []

    for idx, page in enumerate(reader.pages, start=1):
        extracted = page.extract_text() or ""
        cleaned = _clean_page_text(extracted)
        raw_pages.append(PageText(page=idx, text=cleaned))

        if not cleaned:
            continue

        lines = [line for line in cleaned.split("\n") if line]
        edge_lines.extend(_normalize_line_for_repetition(line) for line in lines[:2])
        edge_lines.extend(_normalize_line_for_repetition(line) for line in lines[-2:])

    repeated = Counter(edge_lines)
    threshold = max(3, len(raw_pages) // 3)
    repeated_headers = {line for line, count in repeated.items() if count >= threshold and len(line) > 3}

    final_pages: list[PageText] = []
    for page in raw_pages:
        if not page.text:
            continue
        lines = [line for line in page.text.split("\n") if line]
        filtered = [line for line in lines if _normalize_line_for_repetition(line) not in repeated_headers]
        final_text = "\n".join(filtered).strip()
        if final_text:
            final_pages.append(PageText(page=page.page, text=final_text))

    return final_pages


def flatten_pages(pages: list[PageText]) -> tuple[str, list[tuple[int, int, int]]]:
    """
    Retorna texto unido + mapa de rangos por pagina: (page, start, end).
    """
    joined_parts: list[str] = []
    spans: list[tuple[int, int, int]] = []
    cursor = 0

    for idx, page in enumerate(pages):
        if idx > 0:
            separator = "\n\n"
            joined_parts.append(separator)
            cursor += len(separator)

        start = cursor
        joined_parts.append(page.text)
        cursor += len(page.text)
        spans.append((page.page, start, cursor))

    return "".join(joined_parts), spans
