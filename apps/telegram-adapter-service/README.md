# Telegram Adapter Service

Este servicio conecta Telegram Bot API con `orchestrator-service`.

## Variables de entorno

Copiar `.env.example` a `.env` y ajustar:

```env
PORT=3050
ORCHESTRATOR_URL=http://localhost:3022/v1/orchestrator/handle-message
TENANT_ID=tenant_demo_flow
CHANNEL=WEBCHAT
TELEGRAM_BOT_TOKEN=1234567890:replace_with_bot_token
TELEGRAM_POLLING_ENABLED=true
TELEGRAM_POLL_TIMEOUT_S=25
LOG_LEVEL=debug
```

## Ejecutar

```bash
pnpm --filter telegram-adapter-service dev
```

## Endpoints

- `GET /health` -> `ok`
- `GET /ready` -> estado de polling y ultimo error

## Flujo

- Recibe mensajes desde Telegram usando long polling (`getUpdates`).
- Reenvia cada texto al `orchestrator-service`.
- Responde en Telegram con el texto retornado por el orchestrator.

## Requisitos

- `conversation-service` levantado (`3010`)
- `orchestrator-service` levantado (`3022`)
- `ms-ia-orquestacion` levantado (`3040`) si usas RAG
