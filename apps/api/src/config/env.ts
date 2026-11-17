import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.string().url(),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
});

export function loadEnv(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(environment);
  if (parsed.AUTH_ACCESS_TOKEN_SECRET) {
    return { ...parsed, AUTH_ACCESS_TOKEN_SECRET: parsed.AUTH_ACCESS_TOKEN_SECRET };
  }
  if (parsed.APP_ENV === 'production') {
    throw new Error('AUTH_ACCESS_TOKEN_SECRET must be set in production.');
  }

  return {
    ...parsed,
    AUTH_ACCESS_TOKEN_SECRET: randomBytes(32).toString('base64url'),
  };
}
