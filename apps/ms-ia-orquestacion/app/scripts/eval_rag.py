from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any

from app.core.logger import configure_logging, get_logger
from app.services.rag_service import get_rag_service


logger = get_logger("ms-ia-orquestacion.eval-rag")


def _str_to_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_thresholds(raw: str) -> list[float]:
    values = []
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        values.append(float(item))
    if not values:
        raise ValueError("Debes proveer al menos un threshold")
    return values


def _load_questions(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("questions.json debe ser una lista de strings")
    questions = [str(item).strip() for item in data if str(item).strip()]
    if not questions:
        raise ValueError("questions.json no contiene preguntas validas")
    return questions


def _evaluate_suspicious(answerable: bool, used_chunks_count: int, answer_length: int | None) -> bool:
    if not answerable:
        return False
    if used_chunks_count == 0:
        return True
    if answer_length is not None and answer_length <= 20:
        return True
    return False


def _recommend_threshold(summary: list[dict[str, Any]]) -> dict[str, Any]:
    if not summary:
        return {"recommendedThreshold": None, "reason": "Sin datos"}

    # Heuristica: maximize answerable while penalizing suspicious.
    best = None
    best_score = -1.0
    for item in summary:
        answerable_rate = float(item["answerableRate"])
        suspicious_rate = float(item["suspiciousRate"])
        avg_top1 = float(item["avgTop1Score"]) if item["avgTop1Score"] is not None else 0.0
        utility = (answerable_rate * 1.0) + (avg_top1 * 0.35) - (suspicious_rate * 0.8)
        if utility > best_score:
            best_score = utility
            best = item

    if best is None:
        return {"recommendedThreshold": None, "reason": "No fue posible calcular recomendacion"}

    recommendation = float(best["threshold"])
    return {
        "recommendedThreshold": recommendation,
        "reason": (
            "Balance entre mayor tasa de respuestas aceptables y menor tasa de casos sospechosos "
            f"(answerableRate={best['answerableRate']}, suspiciousRate={best['suspiciousRate']}, avgTop1={best['avgTop1Score']})"
        ),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluacion de thresholds para pipeline RAG")
    parser.add_argument("--thresholds", default="0.60,0.65,0.70,0.72,0.75,0.78")
    parser.add_argument("--mode", choices=["cosine", "llm"], default="cosine")
    parser.add_argument("--topk", type=int, default=30)
    parser.add_argument("--final-k", type=int, default=5)
    parser.add_argument("--source", type=str, default="consultorio_juridico")
    parser.add_argument("--version", type=str, default="")
    parser.add_argument("--dry-run", default="true")
    parser.add_argument("--out-dir", default="app/data/evals")
    parser.add_argument("--questions", default="app/data/evals/questions.json")
    return parser


def main() -> int:
    configure_logging()
    parser = _build_parser()
    args = parser.parse_args()

    thresholds = _parse_thresholds(args.thresholds)
    dry_run = _str_to_bool(str(args.dry_run))

    questions_path = Path(args.questions)
    questions = _load_questions(questions_path)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    service = get_rag_service()
    rows: list[dict[str, Any]] = []
    threshold_buckets: dict[float, list[dict[str, Any]]] = {threshold: [] for threshold in thresholds}

    logger.info(
        "eval_rag start questions=%d thresholds=%s mode=%s topk=%d final_k=%d dry_run=%s source=%s",
        len(questions),
        thresholds,
        args.mode,
        args.topk,
        args.final_k,
        dry_run,
        args.source,
    )

    for threshold in thresholds:
        for query in questions:
            try:
                result = service.rag_evaluate(
                    query=query,
                    filters=None,
                    overrides={
                        "candidate_topk": args.topk,
                        "final_k": args.final_k,
                        "score_threshold": threshold,
                        "rerank_mode": args.mode,
                        "rerank_enabled": True,
                        "source_filter": args.source if args.source else None,
                        "version_filter": args.version if args.version else None,
                        "dry_run": dry_run,
                    },
                    dry_run=dry_run,
                )

                metrics = result.get("metrics", {})
                response = result.get("response", {})
                answerable = bool(metrics.get("answerable"))
                used_chunks_count = int(metrics.get("usedChunksCount", 0))
                answer = str(response.get("answer") or "")
                answer_length = None if dry_run else len(answer)
                suspicious = _evaluate_suspicious(answerable, used_chunks_count, answer_length)

                row = {
                    "query": query,
                    "threshold": threshold,
                    "rerankMode": args.mode,
                    "candidateTopK": args.topk,
                    "finalK": args.final_k,
                    "sourceFilter": args.source,
                    "versionFilter": args.version or None,
                    "answerable": answerable,
                    "thresholdTriggered": bool(metrics.get("thresholdTriggered")),
                    "top1Score": metrics.get("top1Score"),
                    "top5Scores": metrics.get("top5Scores", []),
                    "latencyTotalMs": metrics.get("latencyMs", {}).get("total"),
                    "latencyRetrievalMs": metrics.get("latencyMs", {}).get("retrieval"),
                    "latencyRerankMs": metrics.get("latencyMs", {}).get("rerank"),
                    "latencyGenerateMs": metrics.get("latencyMs", {}).get("generate"),
                    "usedChunksCount": used_chunks_count,
                    "usedChunkIds": metrics.get("usedChunkIds", []),
                    "answerLength": answer_length,
                    "suspicious": suspicious,
                    "error": None,
                }
            except Exception as exc:  # pragma: no cover
                row = {
                    "query": query,
                    "threshold": threshold,
                    "rerankMode": args.mode,
                    "candidateTopK": args.topk,
                    "finalK": args.final_k,
                    "sourceFilter": args.source,
                    "versionFilter": args.version or None,
                    "answerable": False,
                    "thresholdTriggered": False,
                    "top1Score": None,
                    "top5Scores": [],
                    "latencyTotalMs": None,
                    "latencyRetrievalMs": None,
                    "latencyRerankMs": None,
                    "latencyGenerateMs": None,
                    "usedChunksCount": 0,
                    "usedChunkIds": [],
                    "answerLength": None,
                    "suspicious": True,
                    "error": str(exc),
                }

            rows.append(row)
            threshold_buckets[threshold].append(row)

    summary: list[dict[str, Any]] = []
    for threshold in thresholds:
        bucket = threshold_buckets[threshold]
        total = len(bucket)
        answerable_count = sum(1 for row in bucket if row["answerable"])
        rejected_count = sum(1 for row in bucket if row["thresholdTriggered"])
        suspicious_count = sum(1 for row in bucket if row["suspicious"])

        top1_values = [float(row["top1Score"]) for row in bucket if row["top1Score"] is not None]
        latency_values = [float(row["latencyTotalMs"]) for row in bucket if row["latencyTotalMs"] is not None]

        summary.append(
            {
                "threshold": threshold,
                "queries": total,
                "answerableRate": round(answerable_count / total, 4) if total else 0.0,
                "rejectedCount": rejected_count,
                "suspiciousRate": round(suspicious_count / total, 4) if total else 0.0,
                "avgTop1Score": round(mean(top1_values), 4) if top1_values else None,
                "avgLatencyMs": round(mean(latency_values), 2) if latency_values else None,
            }
        )

    recommendation = _recommend_threshold(summary)
    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"rag_eval_{now}.json"
    csv_path = out_dir / f"rag_eval_{now}.csv"

    report_payload = {
        "generatedAt": datetime.now().isoformat(),
        "config": {
            "thresholds": thresholds,
            "mode": args.mode,
            "topk": args.topk,
            "finalK": args.final_k,
            "source": args.source,
            "version": args.version or None,
            "dryRun": dry_run,
            "questionsFile": str(questions_path),
        },
        "summary": summary,
        "recommendation": recommendation,
        "rows": rows,
    }
    json_path.write_text(json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_columns = [
        "query",
        "threshold",
        "rerankMode",
        "candidateTopK",
        "finalK",
        "sourceFilter",
        "versionFilter",
        "answerable",
        "thresholdTriggered",
        "top1Score",
        "top5Scores",
        "latencyTotalMs",
        "latencyRetrievalMs",
        "latencyRerankMs",
        "latencyGenerateMs",
        "usedChunksCount",
        "usedChunkIds",
        "answerLength",
        "suspicious",
        "error",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=csv_columns)
        writer.writeheader()
        for row in rows:
            csv_row = row.copy()
            csv_row["top5Scores"] = json.dumps(csv_row["top5Scores"], ensure_ascii=False)
            csv_row["usedChunkIds"] = json.dumps(csv_row["usedChunkIds"], ensure_ascii=False)
            writer.writerow(csv_row)

    print(f"JSON report: {json_path}")
    print(f"CSV report : {csv_path}")
    print(f"Recommendation: threshold={recommendation.get('recommendedThreshold')} | {recommendation.get('reason')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
