# Evaluacion de Threshold RAG

Herramienta para calibrar `RAG_SCORE_THRESHOLD` sin romper el endpoint `/v1/ai/rag-answer`.

## Dataset

Archivo editable de preguntas:

- `app/data/evals/questions.json`

## Ejecucion (dry-run por defecto)

```powershell
python -m app.scripts.eval_rag --dry-run true --mode cosine --thresholds "0.60,0.65,0.70,0.72,0.75"
```

## Ejecucion con generacion (usa LLM)

```powershell
python -m app.scripts.eval_rag --mode llm --dry-run false --thresholds "0.70,0.72,0.75"
```

## Parametros utiles

- `--thresholds "0.60,0.65,0.70"`
- `--mode cosine|llm`
- `--topk 30`
- `--final-k 5`
- `--source consultorio_juridico`
- `--version v1`
- `--out-dir app/data/evals`

## Salidas

Se generan dos archivos por corrida:

- `app/data/evals/rag_eval_YYYYMMDD_HHMMSS.json`
- `app/data/evals/rag_eval_YYYYMMDD_HHMMSS.csv`

El JSON incluye:

- resultados por pregunta (scores, latencias, thresholdTriggered, usedChunkIds)
- resumen por threshold (`answerableRate`, `avgTop1Score`, `avgLatencyMs`, `rejectedCount`)
- recomendacion automatica de threshold.
