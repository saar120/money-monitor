import { describe, expect, it } from 'vitest';
import {
  ExecFileFailure,
  type ExecFileAdapter,
  type ExecFileRequest,
} from './exec-file-adapter.js';
import type { ServeOwnershipRecord, ServeOwnershipStore } from './serve-ownership-store.js';
import { TailscaleServeCoordinator } from './tailscale-serve-coordinator.js';

const AUTHORITY = 'money-mac.example.ts.net:443';
const MOUNT_PATH = '/money-monitor';
type FakeResponse = { stdout: string; stderr?: string } | Error;

class FakeProcess implements ExecFileAdapter {
  readonly requests: ExecFileRequest[] = [];
  private readonly responses: FakeResponse[];
  private readonly tailnetStatusResponse: FakeResponse;

  constructor(
    responses: FakeResponse[],
    tailnetStatusResponse: FakeResponse = { stdout: tailnetStatusJson() },
  ) {
    this.responses = [...responses];
    this.tailnetStatusResponse = tailnetStatusResponse;
  }

  async run(request: ExecFileRequest) {
    this.requests.push(request);
    const response =
      request.args[0] === 'status' ? this.tailnetStatusResponse : this.responses.shift();
    if (!response) throw new Error('Fake process ran out of responses');
    if (response instanceof Error) throw response;
    return { stdout: response.stdout, stderr: response.stderr ?? '' };
  }
}

class MemoryOwnershipStore implements ServeOwnershipStore {
  record: ServeOwnershipRecord | null;
  readonly saved: ServeOwnershipRecord[] = [];
  clearCount = 0;

  constructor(record: ServeOwnershipRecord | null = null) {
    this.record = record;
  }

  async load() {
    return this.record;
  }

  async save(record: ServeOwnershipRecord) {
    this.record = structuredClone(record);
    this.saved.push(structuredClone(record));
  }

  async clear() {
    this.record = null;
    this.clearCount += 1;
  }
}

function coordinator(process: FakeProcess, store = new MemoryOwnershipStore()) {
  return {
    coordinator: new TailscaleServeCoordinator({ process, ownershipStore: store }),
    store,
  };
}

function ownership(
  target: string | null,
  pendingTarget: string | null = null,
): ServeOwnershipRecord {
  return {
    schemaVersion: 1,
    httpsPort: 443,
    mountPath: MOUNT_PATH,
    lastKnownTarget: target,
    pendingTarget,
  };
}

function statusJson(options?: {
  target?: string;
  otherTarget?: string;
  funnel?: boolean;
  httpListener?: boolean;
  foreground?: boolean;
}) {
  const handlers: Record<string, { Proxy: string }> = {};
  if (options?.target) handlers[MOUNT_PATH] = { Proxy: options.target };
  if (options?.otherTarget) handlers['/another-app'] = { Proxy: options.otherTarget };

  return JSON.stringify({
    TCP: {
      443: options?.httpListener ? { HTTP: true } : { HTTPS: true },
    },
    Web: {
      [AUTHORITY]: { Handlers: handlers },
    },
    ...(options?.funnel ? { AllowFunnel: { [AUTHORITY]: true } } : {}),
    ...(options?.foreground
      ? {
          Foreground: {
            session: {
              TCP: { 443: { HTTPS: true } },
              Web: { [AUTHORITY]: { Handlers: {} } },
            },
          },
        }
      : {}),
  });
}

function tailnetStatusJson(options?: {
  backendState?: string;
  online?: boolean;
  httpsEnabled?: boolean;
}) {
  return JSON.stringify({
    BackendState: options?.backendState ?? 'Running',
    Self: { Online: options?.online ?? true },
    CertDomains: options?.httpsEnabled === false ? null : ['money-mac.example.ts.net'],
  });
}

