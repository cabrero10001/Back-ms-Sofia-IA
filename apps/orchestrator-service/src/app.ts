import express from 'express';
import cors from 'cors';
import { httpLoggerMiddleware } from '@sofia/observability';
import { v1Router } from './routes/v1.routes';
import { errorHandler } from './middlewares/error-handler';
import { requestIdMiddleware } from './middlewares/request-id';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'orchestrator-service', timestamp: new Date().toISOString() });
});

app.use('/v1', v1Router);
app.use(errorHandler);
