import type { FastifyInstance } from 'fastify';
import { mobileFinancialDateFor } from './bootstrap-contract.js';
import {
  MOBILE_API_VERSION,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RESPONSE_SOURCE,
  MobileApiError,
} from './contract.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';
import {
  mobileOverviewQuerySchema,
  validateMobileOverviewEnvelope,
  type MobileOverviewQuery,
} from './overview-contract.js';
import type { MobileTransactionReadContext } from './transaction-routes.js';

export const MOBILE_OVERVIEW_ROUTE = '/api/mobile/v1/overview' as const;

export interface MobileOverviewRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string; protocolVersion: typeof MOBILE_PROTOCOL_VERSION };
  provide(
    query: Readonly<MobileOverviewQuery>,
    context: Readonly<MobileTransactionReadContext>,
  ): unknown | Promise<unknown>;
}

export function registerMobileOverviewRoute(
  app: FastifyInstance,
  dependencies: MobileOverviewRouteDependencies,
  clock: () => Date,
) {
  app.get(
    MOBILE_OVERVIEW_ROUTE,
    { onRequest: createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read') },
    async (request) => {
      const parsed = mobileOverviewQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new MobileApiError('validation_error');
      const now = clock();
      const data = await dependencies.provide(parsed.data, {
        generatedAt: now.toISOString(),
        financialDate: mobileFinancialDateFor(now),
      });
      const validated = validateMobileOverviewEnvelope({
        data,
        meta: {
          apiVersion: MOBILE_API_VERSION,
          generatedAt: now.toISOString(),
          source: MOBILE_RESPONSE_SOURCE,
          server: dependencies.server,
        },
      });
      if (!validated) throw new MobileApiError('internal_server_error');
      return validated;
    },
  );
}
