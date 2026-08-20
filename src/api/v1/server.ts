import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  CANONICAL_API_VERSION,
  CANONICAL_ERROR_DEFINITIONS,
  canonicalErrorEnvelopeSchema,
  createCanonicalMeta,
  diagnosticsResponseSchema,
  homeOverviewResponseSchema,
  pairingStatusResponseSchema,
  referenceCommandRequestSchema,
  referenceCommandResponseSchema,
  referenceDeleteQuerySchema,
  referenceDeleteResponseSchema,
  referenceReadQuerySchema,
  referenceResponseSchema,
  referenceUpdateRequestSchema,
  type ReferenceResource,
} from './contract.js';
import { createHomeOverviewProjection } from './home-overview.js';
import { CanonicalApiError, sendCanonicalError } from './errors.js';
import {
  CANONICAL_ROUTE_DEFINITIONS,
  canonicalRoutePolicy,
  isCanonicalCallerAllowed,
  type CanonicalAuthenticator,
  type CanonicalCallerIdentity,
} from './policy.js';
import {
  CanonicalFoundationStore,
  IdempotencyKeyReusedError,
  ResourceConflictError,
  stableRequestFingerprint,
  type ReferenceSeed,
} from './store.js';
import { getExchangeRates, type ExchangeRateResult } from '../../services/exchange-rates.js';

export const CANONICAL_SERVER_HOST = '127.0.0.1' as const;
export type CanonicalListener = 'mac-local' | 'paired-iphone';

export interface CanonicalServerOptions {
  sqlite: Database.Database;
  listener: CanonicalListener;
  authenticate: CanonicalAuthenticator;
  clock?: () => Date;
  logger?: boolean;
  seed?: ReferenceSeed;
  /** Test-only fault injection. It is never enabled by the production factory. */
  allowUnknownOutcomeSimulation?: boolean;
  /** Mac-owned conversion rates; injectable only for deterministic tests. */
  homeExchangeRates?: () => Promise<ExchangeRateResult>;
}

export interface CanonicalServerStartOptions {
  port?: number;
  host?: typeof CANONICAL_SERVER_HOST;
}

declare module 'fastify' {
  interface FastifyRequest {
    canonicalIdentity?: CanonicalCallerIdentity;
  }
}

function requestIdFor(request: { id: string }): string {
  return request.id;
}

function parseOrThrow<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CanonicalApiError('validation_error');
  return parsed.data;
}

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new CanonicalApiError('validation_error');
  return id;
}

function clientId(identity: CanonicalCallerIdentity): string {
  return identity.kind === 'mac-local' ? 'mac-local' : `paired-iphone:${identity.deviceId}`;
}

function canonicalResourceResponse(resource: ReferenceResource, now: Date) {
  const candidate = {
    data: resource,
    meta: createCanonicalMeta(now, {
      calculationVersion: 'canonical-foundation-1',
      completeness: 'complete',
      estimated: false,
      resourceVersion: resource.resourceVersion,
    }),
  };
  const parsed = referenceResponseSchema.safeParse(candidate);
  if (!parsed.success) throw new CanonicalApiError('internal_server_error');
  return parsed.data;
}

function mapStorageError(error: unknown): never {
  if (error instanceof CanonicalApiError) throw error;
  if (error instanceof ResourceConflictError) {
    throw new CanonicalApiError('resource_conflict', {
      resourceId: error.resourceId,
      expectedVersion: error.expectedVersion,
      currentVersion: error.currentVersion,
    });
  }
  if (error instanceof IdempotencyKeyReusedError) {
    throw new CanonicalApiError('idempotency_key_reused');
  }
  throw error;
}

