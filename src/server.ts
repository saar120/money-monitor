import {
  pauseAlertEvaluations,
  resumeAlertEvaluations,
  drainAlertEvaluations,
} from './telegram/alerts.js';
import {
  pauseTelegramDeliveries,
  resumeTelegramDeliveries,
  drainTelegramDeliveries,
} from './telegram/delivery.js';
import { clearReplyImages } from './ai/image-tools.js';
import { advisorReplies } from './ai/advisor-replies.js';
import { closeSseClients } from './api/sse.js';
import {
  pauseScrapeAdmission,
  resumeScrapeAdmission,
  drainScrapeSessions,
  recoverInterruptedScrapes,
} from './scraper/session-manager.js';
import { drainPostImports, recoverPostImports } from './services/post-import.js';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, closeAll, isDemoMode } from './db/connection.js';
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
import { membersRoutes } from './api/members.routes.js';
import { ownershipRoutes } from './api/ownership.routes.js';
import { demoRoutes } from './api/demo.routes.js';
import { alertsRoutes } from './api/alerts.routes.js';
import { budgetsRoutes } from './api/budgets.routes.js';
import { oneZeroImportRoutes } from './api/onezero-import.routes.js';
import { startScheduler, stopScheduler, checkAndRunMissedScrape } from './scraper/scheduler.js';
import { startTelegramBot, stopTelegramBot, restartTelegramBot } from './telegram/bot.js';
import { closeImageBrowser, setServerPort } from './services/html-to-image.js';

export async function createServer() {
  const app = Fastify({
    disableRequestLogging: true,
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

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    return payload;
  });

  // Global error handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ code: error.code, statusCode: error.statusCode }, 'Request failed');

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
      `${request.method} ${request.routeOptions.url ?? 'unmatched'}`,
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
  await app.register(membersRoutes);
  await app.register(ownershipRoutes);
  await app.register(alertsRoutes);
  await app.register(budgetsRoutes);
  await app.register(oneZeroImportRoutes);
  await app.register(demoRoutes);

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

  let lifecycle: 'starting' | 'running' | 'recovering' | 'stopping' | 'stopped' | 'failed' =
    'starting';
  let startPromise: Promise<number> | null = null;
  let stopPromise: Promise<void> | null = null;
  let recoveryPromise: Promise<void> | null = null;

  async function startRuntime(options?: { port?: number; host?: string }): Promise<number> {
    const port = options?.port ?? config.PORT;
    const host = options?.host ?? config.HOST;
    if (!config.API_TOKEN && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
      throw new Error('API_TOKEN is required for a non-loopback listener');
    }
    await app.listen({ port, host });
    // Add the actual bound port to CORS allowed origins (needed for port: 0)
    const address = app.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    if (boundPort !== config.PORT) {
      allowedOrigins.push(`http://localhost:${boundPort}`, `http://127.0.0.1:${boundPort}`);
    }
    app.log.info(`Server running on http://${host}:${boundPort}`);
    setServerPort(boundPort);
    recoverInterruptedScrapes();
    advisorReplies.recover();
    if (stopPromise) return boundPort;
    resumeScrapeAdmission();
    advisorReplies.resume();
    resumeAlertEvaluations();
    resumeTelegramDeliveries();
    await startTelegramBot();
    if (stopPromise) return boundPort;
    recoverPostImports();
    if (!isDemoMode()) startScheduler();
    lifecycle = 'running';
    return boundPort;
  }

  function start(options?: { port?: number; host?: string }): Promise<number> {
    if (lifecycle === 'stopping' || lifecycle === 'stopped')
      return Promise.reject(new Error('Server is stopping'));
    if (!startPromise)
      startPromise = startRuntime(options).catch(async (error) => {
        lifecycle = 'failed';
        stopScheduler();
        await app.close().catch(() => {});
        throw error;
      });
    return startPromise;
  }
  function shutdown(): Promise<void> {
    if (stopPromise) return stopPromise;
    lifecycle = 'stopping';
    pauseScrapeAdmission();
    advisorReplies.pause();
    pauseAlertEvaluations();
    pauseTelegramDeliveries();
    stopScheduler();
    closeSseClients();
    stopPromise = (async () => {
      await startPromise?.catch(() => {});
      await recoveryPromise?.catch(() => {});
      // The process exit owner bounds shutdown; interrupted records remain durable.
      stopScheduler();
      const replies = advisorReplies.drain(true);
      const telegram = Promise.resolve(stopTelegramBot());
      void telegram.catch(() => {});
      await drainScrapeSessions();
      await drainPostImports();
      await replies;
      await drainAlertEvaluations();
      await drainTelegramDeliveries();
      await telegram;
      clearReplyImages();
      const cleanup = await Promise.allSettled([closeImageBrowser()]);
      await app.close();
      closeAll();
      lifecycle = 'stopped';
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Shutdown cleanup failed',
        );
    })();
    return stopPromise;
  }
  function onResume(): Promise<void> {
    if (stopPromise || lifecycle === 'failed' || lifecycle === 'stopped') return Promise.resolve();
    if (recoveryPromise) return recoveryPromise;
    lifecycle = 'recovering';
    recoveryPromise = (async () => {
      if (!isDemoMode()) {
        checkAndRunMissedScrape();
        stopScheduler();
        startScheduler();
      }
      if (!stopPromise) await restartTelegramBot();
    })().finally(() => {
      recoveryPromise = null;
      if (!stopPromise) lifecycle = 'running';
    });
    return recoveryPromise;
  }

  return { app, start, shutdown, onResume };
}

export { db };
