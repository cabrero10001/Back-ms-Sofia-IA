# SOFIA - Back (Monorepo)

Backend del proyecto SOFIA con servicios en Node/TypeScript y un servicio de IA en Python (FastAPI).

## Servicios actuales

| Puerto | Servicio | Stack |
|---|---|---|
| `3000` | `api-gateway-bff` | Express + TypeScript |
| `3010` | `conversation-service` | Express + TypeScript + Prisma |
| `3021` | `orchestrator-service` | Express + TypeScript |
| `3050` | `telegram-adapter-service` | Express + TypeScript |
| `3051` | `whatsapp-adapter-service` | Express + TypeScript + Baileys |
| `3004` | `ms-citas-agenda` | Express + TypeScript |
| `3040` (recomendado) | `ms-ia-orquestacion` | FastAPI + Python |

## Requisitos

- Node.js `>= 20`
- pnpm `>= 9`
- Docker + Docker Compose
- Python `>= 3.11` (para `ms-ia-orquestacion`)

## 1) Instalacion local

Desde la raiz del repo:

```bash
pnpm install
```

## 2) Variables de entorno

Copia los ejemplos a `.env` en los servicios que vayas a levantar.

Ejemplo minimo:

- `packages/prisma/.env.example` -> `packages/prisma/.env`
- `apps/conversation-service/.env.example` -> `apps/conversation-service/.env`
- `apps/orchestrator-service/.env.example` -> `apps/orchestrator-service/.env`
- `apps/telegram-adapter-service/.env.example` -> `apps/telegram-adapter-service/.env`
- `apps/whatsapp-adapter-service/.env.example` -> `apps/whatsapp-adapter-service/.env`
- `apps/api-gateway-bff/.env.example` -> `apps/api-gateway-bff/.env`

Nota: si corres IA en `3040`, valida que `AI_SERVICE_URL` y `ORCH_RAG_BASE_URL` apunten a `http://127.0.0.1:3040`.

## 3) Base de datos (Postgres)

Levanta Postgres:

```bash
pnpm docker:up
```

Aplica schema/migraciones:

```bash
pnpm db:generate
pnpm db:migrate -- --name init
```

Opcional seed:

```bash
pnpm db:seed
```

## 4) Build de paquetes compartidos

Si es primera ejecucion local, compila estos paquetes una vez:

```bash
pnpm --filter @sofia/shared-kernel run build
pnpm --filter @sofia/config run build
pnpm --filter @sofia/observability run build
pnpm --filter @sofia/http-client run build
pnpm --filter @sofia/prisma run build
```

## 5) Levantar servicios en local

Abre una terminal por servicio:

```bash
pnpm --filter conversation-service dev
pnpm --filter orchestrator-service dev
pnpm --filter telegram-adapter-service dev
pnpm --filter whatsapp-adapter-service dev
pnpm --filter api-gateway-bff dev
```

### IA (FastAPI)

```bash
cd apps/ms-ia-orquestacion
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/Mac
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 3040
```

## 6) Verificaciones rapidas

```bash
curl http://localhost:3000/health
curl http://localhost:3010/health
curl http://localhost:3021/health
curl http://localhost:3050/health
curl http://localhost:3051/health
curl http://127.0.0.1:3040/health
```

## WhatsApp local (vincular celular)

Servicio: `apps/whatsapp-adapter-service`

- Si usas codigo: `POST /pairing-code/refresh`
- Si falla por `405`, usa QR (fallback):
  - se imprime en terminal
  - tambien disponible en `GET /qr`

Recomendado para vincular:

1. Borra sesiones previas en `apps/whatsapp-adapter-service/bot_sessions`.
2. Inicia `whatsapp-adapter-service`.
3. Si `pairing-code` falla, escanea QR inmediatamente.

## Prisma Studio

Desde la raiz:

```bash
pnpm db:studio
```

## Comandos utiles

- `pnpm docker:up` / `pnpm docker:down`
- `pnpm db:generate`
- `pnpm db:migrate -- --name <nombre>`
- `pnpm db:seed`
- `pnpm db:studio`
- `pnpm build`
- `pnpm test`
