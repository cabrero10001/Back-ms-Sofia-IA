import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { JwtPayload, UnauthorizedError, ForbiddenError, Rol } from '@sofia/shared-kernel';

// Extend Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verifica JWT. Adjunta req.user con el payload decodificado.
 */
export function jwtVerify(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token no proporcionado');
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError('Token inválido o expirado');
  }
}

/**
 * RBAC: restringe acceso a roles específicos. Usar después de jwtVerify.
 */
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.rol)) {
      throw new ForbiddenError(`Rol '${req.user.rol}' sin acceso`);
    }
    next();
  };
}

/**
 * Opcional: si el token viene, lo decodifica; si no, pasa sin user.
 */
export function jwtOptional(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload;
    } catch {
      // token inválido → ignorar silenciosamente
    }
  }
  next();
}
