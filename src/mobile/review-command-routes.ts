import type { FastifyInstance } from 'fastify';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE, MobileApiError } from './contract.js';
import type { PublicMobileDevice } from './device-registry.js';
import { createMobileAuthenticationHook, type MobileCredentialAuthenticator } from './mobile-auth.js';
import {
  mobileReviewCommandEnvelopeSchema,
  mobileReviewResolveCommandSchema,
  mobileReviewSkipCommandSchema,
  type MobileReviewCommandResult,
  type MobileReviewResolveCommand,
  type MobileReviewSkipCommand,
} from './review-command-contract.js';

export const MOBILE_REVIEW_RESOLVE_ROUTE = '/api/mobile/v1/reviews/resolve' as const;
export const MOBILE_REVIEW_SKIP_ROUTE = '/api/mobile/v1/reviews/skip' as const;

export interface MobileReviewCommandRouteDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string; protocolVersion: typeof MOBILE_PROTOCOL_VERSION };
  resolve: (
    command: Readonly<MobileReviewResolveCommand>,
    context: Readonly<{ requestId: string; generatedAt: string }>,
    device: PublicMobileDevice,
  ) => MobileReviewCommandResult | Promise<MobileReviewCommandResult>;
  skip: (
    command: Readonly<MobileReviewSkipCommand>,
    context: Readonly<{ requestId: string; generatedAt: string }>,
    device: PublicMobileDevice,
  ) => MobileReviewCommandResult | Promise<MobileReviewCommandResult>;
}

/** Registers no desktop CRUD: only the explicit review-resolution command. */
export function registerMobileReviewCommandRoutes(
  app: FastifyInstance,
  dependencies: MobileReviewCommandRouteDependencies,
  clock: () => Date,
): void {
  const authorize = createMobileAuthenticationHook(dependencies.authenticator, 'mobile.review.write');
  app.post(MOBILE_REVIEW_RESOLVE_ROUTE, { onRequest: authorize }, async (request) => {
    const device = request.mobileDevice;
    if (!device) throw new MobileApiError('internal_server_error');
    const command = mobileReviewResolveCommandSchema.safeParse(request.body);
    if (!command.success) throw new MobileApiError('validation_error');

    const now = clock();
    const candidate = {
      data: await dependencies.resolve(command.data, { requestId: request.id, generatedAt: now.toISOString() }, device),
      meta: { apiVersion: MOBILE_API_VERSION, generatedAt: now.toISOString(), source: MOBILE_RESPONSE_SOURCE, server: dependencies.server },
    };
    const validated = mobileReviewCommandEnvelopeSchema.safeParse(candidate);
    if (!validated.success) throw new MobileApiError('internal_server_error');
    return validated.data;
  });
  app.post(MOBILE_REVIEW_SKIP_ROUTE, { onRequest: authorize }, async (request) => {
    const device = request.mobileDevice;
    if (!device) throw new MobileApiError('internal_server_error');
    const command = mobileReviewSkipCommandSchema.safeParse(request.body);
    if (!command.success) throw new MobileApiError('validation_error');

    const now = clock();
    const candidate = {
      data: await dependencies.skip(command.data, { requestId: request.id, generatedAt: now.toISOString() }, device),
      meta: { apiVersion: MOBILE_API_VERSION, generatedAt: now.toISOString(), source: MOBILE_RESPONSE_SOURCE, server: dependencies.server },
    };
    const validated = mobileReviewCommandEnvelopeSchema.safeParse(candidate);
    if (!validated.success) throw new MobileApiError('internal_server_error');
    return validated.data;
  });
}
