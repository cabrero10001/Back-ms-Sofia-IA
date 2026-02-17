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

### G) Prueba end-to-end por WhatsApp

1. Levanta `ms-ia-orquestacion`, `conversation-service`, `orchestrator-service` y `whatsapp-adapter-service`.
2. Envia desde WhatsApp una consulta laboral/juridica.
3. Revisa logs:
   - `orchestrator-service`: veras `correlationId`, `intent`, `ragLatencyMs`, `ragStatusCode`.
   - `whatsapp-adapter-service`: veras `correlationId` y `orchestrationCorrelationId` para trazar el mensaje.

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
