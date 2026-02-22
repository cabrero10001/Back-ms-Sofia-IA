# Orchestrator Service

## Variables de entorno

```env
PORT=3021
CONVERSATION_SERVICE_URL=http://localhost:3010
AI_SERVICE_URL=http://127.0.0.1:3040
ORCH_FLOW_MODE=stateful
ORCH_CONV_TTL_MIN=30
ORCH_RAG_ENABLED=true
ORCH_RAG_BASE_URL=http://127.0.0.1:3040
ORCH_RAG_ENDPOINT=/v1/ai/rag-answer
ORCH_RAG_TIMEOUT_MS=12000
```

Si ejecutas por Docker Compose, usa el host del servicio Python, por ejemplo:

```env
ORCH_RAG_BASE_URL=http://ms-ia-orquestacion:3040
```

Flujo conversacional recomendado (stateful):

- `Hola` -> menu de categorias (laboral/soporte)
- `laboral` o `1` -> pide consulta laboral y usa RAG
- `soporte` o `2` -> flujo de soporte
- `reset` -> reinicia estado de conversacion

## Orden ideal del flujo end-to-end

1. `telegram-adapter-service` o `whatsapp-adapter-service` recibe el mensaje del proveedor.
2. El adapter llama a `POST /v1/orchestrator/handle-message` en `orchestrator-service`.
3. `orchestrator-service` decide el flow/step:
   - **consulta laboral/jurídica** -> llama a `POST /v1/ai/rag-answer` en `ms-ia-orquestacion`.
   - **soporte** -> sigue flujo de soporte (sin RAG).
   - **reset** -> limpia estado y vuelve al menú.
4. `orchestrator-service` responde al adapter con `responses[]` y `correlationId` para trazabilidad.
5. El adapter envia al usuario el `responses[0].text`.

## Contrato recomendado (ideal)

Formato recomendado para clientes (incluyendo telegram-adapter):

```json
{
  "tenantId": "tenant_ai_demo",
  "channel": "webchat",
  "externalUserId": "user-123",
  "message": {
    "type": "text",
    "text": "laboral",
    "payload": {
      "providerRaw": {}
    }
  }
}
```

Regla: `message.text` es el texto canónico. El orquestador mantiene compatibilidad hacia atras y tambien acepta:

- `text` (root)
- `message.message`
- `message.body`
- `message.text.body`

Payload mínimo recomendado hacia orchestrator:

```json
{
  "tenantId": "tenant_ai_demo",
  "channel": "telegram",
  "externalUserId": "573001112233",
  "message": {
    "type": "text",
    "text": "laboral"
  }
}
```

`message.payload` se puede usar para adjuntar metadata raw del provider si se necesita auditoría/debug.

## Payload recomendado hacia RAG

Endpoint: `POST http://127.0.0.1:3040/v1/ai/rag-answer`

Forma mínima:

```json
{ "query": "¿Cuántos días de vacaciones me corresponden?" }
```

Forma alterna:

```json
{
  "question": "¿Cuántos días de vacaciones me corresponden?",
  "source": "consultorio_juridico",
  "tenantId": "tenant_ai_demo"
}
```

Con filtros:

```json
{
  "query": "¿Cómo se calcula liquidación?",
  "filters": {
    "source": "consultorio_juridico",
    "tenantId": "tenant_ai_demo"
  }
}
```

### curl (copiable)

```bash
curl -X POST "http://127.0.0.1:3040/v1/ai/rag-answer" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: rag-manual-001" \
  -d '{"query":"¿Cómo se calcula liquidación?","filters":{"source":"consultorio_juridico","tenantId":"tenant_ai_demo"}}'
```

### PowerShell (UTF-8 recomendado para FastAPI)

```powershell
$payload = @{
  query = "¿Cómo se calcula liquidación?"
  filters = @{ source = "consultorio_juridico"; tenantId = "tenant_ai_demo" }
}
$json = $payload | ConvertTo-Json -Depth 10
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3040/v1/ai/rag-answer" `
  -Headers @{ "x-correlation-id" = "rag-manual-001" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes
```

## Ejecutar

```bash
pnpm -C apps/orchestrator-service dev
```

## Pruebas PowerShell

### A) Reset

```powershell
$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"reset-user","message":{"type":"text","text":"menu quiero cambiar"}}'
$res | ConvertTo-Json -Depth 20
```

### B) Laboral

```powershell
$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"laboral-user","message":{"type":"text","text":"Hola"}}'
$res | ConvertTo-Json -Depth 20

