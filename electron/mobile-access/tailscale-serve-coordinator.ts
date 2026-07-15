import { ExecFileFailure, type ExecFileAdapter } from './exec-file-adapter.js';
import type { ServeOwnershipRecord, ServeOwnershipStore } from './serve-ownership-store.js';

export type TailscaleServeStatus =
  | 'disabled'
  | 'running'
  | 'notInstalled'
  | 'loggedOut'
  | 'permissionRequired'
  | 'conflict'
  | 'failed';

export type TailscaleServeDiagnostic =
  | 'routeDisabled'
  | 'routeVerified'
  | 'cliNotFound'
  | 'tailscaleLoggedOut'
  | 'tailscalePermissionRequired'
  | 'tailscaleHTTPSRequired'
  | 'tailscaleNotReady'
  | 'routeOwnershipConflict'
  | 'invalidRequest'
  | 'invalidStatus'
  | 'ownershipStoreUnavailable'
  | 'commandFailed'
  | 'verificationFailed';

export interface TailscaleServeState {
  status: TailscaleServeStatus;
  diagnostic: TailscaleServeDiagnostic;
  /** A sanitized HTTPS URL. Command output and proxy targets are never exposed. */
  publicUrl?: string;
}

export interface TailscaleServeCoordinatorOptions {
  process: ExecFileAdapter;
  ownershipStore: ServeOwnershipStore;
  executable?: string;
  httpsPort?: number;
  mountPath?: string;
  commandTimeoutMs?: number;
  maxBufferBytes?: number;
}

export interface TailscaleServeReconcileRequest {
  enabled: boolean;
  /** Required only when enabled is true. */
  mobilePort?: number;
}

interface OwnedRoute {
  target: string;
  authority: string;
}

interface ServeInspection {
  kind: 'inspected';
  route: OwnedRoute | null;
}

interface ServeInspectionError {
  kind: 'state';
  state: TailscaleServeState;
}

type InspectionResult = ServeInspection | ServeInspectionError;

interface TailnetReady {
  kind: 'ready';
}

type TailnetReadinessResult = TailnetReady | ServeInspectionError;

const DEFAULT_EXECUTABLE = 'tailscale';
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_MOUNT_PATH = '/money-monitor';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const TAILSCALE_CLI_ENVIRONMENT = Object.freeze({ TAILSCALE_BE_CLI: '1' });

/**
 * Reconciles exactly one path-scoped, HTTPS Serve mapping. It never invokes a
 * shell, `tailscale serve reset`, or a bulk configuration command.
 */
