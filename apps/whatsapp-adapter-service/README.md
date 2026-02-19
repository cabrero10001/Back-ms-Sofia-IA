# WhatsApp Adapter Service

Adaptador para WhatsApp Business Platform (Cloud API de Meta).

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

```env
PORT=3050
ORCHESTRATOR_URL=http://localhost:3022/v1/orchestrator/handle-message
TENANT_ID=tenant_demo_flow
CHANNEL=WHATSAPP
LOG_LEVEL=info

META_VERIFY_TOKEN=replace-with-webhook-verify-token
META_GRAPH_VERSION=v21.0
META_PHONE_NUMBER_ID=123456789012345
META_ACCESS_TOKEN=replace-with-permanent-access-token
META_APP_SECRET=
```

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /webhook` (verificacion de Meta)
- `POST /webhook` (recepcion de mensajes)

## Configuracion en Meta

1. En tu app de Meta agrega producto **WhatsApp**.
2. Configura webhook apuntando a `https://<tu-dominio>/webhook`.
3. Usa en Meta el mismo valor de `META_VERIFY_TOKEN`.
4. Suscribe el campo `messages`.
5. Usa un access token valido en `META_ACCESS_TOKEN`.

## Ejecucion

```bash
pnpm -C apps/whatsapp-adapter-service dev
```

## Notas

- El adapter reenvia texto al orchestrator y responde con lo que devuelve.
- Si defines `META_APP_SECRET`, se valida firma `X-Hub-Signature-256`.
