# WhatsApp Adapter Service

Adaptador temporal para pruebas end-to-end con WhatsApp Web usando BuilderBot + Baileys.

## Instalacion

```bash
pnpm -C apps/whatsapp-adapter-service install
```

## Variables de entorno

Copiar `.env.example` a `.env` y ajustar:

```env
PORT=3050
ORCHESTRATOR_URL=http://localhost:3022/v1/orchestrator/handle-message
TENANT_ID=tenant_demo_flow
CHANNEL=WHATSAPP
PHONE_NUMBER=+57XXXXXXXXXX
BAILEYS_USE_PAIRING_CODE=true
BAILEYS_SESSION_PATH=./.sessions
LOG_LEVEL=info
```

- Usa `LOG_LEVEL=debug` para ver eventos `connection.update` y errores detallados de Baileys.

## Ejecutar

```bash
pnpm -C apps/whatsapp-adapter-service dev
```

## Requisitos previos

- `orchestrator-service` levantado en `3022`
- `conversation-service` levantado en `3010`
- `ms-ia-orquestacion` levantado si el orchestrator depende de IA

## Pairing code (BAILEYS_USE_PAIRING_CODE=true)

Flujo recomendado para desarrollo local:

1) Borrar sesion previa para forzar nuevo pairing:

```powershell
Remove-Item -Recurse -Force .\apps\whatsapp-adapter-service\.sessions
```

2) Levantar el servicio:

```powershell
pnpm -C apps/whatsapp-adapter-service dev
```

3) Solicitar codigo de pairing por endpoint:

```powershell
Invoke-RestMethod http://localhost:3050/pairing-code
```

Comandos rapidos de verificacion:

```powershell
Invoke-RestMethod http://localhost:3050/health
Invoke-RestMethod http://localhost:3050/ready
Invoke-RestMethod http://localhost:3050/pairing
Invoke-RestMethod http://localhost:3050/pairing-code
```

4) Ver codigo en consola:

- Busca una linea como: `[whatsapp-adapter] PAIRING CODE: 123-456`

5) Vincular en WhatsApp:

- WhatsApp -> Dispositivos vinculados -> Vincular con numero
- Ingresa el codigo mostrado por `/pairing-code` o en consola

Notas:

- Si la sesion ya esta autenticada y conectada (`ready=true`), `/pairing-code` devuelve `pairingCode=null`.
- La sesion se persiste en `.sessions` para evitar re-pairing continuo.
- `.gitignore` ya incluye `apps/whatsapp-adapter-service/.sessions/` para no commitear sesiones.

## Endpoints de control

- `GET /health` -> `ok`
- `GET /ready` -> estado de conexion (`ready`, `lastConnectionState`, `lastError`)
- `GET /pairing` -> resumen de pairing (incluye codigo si disponible)
- `GET /pairing-code` -> codigo de pairing y ultimo error

## Limitaciones de Baileys

- Evitar botones/listas/interactive messages por compatibilidad.
- Usar mensajes de texto para pruebas de flujo.