export function registerCanonicalRoutes(
  app: FastifyInstance,
  store: CanonicalFoundationStore,
  options: CanonicalServerOptions,
  clock: () => Date,
): void {
  const homeOverview = createHomeOverviewProjection(options.sqlite);
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/v1')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  const authorize =
    (policy: (typeof CANONICAL_ROUTE_DEFINITIONS)[number]['policy']) =>
    async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      let identity: CanonicalCallerIdentity | null;
      try {
        identity = await options.authenticate(request);
      } catch {
        return sendCanonicalError(reply, 'authentication_invalid', request.id);
      }
      if (!identity) return sendCanonicalError(reply, 'authentication_required', request.id);
      if (
        (options.listener === 'mac-local' && identity.kind !== 'mac-local') ||
        (options.listener === 'paired-iphone' && identity.kind !== 'paired-iphone')
      ) {
        return sendCanonicalError(reply, 'authentication_invalid', request.id);
      }
      if (!isCanonicalCallerAllowed(policy, identity)) {
        return sendCanonicalError(
          reply,
          policy === 'macOnly' ? 'mac_only' : 'pairing_required',
          request.id,
        );
      }
      request.canonicalIdentity = identity;
    };

  app.get(
    '/api/v1/home',
    { onRequest: authorize(canonicalRoutePolicy('GET', '/api/v1/home')) },
    async () => {
      const now = clock();
      const rates =
        homeOverview.requiredCurrencies(now).length > 0
          ? await (options.homeExchangeRates ?? getExchangeRates)()
          : { rates: { ILS: 1 }, stale: false };
      const projection = homeOverview.readWithMetadata(now, {
        rates: rates.rates,
        ratesStale: rates.stale,
      });
      const data = projection.data;
      const missingSections = [
        ...projection.missingSections,
        ...(data.availableMoney === null ? (['availableMoney'] as const) : []),
        ...(data.netWorth.total === null ? (['netWorth'] as const) : []),
        ...(data.accountFreshness.some((account) => account.status === 'unknown')
          ? (['accountFreshness'] as const)
          : []),
      ];
      const candidate = {
        data,
        meta: createCanonicalMeta(now, {
          calculationVersion: 'home-overview-1',
          completeness: missingSections.length === 0 ? 'complete' : 'partial',
          estimated: projection.estimated,
          missingSections: [...new Set(missingSections)],
        }),
      };
      const parsed = homeOverviewResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new CanonicalApiError('internal_server_error');
      return parsed.data;
    },
  );

  app.get(
    '/api/v1/reference',
    { onRequest: authorize(canonicalRoutePolicy('GET', '/api/v1/reference')) },
    async (request) => {
      const query = parseOrThrow(referenceReadQuerySchema, request.query);
      const id = query.id ?? 1;
      const resource = store.getReference(id);
      if (!resource) throw new CanonicalApiError('resource_not_found');
      return canonicalResourceResponse(resource, clock());
    },
  );

  app.post(
    '/api/v1/reference/commands/refresh',
    {
      onRequest: authorize(canonicalRoutePolicy('POST', '/api/v1/reference/commands/refresh')),
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const headerKey = request.headers['idempotency-key'];
      const candidate = {
        ...body,
        ...(body.idempotencyKey === undefined && typeof headerKey === 'string'
          ? { idempotencyKey: headerKey }
          : {}),
      };
      const command = parseOrThrow(referenceCommandRequestSchema, candidate);
      const identity = request.canonicalIdentity;
      if (!identity) throw new CanonicalApiError('internal_server_error');
      const now = clock();
      let receipt;
      try {
        receipt = store.executeRefreshCommand(
          clientId(identity),
          command.idempotencyKey,
          command.resourceId,
          stableRequestFingerprint({ command: command.command, resourceId: command.resourceId }),
          now.toISOString(),
        );
      } catch (error) {
        mapStorageError(error);
      }

      const refreshHints = receipt!.outcome.refreshHints;
      if (
        options.allowUnknownOutcomeSimulation &&
        request.headers['x-canonical-test-unknown'] === 'true'
      ) {
        throw new CanonicalApiError('unknown_outcome', { refreshHints });
      }

      const candidateResponse = {
        data: {
          accepted: true as const,
          resourceId: receipt!.outcome.resourceId,
        },
        meta: createCanonicalMeta(now, {
          receipt: { idempotencyKey: command.idempotencyKey, replayed: receipt!.replayed },
          refreshHints,
        }),
      };
      const parsed = referenceCommandResponseSchema.safeParse(candidateResponse);
      if (!parsed.success) throw new CanonicalApiError('internal_server_error');
      return reply.send(parsed.data);
    },
  );

  app.patch(
    '/api/v1/reference/:id',
    { onRequest: authorize(canonicalRoutePolicy('PATCH', '/api/v1/reference/:id')) },
    async (request) => {
      const id = parseId((request.params as { id: unknown }).id);
      const update = parseOrThrow(referenceUpdateRequestSchema, request.body);
      const identity = request.canonicalIdentity;
      if (!identity) throw new CanonicalApiError('internal_server_error');
      let resource: ReferenceResource;
      try {
        resource = store.updateReference({
          id,
          expectedVersion: update.expectedVersion,
          ...(update.title === undefined ? {} : { title: update.title }),
          ...(update.amount === undefined ? {} : { amount: update.amount }),
          updatedAt: clock().toISOString(),
        });
      } catch (error) {
        mapStorageError(error);
      }
      return canonicalResourceResponse(resource!, clock());
    },
  );

  app.delete(
    '/api/v1/reference/:id',
    { onRequest: authorize(canonicalRoutePolicy('DELETE', '/api/v1/reference/:id')) },
    async (request) => {
      const id = parseId((request.params as { id: unknown }).id);
      const query = parseOrThrow(referenceDeleteQuerySchema, request.query);
      try {
        store.deleteReference(id, query.expectedVersion);
      } catch (error) {
        mapStorageError(error);
      }
      const now = clock();
      const candidate = {
        data: { deletedId: id },
        meta: createCanonicalMeta(now, { refreshHints: store.refreshHintsFor(id) }),
      };
      const parsed = referenceDeleteResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new CanonicalApiError('internal_server_error');
      return parsed.data;
    },
  );

  app.get(
    '/api/v1/diagnostics',
    { onRequest: authorize(canonicalRoutePolicy('GET', '/api/v1/diagnostics')) },
    async (_request) => {
      const candidate = {
        data: { listener: 'mac-local' as const, capabilities: ['canonical-api' as const] },
        meta: createCanonicalMeta(clock()),
      };
      const parsed = diagnosticsResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new CanonicalApiError('internal_server_error');
      return parsed.data;
    },
  );

  app.get(
    '/api/v1/pairing/status',
    { onRequest: authorize(canonicalRoutePolicy('GET', '/api/v1/pairing/status')) },
    async (request) => {
      const identity = request.canonicalIdentity;
      if (!identity || identity.kind !== 'paired-iphone') {
        throw new CanonicalApiError('internal_server_error');
      }
      const candidate = {
        data: { paired: true as const, deviceId: identity.deviceId },
        meta: createCanonicalMeta(clock()),
      };
      const parsed = pairingStatusResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new CanonicalApiError('internal_server_error');
      return parsed.data;
    },
  );
}

