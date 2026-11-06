/**
 * Environment configuration loader. Reads .env (from the project root), validates with Zod,
 * and fails fast with a clear message if anything required is missing/invalid.
 */
import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load the project-root .env (two levels up from apps/api).
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
// Also try a local .env (when run from the api folder directly).
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(8, 'SESSION_SECRET must be at least 8 chars').default(
    'change-me-dev-only-secret',
  ),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  DOC_STORAGE_DIR: z.string().default('./storage/generated-docs'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast — do not boot a misconfigured server.
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Check your .env against .env.example.');
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((o) => o.trim()),
  isProd: parsed.data.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
