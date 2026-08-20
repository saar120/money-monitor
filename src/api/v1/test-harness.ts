import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';
import {
  CanonicalIPhoneClient,
  CanonicalMacClient,
  type CanonicalIPhoneClient as CanonicalIPhoneClientType,
  type CanonicalMacClient as CanonicalMacClientType,
} from './client.js';
import { createServer, type CreateServerOptions } from '../../server.js';
import { createMobileServer, type MobileServerStartOptions } from '../../mobile/mobile-server.js';
import { createCanonicalMobileAuthenticator } from '../../mobile/production-mobile-access.js';
import { MOBILE_READ_CAPABILITY, MobileDeviceRegistry } from '../../mobile/device-registry.js';
import type { ReferenceSeed } from './store.js';
import type { ExchangeRateResult } from '../../services/exchange-rates.js';

/** Stable non-secret fixtures; the registry stores only the digest. */
export const CANONICAL_TEST_MAC_TOKEN = 'mac-test-token';
export const CANONICAL_TEST_IPHONE_TOKEN = 'I'.repeat(43);
export const CANONICAL_TEST_DEVICE_ID = 'iphone-device-1';

export interface CanonicalHarnessOptions {
  /** A caller-owned connection enables deterministic restart tests. */
  sqlite?: Database.Database;
  /** Reuse the issued credential when reopening a persistent fixture. */
  iPhoneToken?: string;
  clock?: () => Date;
  seed?: ReferenceSeed;
  allowUnknownOutcomeSimulation?: boolean;
  /** Avoid TCP binds in sandboxed unit tests; Fastify injection remains available. */
  startListeners?: boolean;
  homeExchangeRates?: () => Promise<ExchangeRateResult>;
}

type DesktopServer = Awaited<ReturnType<typeof createServer>>;
type MobileServer = ReturnType<typeof createMobileServer>;

export interface CanonicalHarness {
  macBaseUrl: string;
  iPhoneBaseUrl: string;
  macToken: string;
  iPhoneToken: string;
  iPhoneDeviceId: string;
  mac: CanonicalMacClientType;
  iPhone: CanonicalIPhoneClientType;
  macServer: DesktopServer;
  iPhoneServer: MobileServer;
  deviceRegistry: MobileDeviceRegistry;
  sqlite: Database.Database;
  close(): Promise<void>;
}

function ensureMobileCredentialSchema(sqlite: Database.Database): void {
  // The harness intentionally accepts a raw SQLite connection so it can use
  // the same file as the production listener without requiring the desktop
  // database singleton. This is the one legacy table needed to issue a real
  // paired credential; production creates it through the migration set.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mobile_devices (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      token_digest TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '["mobile.read"]',
      protocol_version INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      rotated_at TEXT,
      revoked_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_devices_token_digest
      ON mobile_devices(token_digest);
    CREATE INDEX IF NOT EXISTS idx_mobile_devices_revoked_at
      ON mobile_devices(revoked_at);
  `);
}

function mobileServerStartOptions(): MobileServerStartOptions {
  return { host: '127.0.0.1', port: 0 };
}

/**
 * Boots the production desktop factory and the production mobile factory as
 * real loopback TCP listeners. The iPhone side authenticates through an
 * issued, persisted MobileDeviceRegistry credential; static identity adapters
 * are intentionally not used here.
 */
export async function createCanonicalHarness(
  options: CanonicalHarnessOptions = {},
): Promise<CanonicalHarness> {
  const ownsSqlite = options.sqlite === undefined;
  const sqlite = options.sqlite ?? new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  ensureMobileCredentialSchema(sqlite);

  const clock = options.clock ?? (() => new Date());
  const seed = options.seed ?? {
    id: 1,
    title: 'Canonical Foundation Fixture',
    amount: { value: '123.45', currencyCode: 'ILS' },
    resourceVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mobileDb = drizzle(sqlite, { schema });
  const deviceRegistry = new MobileDeviceRegistry(mobileDb, {
    clock,
    idFactory: () => CANONICAL_TEST_DEVICE_ID,
    tokenFactory: () => options.iPhoneToken ?? CANONICAL_TEST_IPHONE_TOKEN,
  });
  const knownDevice = deviceRegistry
    .list()
    .find((device) => device.id === CANONICAL_TEST_DEVICE_ID);
  const iPhoneToken = options.iPhoneToken ?? CANONICAL_TEST_IPHONE_TOKEN;
  if (!knownDevice) {
    deviceRegistry.issue({
      name: 'Canonical test iPhone',
      capabilities: [MOBILE_READ_CAPABILITY],
      protocolVersion: 1,
    });
  } else if (
    deviceRegistry.authenticate(iPhoneToken, MOBILE_READ_CAPABILITY).status !== 'authenticated'
  ) {
    throw new Error('A persistent canonical fixture requires the original iPhone token');
  }

  const macServer = await createServer({
    sqlite,
    canonicalAuthenticator: (request) =>
      request.headers.authorization === `Bearer ${CANONICAL_TEST_MAC_TOKEN}`
        ? { kind: 'mac-local' }
        : null,
    registerLegacyRoutes: false,
    startBackgroundServices: false,
    clock,
    logger: false,
    seedCanonical: seed,
    homeExchangeRates: options.homeExchangeRates,
  } satisfies CreateServerOptions);
  const iPhoneServer = createMobileServer({
    canonical: {
      sqlite,
      authenticate: createCanonicalMobileAuthenticator(deviceRegistry),
      allowUnknownOutcomeSimulation: options.allowUnknownOutcomeSimulation,
      homeExchangeRates: options.homeExchangeRates,
    },
    clock,
    logger: false,
  });

  try {
    const [macPort, iPhonePort] =
      options.startListeners === false
        ? [0, 0]
        : await Promise.all([
            macServer.start({ port: 0, host: '127.0.0.1' }),
            iPhoneServer.start(mobileServerStartOptions()),
          ]);
    const macBaseUrl = `http://127.0.0.1:${macPort}`;
    const iPhoneBaseUrl = `http://127.0.0.1:${iPhonePort}`;
    const mac = new CanonicalMacClient({ baseUrl: macBaseUrl, token: CANONICAL_TEST_MAC_TOKEN });
    const iPhone = new CanonicalIPhoneClient({
      baseUrl: iPhoneBaseUrl,
      token: iPhoneToken,
      testUnknownOutcome: options.allowUnknownOutcomeSimulation ?? false,
    });
    return {
      macBaseUrl,
      iPhoneBaseUrl,
      macToken: CANONICAL_TEST_MAC_TOKEN,
      iPhoneToken,
      iPhoneDeviceId: CANONICAL_TEST_DEVICE_ID,
      mac,
      iPhone,
      macServer,
      iPhoneServer,
      deviceRegistry,
      sqlite,
      close: async () => {
        await Promise.all([macServer.shutdown(), iPhoneServer.shutdown()]);
        if (ownsSqlite) sqlite.close();
      },
    };
  } catch (error) {
    await Promise.allSettled([macServer.shutdown(), iPhoneServer.shutdown()]);
    if (ownsSqlite) sqlite.close();
    throw error;
  }
}