function errorCodeFor(error: FastifyError): CanonicalApiError | null {
  if (error instanceof CanonicalApiError) return error;
  if (error.validation) return new CanonicalApiError('validation_error');
  if (error.statusCode === 404) return new CanonicalApiError('route_not_found');
  return null;
}

/**
 * Create one canonical server and select only its transport identity.  Mac and
 * paired-iPhone listeners call this same registrar, so the route/policy matrix
 * cannot drift between clients.
 */
export function createCanonicalServer(options: CanonicalServerOptions) {
  const clock = options.clock ?? (() => new Date());
  const store = new CanonicalFoundationStore(options.sqlite);
  if (options.seed) store.seedReference(options.seed);

  const app = Fastify({
    logger: options.logger ?? true,
    disableRequestLogging: true,
    exposeHeadRoutes: false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const mapped = errorCodeFor(error);
    if (mapped) {
      return sendCanonicalError(reply, mapped.code, requestIdFor(request), mapped.details);
    }
    request.log.error({ requestId: request.id }, 'Canonical API request failed');
    return sendCanonicalError(reply, 'internal_server_error', requestIdFor(request));
  });

  app.setNotFoundHandler((request, reply) =>
    sendCanonicalError(reply, 'route_not_found', requestIdFor(request)),
  );

  registerCanonicalRoutes(app, store, options, clock);

  async function start(startOptions: CanonicalServerStartOptions = {}): Promise<number> {
    const host = startOptions.host ?? CANONICAL_SERVER_HOST;
    if (host !== CANONICAL_SERVER_HOST) {
      throw new Error(`Canonical server may bind only to ${CANONICAL_SERVER_HOST}`);
    }
    await app.listen({ host, port: startOptions.port ?? 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      await app.close();
      throw new Error('Canonical server did not return a TCP address');
    }
    return address.port;
  }

  async function shutdown(): Promise<void> {
    await app.close();
  }

  return {
    app,
    store,
    start,
    shutdown,
    listener: options.listener,
  };
}

export type CanonicalServer = ReturnType<typeof createCanonicalServer>;

export { canonicalErrorEnvelopeSchema, CANONICAL_API_VERSION, CANONICAL_ERROR_DEFINITIONS };
