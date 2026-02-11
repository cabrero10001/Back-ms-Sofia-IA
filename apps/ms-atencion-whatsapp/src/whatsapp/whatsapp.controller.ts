import { Request, Response, NextFunction } from 'express';
import { whatsappService } from './whatsapp.service';
import { whatsappRepository } from './whatsapp.repository';
import { ok } from '@sofia/shared-kernel';

export const whatsappController = {
  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsappService.procesarMensajeEntrante(req.body);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  },

  /** GET /whatsapp/sesiones?telefono=+57300... */
  async sesiones(req: Request, res: Response, next: NextFunction) {
    try {
      const telefono = req.query.telefono as string;
      if (!telefono) {
        res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Query param "telefono" requerido' } });
        return;
      }
      const data = await whatsappRepository.findSesionesByTelefono(telefono);
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  },

  /** GET /whatsapp/sesiones/:sesionId/mensajes */
  async mensajes(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await whatsappRepository.findMensajesBySesion(req.params.sesionId as string);
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  },
};
