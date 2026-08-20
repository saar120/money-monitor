import type { MobileBootstrapServerIdentity } from './bootstrap-adapter.js';
import { createMobileBootstrapAdapter } from './bootstrap-adapter.js';
import {
  createProductionMobileBootstrapPorts,
  financialDateInIsrael,
  type ProductionMobileBootstrapPortOptions,
} from './bootstrap-production-ports.js';
import { MOBILE_PROTOCOL_VERSION } from './contract.js';
import {
  MOBILE_READ_CAPABILITY,
  MobileDeviceRegistry,
  type MobileDeviceCredential,
  type MobileDeviceRegistryOptions,
} from './device-registry.js';
import type {
  MobilePairingPublicSessions,
  MobilePairingRouteDependencies,
} from './pairing-routes.js';
import {
  MobilePairingSessionManager,
  type PairingRequestInput,
  type MobilePairingSessionManagerOptions,
} from './pairing-session.js';
import type { MobileBootstrapRouteDependencies } from './mobile-server.js';
import { createProductionMobileTransactionPorts } from './transaction-production-ports.js';
import type { MobileTransactionRouteDependencies } from './transaction-routes.js';
import { createProductionMobilePlanningPorts } from './planning-production-ports.js';
import type { MobilePlanningRouteDependencies } from './planning-routes.js';
import { createProductionMobileNetWorthHistoryPorts } from './net-worth-history-production-ports.js';
import type { MobileNetWorthHistoryRouteDependencies } from './net-worth-history-routes.js';
import { createProductionMobileReviewCommandPorts } from './review-command-production-ports.js';
import type { MobileReviewCommandRouteDependencies } from './review-command-routes.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PairingManager = MobilePairingSessionManager<MobileDeviceCredential>;
type PairingManagerOverrides = Partial<
  Pick<
    MobilePairingSessionManagerOptions<MobileDeviceCredential>,
    'idFactory' | 'nonceFactory' | 'claimantSecretFactory' | 'pairingExpiryMs' | 'approvalTimeoutMs'
  >
>;

export interface ProductionMobileAccessOptions {
  db: ProductionMobileBootstrapPortOptions['db'];
  /** Persisted UUID identifying this Mac installation across restarts. */
  serverId: string;
  /** Private HMAC key used only to derive stable public DTO identifiers. */
  publicIdKey: string;
  server: Omit<MobileBootstrapServerIdentity, 'id'>;
  readNetWorthIls: ProductionMobileBootstrapPortOptions['readNetWorthIls'];
  /** Fail closed when the desktop data source is not safe to expose. */
  isMobileReadAvailable?: () => boolean;
  fallbackCurrencyCode?: string;
  clock?: () => Date;
  /** Deterministic factories are accepted for tests; production uses CSPRNG defaults. */
  deviceRegistryOptions?: Omit<MobileDeviceRegistryOptions, 'clock'>;
  pairingManagerOptions?: PairingManagerOverrides;
  resolveReview?: (transactionID: number, categoryName: string) => { needsReview: boolean } | null;
}

export interface ProductionMobileAccess {
  bootstrapDependencies: MobileBootstrapRouteDependencies;
  transactionDependencies: MobileTransactionRouteDependencies;
  planningDependencies: MobilePlanningRouteDependencies;
  netWorthHistoryDependencies: MobileNetWorthHistoryRouteDependencies;
  reviewCommandDependencies?: MobileReviewCommandRouteDependencies;
  pairingDependencies: MobilePairingRouteDependencies;
  deviceRegistry: MobileDeviceRegistry;
  createPairingManager(publicUrl: string): PairingManager;
  clearPairingManager(): void;
}

function stableServerId(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error('Mobile server ID must be a stable UUID');
  }
  return normalized.toLowerCase();
}

/**
 * Owns the production mobile bridge dependencies and their security-sensitive
 * lifetimes. Pending pairing state remains memory-only; paired device records
 * remain persisted in the injected database.
 */
