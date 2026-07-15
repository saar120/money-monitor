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
export class MobileAccessRuntime {
  private readonly serverFactory: MobileAccessServerFactory;
  private readonly serveCoordinator: MobileAccessServeCoordinator;
  private readonly logger?: MobileAccessRuntimeLogger;
  private operationQueue: Promise<void> = Promise.resolve();
  private server: RunningMobileAccessServer | null = null;
  private startAttempted = false;
  private resumeEligible = false;
  private lastState: MobileAccessRuntimeState = NOT_STARTED_STATE;
  private successfulDisableState: MobileAccessRuntimeState | null = null;

  constructor(options: MobileAccessRuntimeOptions) {
    this.serverFactory = options.serverFactory;
    this.serveCoordinator = options.serveCoordinator;
    this.logger = options.logger;
  }

  /**
   * Starts Mobile Access during app startup. A disabled startup still asks the
   * coordinator to remove any route that this app durably owns. That closes the
   * crash window between persisting the disabled setting and route teardown.
   */
  start(enabled: boolean): Promise<MobileAccessRuntimeState> {
    return this.serialize(() => this.performStart(enabled));
  }

  /** Re-verifies the persistent mapping after wake only after a running start. */
  resume(): Promise<MobileAccessRuntimeState> {
    return this.serialize(() => this.performResume());
  }

  /** Closes process-local resources without removing the persistent Serve route. */
  shutdown(): Promise<MobileAccessRuntimeState> {
    return this.serialize(() => this.performShutdown());
  }

  /** Explicit user action: remove the owned Serve route, then close the server. */
  disable(): Promise<MobileAccessRuntimeState> {
    return this.serialize(() => this.performDisable());
  }

  private async performStart(enabled: boolean): Promise<MobileAccessRuntimeState> {
    if (!enabled) {
      if (this.startAttempted) {
        this.safeLog('startupSkipped', this.lastState);
        return this.lastState;
      }

      if (this.successfulDisableState) {
        this.safeLog('startupCompleted', this.successfulDisableState);
        return this.successfulDisableState;
      }

      const result = await this.safeReconcile({ enabled: false });
      this.lastState = result;
      if (result.status === 'disabled') this.successfulDisableState = result;
      this.safeLog('startupCompleted', result);
      return result;
    }

    if (this.startAttempted) {
      this.safeLog('startupCompleted', this.lastState);
      return this.lastState;
    }

    this.startAttempted = true;
    this.successfulDisableState = null;

    if (!this.server) {
      try {
        const server = await this.serverFactory.start({ host: '127.0.0.1' });
        if (!isValidPort(server.port)) {
          await closeWithoutThrow(server);
          this.lastState = runtimeFailure('mobileServerStartFailed');
          this.safeLog('startupCompleted', this.lastState);
          return this.lastState;
        }
        this.server = server;
      } catch {
        this.lastState = runtimeFailure('mobileServerStartFailed');
        this.safeLog('startupCompleted', this.lastState);
        return this.lastState;
      }
    }

    const result = await this.safeReconcile({ enabled: true, mobilePort: this.server.port });
    this.lastState = result;
    // The loopback server is the prerequisite for reconciliation. Keep wake
    // recovery eligible even if Tailscale was logged out or unavailable at
    // startup so a later resume can heal the private route without restarting
    // Money Monitor.
    this.resumeEligible = true;
    this.safeLog('startupCompleted', result);
    return result;
  }

  private async performResume(): Promise<MobileAccessRuntimeState> {
    if (!this.resumeEligible || !this.server) {
      const result = this.startAttempted ? this.lastState : NOT_STARTED_STATE;
      this.safeLog('resumeSkipped', result);
      return result;
    }

    const result = await this.safeReconcile({ enabled: true, mobilePort: this.server.port });
    this.lastState = result;
    this.safeLog('resumeCompleted', result);
    return result;
  }

  private async performShutdown(): Promise<MobileAccessRuntimeState> {
    if (!(await this.closeServer())) {
      const result = runtimeFailure('mobileServerCloseFailed');
      this.lastState = result;
      this.safeLog('shutdownCompleted', result);
      return result;
    }

    this.resetStartLifecycle();
    this.lastState = STOPPED_STATE;
    this.safeLog('shutdownCompleted', STOPPED_STATE);
    return STOPPED_STATE;
  }

  private async performDisable(): Promise<MobileAccessRuntimeState> {
    if (this.successfulDisableState) {
      this.safeLog('disableCompleted', this.successfulDisableState);
      return this.successfulDisableState;
    }

    const coordinatorState = await this.safeReconcile({ enabled: false });
    const serverClosed = await this.closeServer();
    this.resumeEligible = false;

    const result = serverClosed
      ? coordinatorState
      : coordinatorState.status === 'disabled'
        ? runtimeFailure('mobileServerCloseFailed')
        : coordinatorState;

    if (serverClosed) {
      this.resetStartLifecycle();
    }
    this.lastState = result;

    if (coordinatorState.status === 'disabled' && serverClosed) {
      this.successfulDisableState = result;
    }

    this.safeLog('disableCompleted', result);
    return result;
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

  private async closeServer(): Promise<boolean> {
    if (!this.server) return true;
    try {
      await this.server.close();
      this.server = null;
      return true;
    } catch {
      return false;
    }
  }

  private resetStartLifecycle(): void {
    this.startAttempted = false;
    this.resumeEligible = false;
  }

  private safeLog(event: MobileAccessRuntimeEvent, state: MobileAccessRuntimeState): void {
    try {
      this.logger?.log({
        event,
        status: state.status,
        diagnostic: state.diagnostic,
      });
    } catch {
      // Diagnostics must never affect the desktop app lifecycle.
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
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

async function closeWithoutThrow(server: RunningMobileAccessServer): Promise<void> {
  try {
    await server.close();
  } catch {
    // The startup result remains a fixed failure state.
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
