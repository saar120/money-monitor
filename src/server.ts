import Fastify, { type FastifyError } from 'fastify';
import type Database from 'better-sqlite3';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, sqlite, closeAll } from './db/connection.js';
import { scrapeRoutes } from './api/scrape.routes.js';
import { accountsRoutes } from './api/accounts.routes.js';
import { transactionsRoutes } from './api/transactions.routes.js';
import { aiRoutes } from './api/ai.routes.js';
import { categoriesRoutes } from './api/categories.routes.js';
import { exchangeRatesRoutes } from './api/exchange-rates.routes.js';
import { assetsRoutes } from './api/assets.routes.js';
import { liabilitiesRoutes } from './api/liabilities.routes.js';
import { netWorthRoutes } from './api/net-worth.routes.js';
import { settingsRoutes } from './api/settings.routes.js';
import { membersRoutes } from './api/members.routes.js';
import { ownershipRoutes } from './api/ownership.routes.js';
import { demoRoutes } from './api/demo.routes.js';
import { alertsRoutes } from './api/alerts.routes.js';
import { budgetsRoutes } from './api/budgets.routes.js';
import { oneZeroImportRoutes } from './api/onezero-import.routes.js';
import { startScheduler, stopScheduler, checkAndRunMissedScrape } from './scraper/scheduler.js';
import { startTelegramBot, stopTelegramBot, restartTelegramBot } from './telegram/bot.js';
import { closeImageBrowser, setServerPort } from './services/html-to-image.js';
import { registerCanonicalRoutes } from './api/v1/server.js';
import type { CanonicalAuthenticator } from './api/v1/policy.js';
import { CanonicalApiError, sendCanonicalError } from './api/v1/errors.js';
import { CanonicalFoundationStore } from './api/v1/store.js';
import type { ReferenceSeed } from './api/v1/store.js';
import type { ExchangeRateResult } from './services/exchange-rates.js';

export interface CreateServerOptions {
  /** Injected only for deterministic canonical listener tests. */
  sqlite?: Database.Database;
  /** The desktop bearer-token authenticator can be replaced by a test seam. */
  canonicalAuthenticator?: CanonicalAuthenticator;
  /** Disable legacy desktop route registration when booting a canonical fixture. */
  registerLegacyRoutes?: boolean;
  /** Keep schedulers and Telegram out of isolated listener tests. */
  startBackgroundServices?: boolean;
  clock?: () => Date;
  /** Explicitly disable first-install canonical seeding. */
  seedCanonical?: ReferenceSeed | false;
  logger?: boolean;
  /** Injectable Mac-owned rates for deterministic canonical Home tests. */
  homeExchangeRates?: () => Promise<ExchangeRateResult>;
}

