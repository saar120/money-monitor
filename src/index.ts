import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, sqlite } from './db/connection.js';
import { scrapeRoutes } from './api/scrape.routes.js';
import { accountsRoutes } from './api/accounts.routes.js';
import { transactionsRoutes } from './api/transactions.routes.js';
import { summaryRoutes } from './api/summary.routes.js';
import { aiRoutes } from './api/ai.routes.js';
import { startScheduler, stopScheduler } from './scraper/scheduler.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Global error handler
app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error(error);

  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation error',
      details: error.message,
    });
  }

  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  return reply.status(500).send({
    error: 'Internal server error',
  });
});

// Request timing hook
app.addHook('onResponse', (request, reply, done) => {
  request.log.info(
    { responseTime: reply.elapsedTime, statusCode: reply.statusCode },
    `${request.method} ${request.url}`
  );
  done();
});

await app.register(cors, { origin: true });

// Health check
app.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register route modules
await app.register(scrapeRoutes);
await app.register(accountsRoutes);
await app.register(transactionsRoutes);
await app.register(summaryRoutes);
await app.register(aiRoutes);

// Serve dashboard static files in production
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dashboardDist = join(__dirname, '..', 'dashboard', 'dist');

if (existsSync(dashboardDist)) {
  await app.register(fastifyStatic, {
    root: dashboardDist,
    prefix: '/',
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: `Route ${request.method} ${request.url} not found`,
    });
  });
}

// Graceful shutdown
async function shutdown() {
  app.log.info('Shutting down...');
  stopScheduler();
  await app.close();
  sqlite.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Server running on http://${config.HOST}:${config.PORT}`);
  startScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, db };
