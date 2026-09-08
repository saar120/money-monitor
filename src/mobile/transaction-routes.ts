import type { FastifyInstance } from 'fastify';
import { mobileFinancialDateFor } from './bootstrap-contract.js';
import {
  MOBILE_API_VERSION,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RESPONSE_SOURCE,
  MobileApiError,
} from './contract.js';
import type { PublicMobileDevice } from './device-registry.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';
import { isMobilePublicId } from './mobile-public-id.js';
import { MobileTransactionCursorError } from './transaction-cursor.js';
import {
  mobileTransactionQuerySchema,
  validateMobileTransactionDetailEnvelope,
  validateMobileTransactionListEnvelope,
  type MobileTransactionQuery,
} from './transaction-contract.js';

export const MOBILE_TRANSACTIONS_ROUTE = '/api/mobile/v1/transactions' as const;

export interface MobileTransactionReadContext {
  generatedAt: string;
  financialDate: string;
}

export interface MobileTransactionRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: {
    id: string;
    protocolVersion: typeof MOBILE_PROTOCOL_VERSION;
  };
  list: (
    query: Readonly<MobileTransactionQuery>,
    context: Readonly<MobileTransactionReadContext>,
    device: PublicMobileDevice,
  ) => unknown | Promise<unknown>;
  detail: (
    publicId: string,
    context: Readonly<MobileTransactionReadContext>,
    device: PublicMobileDevice,
  ) => unknown | null | Promise<unknown | null>;
}

function successEnvelope(
  data: unknown,
  dependencies: MobileTransactionRouteDependencies,
  now: Date,
) {
  return {
    data,
    meta: {
      apiVersion: MOBILE_API_VERSION,
      generatedAt: now.toISOString(),
      source: MOBILE_RESPONSE_SOURCE,
      server: dependencies.server,
    },
  };
}

function readContext(now: Date): MobileTransactionReadContext {
  return {
    generatedAt: now.toISOString(),
    financialDate: mobileFinancialDateFor(now),
  };
}

export function registerMobileTransactionRoutes(
  app: FastifyInstance,
  dependencies: MobileTransactionRouteDependencies,
  clock: () => Date,
): void {
  const authorize = createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read');

  app.get(MOBILE_TRANSACTIONS_ROUTE, { onRequest: authorize }, async (request) => {
    const device = request.mobileDevice;
    if (!device) throw new MobileApiError('internal_server_error');

    const parsedQuery = mobileTransactionQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) throw new MobileApiError('validation_error');

    const now = clock();
    let data: unknown;
    try {
      data = await dependencies.list(parsedQuery.data, readContext(now), device);
    } catch (error) {
      if (error instanceof MobileTransactionCursorError) {
        throw new MobileApiError('validation_error');
      }
      throw error;
    }
    const candidate = successEnvelope(data, dependencies, now);
    const validated = validateMobileTransactionListEnvelope(candidate);
    if (!validated.success) throw new MobileApiError('internal_server_error');
    return validated.data;
  });

  app.get<{ Params: { id: string } }>(
    `${MOBILE_TRANSACTIONS_ROUTE}/:id`,
    { onRequest: authorize },
    async (request) => {
      const device = request.mobileDevice;
      if (!device) throw new MobileApiError('internal_server_error');
      if (!isMobilePublicId(request.params.id, 'transaction')) {
        throw new MobileApiError('validation_error');
      }

      const now = clock();
      const transaction = await dependencies.detail(request.params.id, readContext(now), device);
      if (transaction === null) throw new MobileApiError('transaction_not_found');

      const candidate = successEnvelope({ transaction }, dependencies, now);
      const validated = validateMobileTransactionDetailEnvelope(candidate);
      if (!validated.success) throw new MobileApiError('internal_server_error');
      return validated.data;
    },
  );
}
