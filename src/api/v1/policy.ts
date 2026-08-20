import type { FastifyRequest } from 'fastify';

export type CanonicalRoutePolicy = 'shared' | 'macOnly' | 'pairing';

export type CanonicalCallerIdentity =
  | { kind: 'mac-local' }
  | { kind: 'paired-iphone'; deviceId: string };

export interface CanonicalRouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  policy: CanonicalRoutePolicy;
  /** Stable operation name shared by generated clients and API docs. */
  operationId: string;
  summary: string;
}

/**
 * The registry is the one place where transport authorization is classified.
 * Feature handlers never inspect a token or infer access from a device grant.
 */
export const CANONICAL_ROUTE_DEFINITIONS: readonly CanonicalRouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/home',
    policy: 'shared',
    operationId: 'getHomeOverview',
    summary: 'Read the Mac-calculated Home overview projection',
  },
  {
    method: 'GET',
    path: '/api/v1/reference',
    policy: 'shared',
    operationId: 'getReference',
    summary: 'Read the canonical foundation resource',
  },
  {
    method: 'PATCH',
    path: '/api/v1/reference/:id',
    policy: 'shared',
    operationId: 'updateReference',
    summary: 'Update the canonical foundation resource',
  },
  {
    method: 'DELETE',
    path: '/api/v1/reference/:id',
    policy: 'shared',
    operationId: 'deleteReference',
    summary: 'Delete the canonical foundation resource',
  },
  {
    method: 'POST',
    path: '/api/v1/reference/commands/refresh',
    policy: 'shared',
    operationId: 'requestReferenceRefresh',
    summary: 'Request a receipt-protected refresh',
  },
  {
    method: 'GET',
    path: '/api/v1/diagnostics',
    policy: 'macOnly',
    operationId: 'getDiagnostics',
    summary: 'Read trusted Mac diagnostics',
  },
  {
    method: 'GET',
    path: '/api/v1/pairing/status',
    policy: 'pairing',
    operationId: 'getPairingStatus',
    summary: 'Read paired-device status',
  },
] as const;

export function canonicalRoutePolicy(
  method: CanonicalRouteDefinition['method'],
  path: string,
): CanonicalRoutePolicy {
  const definition = CANONICAL_ROUTE_DEFINITIONS.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!definition) throw new Error(`Canonical route is missing a policy: ${method} ${path}`);
  return definition.policy;
}

export function isCanonicalCallerAllowed(
  policy: CanonicalRoutePolicy,
  identity: CanonicalCallerIdentity,
): boolean {
  switch (policy) {
    case 'shared':
      return true;
    case 'macOnly':
      return identity.kind === 'mac-local';
    case 'pairing':
      return identity.kind === 'paired-iphone';
  }
}

export type CanonicalAuthenticator = (
  request: FastifyRequest,
) => CanonicalCallerIdentity | null | Promise<CanonicalCallerIdentity | null>;

/**
 * A deliberately explicit test adapter. Production callers supply an
 * authenticator backed by the Mac bearer token and MobileDeviceRegistry; no
 * route can become public merely because this helper is imported.
 */
export function staticCanonicalAuthenticator(values: {
  macToken: string;
  pairedToken: string;
  pairedDeviceId: string;
}): CanonicalAuthenticator {
  return (request) => {
    const auth = request.headers.authorization;
    if (auth === `Bearer ${values.macToken}`) return { kind: 'mac-local' };
    if (auth === `Bearer ${values.pairedToken}`) {
      return { kind: 'paired-iphone', deviceId: values.pairedDeviceId };
    }
    return null;
  };
}
