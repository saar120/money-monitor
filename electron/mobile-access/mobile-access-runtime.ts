import type {
  TailscaleServeDiagnostic,
  TailscaleServeReconcileRequest,
  TailscaleServeState,
  TailscaleServeStatus,
} from './tailscale-serve-coordinator.js';

export interface RunningMobileAccessServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface MobileAccessServerFactory {
  start(options: { host: '127.0.0.1' }): Promise<RunningMobileAccessServer>;
}

export interface MobileAccessServeCoordinator {
  reconcile(request: TailscaleServeReconcileRequest): Promise<TailscaleServeState>;
}

export type MobileAccessRuntimeStatus = TailscaleServeStatus | 'stopped';

export type MobileAccessRuntimeDiagnostic =
  | TailscaleServeDiagnostic
  | 'mobileServerStartFailed'
  | 'mobileServerCloseFailed'
  | 'coordinatorUnavailable'
  | 'runtimeNotStarted'
  | 'runtimeStopped';

export interface MobileAccessRuntimeState {
  status: MobileAccessRuntimeStatus;
  diagnostic: MobileAccessRuntimeDiagnostic;
  publicUrl?: string;
}

export type MobileAccessRuntimeEvent =
  | 'startupSkipped'
  | 'startupCompleted'
  | 'resumeSkipped'
  | 'resumeCompleted'
  | 'shutdownCompleted'
  | 'disableCompleted';

/** Intentionally contains no exception, command output, target URL, or port. */
export interface MobileAccessRuntimeLogEntry {
  event: MobileAccessRuntimeEvent;
  status: MobileAccessRuntimeStatus;
  diagnostic: MobileAccessRuntimeDiagnostic;
}

export interface MobileAccessRuntimeLogger {
  log(entry: MobileAccessRuntimeLogEntry): void;
}

export interface MobileAccessRuntimeOptions {
  serverFactory: MobileAccessServerFactory;
  serveCoordinator: MobileAccessServeCoordinator;
  logger?: MobileAccessRuntimeLogger;
}

const SERVE_STATUSES = new Set<TailscaleServeStatus>([
  'disabled',
  'running',
  'notInstalled',
  'loggedOut',
  'permissionRequired',
  'conflict',
  'failed',
]);

const SERVE_DIAGNOSTICS = new Set<TailscaleServeDiagnostic>([
  'routeDisabled',
  'routeVerified',
  'cliNotFound',
  'tailscaleLoggedOut',
  'tailscalePermissionRequired',
  'tailscaleHTTPSRequired',
  'tailscaleNotReady',
  'routeOwnershipConflict',
  'invalidRequest',
  'invalidStatus',
  'ownershipStoreUnavailable',
  'commandFailed',
  'verificationFailed',
]);

const NOT_STARTED_STATE: MobileAccessRuntimeState = {
  status: 'stopped',
  diagnostic: 'runtimeNotStarted',
};

const STOPPED_STATE: MobileAccessRuntimeState = {
  status: 'stopped',
  diagnostic: 'runtimeStopped',
};

/**
 * Process-local lifecycle owner for the loopback mobile server and persistent
 * Tailscale Serve coordinator. Public methods never reject.
 */
