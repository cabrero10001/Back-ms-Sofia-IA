import { Request, Response, NextFunction } from 'express';
import { AppError } from '@sofia/shared-kernel';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

function asTenantValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireTenantScope(req: Request, _res: Response, next: NextFunction): void {
  const bodyTenant = asTenantValue((req.body as Record<string, unknown> | undefined)?.tenantId);
  const queryTenant = asTenantValue((req.query as Record<string, unknown> | undefined)?.tenantId);
  const headerTenant = asTenantValue(req.headers['x-tenant-id']);

  const tenantId = bodyTenant ?? queryTenant ?? headerTenant;

  if (!tenantId) {
    next(new AppError(400, 'TENANT_REQUIRED', 'tenantId es obligatorio'));
    return;
  }

  if (bodyTenant && queryTenant && bodyTenant !== queryTenant) {
    next(new AppError(400, 'TENANT_MISMATCH', 'tenantId en body y query no coincide'));
    return;
  }

  req.tenantId = tenantId;
  next();
}
