# Ingest Masivo RAG (PDF -> Mongo Atlas)

Este modulo agrega un pipeline de ingesta masiva robusto para RAG usando OpenAI SDK + MongoDB Atlas.

## Requisitos

- `OPENAI_API_KEY`
- `MONGODB_URI`
- `MONGODB_DB` (default: `sofia`)
- `MONGODB_COLLECTION` (default: `rag_documents`)
- `MONGODB_VECTOR_INDEX` (default: `vector_index_float32_ann`)
- `RAG_EMBED_MODEL` (default: `text-embedding-3-small`)
- `RAG_EMBED_DIM` **debe ser 1064**

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
- Se crean indices:
  - `uniq_text_hash` (unique)
  - `uniq_doc_chunk_version` (unique)
- Re-ejecutar no duplica datos; chunks iguales/version igual se cuentan como `skipped`.
- Embeddings usan batch + retries con backoff exponencial.

## Estructura del documento Mongo

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
