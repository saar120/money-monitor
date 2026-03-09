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
import { categoriesRoutes } from './api/categories.routes.js';
import { exchangeRatesRoutes } from './api/exchange-rates.routes.js';
import { assetsRoutes } from './api/assets.routes.js';
import { liabilitiesRoutes } from './api/liabilities.routes.js';
import { netWorthRoutes } from './api/net-worth.routes.js';
import { settingsRoutes } from './api/settings.routes.js';
import { startScheduler, stopScheduler } from './scraper/scheduler.js';
import { startTelegramBot, stopTelegramBot } from './telegram/bot.js';

const SENSITIVE_QUERY_PARAMS = new Set(['token', 'api_token', 'access_token', 'authorization', 'auth']);

function sanitizeUrlForLogs(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    for (const key of SENSITIVE_QUERY_PARAMS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    const query = parsed.searchParams.toString();
    return query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    return rawUrl.replace(
      /([?&](?:token|api_token|access_token|authorization|auth)=)[^&]*/gi,
      '$1[REDACTED]',
    );
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    const value = rest.join('=');
    try {
      cookies[rawKey] = decodeURIComponent(value);
    } catch {
      cookies[rawKey] = value;
    }
  }
  return cookies;
}

export async function createServer() {
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
      `${request.method} ${sanitizeUrlForLogs(request.url)}`
    );
    done();
  });

  // CORS: restrict to known origins only
  const allowedOrigins = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map(o => o.trim())
    : [`http://localhost:${config.PORT}`, `http://127.0.0.1:${config.PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173'];

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // API token authentication
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const requireApiToken = nodeEnv !== 'development' && nodeEnv !== 'test';
  if (!config.API_TOKEN && requireApiToken) {
    throw new Error(
      `API_TOKEN is required when NODE_ENV=${nodeEnv}. Set API_TOKEN to secure all /api/* routes.`,
    );
  }

  if (config.API_TOKEN) {
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return;
      if (request.url === '/api/health') return;

      // SSE endpoints can't reliably send Authorization headers; accept an HttpOnly cookie.
      if (request.url.startsWith('/api/scrape/events')) {
        const auth = request.headers.authorization;
        if (auth === `Bearer ${config.API_TOKEN}`) return;

        const cookieToken = parseCookies(request.headers.cookie).mm_api_token;
        if (cookieToken === config.API_TOKEN) return;

        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const auth = request.headers.authorization;
      if (auth !== `Bearer ${config.API_TOKEN}`) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    });
  } else {
    app.log.warn('API_TOKEN is not set — API endpoints have no authentication. Set API_TOKEN in .env for security.');
  }

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
  await app.register(categoriesRoutes);
  await app.register(exchangeRatesRoutes);
  await app.register(assetsRoutes);
  await app.register(liabilitiesRoutes);
  await app.register(netWorthRoutes);
  await app.register(settingsRoutes);

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

  async function start(options?: { port?: number; host?: string }): Promise<number> {
    const port = options?.port ?? config.PORT;
    const host = options?.host ?? config.HOST;
    await app.listen({ port, host });
    // Add the actual bound port to CORS allowed origins (needed for port: 0)
    const address = app.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    if (boundPort !== config.PORT) {
      allowedOrigins.push(`http://localhost:${boundPort}`, `http://127.0.0.1:${boundPort}`);
    }
    app.log.info(`Server running on http://${host}:${boundPort}`);
    startScheduler();
    startTelegramBot();
    return boundPort;
  }

  async function shutdown() {
    app.log.info('Shutting down...');
    stopScheduler();
    stopTelegramBot();
    await app.close();
    sqlite.close();
  }

  return { app, start, shutdown };
}

export { db };
