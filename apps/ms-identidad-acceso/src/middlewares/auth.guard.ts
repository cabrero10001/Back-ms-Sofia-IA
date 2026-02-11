import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { UnauthorizedError, ForbiddenError, Rol, JwtPayload } from '@sofia/shared-kernel';

// Extiende Request para portar el usuario decodificado
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware: verifica JWT en header Authorization: Bearer <token>
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token no proporcionado');
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError('Token inválido o expirado');
  }
}

/**
 * Middleware factory: restringe a ciertos roles.
 * Debe usarse DESPUÉS de requireAuth.
 */
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (!roles.includes(req.user.rol)) {
      throw new ForbiddenError(`Rol '${req.user.rol}' no tiene acceso a este recurso`);
    }
    next();
  };
}
