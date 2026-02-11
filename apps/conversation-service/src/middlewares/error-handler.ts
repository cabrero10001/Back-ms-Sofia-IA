import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError, fail } from '@sofia/shared-kernel';
import { createLogger } from '@sofia/observability';
import { Prisma } from '../generated/prisma';
import { ZodError } from 'zod';

const log = createLogger('conversation-error-handler');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const ve = new ValidationError(err.flatten().fieldErrors);
    res.status(ve.statusCode).json(fail(ve.code, ve.message, ve.details));
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json(fail('CONFLICT', 'Conflicto de unicidad', err.meta));
      return;
    }
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json(fail(err.code, err.message, err.details));
    return;
  }

  log.error({ err }, 'Unhandled error');
  res.status(500).json(fail('INTERNAL_ERROR', 'Error interno del servidor'));
}
