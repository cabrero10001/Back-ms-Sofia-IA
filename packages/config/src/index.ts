import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { existsSync } from 'fs';

// Busca .env subiendo desde cwd hasta encontrar la raíz del monorepo
function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

const monorepoRoot = findMonorepoRoot(process.cwd());

// 1. Carga .env local del servicio (mayor prioridad)
config();
// 2. Carga .env desde la raíz del monorepo (valores por defecto)
config({ path: path.resolve(monorepoRoot, '.env') });

/**
 * Valida variables de entorno contra un schema Zod.
 * Lanza error legible si falta algo.
 */
export function validateEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Variables de entorno inválidas:\n${formatted}`);
  }
  return result.data;
}

/** Schema base compartido por todos los MS */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),
});

export { envDebug } from './env-debug';
