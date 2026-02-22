import { validateEnv } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),

  URL_MS_IDENTIDAD: z.string().url().default('http://localhost:3001'),
  URL_MS_TELEGRAM: z.string().url().default('http://localhost:3050'),
  URL_MS_WHATSAPP: z.string().url().default('http://localhost:3051'),
  URL_MS_CASOS: z.string().url().default('http://localhost:3003'),
  URL_MS_IA: z.string().url().default('http://localhost:8000'),
  URL_MS_CITAS: z.string().url().default('http://localhost:3004'),
  URL_MS_ESTUDIANTES: z.string().url().default('http://localhost:3005'),
  URL_MS_DASHBOARD: z.string().url().default('http://localhost:3006'),
  URL_MS_CONSENTIMIENTOS: z.string().url().default('http://localhost:3007'),
  URL_MS_NORMATIVA: z.string().url().default('http://localhost:3008'),
  URL_MS_REPORTES: z.string().url().default('http://localhost:3009'),
});

export const env = validateEnv(EnvSchema);
