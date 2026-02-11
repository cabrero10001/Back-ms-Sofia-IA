import { BaseEnvSchema, validateEnv } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = BaseEnvSchema.extend({
  PORT: z.coerce.number().default(3010),
});

export const env = validateEnv(EnvSchema);
