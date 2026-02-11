import { validateEnv, BaseEnvSchema } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = BaseEnvSchema.extend({
  PORT: z.coerce.number().default(3002),
  URL_MS_IA: z.string().url().default('http://localhost:8000'),
  URL_MS_CONSENTIMIENTOS: z.string().url().default('http://localhost:3007'),
});

export const env = validateEnv(EnvSchema);
