import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { citasRouter } from './citas/citas.routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-citas-agenda', timestamp: new Date().toISOString() });
});

app.use('/citas', citasRouter);
app.use(errorHandler);
