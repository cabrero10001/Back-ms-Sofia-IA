import { NextFunction, Request, Response } from 'express';
import { ok } from '@sofia/shared-kernel';
import { MessageIn } from '../dtos';
import { orchestratorService } from '../services/orchestrator.service';

export const orchestratorController = {
  async handleMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as MessageIn;
      const result = await orchestratorService.handleMessage(body, req.requestId);
      res.status(200).json(ok(result));
    } catch (err) {
      next(err);
    }
  },
};