export function createProductionMobileAccess(
  options: ProductionMobileAccessOptions,
): ProductionMobileAccess {
  const serverId = stableServerId(options.serverId);
  const clock = options.clock ?? (() => new Date());
  const deviceRegistry = new MobileDeviceRegistry(options.db, {
    ...options.deviceRegistryOptions,
    clock,
  });

  const ports = createProductionMobileBootstrapPorts({
    db: options.db,
    publicIdKey: options.publicIdKey,
    readNetWorthIls: options.readNetWorthIls,
  });
  const transactionPorts = createProductionMobileTransactionPorts({
    db: options.db,
    publicIdKey: options.publicIdKey,
  });
  const planningPorts = createProductionMobilePlanningPorts({
    db: options.db,
    publicIdKey: options.publicIdKey,
  });
  const netWorthHistoryPorts = createProductionMobileNetWorthHistoryPorts({ db: options.db });
  const reviewCommandPorts = options.resolveReview
    ? createProductionMobileReviewCommandPorts({
      db: options.db,
      publicIdKey: options.publicIdKey,
      clock,
      resolveReview: options.resolveReview,
    })
    : undefined;
  const provideBootstrap = createMobileBootstrapAdapter({
    ports,
    // Keep the persisted composition identity authoritative even for an
    // untyped runtime caller that supplies an unexpected `server.id` field.
    server: { ...options.server, id: serverId },
    fallbackCurrencyCode: options.fallbackCurrencyCode ?? 'ILS',
    clock,
    financialDateFor: financialDateInIsrael,
  });
  function assertMobileReadAvailable(): void {
    if (options.isMobileReadAvailable && !options.isMobileReadAvailable()) {
      throw new Error('Mobile read data is unavailable');
    }
  }

  const bootstrapDependencies: MobileBootstrapRouteDependencies = Object.freeze({
    authenticator: deviceRegistry,
    provide: () => {
      assertMobileReadAvailable();
      return provideBootstrap();
    },
  });
  const transactionDependencies: MobileTransactionRouteDependencies = {
    authenticator: deviceRegistry,
    server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
    list: (query, context) => {
      assertMobileReadAvailable();
      return transactionPorts.list(query, context);
    },
    detail: (publicId, context) => {
      assertMobileReadAvailable();
      return transactionPorts.detail(publicId, context);
    },
  };
  Object.freeze(transactionDependencies);
  const planningDependencies: MobilePlanningRouteDependencies = Object.freeze({
    authenticator: deviceRegistry,
    server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
    read: (context: Readonly<{ generatedAt: string; financialDate: string }>) => {
      assertMobileReadAvailable();
      return planningPorts.read(context);
    },
  });
  const netWorthHistoryDependencies: MobileNetWorthHistoryRouteDependencies = Object.freeze({
    authenticator: deviceRegistry,
    server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
    read: (
      query: Parameters<MobileNetWorthHistoryRouteDependencies['read']>[0],
      context: Parameters<MobileNetWorthHistoryRouteDependencies['read']>[1],
    ) => {
      assertMobileReadAvailable();
      return netWorthHistoryPorts.read(query, context);
    },
  });
  const reviewCommandDependencies = reviewCommandPorts
    ? Object.freeze({
      authenticator: deviceRegistry,
      server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
      resolve: reviewCommandPorts.resolve,
      skip: reviewCommandPorts.skip,
    } satisfies MobileReviewCommandRouteDependencies)
    : undefined;

  let activeManager: PairingManager | null = null;
  let pairingGeneration = 0;

  // Register this stable proxy with Fastify once. Tailscale lifecycle changes
  // replace the private target rather than rebuilding the HTTP route graph.
  const publicSessions: MobilePairingPublicSessions = Object.freeze({
    request(input: PairingRequestInput) {
      return activeManager?.request(input) ?? { status: 'pairing_not_found' };
    },
    poll(pairingId: string, claimantSecret: string) {
      return activeManager?.poll(pairingId, claimantSecret) ?? { status: 'pairing_not_found' };
    },
    claim(pairingId: string, claimantSecret: string) {
      return activeManager?.claim(pairingId, claimantSecret) ?? { status: 'pairing_not_found' };
    },
  });
  const pairingDependencies: MobilePairingRouteDependencies = Object.freeze({
    sessions: publicSessions,
  });

  function createPairingManager(publicUrl: string): PairingManager {
    const nextGeneration = pairingGeneration + 1;
    const manager = new MobilePairingSessionManager<MobileDeviceCredential>({
      serverId,
      baseURL: publicUrl,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      credentialIssuer: (request) => {
        // A stale manager can remain referenced by an old Mac UI callback.
        // Its lease must fail before the registry writes a device or token.
        if (pairingGeneration !== nextGeneration || activeManager !== manager) {
          throw new Error('Inactive pairing manager cannot issue credentials');
        }
        if (request.replacementDeviceId) {
          const rotated = deviceRegistry.rotate(request.replacementDeviceId);
          if (!rotated) {
            // A missing, revoked, or concurrently invalidated device must never
            // fall back to issuing a second identity.
            throw new Error('Replacement device is not active');
          }
          return rotated;
        }
        return deviceRegistry.issue({
          name: request.deviceName,
          capabilities: [MOBILE_READ_CAPABILITY],
          protocolVersion: request.protocolVersion,
        });
      },
      clock,
      ...options.pairingManagerOptions,
    });

    pairingGeneration = nextGeneration;
    activeManager = manager;
    return manager;
  }

  function clearPairingManager(): void {
    pairingGeneration += 1;
    activeManager = null;
  }

  return {
    bootstrapDependencies,
    transactionDependencies,
    planningDependencies,
    netWorthHistoryDependencies,
    reviewCommandDependencies,
    pairingDependencies,
    deviceRegistry,
    createPairingManager,
    clearPairingManager,
  };
}
