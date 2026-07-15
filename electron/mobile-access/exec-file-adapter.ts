import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecFileRequest {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maxBufferBytes: number;
  /** Fixed, caller-owned overrides merged with the inherited process environment. */
  environment?: Readonly<Record<string, string>>;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * Small seam around child_process.spawn. Keeping the executable and
 * arguments separate is intentional: callers must never construct a shell
 * command containing ports, paths, or other runtime values.
 */
export interface ExecFileAdapter {
  run(request: ExecFileRequest): Promise<ExecFileResult>;
}

/**
 * Captures process output for internal classification without copying it into
 * the public Error message. Consumers must not log stdout or stderr.
 */
export class ExecFileFailure extends Error {
  readonly code: string | number | undefined;
  readonly stdout: string;
  readonly stderr: string;

  constructor(options: {
    code?: string | number;
    stdout?: string;
    stderr?: string;
    cause?: unknown;
  }) {
    super('The external process did not complete successfully', { cause: options.cause });
    this.name = 'ExecFileFailure';
    this.code = options.code;
    this.stdout = options.stdout ?? '';
    this.stderr = options.stderr ?? '';
  }
}

export interface NodeExecFileAdapterOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  killProcess?: (pid: number, signal: NodeJS.Signals) => boolean;
}

export class NodeExecFileAdapter implements ExecFileAdapter {
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: typeof spawn;
  private readonly killProcess: (pid: number, signal: NodeJS.Signals) => boolean;

  constructor(options: NodeExecFileAdapterOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawn ?? spawn;
    this.killProcess = options.killProcess ?? process.kill;
  }

  async run(request: ExecFileRequest): Promise<ExecFileResult> {
    return new Promise((resolve, reject) => {
      let completed = false;
      const usesProcessGroup = this.platform !== 'win32';
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let child: ChildProcess;

      try {
        child = this.spawnProcess(request.executable, [...request.args], {
          // A separate process group lets the timeout terminate launchers and
          // their descendants together. Node's native timeout only signals the
          // immediate child, which is insufficient for shell-script launchers.
          detached: usesProcessGroup,
          windowsHide: true,
          env: request.environment ? { ...process.env, ...request.environment } : process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(
          new ExecFileFailure({
            code: (error as NodeJS.ErrnoException).code,
            cause: error,
          }),
        );
        return;
      }

      const readStdout = () => Buffer.concat(stdoutChunks).toString('utf8');
      const readStderr = () => Buffer.concat(stderrChunks).toString('utf8');
      const fail = (options: { code?: string | number; cause?: unknown }) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        reject(
          new ExecFileFailure({
            ...options,
            stdout: readStdout(),
            stderr: readStderr(),
          }),
        );
      };

      const timeout = setTimeout(() => {
        if (completed) return;
        this.terminateProcessTree(child, usesProcessGroup);
        fail({ code: 'ETIMEDOUT' });
      }, request.timeoutMs);

      const appendOutput = (chunks: Buffer[], currentBytes: number, chunk: unknown): number => {
        if (completed) return currentBytes;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const availableBytes = request.maxBufferBytes - currentBytes;

        if (buffer.length <= availableBytes) {
          chunks.push(buffer);
          return currentBytes + buffer.length;
        }

        if (availableBytes > 0) chunks.push(buffer.subarray(0, availableBytes));
        this.terminateProcessTree(child, usesProcessGroup);
        fail({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
        return request.maxBufferBytes;
      };

      child.stdout?.on('data', (chunk: unknown) => {
        stdoutBytes = appendOutput(stdoutChunks, stdoutBytes, chunk);
      });
      child.stderr?.on('data', (chunk: unknown) => {
        stderrBytes = appendOutput(stderrChunks, stderrBytes, chunk);
      });
      child.once('error', (error: Error) => {
        fail({ code: (error as NodeJS.ErrnoException).code, cause: error });
      });
      child.once('close', (code: number | null) => {
        if (completed) return;
        if (code !== 0) {
          fail({ code: code ?? undefined });
          return;
        }

        completed = true;
        clearTimeout(timeout);
        resolve({ stdout: readStdout(), stderr: readStderr() });
      });
    });
  }

  private terminateProcessTree(child: ChildProcess, usesProcessGroup: boolean): void {
    if (usesProcessGroup && child.pid !== undefined) {
      try {
        // A negative PID addresses the POSIX process group created by
        // `detached: true`, including grandchildren of a launcher script.
        this.killProcess(-child.pid, 'SIGKILL');
        return;
      } catch {
        // Fall back to the direct child if group signaling is unavailable.
      }
    }

    child.kill('SIGKILL');
  }
}
