/**
 * Cliente HTTP ligero para comunicación inter-servicio.
 * Usa fetch nativo de Node 20+ (sin dependencias externas).
 */
export interface ServiceRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

export async function serviceRequest<T = unknown>(
  baseUrl: string,
  path: string,
  options: ServiceRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = 10_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Service ${baseUrl}${path} responded ${res.status}: ${JSON.stringify(json)}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}
