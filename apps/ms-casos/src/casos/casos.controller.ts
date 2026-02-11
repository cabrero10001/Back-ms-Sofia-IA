import { Request, Response, NextFunction } from 'express';
import { casosService } from './casos.service';
import { ok, paginated, PaginationDto } from '@sofia/shared-kernel';

export const casosController = {
  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      // X-User-Id is propagated by the gateway when user is authenticated
      const userId = req.headers['x-user-id'] as string | undefined;
      const caso = await casosService.crear(req.body, userId);
      res.status(201).json(ok(caso));
    } catch (err) {
      next(err);
    }
  },

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PaginationDto.parse(req.query);
      const estado = req.query.estado as string | undefined;
      const areaDerecho = req.query.areaDerecho as string | undefined;
      const creadoPorUsuarioId = req.query.creadoPorUsuarioId as string | undefined;

      const { data, total } = await casosService.listar({
        estado,
        areaDerecho,
        creadoPorUsuarioId,
        page,
        limit,
      });
      res.json(paginated(data, total, page, limit));
    } catch (err) {
      next(err);
    }
  },

  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const caso = await casosService.obtener(req.params.id as string);
      res.json(ok(caso));
    } catch (err) {
      next(err);
    }
  },

  async actualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const caso = await casosService.actualizar(req.params.id as string, req.body);
      res.json(ok(caso));
    } catch (err) {
      next(err);
    }
  },

  async actualizarEstado(req: Request, res: Response, next: NextFunction) {
    try {
      const caso = await casosService.actualizarEstado(req.params.id as string, req.body);
      res.json(ok(caso));
    } catch (err) {
      next(err);
    }
  },

  async eliminar(req: Request, res: Response, next: NextFunction) {
    try {
      await casosService.eliminar(req.params.id as string);
      res.json(ok({ deleted: true }));
    } catch (err) {
      next(err);
    }
  },
};
