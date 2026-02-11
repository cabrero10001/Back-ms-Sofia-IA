import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '@sofia/shared-kernel';
import { fail } from '@sofia/shared-kernel';
import { ZodError } from 'zod';
import { createLogger } from '@sofia/observability';

const log = createLogger('error-handler');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const ve = new ValidationError(err.flatten().fieldErrors);
    res.status(ve.statusCode).json(fail(ve.code, ve.message, ve.details));
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json(fail(err.code, err.message, err.details));
    return;
  }

  // Unknown errors
  log.error({ err }, 'Unhandled error');
  res.status(500).json(fail('INTERNAL_ERROR', 'Error interno del servidor'));
}
