import type { FastifyInstance } from 'fastify';
import { mobileFinancialDateFor } from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE, MobileApiError } from './contract.js';
import type { PublicMobileDevice } from './device-registry.js';
import { createMobileAuthenticationHook, type MobileCredentialAuthenticator } from './mobile-auth.js';
import {
  mobileNetWorthHistoryQuerySchema,
  validateMobileNetWorthHistoryEnvelope,
  type MobileNetWorthHistoryQuery,
} from './net-worth-history-contract.js';

export const MOBILE_NET_WORTH_HISTORY_ROUTE = '/api/mobile/v1/net-worth/history' as const;

export interface MobileNetWorthHistoryRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string; protocolVersion: typeof MOBILE_PROTOCOL_VERSION };
  read: (
    query: Readonly<MobileNetWorthHistoryQuery>,
    context: Readonly<{ generatedAt: string; financialDate: string }>,
    device: PublicMobileDevice,
  ) => unknown | Promise<unknown>;
}

/** Registers the Phase 3 aggregate-only net-worth chart source. */
export function registerMobileNetWorthHistoryRoutes(
  app: FastifyInstance,
  dependencies: MobileNetWorthHistoryRouteDependencies,
  clock: () => Date,
): void {
  const authorize = createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read');
  app.get(MOBILE_NET_WORTH_HISTORY_ROUTE, { onRequest: authorize }, async (request) => {
    const device = request.mobileDevice;
    if (!device) throw new MobileApiError('internal_server_error');
    const parsedQuery = mobileNetWorthHistoryQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) throw new MobileApiError('validation_error');

    const now = clock();
    const candidate = {
      data: await dependencies.read(
        parsedQuery.data,
        { generatedAt: now.toISOString(), financialDate: mobileFinancialDateFor(now) },
        device,
      ),
      meta: { apiVersion: MOBILE_API_VERSION, generatedAt: now.toISOString(), source: MOBILE_RESPONSE_SOURCE, server: dependencies.server },
    };
    const validated = validateMobileNetWorthHistoryEnvelope(candidate);
    if (!validated.success) throw new MobileApiError('internal_server_error');
    return validated.data;
  });
}
