import { Request, Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';

interface ValidateConfig {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

export function validate(config: ValidateConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (config.body) req.body = config.body.parse(req.body);
      if (config.query) req.query = config.query.parse(req.query);
      if (config.params) req.params = config.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}
