import Fastify, { type FastifyError } from 'fastify';
import type Database from 'better-sqlite3';
import { validateBootstrapPayload } from './bootstrap-contract.js';
import {
  MOBILE_ERROR_DEFINITIONS,
  MobileApiError,
  createMobileSuccessEnvelope,
  sendMobileError,
  type MobileErrorCode,
} from './contract.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';
import type { PublicMobileDevice } from './device-registry.js';
import {
  registerMobilePairingRoutes,
  type MobilePairingRouteDependencies,
} from './pairing-routes.js';
import {
  registerMobileTransactionRoutes,
  type MobileTransactionRouteDependencies,
} from './transaction-routes.js';
import {
  registerMobilePlanningRoutes,
  type MobilePlanningRouteDependencies,
} from './planning-routes.js';
import {
  registerMobileNetWorthHistoryRoutes,
  type MobileNetWorthHistoryRouteDependencies,
} from './net-worth-history-routes.js';
import {
  registerMobileReviewCommandRoutes,
  type MobileReviewCommandRouteDependencies,
} from './review-command-routes.js';
import { CanonicalApiError, sendCanonicalError } from '../api/v1/errors.js';
import { registerCanonicalRoutes } from '../api/v1/server.js';
import type { CanonicalAuthenticator } from '../api/v1/policy.js';
import { CanonicalFoundationStore } from '../api/v1/store.js';
import type { ReferenceSeed } from '../api/v1/store.js';
import type { ExchangeRateResult } from '../services/exchange-rates.js';

export const MOBILE_SERVER_HOST = '127.0.0.1' as const;

export interface MobileBootstrapRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  provide: (device: PublicMobileDevice) => unknown | Promise<unknown>;
}

export interface MobileServerErrorEvent {
  requestId: string;
  method: string;
  route: string | undefined;
  statusCode: number;
  errorCode: MobileErrorCode;
}

export interface CreateMobileServerOptions {
  /** The same /api/v1 registrar used by the Mac-local listener. */
  canonical?: {
    sqlite: Database.Database;
    authenticate: CanonicalAuthenticator;
    seed?: ReferenceSeed;
    /** Test-only fault injection; production never sets this. */
    allowUnknownOutcomeSimulation?: boolean;
    /** Mac-owned rates for canonical Home conversion; injectable for tests. */
    homeExchangeRates?: () => Promise<ExchangeRateResult>;
  };
  bootstrap?: MobileBootstrapRouteDependencies;
  pairing?: MobilePairingRouteDependencies;
  transactions?: MobileTransactionRouteDependencies;
  planning?: MobilePlanningRouteDependencies;
  netWorthHistory?: MobileNetWorthHistoryRouteDependencies;
  reviewCommands?: MobileReviewCommandRouteDependencies;
  clock?: () => Date;
  errorObserver?: (event: Readonly<MobileServerErrorEvent>) => void;
  logger?: boolean;
}

export interface MobileServerStartOptions {
  port?: number;
  host?: typeof MOBILE_SERVER_HOST;
}

function errorCodeFor(error: FastifyError): MobileErrorCode {
  if (error instanceof MobileApiError) return error.code;
  if (error.validation) return 'validation_error';

  switch (error.statusCode) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'authentication_required';
    case 403:
      return 'forbidden';
    case 404:
      return 'route_not_found';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limited';
    default:
      return 'internal_server_error';
  }
}

/**
 * Builds the isolated native-app API. It intentionally imports no desktop
 * routes, database connection, scrapers, schedulers, Telegram services, or
 * static dashboard plugin.
 */
export function createMobileServer(options: CreateMobileServerOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? true,
    disableRequestLogging: true,
    exposeHeadRoutes: false,
  });

  // Financial payloads must never enter browser, proxy, or intermediary caches.
  // Keep this server-wide so errors and future mobile routes inherit the same
  // transport boundary without relying on each handler to remember it.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof CanonicalApiError) {
      return sendCanonicalError(reply, error.code, request.id, error.details);
    }
    const code = errorCodeFor(error);

    // Log only request metadata and an allow-listed code. Raw exceptions can
    // contain provider payloads, local paths, or credentials.
    const event: MobileServerErrorEvent = {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
      statusCode: MOBILE_ERROR_DEFINITIONS[code].statusCode,
      errorCode: code,
    };
    try {
      options.errorObserver?.(event);
    } catch {
      // Diagnostics are optional and must never change the response boundary.
    }
    request.log.error(event, 'Mobile request failed');

    return sendMobileError(reply, code, request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/v1')) {
      return sendCanonicalError(reply, 'route_not_found', request.id);
    }
    return sendMobileError(reply, 'route_not_found', request.id);
  });

  app.get('/api/mobile/v1/health', async () => {
    return createMobileSuccessEnvelope({ status: 'ok' as const }, clock());
  });

  if (options.pairing) {
    registerMobilePairingRoutes(app, options.pairing, clock);
  }

  if (options.bootstrap) {
    const { authenticator, provide } = options.bootstrap;
    app.get(
      '/api/mobile/v1/bootstrap',
      { onRequest: createMobileAuthenticationHook(authenticator, 'mobile.read') },
      async (request) => {
        const device = request.mobileDevice;
        if (!device) throw new MobileApiError('internal_server_error');

        const bootstrap = validateBootstrapPayload(await provide(device));
        if (!bootstrap.success) {
          // Contract details can reveal field names from an unsafe provider
          // payload. Collapse every validation failure to the allow-listed 500.
          throw new MobileApiError('internal_server_error');
        }
        return bootstrap.data;
      },
    );
  }

  if (options.transactions) {
    registerMobileTransactionRoutes(app, options.transactions, clock);
  }

  if (options.planning) {
    registerMobilePlanningRoutes(app, options.planning, clock);
  }

  if (options.netWorthHistory) {
    registerMobileNetWorthHistoryRoutes(app, options.netWorthHistory, clock);
  }

  if (options.reviewCommands) {
    registerMobileReviewCommandRoutes(app, options.reviewCommands, clock);
  }

  if (options.canonical) {
    const canonicalStore = new CanonicalFoundationStore(options.canonical.sqlite);
    if (options.canonical.seed) canonicalStore.seedReferenceOnce(options.canonical.seed);
    registerCanonicalRoutes(
      app,
      canonicalStore,
      {
        sqlite: options.canonical.sqlite,
        listener: 'paired-iphone',
        authenticate: options.canonical.authenticate,
        logger: options.logger ?? false,
        allowUnknownOutcomeSimulation: options.canonical.allowUnknownOutcomeSimulation,
        homeExchangeRates: options.canonical.homeExchangeRates,
      },
      clock,
    );
  }

  async function start(startOptions: MobileServerStartOptions = {}): Promise<number> {
    const port = startOptions.port ?? 0;
    const host = startOptions.host ?? MOBILE_SERVER_HOST;

    // Keep a runtime guard in addition to the literal TypeScript type so a
    // JavaScript caller cannot accidentally expose Fastify on the LAN.
    if (host !== MOBILE_SERVER_HOST) {
      throw new Error(`Mobile server may bind only to ${MOBILE_SERVER_HOST}`);
    }

    await app.listen({ port, host });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      await app.close();
      throw new Error('Mobile server did not return a TCP address');
    }

    return address.port;
  }

  async function shutdown(): Promise<void> {
    await app.close();
  }

  return { app, start, shutdown };
}
