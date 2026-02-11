import { validateEnv, BaseEnvSchema } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = BaseEnvSchema.extend({
  PORT: z.coerce.number().default(3009),
});

export const env = validateEnv(EnvSchema);
