import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { proxyRouter } from './proxy/proxy-routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();

// ── Global middlewares ──────────────────────────────
app.use(cors());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

// Body parsing solo para rutas que NO son proxy
// (http-proxy-middleware necesita el body raw)
// Las rutas proxy se montan ANTES de express.json()
app.use(proxyRouter);

// Para cualquier ruta propia del gateway
app.use(express.json());

// ── Health ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway-bff', timestamp: new Date().toISOString() });
});

// ── Error handler ───────────────────────────────────
app.use(errorHandler);
