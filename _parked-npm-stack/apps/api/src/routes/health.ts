/** Health-check route. Confirms the API is up and can reach the database. */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    let dbOk = false;
    try {
      // Cheap round-trip to confirm the DB connection works.
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'mdp-api',
      version: '0.1.0-proto',
      db: dbOk ? 'connected' : 'unavailable',
      time: new Date().toISOString(),
    };
  });
}
