import { describe, expect, it } from 'vitest';
import type {
  TailscaleServeReconcileRequest,
  TailscaleServeState,
} from './tailscale-serve-coordinator.js';
import {
  MobileAccessRuntime,
  type MobileAccessRuntimeLogEntry,
  type MobileAccessServerFactory,
  type MobileAccessServeCoordinator,
  type RunningMobileAccessServer,
} from './mobile-access-runtime.js';

const RUNNING_STATE: TailscaleServeState = {
  status: 'running',
  diagnostic: 'routeVerified',
  publicUrl: 'https://money-mac.example.ts.net/money-monitor',
};

const NOT_INSTALLED_STATE: TailscaleServeState = {
  status: 'notInstalled',
  diagnostic: 'cliNotFound',
};

class FakeServer implements RunningMobileAccessServer {
  closeCalls = 0;
  closeError: Error | null = null;

  constructor(
    readonly port = 43123,
    private readonly events: string[] = [],
  ) {}

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.events.push('server:close');
    if (this.closeError) throw this.closeError;
  }
}

class FakeServerFactory implements MobileAccessServerFactory {
  startCalls = 0;
  startError: Error | null = null;
  onStart: (() => Promise<void>) | null = null;

  constructor(
    readonly server: FakeServer,
    private readonly events: string[] = [],
  ) {}

  async start(options: { host: '127.0.0.1' }): Promise<RunningMobileAccessServer> {
    this.startCalls += 1;
    this.events.push(`server:start:${options.host}`);
    if (this.onStart) await this.onStart();
    if (this.startError) throw this.startError;
    return this.server;
  }
}

class FakeCoordinator implements MobileAccessServeCoordinator {
  readonly requests: TailscaleServeReconcileRequest[] = [];
  activeCalls = 0;
  maximumActiveCalls = 0;
  onReconcile: (() => Promise<void>) | null = null;

  constructor(
    private readonly states: TailscaleServeState[],
    private readonly events: string[] = [],
  ) {}

  async reconcile(request: TailscaleServeReconcileRequest): Promise<TailscaleServeState> {
    this.requests.push(structuredClone(request));
    this.events.push(request.enabled ? `serve:enable:${request.mobilePort}` : 'serve:disable');
    this.activeCalls += 1;
    this.maximumActiveCalls = Math.max(this.maximumActiveCalls, this.activeCalls);
    try {
      if (this.onReconcile) await this.onReconcile();
      const state = this.states.shift();
      if (!state) throw new Error('Fake coordinator ran out of states');
      return state;
    } finally {
      this.activeCalls -= 1;
    }
  }
}

function runtime(options?: {
  states?: TailscaleServeState[];
  events?: string[];
  logger?: { log(entry: MobileAccessRuntimeLogEntry): void };
}) {
  const events = options?.events ?? [];
  const server = new FakeServer(43123, events);
  const serverFactory = new FakeServerFactory(server, events);
  const serveCoordinator = new FakeCoordinator(options?.states ?? [RUNNING_STATE], events);
  const subject = new MobileAccessRuntime({
    serverFactory,
    serveCoordinator,
    logger: options?.logger,
  });
  return { subject, server, serverFactory, serveCoordinator, events };
}

