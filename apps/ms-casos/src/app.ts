import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { casosRouter } from './casos/casos.routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-casos', timestamp: new Date().toISOString() });
});

app.use('/casos', casosRouter);
app.use(errorHandler);
