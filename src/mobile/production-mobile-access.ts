import type { MobileBootstrapServerIdentity } from './bootstrap-adapter.js';
import { createMobileBootstrapAdapter } from './bootstrap-adapter.js';
import {
  createProductionMobileBootstrapPorts,
  financialDateInIsrael,
  type ProductionMobileBootstrapPortOptions,
} from './bootstrap-production-ports.js';
import { MOBILE_PROTOCOL_VERSION } from './contract.js';
import { MobileApiError } from './contract.js';
import * as schema from '../db/schema.js';
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
import {
  createMobileOverviewProvider,
  type MobileOverviewPortsOptions,
} from './overview-production-ports.js';
import type { MobileOverviewRouteDependencies } from './overview-routes.js';
import type { MobileOverviewQuery } from './overview-contract.js';
import type { MobileTransactionReadContext } from './transaction-routes.js';
import {
  readRecurringPaymentDetail,
  readRecurringPayments,
  saveRecurringPaymentDecision,
  type RecurringPaymentDetail,
  type RecurringPaymentsResult,
} from '../services/recurring-payments.js';
import type { MobileRecurringPaymentsDependencies } from './recurring-payments-routes.js';
import { createMobilePublicIdProjector, type MobilePublicIdProjector } from './mobile-public-id.js';
import {
  boundedMobileText,
  mobileTransactionDisplayName,
  projectedMobileCurrencyCode,
} from './mobile-transaction-projection.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectRecurringPayment(
  payment: RecurringPaymentsResult['payments'][number],
  publicId: MobilePublicIdProjector,
) {
  return {
    ...payment,
    accountId: publicId('account', payment.accountId),
    name: mobileTransactionDisplayName(payment.name),
    accountName: boundedMobileText(payment.accountName, 'Account', 80),
    currencyCode: projectedMobileCurrencyCode(payment.currencyCode),
  };
}

export function projectMobileRecurringPaymentDetail(
  detail: RecurringPaymentDetail,
  publicId: MobilePublicIdProjector,
) {
  return {
    ...detail,
    payment: projectRecurringPayment(detail.payment, publicId),
    transactions: detail.transactions.map((transaction) => ({
      ...transaction,
      id: publicId('transaction', transaction.id),
      description: mobileTransactionDisplayName(transaction.description),
    })),
  };
}

export function projectMobileRecurringPayments(
  result: RecurringPaymentsResult,
  publicId: MobilePublicIdProjector,
) {
  const totals = new Map<string, { monthlyCost: number; annualCost: number }>();
  for (const total of result.totals) {
    const currencyCode = projectedMobileCurrencyCode(total.currencyCode);
    const current = totals.get(currencyCode) ?? { monthlyCost: 0, annualCost: 0 };
    current.monthlyCost += total.monthlyCost;
    current.annualCost += total.annualCost;
    totals.set(currencyCode, current);
  }
  return {
    ...result,
    payments: result.payments.map((payment) => projectRecurringPayment(payment, publicId)),
    suggestions: result.suggestions.map((payment) => projectRecurringPayment(payment, publicId)),
    excluded: result.excluded.map((payment) => projectRecurringPayment(payment, publicId)),
    totals: [...totals].map(([currencyCode, total]) => ({
      currencyCode,
      monthlyCost: Math.round(total.monthlyCost * 100) / 100,
      annualCost: Math.round(total.annualCost * 100) / 100,
    })),
  };
}

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
  readNetWorth?: MobileOverviewPortsOptions['readNetWorth'];
  readNetWorthHistory?: MobileOverviewPortsOptions['readNetWorthHistory'];
  updateTransactionCategory?: (transactionId: number, category: string) => unknown | null;
  /** Fail closed when the desktop data source is not safe to expose. */
  isMobileReadAvailable?: () => boolean;
  fallbackCurrencyCode?: string;
  clock?: () => Date;
  /** Deterministic factories are accepted for tests; production uses CSPRNG defaults. */
  deviceRegistryOptions?: Omit<MobileDeviceRegistryOptions, 'clock'>;
  pairingManagerOptions?: PairingManagerOverrides;
}

export interface ProductionMobileAccess {
  bootstrapDependencies: MobileBootstrapRouteDependencies;
  transactionDependencies: MobileTransactionRouteDependencies;
  overviewDependencies: MobileOverviewRouteDependencies;
  recurringPaymentsDependencies: MobileRecurringPaymentsDependencies;
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
    updateCategory: options.updateTransactionCategory,
  });
  const publicId = createMobilePublicIdProjector(options.publicIdKey);
  const resolveAccountId = (publicAccountId: string) => {
    const account = options.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .all()
      .find(({ id }) => publicId('account', id) === publicAccountId);
    if (!account) throw new MobileApiError('route_not_found');
    return account.id;
  };
  const provideOverview = createMobileOverviewProvider({
    db: options.db,
    readNetWorth:
      options.readNetWorth ??
      (async () => {
        const total = await options.readNetWorthIls({
          calculatedAt: clock().toISOString(),
          financialDate: financialDateInIsrael(clock()),
        });
        return { total, assetsTotal: total, liabilitiesTotal: 0 };
      }),
    readNetWorthHistory: options.readNetWorthHistory ?? (async () => []),
  });
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
    update: (publicId, update, context) => {
      assertMobileReadAvailable();
      return transactionPorts.update(publicId, update, context);
    },
    reviewOptions: () => {
      assertMobileReadAvailable();
      return transactionPorts.reviewOptions();
    },
  };
  Object.freeze(transactionDependencies);
  const overviewDependencies: MobileOverviewRouteDependencies = Object.freeze({
    authenticator: deviceRegistry,
    server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
    provide: (query: MobileOverviewQuery, context: MobileTransactionReadContext) => {
      assertMobileReadAvailable();
      return provideOverview(query, context);
    },
  });
  const recurringPaymentsDependencies: MobileRecurringPaymentsDependencies = Object.freeze({
    authenticator: deviceRegistry,
    server: Object.freeze({ id: serverId, protocolVersion: MOBILE_PROTOCOL_VERSION }),
    provide: async (asOfDate: string) => {
      assertMobileReadAvailable();
      return projectMobileRecurringPayments(
        await readRecurringPayments(options.db, asOfDate),
        publicId,
      );
    },
    detail: (
      identity: { accountId: string; currencyCode: string; merchantKey: string },
      asOfDate: string,
    ) => {
      assertMobileReadAvailable();
      const detail = readRecurringPaymentDetail(options.db, asOfDate, {
        ...identity,
        accountId: resolveAccountId(identity.accountId),
      });
      return detail ? projectMobileRecurringPaymentDetail(detail, publicId) : null;
    },
    decide: async (
      input: {
        accountId: string;
        currencyCode: string;
        merchantKey: string;
        decision: 'include' | 'exclude' | 'auto';
      },
      asOfDate: string,
    ) => {
      assertMobileReadAvailable();
      saveRecurringPaymentDecision(options.db, {
        ...input,
        accountId: resolveAccountId(input.accountId),
      });
      return projectMobileRecurringPayments(
        await readRecurringPayments(options.db, asOfDate),
        publicId,
      );
    },
  });

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
    overviewDependencies,
    recurringPaymentsDependencies,
    pairingDependencies,
    deviceRegistry,
    createPairingManager,
    clearPairingManager,
  };
}
