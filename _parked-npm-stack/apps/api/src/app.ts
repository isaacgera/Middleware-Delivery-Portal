/**
 * Fastify app factory. Wires plugins (CORS, cookies, multipart), the error handler and routes.
 * Kept separate from server.ts so tests can build an app without binding a port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Structured JSON logging. (pino-pretty omitted deliberately — its transitive dependency
    // thread-stream is blocked by the BT registry policy; plain pino needs no extra packages.)
    logger: {
      level: config.isProd ? 'info' : 'debug',
    },
  });

  // Cross-origin for the Vite dev server; credentials for the session cookie.
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
  });

  // Menu Card Excel uploads (Stage 3); modest size cap for the prototype.
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  app.setErrorHandler(registerErrorHandler);

  // Routes
  await app.register(healthRoutes);
  // Future: await app.register(authRoutes); etc. (Stages 2+)

  return app;
}