$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"laboral-user","message":{"type":"text","text":"laboral"}}'
$res | ConvertTo-Json -Depth 20

$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"laboral-user","message":{"type":"text","text":"Cali"}}'
$res | ConvertTo-Json -Depth 20

$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"laboral-user","message":{"type":"text","text":"29"}}'
$res | ConvertTo-Json -Depth 20
```

### D) Prueba directa RAG desde Orchestrator

```powershell
curl.exe -X POST "http://127.0.0.1:3040/v1/ai/rag-answer" ^
  -H "Content-Type: application/json" ^
  -H "x-correlation-id: orch-manual-test" ^
  -d "{\"query\":\"Tengo dudas sobre vacaciones y liquidacion\"}"
```

### E) Prueba flujo real (intent laboral -> RAG)

```powershell
$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"rag-user","message":{"type":"text","text":"Me despidieron sin justa causa, como calculo mi liquidacion?"}}'
$res | ConvertTo-Json -Depth 20
```

### F) Prueba stateful (menu -> laboral -> pregunta -> reset)

```powershell
$user = "stateful-user"

Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body "{\"tenantId\":\"tenant_ai_demo\",\"channel\":\"webchat\",\"externalUserId\":\"$user\",\"message\":{\"type\":\"text\",\"text\":\"Hola\"}}" | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body "{\"tenantId\":\"tenant_ai_demo\",\"channel\":\"webchat\",\"externalUserId\":\"$user\",\"message\":{\"type\":\"text\",\"text\":\"laboral\"}}" | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body "{\"tenantId\":\"tenant_ai_demo\",\"channel\":\"webchat\",\"externalUserId\":\"$user\",\"message\":{\"type\":\"text\",\"text\":\"Cuantos dias de vacaciones me corresponden?\"}}" | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body "{\"tenantId\":\"tenant_ai_demo\",\"channel\":\"webchat\",\"externalUserId\":\"$user\",\"message\":{\"type\":\"text\",\"text\":\"reset\"}}" | ConvertTo-Json -Depth 20
```

### F2) Nota PowerShell (JSON robusto)

Para evitar errores de parseo en algunos clientes/servicios, puedes enviar bytes UTF-8:

```powershell
$payload = @{
  tenantId = "tenant_ai_demo"
  channel = "webchat"
  externalUserId = "ps-user"
  message = @{ type = "text"; text = "Hola" }
}
$json = $payload | ConvertTo-Json -Depth 10
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes
```

### F3) Verificacion automatica de input variants

Con el servicio levantado:

```bash
pnpm -C apps/orchestrator-service verify:input
```

El script valida:

- Hola -> menu
- laboral -> sale del menu y pasa a step laboral
- soporte -> pasa a collecting_issue
- reset -> reinicia
- matriz de variantes de texto (`root.text`, `message.message`, `message.text`, `message.body`, `message.text.body`)

### G) Prueba end-to-end por Telegram/WhatsApp

1. Levanta `ms-ia-orquestacion`, `conversation-service`, `orchestrator-service` y el adapter del canal que quieras (`telegram-adapter-service` o `whatsapp-adapter-service`).
2. Envia desde Telegram o WhatsApp una consulta laboral/juridica.
3. Revisa logs:
   - `orchestrator-service`: veras `correlationId`, `intent`, `ragLatencyMs`, `ragStatusCode`.
   - adapter del canal: veras `correlationId` y `orchestrationCorrelationId` para trazar el mensaje.

### C) Soporte

```powershell
$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"soporte-user","message":{"type":"text","text":"soporte"}}'
$res | ConvertTo-Json -Depth 20

$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3021/v1/orchestrator/handle-message" `
  -ContentType "application/json" `
  -Body '{"tenantId":"tenant_ai_demo","channel":"webchat","externalUserId":"soporte-user","message":{"type":"text","text":"tengo un error al iniciar sesión"}}'
$res | ConvertTo-Json -Depth 20
```
