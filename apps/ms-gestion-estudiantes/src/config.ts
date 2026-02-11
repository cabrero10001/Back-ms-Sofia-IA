import { validateEnv, BaseEnvSchema } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = BaseEnvSchema.extend({
  PORT: z.coerce.number().default(3005),
});

export const env = validateEnv(EnvSchema);