describe('MobileAccessRuntime', () => {
  it('reconciles an owned route without starting the server when disabled at startup', async () => {
    const disabledState: TailscaleServeState = {
      status: 'disabled',
      diagnostic: 'routeDisabled',
    };
    const context = runtime({ states: [disabledState] });

    await expect(context.subject.start(false)).resolves.toEqual(disabledState);
    await expect(context.subject.start(false)).resolves.toEqual(disabledState);
    expect(context.serverFactory.startCalls).toBe(0);
    expect(context.serveCoordinator.requests).toEqual([{ enabled: false }]);
  });

  it('can enable after disabled-startup reconciliation', async () => {
    const disabledState: TailscaleServeState = {
      status: 'disabled',
      diagnostic: 'routeDisabled',
    };
    const context = runtime({ states: [disabledState, RUNNING_STATE] });

    await context.subject.start(false);
    await expect(context.subject.start(true)).resolves.toEqual(RUNNING_STATE);
    expect(context.serveCoordinator.requests).toEqual([
      { enabled: false },
      { enabled: true, mobilePort: 43123 },
    ]);
  });

  it('starts the loopback server before reconciling its actual port', async () => {
    const events: string[] = [];
    const context = runtime({ events });

    await expect(context.subject.start(true)).resolves.toEqual(RUNNING_STATE);
    expect(events).toEqual(['server:start:127.0.0.1', 'serve:enable:43123']);
    expect(context.serveCoordinator.requests).toEqual([{ enabled: true, mobilePort: 43123 }]);
  });

  it('returns a coordinator failure without closing the mobile server', async () => {
    const context = runtime({ states: [NOT_INSTALLED_STATE] });

    await expect(context.subject.start(true)).resolves.toEqual(NOT_INSTALLED_STATE);
    expect(context.server.closeCalls).toBe(0);
    expect(context.serverFactory.startCalls).toBe(1);
  });

  it('reconciles on resume after the mobile server starts, including transport recovery', async () => {
    const neverStarted = runtime();
    await expect(neverStarted.subject.resume()).resolves.toEqual({
      status: 'stopped',
      diagnostic: 'runtimeNotStarted',
    });
    expect(neverStarted.serveCoordinator.requests).toHaveLength(0);

    const failed = runtime({ states: [NOT_INSTALLED_STATE, RUNNING_STATE] });
    await failed.subject.start(true);
    await expect(failed.subject.resume()).resolves.toEqual(RUNNING_STATE);
    expect(failed.serveCoordinator.requests).toEqual([
      { enabled: true, mobilePort: 43123 },
      { enabled: true, mobilePort: 43123 },
    ]);

    const running = runtime({ states: [RUNNING_STATE, RUNNING_STATE] });
    await running.subject.start(true);
    await expect(running.subject.resume()).resolves.toEqual(RUNNING_STATE);
    expect(running.serveCoordinator.requests).toEqual([
      { enabled: true, mobilePort: 43123 },
      { enabled: true, mobilePort: 43123 },
    ]);
  });

  it('shutdown closes the server without removing the persistent Serve mapping', async () => {
    const context = runtime({ states: [RUNNING_STATE] });
    await context.subject.start(true);

    await expect(context.subject.shutdown()).resolves.toEqual({
      status: 'stopped',
      diagnostic: 'runtimeStopped',
    });
    await context.subject.shutdown();

    expect(context.server.closeCalls).toBe(1);
    expect(context.serveCoordinator.requests).toEqual([{ enabled: true, mobilePort: 43123 }]);
  });

  it('explicit disable removes the owned mapping before closing the server', async () => {
    const disabledState: TailscaleServeState = {
      status: 'disabled',
      diagnostic: 'routeDisabled',
    };
    const events: string[] = [];
    const context = runtime({ states: [RUNNING_STATE, disabledState], events });
    await context.subject.start(true);

    const [first, second] = await Promise.all([
      context.subject.disable(),
      context.subject.disable(),
    ]);

    expect(first).toEqual(disabledState);
    expect(second).toEqual(disabledState);
    expect(events).toEqual([
      'server:start:127.0.0.1',
      'serve:enable:43123',
      'serve:disable',
      'server:close',
    ]);
    expect(context.server.closeCalls).toBe(1);
    expect(context.serveCoordinator.requests).toEqual([
      { enabled: true, mobilePort: 43123 },
      { enabled: false },
    ]);
  });

  it('serializes and coalesces concurrent startup calls', async () => {
    let releaseStart: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const context = runtime();
    context.serverFactory.onStart = () => gate;

    const first = context.subject.start(true);
    const second = context.subject.start(true);
    await Promise.resolve();
    expect(context.serverFactory.startCalls).toBe(1);

    releaseStart?.();
    await expect(Promise.all([first, second])).resolves.toEqual([RUNNING_STATE, RUNNING_STATE]);
    expect(context.serverFactory.startCalls).toBe(1);
    expect(context.serveCoordinator.requests).toHaveLength(1);
    expect(context.serveCoordinator.maximumActiveCalls).toBe(1);
  });

  it('keeps coordinator calls serialized across resume and disable', async () => {
    const disabledState: TailscaleServeState = {
      status: 'disabled',
      diagnostic: 'routeDisabled',
    };
    const context = runtime({ states: [RUNNING_STATE, RUNNING_STATE, disabledState] });
    await context.subject.start(true);

    await Promise.all([context.subject.resume(), context.subject.disable()]);

    expect(context.serveCoordinator.requests).toEqual([
      { enabled: true, mobilePort: 43123 },
      { enabled: true, mobilePort: 43123 },
      { enabled: false },
    ]);
    expect(context.serveCoordinator.maximumActiveCalls).toBe(1);
  });

  it('logs only fixed event, status, and diagnostic fields', async () => {
    const entries: MobileAccessRuntimeLogEntry[] = [];
    const logger = {
      log(entry: MobileAccessRuntimeLogEntry) {
        entries.push(entry);
        throw new Error('logger-secret-that-must-not-affect-runtime');
      },
    };
    const context = runtime({ states: [NOT_INSTALLED_STATE], logger });

    await expect(context.subject.start(true)).resolves.toEqual(NOT_INSTALLED_STATE);
    expect(entries).toEqual([
      {
        event: 'startupCompleted',
        status: 'notInstalled',
        diagnostic: 'cliNotFound',
      },
    ]);
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(['diagnostic', 'event', 'status']);
    expect(JSON.stringify(entries)).not.toMatch(/secret|exception|output|port|url/i);
  });

  it('converts thrown dependency errors into fixed states without rejecting', async () => {
    const context = runtime();
    context.serverFactory.startError = new Error('server output contains a secret token');

    await expect(context.subject.start(true)).resolves.toEqual({
      status: 'failed',
      diagnostic: 'mobileServerStartFailed',
    });
    expect(context.serveCoordinator.requests).toHaveLength(0);

    const throwingCoordinator: MobileAccessServeCoordinator = {
      async reconcile() {
        throw new Error('tailscale stderr contains a secret token');
      },
    };
    const second = new MobileAccessRuntime({
      serverFactory: new FakeServerFactory(new FakeServer()),
      serveCoordinator: throwingCoordinator,
    });
    await expect(second.start(true)).resolves.toEqual({
      status: 'failed',
      diagnostic: 'coordinatorUnavailable',
    });
  });

  it('does not call disable during shutdown even when closing fails', async () => {
    const context = runtime({ states: [RUNNING_STATE] });
    await context.subject.start(true);
    context.server.closeError = new Error('private close failure');

    await expect(context.subject.shutdown()).resolves.toEqual({
      status: 'failed',
      diagnostic: 'mobileServerCloseFailed',
    });
    expect(context.serveCoordinator.requests).toEqual([{ enabled: true, mobilePort: 43123 }]);
  });

  it('closes the server after an explicit disable even when reconciliation fails', async () => {
    const context = runtime({ states: [RUNNING_STATE, NOT_INSTALLED_STATE] });
    await context.subject.start(true);

    await expect(context.subject.disable()).resolves.toEqual(NOT_INSTALLED_STATE);
    expect(context.server.closeCalls).toBe(1);
    expect(context.serveCoordinator.requests.at(-1)).toEqual({ enabled: false });
  });
});
