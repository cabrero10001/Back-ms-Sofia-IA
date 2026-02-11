import { Request, Response, NextFunction } from 'express';
import { dashboardService } from './dashboard.service';
import { ok, paginated, PaginationDto } from '@sofia/shared-kernel';

export const dashboardController = {
  /**
   * GET /dashboard/citas
   * Usa X-User-Rol y X-User-Id propagados por el gateway para filtrar.
   * ADMIN ve todo; ESTUDIANTE ve solo sus citas.
   */
  async citas(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PaginationDto.parse(req.query);
      const rol = req.headers['x-user-rol'] as string;
      const usuarioId = req.headers['x-user-id'] as string;
      const { data, total } = await dashboardService.citas(rol, usuarioId, page, limit);
      res.json(paginated(data, total, page, limit));
    } catch (err) {
      next(err);
    }
  },

  /** GET /dashboard/resumen */
  async resumen(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await dashboardService.resumen();
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  },

  /** GET /dashboard/casos (listado paginado con filtros) */
  async casos(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PaginationDto.parse(req.query);
      const estado = req.query.estado as string | undefined;
      const areaDerecho = req.query.areaDerecho as string | undefined;
      const { data, total } = await dashboardService.casos(page, limit, { estado, areaDerecho });
      res.json(paginated(data, total, page, limit));
    } catch (err) {
      next(err);
    }
  },

  /** GET /dashboard/casos/:id */
  async caso(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await dashboardService.caso(req.params.id as string);
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  },
};
