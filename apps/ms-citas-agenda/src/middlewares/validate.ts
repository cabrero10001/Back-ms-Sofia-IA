import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Middleware factory: valida req.body contra un schema Zod.
 * Reemplaza req.body con el objeto parseado (coercions, defaults, strips).
 * Los errores de validación se delegan al error-handler centralizado.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
