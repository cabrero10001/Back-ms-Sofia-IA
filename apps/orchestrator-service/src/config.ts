import { validateEnv } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3021),
  CONVERSATION_SERVICE_URL: z.string().url().default('http://localhost:3010'),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:3040'),
});

export const env = validateEnv(EnvSchema);
