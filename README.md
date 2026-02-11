# SOFIA - Plataforma Consultorio Jurídico Universitario

Monorepo con microservicios (Express + TypeScript), IA (FastAPI + Python), y dashboard web (React + Vite).

## Arquitectura

```
Puerto  Servicio
─────── ────────────────────────────
3000    api-gateway-bff          (Express – punto de entrada único)
3001    ms-identidad-acceso      (Express – auth: register/login/me)
3002    ms-atencion-whatsapp     (Express – webhook WhatsApp)
8000    ms-ia-orquestacion       (FastAPI – IA/RAG mock)
3004    ms-citas-agenda          (Express – CRUD citas)
3005    ms-gestion-estudiantes   (Express – CRUD estudiantes)
3006    ms-dashboard             (Express – endpoints dashboard)
3007    ms-consentimientos       (Express – consentimientos)
3008    ms-normativa             (Express – placeholder fase 2)
3009    ms-reportes-analitica    (Express – placeholder fase 2)
5173    dashboard-web            (React + Vite)
```

## Requisitos

- **Node.js** >= 20
- **pnpm** >= 9 (`npm i -g pnpm`)
- **Docker** y **Docker Compose**
- **Python** >= 3.11 (solo para ms-ia-orquestacion)

## Setup rápido

```bash
# 1. Clonar e instalar dependencias Node
pnpm install

# 2. Levantar Postgres
pnpm docker:up

# 3. Copiar .env desde el ejemplo (raíz + cada app que lo necesite)
cp .env.example .env
cp packages/prisma/.env.example packages/prisma/.env
cp apps/ms-identidad-acceso/.env.example apps/ms-identidad-acceso/.env
cp apps/api-gateway-bff/.env.example apps/api-gateway-bff/.env
# (repetir para los demás MS si se van a levantar)

# 4. Generar Prisma Client y ejecutar migración inicial
pnpm db:generate
pnpm db:migrate -- --name init

# 5. (Opcional) Sembrar datos de prueba
pnpm db:seed

# 6. Compilar los paquetes compartidos
pnpm --filter @sofia/shared-kernel run build
pnpm --filter @sofia/config run build
pnpm --filter @sofia/observability run build
pnpm --filter @sofia/http-client run build

# 7. Levantar los servicios core en modo dev
pnpm dev:identidad   # terminal 1 → :3001
pnpm dev:gateway     # terminal 2 → :3000
```

### MS IA (Python / FastAPI)

```bash
cd apps/ms-ia-orquestacion
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/Mac:
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Dashboard Web (React + Vite)

```bash
pnpm --filter dashboard-web run dev   # → http://localhost:5173
```

## Curls de prueba

### Health checks

```bash
curl http://localhost:3000/health          # Gateway
curl http://localhost:3001/health          # Identidad
curl http://localhost:8000/health          # IA (FastAPI)
```

### Registrar usuario

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "nombreCompleto": "Juan Pérez",
    "correo": "juan@test.com",
    "password": "MiClave123!",
    "rol": "USUARIO"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "juan@test.com",
    "password": "MiClave123!"
  }'
```

### Obtener perfil (con token)

```bash
TOKEN="<pegar accessToken aquí>"

curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### Login con admin del seed

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "admin@sofia.edu.co",
    "password": "Admin123!"
  }'
```

## Estructura del monorepo

```
sofia/
├── apps/
│   ├── api-gateway-bff/        ← Punto de entrada, proxy + JWT + RBAC
│   ├── ms-identidad-acceso/    ← Auth completo
│   ├── ms-atencion-whatsapp/   ← Webhook WhatsApp
│   ├── ms-ia-orquestacion/     ← FastAPI Python (IA/RAG)
│   ├── ms-citas-agenda/        ← CRUD citas
│   ├── ms-gestion-estudiantes/ ← CRUD estudiantes
│   ├── ms-dashboard/           ← Endpoints para dashboard
│   ├── ms-consentimientos/     ← Gestión consentimientos
│   ├── ms-normativa/           ← Placeholder fase 2
│   ├── ms-reportes-analitica/  ← Placeholder fase 2
│   └── dashboard-web/          ← React + Vite
├── packages/
│   ├── shared-kernel/          ← Enums, DTOs (Zod), errores, response helpers
│   ├── prisma/                 ← Schema centralizado, migraciones, seed
│   ├── config/                 ← Validación de env con Zod + dotenv
│   ├── observability/          ← Logger (pino), request-id, http-logger
│   └── http-client/            ← Cliente HTTP inter-servicio (fetch nativo)
├── infra/docker/
│   └── docker-compose.yml      ← PostgreSQL
├── docs/
├── .env.example
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Patrón por microservicio Express

```
ms-*/src/
├── config.ts                ← Env validation con Zod
├── app.ts                   ← Express app + middlewares + routes
├── server.ts                ← Arranque del servidor
├── middlewares/
│   ├── error-handler.ts     ← Manejo centralizado de errores
│   └── validate.ts          ← Middleware Zod para body
└── <dominio>/
    ├── <dominio>.routes.ts      ← Definición de rutas
    ├── <dominio>.controller.ts  ← Manejo de req/res
    ├── <dominio>.service.ts     ← Lógica de negocio
    └── <dominio>.repository.ts  ← Acceso a datos (Prisma)
```

### Formato de respuesta estándar

```json
{
  "data": { ... },
  "error": null,
  "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 }
}
```

```json
{
  "data": null,
  "error": { "code": "NOT_FOUND", "message": "Recurso no encontrado" }
}
```

## Comandos útiles

| Comando | Descripción |
|---|---|
| `pnpm install` | Instalar todas las dependencias |
| `pnpm docker:up` | Levantar PostgreSQL |
| `pnpm docker:down` | Bajar PostgreSQL |
| `pnpm db:generate` | Generar Prisma Client |
| `pnpm db:migrate -- --name <name>` | Crear migración |
| `pnpm db:seed` | Ejecutar seed |
| `pnpm db:studio` | Abrir Prisma Studio |
| `pnpm dev:identidad` | Dev ms-identidad-acceso |
| `pnpm dev:gateway` | Dev api-gateway-bff |
| `pnpm build` | Build de todos los packages/apps |
| `pnpm test` | Tests de todos los packages/apps |
