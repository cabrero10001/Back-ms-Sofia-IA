from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from qdrant_client import models

from app.ai.embeddings import embed_texts, estimate_tokens
from app.core.config import get_settings
from app.core.logger import get_logger
from app.db.qdrant import ensure_rag_collection, get_qdrant_client
from app.ingest.chunking import Chunk, chunk_text
from app.ingest.pdf_loader import flatten_pages, load_pdf_pages


logger = get_logger("ms-ia-orquestacion.ingest")


@dataclass(frozen=True)
class IngestOptions:
    file_path: str
    doc_id: str
    doc_name: str
    source: str
    version: str
    chunk_size: int
    overlap: int
    min_chunk_size: int
    batch_size: int
    dry_run: bool
    replace_source: bool


@dataclass
class IngestReport:
    filePath: str
    docId: str
    docName: str
    source: str
    version: str
    totalPages: int
    totalChunks: int
    inserted: int
    updated: int
    skipped: int
    estimatedTokens: int
    estimatedEmbeddingCostUsd: float
    durationMs: int
    sourceDocsDeleted: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _hash_chunk(doc_id: str, chunk: Chunk) -> str:
    base = f"{doc_id}|{chunk.chunk_index}|{chunk.normalized_text}".encode("utf-8")
    return hashlib.sha256(base).hexdigest()


def _point_id_from_hash(text_hash: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, text_hash))


def _estimate_embedding_cost_usd(token_count: int) -> float:
    # text-embedding-3-small ~ $0.02 / 1M tokens
    return round((token_count / 1_000_000) * 0.02, 6)


def _build_default_doc_name(file_path: str) -> str:
    return Path(file_path).stem


def _prepare_docs(options: IngestOptions, chunks: list[Chunk], embeddings: list[list[float]]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    docs: list[dict[str, Any]] = []

    for chunk, embedding in zip(chunks, embeddings):
        text_hash = _hash_chunk(options.doc_id, chunk)
        docs.append(
            {
                "docId": options.doc_id,
                "docName": options.doc_name,
                "source": options.source,
                "version": options.version,
                "chunkIndex": chunk.chunk_index,
                "pageStart": chunk.page_start,
                "pageEnd": chunk.page_end,
                "text": chunk.text,
                "textHash": text_hash,
                "embedding": embedding,
                "updatedAt": now,
            }
        )

    return docs


class PDFIngestService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = get_qdrant_client()

    def _count_source_points(self, source: str) -> int:
        total = 0
        offset: str | int | None = None
        source_filter = models.Filter(
            must=[models.FieldCondition(key="source", match=models.MatchValue(value=source))]
        )
        while True:
            points, next_offset = self.client.scroll(
                collection_name=self.settings.qdrant_collection,
                scroll_filter=source_filter,
                with_payload=False,
                with_vectors=False,
                limit=256,
                offset=offset,
            )
            total += len(points)
            if next_offset is None:
                return total
            offset = next_offset

    def ingest_pdf(self, options: IngestOptions) -> IngestReport:
        started = time.perf_counter()

        ensure_rag_collection()

        pages = load_pdf_pages(options.file_path)
        full_text, page_spans = flatten_pages(pages)
        chunks = chunk_text(
            text=full_text,
            page_spans=page_spans,
            chunk_size=options.chunk_size,
            overlap=options.overlap,
            min_chunk_size=options.min_chunk_size,
        )

        estimated_tokens = estimate_tokens([chunk.text for chunk in chunks], model=self.settings.embedding_model)
        estimated_cost = _estimate_embedding_cost_usd(estimated_tokens)

        logger.info(
            "ingest_pdf start file=%s pages=%d chunks=%d dry_run=%s",
            options.file_path,
            len(pages),
            len(chunks),
            options.dry_run,
        )

        if options.dry_run:
            duration_ms = int((time.perf_counter() - started) * 1000)
            return IngestReport(
                filePath=options.file_path,
                docId=options.doc_id,
                docName=options.doc_name,
                source=options.source,
                version=options.version,
                totalPages=len(pages),
                totalChunks=len(chunks),
                inserted=0,
                updated=0,
                skipped=len(chunks),
                estimatedTokens=estimated_tokens,
                estimatedEmbeddingCostUsd=estimated_cost,
                durationMs=duration_ms,
                sourceDocsDeleted=0,
            )

        inserted = 0
        updated = 0
        skipped = 0
        source_docs_deleted = 0

        if options.replace_source:
            source_docs_deleted = self._count_source_points(options.source)
            source_filter = models.Filter(
                must=[models.FieldCondition(key="source", match=models.MatchValue(value=options.source))]
            )
            self.client.delete(
                collection_name=self.settings.qdrant_collection,
                points_selector=models.FilterSelector(filter=source_filter),
            )
            logger.info(
                "ingest_pdf replace_source=true source=%s deleted=%d",
                options.source,
                source_docs_deleted,
            )

        for start_idx in range(0, len(chunks), options.batch_size):
            batch_chunks = chunks[start_idx: start_idx + options.batch_size]
            embeddings = embed_texts([chunk.text for chunk in batch_chunks], batch_size=options.batch_size)
            docs = _prepare_docs(options, batch_chunks, embeddings)

            points: list[models.PointStruct] = []
            for doc in docs:
                point_id = _point_id_from_hash(str(doc["textHash"]))
                points.append(
                    models.PointStruct(
                        id=point_id,
                        vector=doc["embedding"],
                        payload={
                            "docId": doc["docId"],
                            "docName": doc["docName"],
                            "source": doc["source"],
                            "version": doc["version"],
                            "chunkIndex": doc["chunkIndex"],
                            "pageStart": doc["pageStart"],
                            "pageEnd": doc["pageEnd"],
                            "text": doc["text"],
                            "textHash": doc["textHash"],
                            "updatedAt": doc["updatedAt"].isoformat() if isinstance(doc["updatedAt"], datetime) else str(doc["updatedAt"]),
                        },
                    )
                )

            self.client.upsert(collection_name=self.settings.qdrant_collection, points=points)
            inserted += len(points)

        duration_ms = int((time.perf_counter() - started) * 1000)
        report = IngestReport(
            filePath=options.file_path,
            docId=options.doc_id,
            docName=options.doc_name,
            source=options.source,
            version=options.version,
            totalPages=len(pages),
            totalChunks=len(chunks),
            inserted=inserted,
            updated=updated,
            skipped=skipped,
            estimatedTokens=estimated_tokens,
            estimatedEmbeddingCostUsd=estimated_cost,
            durationMs=duration_ms,
            sourceDocsDeleted=source_docs_deleted,
        )
        logger.info("ingest_pdf end report=%s", json.dumps(report.to_dict(), ensure_ascii=True))
        return report


def build_ingest_options(
    file_path: str,
    doc_id: str | None,
    source: str | None,
    chunk_size: int | None,
    overlap: int | None,
    batch_size: int | None,
    dry_run: bool,
    version: str | None,
    replace_source: bool,
) -> IngestOptions:
    settings = get_settings()
    path = Path(file_path)

    return IngestOptions(
        file_path=str(path),
        doc_id=doc_id or path.stem,
        doc_name=_build_default_doc_name(str(path)),
        source=source or settings.source_default,
        version=version or settings.version_default,
        chunk_size=chunk_size or settings.chunk_size,
        overlap=overlap or settings.chunk_overlap,
        min_chunk_size=settings.min_chunk_size,
        batch_size=batch_size or settings.embedding_batch_size,
        dry_run=dry_run,
        replace_source=replace_source,
    )
