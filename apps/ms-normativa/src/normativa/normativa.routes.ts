import { Router } from 'express';
import { ok } from '@sofia/shared-kernel';

export const normativaRouter = Router();
normativaRouter.get('/', (_req, res) => { res.json(ok({ message: 'MS Normativa - Fase 2' })); });
