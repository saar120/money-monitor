import type { FastifyInstance } from 'fastify';
import { mobileFinancialDateFor } from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE, MobileApiError } from './contract.js';
import type { PublicMobileDevice } from './device-registry.js';
import { createMobileAuthenticationHook, type MobileCredentialAuthenticator } from './mobile-auth.js';
import { validateMobilePlanningSnapshotEnvelope } from './planning-contract.js';

export const MOBILE_PLANNING_ROUTE = '/api/mobile/v1/planning' as const;

export interface MobilePlanningRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string; protocolVersion: typeof MOBILE_PROTOCOL_VERSION };
  read: (context: Readonly<{ generatedAt: string; financialDate: string }>, device: PublicMobileDevice) => unknown | Promise<unknown>;
}

/** Registers the one coherent, read-only Phase 3 planning snapshot. */
export function registerMobilePlanningRoutes(app: FastifyInstance, dependencies: MobilePlanningRouteDependencies, clock: () => Date): void {
  const authorize = createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read');
  app.get(MOBILE_PLANNING_ROUTE, { onRequest: authorize }, async (request) => {
    const device = request.mobileDevice;
    if (!device) throw new MobileApiError('internal_server_error');
    const now = clock();
    const candidate = {
      data: await dependencies.read({ generatedAt: now.toISOString(), financialDate: mobileFinancialDateFor(now) }, device),
      meta: { apiVersion: MOBILE_API_VERSION, generatedAt: now.toISOString(), source: MOBILE_RESPONSE_SOURCE, server: dependencies.server },
    };
    const validated = validateMobilePlanningSnapshotEnvelope(candidate);
    if (!validated.success) throw new MobileApiError('internal_server_error');
    return validated.data;
  });
}
