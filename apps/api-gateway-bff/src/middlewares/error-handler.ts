import { Request, Response, NextFunction } from 'express';
import { AppError } from '@sofia/shared-kernel';
import { fail } from '@sofia/shared-kernel';
import { createLogger } from '@sofia/observability';

const log = createLogger('gateway-error');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(fail(err.code, err.message, err.details));
    return;
  }
  log.error({ err }, 'Unhandled gateway error');
  res.status(500).json(fail('INTERNAL_ERROR', 'Error interno del gateway'));
}
