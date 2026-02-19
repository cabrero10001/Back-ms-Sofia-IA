from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.logger import configure_logging, get_logger
from app.ingest.ingest_service import PDFIngestService, build_ingest_options


logger = get_logger("ms-ia-orquestacion.ingest.cli")


def _find_default_pdf() -> Path:
    service_root = Path(__file__).resolve().parents[2]
    candidates = [service_root / "data_docs", service_root / "data" / "docs"]
    for directory in candidates:
        if not directory.exists():
            continue
        pdfs = sorted(directory.glob("*.pdf"))
        if pdfs:
            return pdfs[0]

    raise FileNotFoundError("No se encontro PDF en data_docs ni en data/docs")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ingest masivo de PDF a Qdrant")
    parser.add_argument("--file", type=str, default=None, help="Ruta del PDF a ingestar")
    parser.add_argument("--doc-id", type=str, default=None, help="ID de documento")
    parser.add_argument("--source", type=str, default=None, help="Source del documento")
    parser.add_argument("--chunk-size", type=int, default=None, help="Tamano de chunk en caracteres")
    parser.add_argument("--overlap", type=int, default=None, help="Overlap de chunk en caracteres")
    parser.add_argument("--batch-size", type=int, default=None, help="Tamano de batch para embeddings")
    parser.add_argument("--version", type=str, default=None, help="Version logica del documento")
    parser.add_argument("--dry-run", action="store_true", help="No inserta en Qdrant, solo calcula reporte")
    parser.add_argument("--replace-source", action="store_true", help="Elimina docs previos del mismo source antes de ingestar")
    return parser


def main() -> int:
    configure_logging()
    settings = get_settings()
    parser = _build_parser()
    args = parser.parse_args()

    try:
        file_path = Path(args.file) if args.file else _find_default_pdf()
        options = build_ingest_options(
            file_path=str(file_path),
            doc_id=args.doc_id,
            source=args.source,
            chunk_size=args.chunk_size,
            overlap=args.overlap,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            version=args.version,
            replace_source=args.replace_source,
        )

        logger.info(
            "ingest_cli env=%s file=%s source=%s chunk_size=%d overlap=%d batch_size=%d dry_run=%s replace_source=%s",
            settings.env_path,
            options.file_path,
            options.source,
            options.chunk_size,
            options.overlap,
            options.batch_size,
            options.dry_run,
            options.replace_source,
        )

        service = PDFIngestService()
        report = service.ingest_pdf(options)
        print(json.dumps(report.to_dict(), ensure_ascii=True, indent=2))
        return 0

    except Exception as exc:
        logger.exception("ingest_cli_failed: %s", exc)
        print(json.dumps({"error": str(exc)}, ensure_ascii=True, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
