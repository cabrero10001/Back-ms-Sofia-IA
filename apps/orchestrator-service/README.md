# Orchestrator Service

## Variables de entorno

```env
PORT=3021
CONVERSATION_SERVICE_URL=http://localhost:3010
AI_SERVICE_URL=http://127.0.0.1:3040
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