export class TailscaleServeCoordinator {
  private readonly process: ExecFileAdapter;
  private readonly ownershipStore: ServeOwnershipStore;
  private readonly executable: string;
  private readonly httpsPort: number;
  private readonly mountPath: string;
  private readonly commandTimeoutMs: number;
  private readonly maxBufferBytes: number;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: TailscaleServeCoordinatorOptions) {
    if (!isValidPort(options.httpsPort ?? DEFAULT_HTTPS_PORT)) {
      throw new Error('httpsPort must be an integer between 1 and 65535');
    }

    const mountPath = options.mountPath ?? DEFAULT_MOUNT_PATH;
    if (!isSafeMountPath(mountPath)) {
      throw new Error('mountPath must be one absolute URL path without query or fragment data');
    }

    this.process = options.process;
    this.ownershipStore = options.ownershipStore;
    this.executable = options.executable ?? DEFAULT_EXECUTABLE;
    this.httpsPort = options.httpsPort ?? DEFAULT_HTTPS_PORT;
    this.mountPath = mountPath;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  /** Serializes startup, wake, settings, and shutdown reconciliations. */
  reconcile(request: TailscaleServeReconcileRequest): Promise<TailscaleServeState> {
    const operation = this.operationQueue.then(
      () => this.performReconcile(request),
      () => this.performReconcile(request),
    );
    this.operationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performReconcile(
    request: TailscaleServeReconcileRequest,
  ): Promise<TailscaleServeState> {
    if (!request.enabled) return this.disableOwnedRoute();
    if (!isValidPort(request.mobilePort)) return state('failed', 'invalidRequest');
    return this.enableOwnedRoute(request.mobilePort);
  }

  private async enableOwnedRoute(mobilePort: number): Promise<TailscaleServeState> {
    // Status JSON can contain peer and identity data. Ask Tailscale to omit
    // peers, reduce the response immediately to fixed enums, and never expose
    // or log its raw fields.
    const readiness = await this.inspectTailnetReadiness();
    if (readiness.kind === 'state') return readiness.state;

    const expectedTarget = `http://127.0.0.1:${mobilePort}`;
    const ownership = await this.loadOwnership();
    if (ownership.kind === 'state') return ownership.state;

    if (ownership.record && !this.matchesCoordinatorIdentity(ownership.record)) {
      return state('conflict', 'routeOwnershipConflict');
    }

    const current = await this.inspectServeStatus();
    if (current.kind === 'state') return current.state;

    if (current.route) {
      if (!ownership.record || !recordOwnsTarget(ownership.record, current.route.target)) {
        return state('conflict', 'routeOwnershipConflict');
      }

      if (current.route.target === expectedTarget) {
        if (!(await this.persistVerifiedOwnership(expectedTarget))) {
          return state('failed', 'ownershipStoreUnavailable');
        }
        return runningState(current.route.authority, this.httpsPort, this.mountPath);
      }
    }

    const pendingRecord: ServeOwnershipRecord = {
      schemaVersion: 1,
      httpsPort: this.httpsPort,
      mountPath: this.mountPath,
      lastKnownTarget: current.route?.target ?? ownership.record?.lastKnownTarget ?? null,
      pendingTarget: expectedTarget,
    };

    if (!(await this.saveOwnership(pendingRecord))) {
      return state('failed', 'ownershipStoreUnavailable');
    }

    const mutation = await this.run([
      'serve',
      '--bg',
      '--yes',
      `--https=${this.httpsPort}`,
      `--set-path=${this.mountPath}`,
      expectedTarget,
    ]);
    if (mutation.kind === 'state') return mutation.state;

    const verified = await this.inspectServeStatus();
    if (verified.kind === 'state') return verified.state;
    if (!verified.route) return state('failed', 'verificationFailed');
    if (verified.route.target !== expectedTarget) {
      return state('conflict', 'routeOwnershipConflict');
    }

    if (!(await this.persistVerifiedOwnership(expectedTarget))) {
      return state('failed', 'ownershipStoreUnavailable');
    }
    return runningState(verified.route.authority, this.httpsPort, this.mountPath);
  }

  private async disableOwnedRoute(): Promise<TailscaleServeState> {
    const ownership = await this.loadOwnership();
    if (ownership.kind === 'state') return ownership.state;
    if (ownership.record && !this.matchesCoordinatorIdentity(ownership.record)) {
      return state('conflict', 'routeOwnershipConflict');
    }

    const current = await this.inspectServeStatus();
    if (current.kind === 'state') return current.state;

    if (!current.route) {
      if (!(await this.clearOwnership())) {
        return state('failed', 'ownershipStoreUnavailable');
      }
      return state('disabled', 'routeDisabled');
    }

    if (!ownership.record || !recordOwnsTarget(ownership.record, current.route.target)) {
      return state('conflict', 'routeOwnershipConflict');
    }

    const mutation = await this.run([
      'serve',
      '--yes',
      `--https=${this.httpsPort}`,
      `--set-path=${this.mountPath}`,
      current.route.target,
      'off',
    ]);
    if (mutation.kind === 'state') return mutation.state;

    const verified = await this.inspectServeStatus();
    if (verified.kind === 'state') return verified.state;
    if (verified.route) {
      if (recordOwnsTarget(ownership.record, verified.route.target)) {
        return state('failed', 'verificationFailed');
      }
      return state('conflict', 'routeOwnershipConflict');
    }

    if (!(await this.clearOwnership())) {
      return state('failed', 'ownershipStoreUnavailable');
    }
    return state('disabled', 'routeDisabled');
  }

  private async inspectServeStatus(): Promise<InspectionResult> {
    const result = await this.run(['serve', 'status', '--json']);
    if (result.kind === 'state') return result;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return { kind: 'state', state: state('failed', 'invalidStatus') };
    }

    return inspectServeConfig(parsed, this.httpsPort, this.mountPath);
  }

  private async inspectTailnetReadiness(): Promise<TailnetReadinessResult> {
    const result = await this.run(['status', '--json', '--peers=false']);
    if (result.kind === 'state') return result;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return invalidStatus();
    }

    return inspectTailnetReadiness(parsed);
  }

  private async run(
    args: readonly string[],
  ): Promise<{ kind: 'output'; stdout: string } | ServeInspectionError> {
    try {
      const result = await this.process.run({
        executable: this.executable,
        args,
        timeoutMs: this.commandTimeoutMs,
        maxBufferBytes: this.maxBufferBytes,
        // The macOS app-bundled executable otherwise decides between GUI and
        // CLI mode from terminal-only environment variables Finder omits.
        environment: TAILSCALE_CLI_ENVIRONMENT,
      });
      return { kind: 'output', stdout: result.stdout };
    } catch (error) {
      return { kind: 'state', state: classifyProcessFailure(error) };
    }
  }

  private async loadOwnership(): Promise<
    { kind: 'record'; record: ServeOwnershipRecord | null } | ServeInspectionError
  > {
    try {
      return { kind: 'record', record: await this.ownershipStore.load() };
    } catch {
      return { kind: 'state', state: state('failed', 'ownershipStoreUnavailable') };
    }
  }

  private async saveOwnership(record: ServeOwnershipRecord): Promise<boolean> {
    try {
      await this.ownershipStore.save(record);
      return true;
    } catch {
      return false;
    }
  }

  private persistVerifiedOwnership(target: string): Promise<boolean> {
    return this.saveOwnership({
      schemaVersion: 1,
      httpsPort: this.httpsPort,
      mountPath: this.mountPath,
      lastKnownTarget: target,
      pendingTarget: null,
    });
  }

  private async clearOwnership(): Promise<boolean> {
    try {
      await this.ownershipStore.clear();
      return true;
    } catch {
      return false;
    }
  }

  private matchesCoordinatorIdentity(record: ServeOwnershipRecord): boolean {
    return record.httpsPort === this.httpsPort && record.mountPath === this.mountPath;
  }
}