describe('TailscaleServeCoordinator', () => {
  it('reports disabled without mutating unrelated configuration', async () => {
    const process = new FakeProcess([
      { stdout: statusJson({ otherTarget: 'http://127.0.0.1:9000' }) },
    ]);
    const { coordinator: subject, store } = coordinator(process);

    await expect(subject.reconcile({ enabled: false })).resolves.toEqual({
      status: 'disabled',
      diagnostic: 'routeDisabled',
    });
    expect(process.requests.map((request) => request.args)).toEqual([
      ['serve', 'status', '--json'],
    ]);
    expect(store.clearCount).toBe(1);
  });

  it('creates and verifies only the path-scoped HTTPS mapping', async () => {
    const expectedTarget = 'http://127.0.0.1:43123';
    const process = new FakeProcess([
      { stdout: '{}' },
      { stdout: 'Serve started' },
      { stdout: statusJson({ target: expectedTarget }) },
    ]);
    const { coordinator: subject, store } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'running',
      diagnostic: 'routeVerified',
      publicUrl: 'https://money-mac.example.ts.net/money-monitor',
    });

    expect(process.requests).toEqual([
      expect.objectContaining({
        executable: 'tailscale',
        args: ['status', '--json', '--peers=false'],
      }),
      expect.objectContaining({
        executable: 'tailscale',
        args: ['serve', 'status', '--json'],
      }),
      expect.objectContaining({
        executable: 'tailscale',
        args: [
          'serve',
          '--bg',
          '--yes',
          '--https=443',
          '--set-path=/money-monitor',
          expectedTarget,
        ],
      }),
      expect.objectContaining({
        executable: 'tailscale',
        args: ['serve', 'status', '--json'],
      }),
    ]);
    expect(process.requests.flatMap((request) => request.args)).not.toContain('reset');
    expect(process.requests).toHaveLength(4);
    expect(process.requests.every((request) => request.environment?.TAILSCALE_BE_CLI === '1')).toBe(
      true,
    );
    expect(store.saved).toEqual([ownership(null, expectedTarget), ownership(expectedTarget)]);
    expect(store.saved[0]?.lastKnownTarget).toBeNull();
  });

  it('supports the dedicated non-default HTTPS listener selected by the app', async () => {
    const expectedTarget = 'http://127.0.0.1:43123';
    const authority = 'money-mac.example.ts.net:8443';
    const process = new FakeProcess([
      { stdout: '{}' },
      { stdout: 'Serve started' },
      {
        stdout: JSON.stringify({
          TCP: { 8443: { HTTPS: true } },
          Web: {
            [authority]: {
              Handlers: { [MOUNT_PATH]: { Proxy: expectedTarget } },
            },
          },
        }),
      },
    ]);
    const store = new MemoryOwnershipStore();
    const subject = new TailscaleServeCoordinator({
      process,
      ownershipStore: store,
      httpsPort: 8443,
    });

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'running',
      diagnostic: 'routeVerified',
      publicUrl: 'https://money-mac.example.ts.net:8443/money-monitor',
    });
    expect(process.requests[2]?.args).toEqual([
      'serve',
      '--bg',
      '--yes',
      '--https=8443',
      '--set-path=/money-monitor',
      expectedTarget,
    ]);
    expect(store.record).toEqual({
      schemaVersion: 1,
      httpsPort: 8443,
      mountPath: MOUNT_PATH,
      lastKnownTarget: expectedTarget,
      pendingTarget: null,
    });
  });

  it('updates a previously owned mapping when the random mobile port changes', async () => {
    const previousTarget = 'http://127.0.0.1:41000';
    const nextTarget = 'http://127.0.0.1:42000';
    const store = new MemoryOwnershipStore(ownership(previousTarget));
    const process = new FakeProcess([
      { stdout: statusJson({ target: previousTarget }) },
      { stdout: 'updated' },
      { stdout: statusJson({ target: nextTarget }) },
    ]);
    const subject = new TailscaleServeCoordinator({ process, ownershipStore: store });

    await expect(subject.reconcile({ enabled: true, mobilePort: 42000 })).resolves.toMatchObject({
      status: 'running',
    });
    expect(process.requests[2]?.args).toEqual([
      'serve',
      '--bg',
      '--yes',
      '--https=443',
      '--set-path=/money-monitor',
      nextTarget,
    ]);
    expect(store.saved).toEqual([
      {
        ...ownership(previousTarget),
        pendingTarget: nextTarget,
      },
      ownership(nextTarget),
    ]);
  });

  it('is idempotent when the verified mapping already targets the mobile server', async () => {
    const target = 'http://127.0.0.1:43123';
    const store = new MemoryOwnershipStore(ownership(target));
    const process = new FakeProcess([{ stdout: statusJson({ target }) }]);
    const subject = new TailscaleServeCoordinator({ process, ownershipStore: store });

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toMatchObject({
      status: 'running',
    });
    expect(process.requests).toHaveLength(2);
    expect(process.requests[1]?.args).toEqual(['serve', 'status', '--json']);
  });

  it('recovers a pending ownership update after an interrupted reconciliation', async () => {
    const previousTarget = 'http://127.0.0.1:41000';
    const expectedTarget = 'http://127.0.0.1:43123';
    const store = new MemoryOwnershipStore(ownership(previousTarget, expectedTarget));
    const process = new FakeProcess([{ stdout: statusJson({ target: expectedTarget }) }]);
    const subject = new TailscaleServeCoordinator({ process, ownershipStore: store });

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toMatchObject({
      status: 'running',
    });
    expect(process.requests).toHaveLength(2);
    expect(store.record).toEqual(ownership(expectedTarget));
  });

  it('preserves another path while adding the owned mapping', async () => {
    const expectedTarget = 'http://127.0.0.1:43123';
    const otherTarget = 'http://127.0.0.1:9000';
    const process = new FakeProcess([
      { stdout: statusJson({ otherTarget }) },
      { stdout: 'updated' },
      { stdout: statusJson({ target: expectedTarget, otherTarget }) },
    ]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toMatchObject({
      status: 'running',
    });
    expect(process.requests[2]?.args).toContain('--set-path=/money-monitor');
    expect(process.requests.flatMap((request) => request.args)).not.toContain('/another-app');
    expect(process.requests.flatMap((request) => request.args)).not.toContain('reset');
  });

  it('refuses to adopt an unowned mapping even when it has the expected target', async () => {
    const target = 'http://127.0.0.1:43123';
    const process = new FakeProcess([{ stdout: statusJson({ target }) }]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'conflict',
      diagnostic: 'routeOwnershipConflict',
    });
    expect(process.requests).toHaveLength(2);
  });

  it.each([
    ['Funnel-enabled listener', statusJson({ funnel: true })],
    ['HTTP listener on the HTTPS port', statusJson({ httpListener: true })],
    ['foreground listener on the owned port', statusJson({ foreground: true })],
  ])('fails closed for a conflicting %s', async (_name, status) => {
    const process = new FakeProcess([{ stdout: status }]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'conflict',
      diagnostic: 'routeOwnershipConflict',
    });
    expect(process.requests).toHaveLength(2);
  });

  it('fails closed when status contains multiple authorities on the owned listener', async () => {
    const ambiguousStatus = JSON.stringify({
      TCP: { 443: { HTTPS: true } },
      Web: {
        [AUTHORITY]: { Handlers: {} },
        'another-name.example.ts.net:443': { Handlers: {} },
      },
    });
    const process = new FakeProcess([{ stdout: ambiguousStatus }]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'conflict',
      diagnostic: 'routeOwnershipConflict',
    });
    expect(process.requests).toHaveLength(2);
  });

  it('disables only the exact mapping recorded as owned', async () => {
    const target = 'http://127.0.0.1:43123';
    const otherTarget = 'http://127.0.0.1:9000';
    const store = new MemoryOwnershipStore(ownership(target));
    const process = new FakeProcess([
      { stdout: statusJson({ target, otherTarget }) },
      { stdout: 'disabled' },
      { stdout: statusJson({ otherTarget }) },
    ]);
    const subject = new TailscaleServeCoordinator({ process, ownershipStore: store });

    await expect(subject.reconcile({ enabled: false })).resolves.toEqual({
      status: 'disabled',
      diagnostic: 'routeDisabled',
    });
    expect(process.requests[1]?.args).toEqual([
      'serve',
      '--yes',
      '--https=443',
      '--set-path=/money-monitor',
      target,
      'off',
    ]);
    expect(process.requests.flatMap((request) => request.args)).not.toContain('reset');
    expect(store.record).toBeNull();
  });

  it('does not disable a route when durable ownership proof is absent', async () => {
    const target = 'http://127.0.0.1:43123';
    const process = new FakeProcess([{ stdout: statusJson({ target }) }]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: false })).resolves.toEqual({
      status: 'conflict',
      diagnostic: 'routeOwnershipConflict',
    });
    expect(process.requests).toHaveLength(1);
  });

  it.each([null, []])(
    'reports one-time Tailnet HTTPS consent for CertDomains=%j before Serve',
    async (certDomains) => {
      const process = new FakeProcess([], {
        stdout: JSON.stringify({
          BackendState: 'Running',
          Self: { Online: true },
          CertDomains: certDomains,
        }),
      });
      const { coordinator: subject, store } = coordinator(process);

      await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
        status: 'permissionRequired',
        diagnostic: 'tailscaleHTTPSRequired',
      });
      expect(process.requests.map((request) => request.args)).toEqual([
        ['status', '--json', '--peers=false'],
      ]);
      expect(store.saved).toEqual([]);
    },
  );

  it('classifies a parsed Tailnet login requirement without attempting Serve', async () => {
    const process = new FakeProcess([], {
      stdout: tailnetStatusJson({
        backendState: 'NeedsLogin',
        httpsEnabled: false,
      }),
    });
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'loggedOut',
      diagnostic: 'tailscaleLoggedOut',
    });
    expect(process.requests).toHaveLength(1);
  });

  it('classifies pending machine approval without attempting Serve', async () => {
    const process = new FakeProcess([], {
      stdout: tailnetStatusJson({
        backendState: 'NeedsMachineAuth',
        httpsEnabled: false,
      }),
    });
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'permissionRequired',
      diagnostic: 'tailscalePermissionRequired',
    });
    expect(process.requests).toHaveLength(1);
  });

  it.each([
    ['Starting', true],
    ['Running', false],
  ])('reports Tailnet state %s/online=%s as not ready', async (backendState, online) => {
    const process = new FakeProcess([], {
      stdout: tailnetStatusJson({ backendState, online }),
    });
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 43123 })).resolves.toEqual({
      status: 'failed',
      diagnostic: 'tailscaleNotReady',
    });
    expect(process.requests).toHaveLength(1);
  });

  it.each([
    [new ExecFileFailure({ code: 'ENOENT' }), 'notInstalled', 'cliNotFound'],
    [
      new ExecFileFailure({ stderr: 'You are logged out; visit login.tailscale.example/secret' }),
      'loggedOut',
      'tailscaleLoggedOut',
    ],
    [
      new ExecFileFailure({ stderr: 'permission denied: token=do-not-return' }),
      'permissionRequired',
      'tailscalePermissionRequired',
    ],
    [
      new ExecFileFailure({ stderr: 'listener already in use by secret-service' }),
      'conflict',
      'routeOwnershipConflict',
    ],
    [
      new ExecFileFailure({ stderr: 'unexpected failure bearer=super-secret' }),
      'failed',
      'commandFailed',
    ],
  ])('classifies and redacts process failure %#', async (error, status, diagnostic) => {
    const process = new FakeProcess([error]);
    const { coordinator: subject } = coordinator(process);

    const result = await subject.reconcile({ enabled: true, mobilePort: 43123 });
    expect(result).toEqual({ status, diagnostic });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|bearer|login\.tailscale/i);
  });

  it('fails safely on malformed or unknown status output', async () => {
    const process = new FakeProcess([{ stdout: '{"private":"do-not-return"' }]);
    const { coordinator: subject } = coordinator(process);

    const result = await subject.reconcile({ enabled: true, mobilePort: 43123 });
    expect(result).toEqual({ status: 'failed', diagnostic: 'invalidStatus' });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });

  it('rejects invalid server ports before invoking Tailscale', async () => {
    const process = new FakeProcess([]);
    const { coordinator: subject } = coordinator(process);

    await expect(subject.reconcile({ enabled: true, mobilePort: 0 })).resolves.toEqual({
      status: 'failed',
      diagnostic: 'invalidRequest',
    });
    expect(process.requests).toHaveLength(0);
  });
});
