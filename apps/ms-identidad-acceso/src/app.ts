import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { authRouter } from './auth/auth.routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();

// ── Global middlewares ──────────────────────────────
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

// ── Health check ────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-identidad-acceso', timestamp: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────
app.use('/auth', authRouter);

// ── Error handler (must be last) ────────────────────
app.use(errorHandler);
