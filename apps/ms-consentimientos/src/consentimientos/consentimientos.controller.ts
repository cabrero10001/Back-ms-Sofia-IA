import { Request, Response, NextFunction } from 'express';
import { consentimientosService } from './consentimientos.service';
import { ok } from '@sofia/shared-kernel';

export const consentimientosController = {
  async registrar(req: Request, res: Response, next: NextFunction) {
    try { const usuarioId = req.headers['x-user-id'] as string | undefined; const result = await consentimientosService.registrar(req.body, usuarioId); res.status(201).json(ok(result)); } catch (err) { next(err); }
  },
  async porTelefono(req: Request, res: Response, next: NextFunction) {
    try { const data = await consentimientosService.porTelefono(req.params.telefono as string); res.json(ok(data)); } catch (err) { next(err); }
  },
  async porUsuario(req: Request, res: Response, next: NextFunction) {
    try { const data = await consentimientosService.porUsuario(req.params.usuarioId as string); res.json(ok(data)); } catch (err) { next(err); }
  },
};
