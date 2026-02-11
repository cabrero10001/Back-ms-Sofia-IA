import { createHash } from 'crypto';

/**
 * Máscara segura para DATABASE_URL: oculta la contraseña.
 * "postgresql://user:pass@host:5432/db" → "postgresql://user:****@host:5432/db"
 */
function maskDatabaseUrl(url: string | undefined): string {
  if (!url) return 'MISSING';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return '(invalid URL)';
  }
}

/**
 * Resumen seguro de JWT_SECRET: longitud + hash parcial (primeros 8 chars del sha256).
 */
function maskJwtSecret(secret: string | undefined): string {
  if (!secret) return 'MISSING';
  const hash = createHash('sha256').update(secret).digest('hex').substring(0, 8);
  return `set (len=${secret.length}, sha256=${hash}...)`;
}

/**
 * Devuelve el valor o "MISSING" si no está definido.
 */
function val(v: string | undefined): string {
  return v ?? 'MISSING';
}

/**
 * Imprime una sola vez un resumen de variables de entorno críticas.
 *
 * Se activa solo si `ENV_DEBUG=true` (o `1`, `yes`).
 * No imprime secretos completos. Seguro para logs de desarrollo.
 *
 * @param serviceName  Nombre del microservicio que invoca (e.g. "ms-casos").
 */
export function envDebug(serviceName: string): void {
  const flag = (process.env.ENV_DEBUG ?? '').toLowerCase();
  if (flag !== 'true' && flag !== '1' && flag !== 'yes') return;

  const env = process.env;

  const lines: string[] = [
    '',
    `╔══════════════════════════════════════════════════════╗`,
    `║  ENV DEBUG: ${serviceName.padEnd(40)} ║`,
    `╚══════════════════════════════════════════════════════╝`,
    `  NODE_ENV        : ${val(env.NODE_ENV)}`,
    `  DATABASE_URL    : ${maskDatabaseUrl(env.DATABASE_URL)}`,
    `  JWT_SECRET      : ${maskJwtSecret(env.JWT_SECRET)}`,
    `  JWT_EXPIRES_IN  : ${val(env.JWT_EXPIRES_IN)}`,
  ];

  // URL_MS_* (solo las que estén definidas en el entorno)
  const urlKeys = Object.keys(env)
    .filter((k) => k.startsWith('URL_MS_'))
    .sort();

  if (urlKeys.length > 0) {
    lines.push(`  ── Service URLs ──`);
    for (const key of urlKeys) {
      lines.push(`  ${key.padEnd(26)}: ${val(env[key])}`);
    }
  }

  lines.push('');

  // Imprimir todo de una vez (un solo write, un solo momento)
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}
