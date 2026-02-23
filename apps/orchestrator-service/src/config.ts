import { validateEnv } from '@sofia/config';
import { z } from 'zod';

const BoolFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3021),
  CONVERSATION_SERVICE_URL: z.string().url().default('http://localhost:3010'),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:3040'),
  ORCH_FLOW_MODE: z.enum(['stateful', 'legacy']).default('stateful'),
  ORCH_CONV_TTL_MIN: z.coerce.number().int().positive().default(30),
  ORCH_RAG_ENABLED: BoolFromString.default(false),
  ORCH_RAG_BASE_URL: z.string().url().default('http://127.0.0.1:3040'),
  ORCH_RAG_ENDPOINT: z.string().default('/v1/ai/rag-answer'),
  ORCH_RAG_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
});

export const env = validateEnv(EnvSchema);
