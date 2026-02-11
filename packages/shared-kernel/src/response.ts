/** Formato estándar de respuesta JSON para toda la plataforma */
export interface ApiResponse<T = unknown> {
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  } | null;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { data, error: null, ...(meta ? { meta } : {}) };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): ApiResponse<T[]> {
  return {
    data,
    error: null,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export function fail(code: string, message: string, details?: unknown): ApiResponse<null> {
  return { data: null, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
