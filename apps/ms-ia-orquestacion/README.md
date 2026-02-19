# ms-ia-orquestacion

Servicio FastAPI para IA/RAG.

## Backend vectorial

Este servicio usa Qdrant como vector store.

Variables requeridas:

- `OPENAI_API_KEY`
- `QDRANT_URL`
- `QDRANT_COLLECTION`
- `QDRANT_API_KEY` (si tu cluster lo exige)

## Endpoint RAG

- Ruta: `POST /v1/ai/rag-answer`
- Health: `GET /health`

### Contrato de request (compatible)

Se aceptan estas variantes:

1) Minimo:

```json
{ "query": "¿Cuántos días de vacaciones me corresponden?" }
```

2) Extendida:

```json
{
  "question": "¿Cuántos días de vacaciones me corresponden?",
  "source": "consultorio_juridico",
  "tenantId": "tenant_ai_demo"
}
```

3) Con filtros:

```json
{
  "query": "¿Cómo se calcula liquidación?",
  "filters": {
    "source": "consultorio_juridico",
    "tenantId": "tenant_ai_demo"
  }
}
```

Prioridad de pregunta: `query` -> `question`.

### Contrato de respuesta

Se mantiene compatibilidad:

```json
{
  "answer": "...",
  "citations": [],
  "usedChunks": [],
  "confidenceScore": 0.64,
  "bestScore": 0.64,
  "status": "ok",
  "correlationId": "rag-validate-A-001"
}
```

## Trazabilidad (Correlation)

Enviar header `x-correlation-id` (o `x-request-id`).
El servicio devuelve `X-Correlation-Id` y `X-Request-Id` en respuesta.

## Ejemplos

### curl

```bash
curl -X POST "http://127.0.0.1:3040/v1/ai/rag-answer" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: rag-manual-001" \
  -d "{\"query\":\"¿Cuántos días de vacaciones me corresponden?\",\"source\":\"consultorio_juridico\",\"tenantId\":\"tenant_ai_demo\"}"
```

### PowerShell (UTF-8 recomendado)

```powershell
$payload = @{
  query = "¿Cómo se calcula liquidación?"
  filters = @{ source = "consultorio_juridico"; tenantId = "tenant_ai_demo" }
}
$json = $payload | ConvertTo-Json -Depth 10
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3040/v1/ai/rag-answer" `
  -Headers @{ "x-correlation-id" = "rag-manual-002" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes
```

## Script de validacion

```powershell
powershell -ExecutionPolicy Bypass -File .\app\scripts\validate_rag.ps1 -BaseUrl "http://127.0.0.1:3040"
```
