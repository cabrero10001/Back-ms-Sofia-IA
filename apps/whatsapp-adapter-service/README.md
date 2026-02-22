# WhatsApp Adapter Service

Modo local de WhatsApp Web usando Baileys, con vinculacion por codigo o QR.

## Variables de entorno

```env
PORT=3051
ORCHESTRATOR_URL=http://localhost:3022/v1/orchestrator/handle-message
TENANT_ID=tenant_demo_flow
CHANNEL=WHATSAPP
WHATSAPP_SESSION_DIR=./bot_sessions
WHATSAPP_USE_PAIRING_CODE=true
WHATSAPP_PHONE_NUMBER=573001112233
WHATSAPP_PAIRING_INTERVAL_MS=8000
WHATSAPP_AUTO_PAIRING_ON_BOOT=false
WHATSAPP_RECONNECT_ON_405=false
LOG_LEVEL=debug
```

## Ejecutar

```bash
pnpm --filter whatsapp-adapter-service dev
```

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /pairing-code`
- `POST /pairing-code/refresh`
- `GET /qr`
- `POST /pairing-mode/code`

## Vinculacion

- Si `WHATSAPP_USE_PAIRING_CODE=true`, genera codigo con `POST /pairing-code/refresh` e ingresalo en WhatsApp > Dispositivos vinculados > Vincular con numero de telefono.
- Deja `WHATSAPP_AUTO_PAIRING_ON_BOOT=false` para que el codigo no rote solo mientras lo estas digitando.
- Deja `WHATSAPP_RECONNECT_ON_405=false` para evitar bucle de reconexion cuando WhatsApp responde 405.
- Si el codigo sigue fallando, usa QR (se imprime en terminal y tambien puedes pedirlo en `GET /qr`).
- Si aparece 405, el servicio cambia automaticamente a modo QR para permitir vinculacion; puedes volver a modo codigo con `POST /pairing-mode/code`.
- Si `WHATSAPP_USE_PAIRING_CODE=false`, se imprime QR en terminal.
