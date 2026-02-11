import express from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { dashboardRouter } from './dashboard/dashboard.routes';
import { errorHandler } from './middlewares/error-handler';

export const app = express();
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'ms-dashboard', timestamp: new Date().toISOString() }); });
app.use('/dashboard', dashboardRouter);
app.use(errorHandler);