export async function createServer(options: CreateServerOptions = {}) {
  const ownsSqlite = options.sqlite === undefined;
  const canonicalSqlite = options.sqlite ?? sqlite;
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? {
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
    if (error instanceof CanonicalApiError) {
      return sendCanonicalError(reply, error.code, request.id, error.details);
    }

    // Canonical handlers may receive provider-backed values in their private
    // implementation. Keep logs on that seam metadata-only as well as keeping
    // the response coded, so raw exceptions cannot become a redaction escape.
    if (request.url.startsWith('/api/v1')) {
      request.log.error({ requestId: request.id }, 'Canonical API request failed');
      if (error.validation || error.statusCode === 400) {
        return sendCanonicalError(reply, 'validation_error', request.id);
      }
      return sendCanonicalError(reply, 'internal_server_error', request.id);
    }

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
      `${request.method} ${request.url}`,
    );
    done();
  });

  // CORS: restrict to known origins only
  const allowedOrigins = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map((o) => o.trim())
    : [
        `http://localhost:${config.PORT}`,
        `http://127.0.0.1:${config.PORT}`,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ];

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
  if (config.API_TOKEN) {
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return;
      if (request.url === '/api/health') return;
      // The canonical registrar always owns /api/v1 authentication. Its
      // coded envelope and listener-specific policy must run before this
      // legacy hook, even when production uses the default Mac authenticator.
      // Legacy routes below remain protected by the historical response.
      if (request.url.startsWith('/api/v1')) return;
      // SSE endpoints can't send Authorization headers; accept token as query param
      if (request.url.startsWith('/api/scrape/events')) {
        const token = (request.query as Record<string, string>).token;
        if (token === config.API_TOKEN) return;
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const auth = request.headers.authorization;
      if (auth !== `Bearer ${config.API_TOKEN}`) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    });
  } else {
    app.log.warn(
      'API_TOKEN is not set — API endpoints have no authentication. Set API_TOKEN in .env for security.',
    );
  }

  // Health check
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // The desktop listener and the paired-iPhone listener use the same canonical
  // route registrar. The mobile runtime supplies its own transport listener;
  // this registration keeps the Mac-local caller on the shared /api/v1 path.
  const canonicalStore = new CanonicalFoundationStore(canonicalSqlite);
  const canonicalSeed =
    options.seedCanonical === false
      ? null
      : (options.seedCanonical ?? {
          id: 1,
          title: 'Money Monitor foundation',
          amount: { value: '0', currencyCode: 'ILS' },
          resourceVersion: 1,
          updatedAt: new Date(0).toISOString(),
        });
  if (canonicalSeed) canonicalStore.seedReferenceOnce(canonicalSeed);
  registerCanonicalRoutes(
    app,
    canonicalStore,
    {
      sqlite: canonicalSqlite,
      listener: 'mac-local',
      authenticate:
        options.canonicalAuthenticator ??
        ((request) => {
          const authorization = request.headers.authorization;
          if (!authorization) return null;
          if (config.API_TOKEN && authorization === `Bearer ${config.API_TOKEN}`) {
            return { kind: 'mac-local' };
          }
          throw new Error('canonical credentials are invalid');
        }),
      logger: options.logger ?? false,
      homeExchangeRates: options.homeExchangeRates,
    },
    clock,
  );

  // Register route modules
  if (options.registerLegacyRoutes ?? true) {
    await app.register(scrapeRoutes);
    await app.register(accountsRoutes);
    await app.register(transactionsRoutes);
    await app.register(aiRoutes);
    await app.register(categoriesRoutes);
    await app.register(exchangeRatesRoutes);
    await app.register(assetsRoutes);
    await app.register(liabilitiesRoutes);
    await app.register(netWorthRoutes);
    await app.register(settingsRoutes);
    await app.register(membersRoutes);
    await app.register(ownershipRoutes);
    await app.register(alertsRoutes);
    await app.register(budgetsRoutes);
    await app.register(oneZeroImportRoutes);
    await app.register(demoRoutes);
  }

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
        return reply
          .status(404)
          .send({ error: `Route ${request.method} ${request.url} not found` });
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

  async function start(startOptions?: { port?: number; host?: string }): Promise<number> {
    const port = startOptions?.port ?? config.PORT;
    const host = startOptions?.host ?? config.HOST;
    await app.listen({ port, host });
    // Add the actual bound port to CORS allowed origins (needed for port: 0)
    const address = app.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    if (boundPort !== config.PORT) {
      allowedOrigins.push(`http://localhost:${boundPort}`, `http://127.0.0.1:${boundPort}`);
    }
    app.log.info(`Server running on http://${host}:${boundPort}`);
    setServerPort(boundPort);
    if (options.startBackgroundServices ?? true) {
      startScheduler();
      startTelegramBot();
    }
    return boundPort;
  }

  async function shutdown() {
    app.log.info('Shutting down...');
    if (options.startBackgroundServices ?? true) {
      stopScheduler();
      await stopTelegramBot();
    }
    await closeImageBrowser();
    await app.close();
    if (ownsSqlite) closeAll();
  }

  /** Restart background services after system sleep/wake. */
  async function onResume() {
    checkAndRunMissedScrape();
    stopScheduler();
    startScheduler();
    // Restart the Telegram bot to kill any stale polling connections from
    // before sleep. bot.stop() is properly awaited so the cleanup getUpdates
    // finishes before the new instance starts — preventing the 409 race
    // condition that previously caused the first post-wake message to be lost.
    await restartTelegramBot();
  }

  return { app, start, shutdown, onResume };
}

export { db };
