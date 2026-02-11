import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, Rol } from '@sofia/shared-kernel';

/**
 * Middleware de defensa en profundidad: verifica X-User-Rol propagado por el gateway.
 * El gateway ya aplica RBAC, pero cada MS valida internamente como seguridad adicional.
 */
export function requireInternalRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const rol = req.headers['x-user-rol'] as string | undefined;
    if (!rol || !roles.includes(rol as Rol)) {
      throw new ForbiddenError(`Rol '${rol || 'desconocido'}' no tiene acceso a este recurso`);
    }
    next();
  };
}
