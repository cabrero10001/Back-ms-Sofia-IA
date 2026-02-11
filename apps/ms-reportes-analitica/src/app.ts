import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { reportesRouter } from './reportes/reportes.routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-reportes-analitica', timestamp: new Date().toISOString() });
});

app.use('/reportes', reportesRouter);
app.use(errorHandler);
