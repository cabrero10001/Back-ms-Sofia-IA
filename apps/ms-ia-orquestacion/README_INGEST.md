# Ingest Masivo RAG (PDF -> Qdrant)

Este modulo agrega un pipeline de ingesta masiva robusto para RAG usando OpenAI SDK + Qdrant.

## Requisitos

- `OPENAI_API_KEY`
- `QDRANT_URL`
- `QDRANT_COLLECTION` (default: `rag_documents`)
- `QDRANT_API_KEY` (si aplica)
- `RAG_EMBED_MODEL` (default: `text-embedding-3-small`)
- `RAG_EMBED_DIM` **debe coincidir con la dimension de la coleccion en Qdrant** (recomendado: `1536`)

Opcionales:

- `RAG_INGEST_CHUNK_SIZE` (default: `1000`)
- `RAG_INGEST_CHUNK_OVERLAP` (default: `150`)
- `RAG_INGEST_MIN_CHUNK_SIZE` (default: `300`)
- `RAG_EMBED_BATCH_SIZE` (default: `64`)
- `RAG_INGEST_SOURCE` (default: `consultorio_juridico`)
- `RAG_INGEST_VERSION` (default: `v1`)

## Ejecutar

Desde `apps/ms-ia-orquestacion`:

```powershell
python -m pip install -r .\requirements.txt
python -m app.scripts.ingest_pdf --dry-run
```

Si no pasas `--file`, busca el primer PDF en `data_docs/` y luego en `data/docs/`.

### Ejemplo (real)

```powershell
python -m app.scripts.ingest_pdf --file ".\data\docs\SOF-IA CHATBOT CONSULTORIO JURIDICO.docx.pdf" --doc-id "consultorio-juridico-v1" --source "consultorio_juridico" --chunk-size 1000 --overlap 150 --batch-size 64
```

### Argumentos CLI

- `--file`
- `--doc-id`
- `--source`
- `--chunk-size`
- `--overlap`
- `--batch-size`
- `--version`
- `--dry-run`
- `--replace-source` (borra docs previos del mismo source)

## Actualizar corpus tras cambiar PDF

Si cambiaste el documento y quieres evitar que queden chunks viejos:

```powershell
python -m app.scripts.ingest_pdf --file ".\data\docs\SOF-IA CHATBOT CONSULTORIO JURIDICO V2.0.docx.pdf" --doc-id "consultorio-juridico-v2" --source "consultorio_juridico" --version "v2" --replace-source --chunk-size 1000 --overlap 150 --batch-size 32
```

Esto elimina primero todos los documentos con `source=consultorio_juridico` y luego ingesta la nueva version.

## Idempotencia y reintentos

- Cada chunk se identifica por `textHash = sha256(docId + chunkIndex + normalizedText)`.
- Qdrant usa `textHash` como `point_id`, por lo que `upsert` no duplica puntos.
- Si usas `--replace-source`, primero elimina los puntos del `source` y luego inserta la nueva version.
- Embeddings usan batch + retries con backoff exponencial.

## Estructura del payload en Qdrant

```json
{
  "docId": "consultorio-juridico-v1",
  "docName": "SOF-IA CHATBOT CONSULTORIO JURIDICO.docx",
  "source": "consultorio_juridico",
  "version": "v1",
  "chunkIndex": 0,
  "pageStart": 1,
  "pageEnd": 2,
  "text": "...",
  "textHash": "sha256...",
  "embedding": [0.123, -0.045, "..."],
  "createdAt": "2026-02-17T00:00:00Z",
  "updatedAt": "2026-02-17T00:00:00Z"
}
```

## Salida del reporte

El CLI imprime JSON con:

- `totalPages`, `totalChunks`
- `inserted`, `updated`, `skipped`
- `estimatedTokens`, `estimatedEmbeddingCostUsd`
- `durationMs`
