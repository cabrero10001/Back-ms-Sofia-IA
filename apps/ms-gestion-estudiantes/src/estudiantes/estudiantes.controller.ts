import { Request, Response, NextFunction } from 'express';
import { estudiantesService } from './estudiantes.service';
import { ok, paginated, PaginationDto } from '@sofia/shared-kernel';

export const estudiantesController = {
  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      const est = await estudiantesService.crear(req.body);
      res.status(201).json(ok(est));
    } catch (err) { next(err); }
  },

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PaginationDto.parse(req.query);
      const { data, total } = await estudiantesService.listar(page, limit);
      res.json(paginated(data, total, page, limit));
    } catch (err) { next(err); }
  },

  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const est = await estudiantesService.obtener(req.params.id as string);
      res.json(ok(est));
    } catch (err) { next(err); }
  },

  async actualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const est = await estudiantesService.actualizar(req.params.id as string, req.body);
      res.json(ok(est));
    } catch (err) { next(err); }
  },

  async eliminar(req: Request, res: Response, next: NextFunction) {
    try {
      await estudiantesService.eliminar(req.params.id as string);
      res.json(ok({ deleted: true }));
    } catch (err) { next(err); }
  },
};
