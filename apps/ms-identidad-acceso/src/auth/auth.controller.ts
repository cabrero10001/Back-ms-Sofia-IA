import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { ok } from '@sofia/shared-kernel';

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      res.status(201).json(ok(result));
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const usuario = await authService.me(req.user!.sub);
      res.json(ok(usuario));
    } catch (err) {
      next(err);
    }
  },
};
