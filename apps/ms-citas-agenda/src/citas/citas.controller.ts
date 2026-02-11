import { Request, Response, NextFunction } from 'express';
import { citasService } from './citas.service';
import { ok, paginated, PaginationDto } from '@sofia/shared-kernel';

export const citasController = {
  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      const cita = await citasService.crear(req.body);
      res.status(201).json(ok(cita));
    } catch (err) { next(err); }
  },

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PaginationDto.parse(req.query);
      const casoId = req.query.casoId as string | undefined;
      const estado = req.query.estado as string | undefined;
      const { data, total } = await citasService.listar({ casoId, estado, page, limit });
      res.json(paginated(data, total, page, limit));
    } catch (err) { next(err); }
  },

  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const cita = await citasService.obtener(req.params.id as string);
      res.json(ok(cita));
    } catch (err) { next(err); }
  },

  async actualizarEstado(req: Request, res: Response, next: NextFunction) {
    try {
      const cita = await citasService.actualizarEstado(req.params.id as string, req.body);
      res.json(ok(cita));
    } catch (err) { next(err); }
  },
};