function inspectServeConfig(
  value: unknown,
  httpsPort: number,
  mountPath: string,
): InspectionResult {
  if (value === null) return { kind: 'inspected', route: null };
  if (!isRecord(value)) return invalidStatus();

  if (foregroundUsesPort(value.Foreground, httpsPort)) return routeConflict();

  const tcp = value.TCP;
  if (tcp !== undefined && tcp !== null && !isRecord(tcp)) return invalidStatus();
  const listener = isRecord(tcp) ? tcp[String(httpsPort)] : undefined;
  if (listener !== undefined) {
    if (!isRecord(listener)) return routeConflict();
    if (
      listener.HTTPS !== true ||
      listener.HTTP === true ||
      (typeof listener.TCPForward === 'string' && listener.TCPForward.length > 0)
    ) {
      return routeConflict();
    }
  }

  if (funnelUsesPort(value.AllowFunnel, httpsPort)) return routeConflict();

  const web = value.Web;
  if (web !== undefined && web !== null && !isRecord(web)) return invalidStatus();

  const matches: OwnedRoute[] = [];
  if (isRecord(web)) {
    let authoritiesOnPort = 0;
    for (const [authority, server] of Object.entries(web)) {
      if (portFromAuthority(authority) !== httpsPort) continue;
      authoritiesOnPort += 1;
      if (!isRecord(server) || !isRecord(server.Handlers)) return invalidStatus();

      const handler = server.Handlers[mountPath];
      if (handler === undefined) continue;
      if (!isRecord(handler) || typeof handler.Proxy !== 'string') return routeConflict();

      const target = normalizeLoopbackTarget(handler.Proxy);
      if (!target) return routeConflict();
      matches.push({ target, authority });
    }
    if (authoritiesOnPort > 1) return routeConflict();
  }

  if (matches.length > 1) return routeConflict();
  if (matches.length === 1 && listener === undefined) return routeConflict();
  return { kind: 'inspected', route: matches[0] ?? null };
}

function inspectTailnetReadiness(value: unknown): TailnetReadinessResult {
  if (!isRecord(value) || typeof value.BackendState !== 'string') return invalidStatus();

  const backendState = value.BackendState.toLowerCase();
  if (
    backendState === 'needslogin' ||
    backendState === 'needs_login' ||
    backendState === 'loggedout'
  ) {
    return { kind: 'state', state: state('loggedOut', 'tailscaleLoggedOut') };
  }

  if (backendState === 'needsmachineauth' || backendState === 'needs_machine_auth') {
    return { kind: 'state', state: state('permissionRequired', 'tailscalePermissionRequired') };
  }

  if (backendState !== 'running') {
    return { kind: 'state', state: state('failed', 'tailscaleNotReady') };
  }

  if (!isRecord(value.Self) || value.Self.Online !== true) {
    return { kind: 'state', state: state('failed', 'tailscaleNotReady') };
  }

  const certDomains = value.CertDomains;
  if (certDomains === undefined || certDomains === null) {
    return { kind: 'state', state: state('permissionRequired', 'tailscaleHTTPSRequired') };
  }
  if (!Array.isArray(certDomains) || !certDomains.every((domain) => typeof domain === 'string')) {
    return invalidStatus();
  }
  if (certDomains.length === 0) {
    return { kind: 'state', state: state('permissionRequired', 'tailscaleHTTPSRequired') };
  }

  return { kind: 'ready' };
}

