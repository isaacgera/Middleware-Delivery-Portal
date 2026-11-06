/** API server entry point. Builds the app, binds the port, and handles graceful shutdown. */
import { buildApp } from './app.js';
import { config } from './config.js';
import { disconnectDb } from './db.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
    app.log.info(`MDP API listening on http://${config.API_HOST}:${config.API_PORT}`);
    app.log.info(`Health check: http://${config.API_HOST}:${config.API_PORT}/api/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
