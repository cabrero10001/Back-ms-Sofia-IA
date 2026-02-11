import { Router } from 'express';
import { ok } from '@sofia/shared-kernel';

export const reportesRouter = Router();

reportesRouter.get('/', (_req, res) => {
  res.json(ok({ message: 'MS Reportes Analítica - Fase 2' }));
});
