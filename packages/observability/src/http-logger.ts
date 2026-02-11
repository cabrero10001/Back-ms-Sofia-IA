import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
      requestId: req.requestId,
    });
  });
  next();
}