type RuntimeOwnership = {
  kind: 'idle' | 'enabled' | 'disabled' | 'stopped';
  server: RunningMobileAccessServer | null;
  snapshot: MobileAccessRuntimeState;
};
export class MobileAccessRuntime {
  private readonly serverFactory: MobileAccessServerFactory;
  private readonly serveCoordinator: MobileAccessServeCoordinator;
  private readonly logger?: MobileAccessRuntimeLogger;
  private operationQueue: Promise<void> = Promise.resolve();
  private startup: { enabled: boolean; promise: Promise<MobileAccessRuntimeState> } | null = null;
  private owner: RuntimeOwnership = { kind: 'idle', server: null, snapshot: NOT_STARTED_STATE };
  constructor(options: MobileAccessRuntimeOptions) {
    this.serverFactory = options.serverFactory;
    this.serveCoordinator = options.serveCoordinator;
    this.logger = options.logger;
  }
  start(enabled: boolean) {
    if (this.startup?.enabled === enabled) return this.startup.promise;
    const promise = this.serialize(() =>
      enabled
        ? this.owner.kind === 'enabled' && this.owner.snapshot.status === 'running'
          ? Promise.resolve(this.owner.snapshot)
          : this.enable()
        : this.disableOwned('startupCompleted'),
    );
    const startup = { enabled, promise };
    this.startup = startup;
    void promise
      .finally(() => {
        if (this.startup === startup) this.startup = null;
      })
      .catch(() => {});
    return promise;
  }
  resume() {
    return this.serialize(async () => {
      if (this.owner.kind !== 'enabled') {
        this.safeLog('resumeSkipped', this.owner.snapshot);
        return this.owner.snapshot;
      }
      return this.enable('resumeCompleted');
    });
  }
  shutdown() {
    this.startup = null;
    return this.serialize(async () => {
      const server = this.owner.server;
      const closed = await this.closeServer(server);
      this.owner = {
        kind: 'stopped',
        server: closed ? null : server,
        snapshot: closed ? STOPPED_STATE : runtimeFailure('mobileServerCloseFailed'),
      };
      this.safeLog('shutdownCompleted', this.owner.snapshot);
      return this.owner.snapshot;
    });
  }
  disable() {
    this.startup = null;
    return this.serialize(() => this.disableOwned('disableCompleted'));
  }
  private async enable(event: 'startupCompleted' | 'resumeCompleted' = 'startupCompleted') {
    this.owner = { ...this.owner, kind: 'enabled' };
    let server = this.owner.server;
    if (!server) {
      try {
        server = await this.serverFactory.start({ host: '127.0.0.1' });
        if (!isValidPort(server.port)) {
          const closed = await this.closeServer(server);
          this.owner = {
            kind: 'enabled',
            server: closed ? null : server,
            snapshot: runtimeFailure('mobileServerStartFailed'),
          };
          this.safeLog(event, this.owner.snapshot);
          return this.owner.snapshot;
        }
      } catch {
        this.owner.snapshot = runtimeFailure('mobileServerStartFailed');
        this.safeLog(event, this.owner.snapshot);
        return this.owner.snapshot;
      }
    }
    const snapshot = await this.safeReconcile({ enabled: true, mobilePort: server.port });
    this.owner = { kind: 'enabled', server, snapshot };
    this.safeLog(event, snapshot);
    return snapshot;
  }
  private async disableOwned(event: 'startupCompleted' | 'disableCompleted') {
    if (
      this.owner.kind === 'disabled' &&
      !this.owner.server &&
      this.owner.snapshot.status === 'disabled'
    )
      return this.owner.snapshot;
    const snapshot = await this.safeReconcile({ enabled: false });
    const server = this.owner.server;
    const closed = await this.closeServer(server);
    this.owner = {
      kind: 'disabled',
      server: closed ? null : server,
      snapshot:
        !closed && snapshot.status === 'disabled'
          ? runtimeFailure('mobileServerCloseFailed')
          : snapshot,
    };
    this.safeLog(event, this.owner.snapshot);
    return this.owner.snapshot;
  }
  private async closeServer(server: RunningMobileAccessServer | null) {
    if (!server) return true;
    try {
      await server.close();
      return true;
    } catch {
      return false;
    }
  }
  private async safeReconcile(
    request: TailscaleServeReconcileRequest,
  ): Promise<MobileAccessRuntimeState> {
    try {
      return sanitizeCoordinatorState(await this.serveCoordinator.reconcile(request));
    } catch {
      return runtimeFailure('coordinatorUnavailable');
    }
  }
  private safeLog(event: MobileAccessRuntimeEvent, state: MobileAccessRuntimeState) {
    try {
      this.logger?.log({ event, status: state.status, diagnostic: state.diagnostic });
    } catch {
      /* Optional diagnostic. */
    }
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

function sanitizeCoordinatorState(value: TailscaleServeState): MobileAccessRuntimeState {
  if (!SERVE_STATUSES.has(value.status) || !SERVE_DIAGNOSTICS.has(value.diagnostic)) {
    return runtimeFailure('coordinatorUnavailable');
  }

  const publicUrl = sanitizeHttpsUrl(value.publicUrl);
  return publicUrl
    ? { status: value.status, diagnostic: value.diagnostic, publicUrl }
    : { status: value.status, diagnostic: value.diagnostic };
}

function sanitizeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function runtimeFailure(
  diagnostic: 'mobileServerStartFailed' | 'mobileServerCloseFailed' | 'coordinatorUnavailable',
): MobileAccessRuntimeState {
  return { status: 'failed', diagnostic };
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65_535;
}