function foregroundUsesPort(value: unknown, port: number): boolean {
  if (value === undefined || value === null) return false;
  if (!isRecord(value)) return true;

  for (const config of Object.values(value)) {
    if (!isRecord(config)) return true;
    if (isRecord(config.TCP) && String(port) in config.TCP) return true;
    if (config.Web === undefined || config.Web === null) continue;
    if (!isRecord(config.Web)) return true;
    if (Object.keys(config.Web).some((authority) => portFromAuthority(authority) === port)) {
      return true;
    }
  }
  return false;
}

function funnelUsesPort(value: unknown, port: number): boolean {
  if (value === undefined || value === null) return false;
  if (!isRecord(value)) return true;
  return Object.entries(value).some(
    ([authority, enabled]) => enabled !== false && portFromAuthority(authority) === port,
  );
}

function classifyProcessFailure(error: unknown): TailscaleServeState {
  const code = error instanceof ExecFileFailure ? error.code : readErrorCode(error);
  const evidence = processFailureEvidence(error).toLowerCase();

  if (
    code === 'ENOENT' ||
    evidence.includes('command not found') ||
    evidence.includes('executable file not found') ||
    evidence.includes('tailscale: not found')
  ) {
    return state('notInstalled', 'cliNotFound');
  }

  if (
    evidence.includes('logged out') ||
    evidence.includes('not logged in') ||
    evidence.includes('needs login') ||
    evidence.includes('needslogin') ||
    evidence.includes('login.tailscale')
  ) {
    return state('loggedOut', 'tailscaleLoggedOut');
  }

  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    evidence.includes('permission denied') ||
    evidence.includes('access is denied') ||
    evidence.includes('operation not permitted') ||
    evidence.includes('must be run as root') ||
    evidence.includes('requires administrator') ||
    evidence.includes('approval required') ||
    evidence.includes('requires approval') ||
    evidence.includes('https must be enabled') ||
    evidence.includes('serve is not enabled')
  ) {
    return state('permissionRequired', 'tailscalePermissionRequired');
  }

  if (
    evidence.includes('already in use') ||
    evidence.includes('already configured') ||
    evidence.includes('conflicts with') ||
    evidence.includes('listener exists')
  ) {
    return state('conflict', 'routeOwnershipConflict');
  }

  return state('failed', 'commandFailed');
}

function processFailureEvidence(error: unknown): string {
  if (error instanceof ExecFileFailure) {
    return `${error.stdout}\n${error.stderr}`;
  }
  return error instanceof Error ? error.message : '';
}

function readErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

function recordOwnsTarget(record: ServeOwnershipRecord, target: string): boolean {
  return record.lastKnownTarget === target || record.pendingTarget === target;
}

function normalizeLoopbackTarget(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null;
    }
    const port = Number(url.port);
    if (!isValidPort(port)) return null;
    return `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

function runningState(authority: string, port: number, mountPath: string): TailscaleServeState {
  const publicUrl = sanitizePublicUrl(authority, port, mountPath);
  return publicUrl
    ? { status: 'running', diagnostic: 'routeVerified', publicUrl }
    : state('running', 'routeVerified');
}

function sanitizePublicUrl(authority: string, port: number, mountPath: string): string | undefined {
  const separator = authority.lastIndexOf(':');
  if (separator <= 0) return undefined;
  const hostname = authority.slice(0, separator);
  const authorityPort = Number(authority.slice(separator + 1));
  if (authorityPort !== port || !/^[A-Za-z0-9.-]+$/.test(hostname)) return undefined;
  const portSuffix = port === 443 ? '' : `:${port}`;
  return `https://${hostname}${portSuffix}${mountPath}`;
}

function portFromAuthority(authority: string): number | null {
  const separator = authority.lastIndexOf(':');
  if (separator < 0) return null;
  const port = Number(authority.slice(separator + 1));
  return isValidPort(port) ? port : null;
}

function isSafeMountPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    value.length > 1 &&
    !value.endsWith('/') &&
    !value.includes('?') &&
    !value.includes('#') &&
    !value.includes('..') &&
    !/\s/.test(value)
  );
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65_535;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function state(
  status: TailscaleServeStatus,
  diagnostic: TailscaleServeDiagnostic,
): TailscaleServeState {
  return { status, diagnostic };
}

function invalidStatus(): ServeInspectionError {
  return { kind: 'state', state: state('failed', 'invalidStatus') };
}

function routeConflict(): ServeInspectionError {
  return { kind: 'state', state: state('conflict', 'routeOwnershipConflict') };
}
