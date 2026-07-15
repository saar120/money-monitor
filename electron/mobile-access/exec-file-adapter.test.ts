import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecFileFailure, NodeExecFileAdapter } from './exec-file-adapter.ts';

interface CapturedSpawnOptions {
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: unknown;
  timeout?: number;
  windowsHide?: boolean;
}

function createHarness(
  options: {
    platform?: NodeJS.Platform;
    processGroupKillError?: Error;
  } = {},
) {
  let capturedCommand: string | undefined;
  let capturedArgs: readonly string[] | undefined;
  let capturedOptions: CapturedSpawnOptions | undefined;
  const childKill = vi.fn(() => true);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    kill: childKill,
    stdout,
    stderr,
  }) as unknown as ChildProcess;
  const spawnMock = vi.fn(
    (command: string, args: readonly string[], spawnOptions: CapturedSpawnOptions) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedOptions = spawnOptions;
      return child;
    },
  );
  const killProcess = vi.fn(() => {
    if (options.processGroupKillError) throw options.processGroupKillError;
    return true;
  });
  const adapter = new NodeExecFileAdapter({
    platform: options.platform ?? 'darwin',
    spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
    killProcess,
  });

  return {
    adapter,
    capturedArgs: () => capturedArgs,
    capturedCommand: () => capturedCommand,
    capturedOptions: () => capturedOptions,
    child,
    childKill,
    killProcess,
    spawnMock,
    stderr,
    stdout,
  };
}

function request(environment?: Readonly<Record<string, string>>) {
  return {
    executable: '/usr/local/bin/tailscale',
    args: ['serve', 'status', '--json'],
    timeoutMs: 50,
    maxBufferBytes: 1024,
    environment,
  } as const;
}

describe('NodeExecFileAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs POSIX commands in a process group without a native child timeout', async () => {
    const harness = createHarness();
    const inheritedPath = process.env.PATH;
    const result = harness.adapter.run(request({ MM_TEST_FIXED_ENV: 'enabled' }));

    expect(harness.spawnMock).toHaveBeenCalledOnce();
    expect(harness.capturedCommand()).toBe('/usr/local/bin/tailscale');
    expect(harness.capturedArgs()).toEqual(['serve', 'status', '--json']);
    expect(harness.capturedOptions()).toEqual(
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
    expect(harness.capturedOptions()).not.toHaveProperty('timeout');
    expect(harness.capturedOptions()?.env).toMatchObject({
      PATH: inheritedPath,
      MM_TEST_FIXED_ENV: 'enabled',
    });
    expect(process.env.MM_TEST_FIXED_ENV).toBeUndefined();

    harness.stdout.write('status');
    harness.child.emit('close', 0, null);
    await expect(result).resolves.toEqual({ stdout: 'status', stderr: '' });

    await vi.advanceTimersByTimeAsync(50);
    expect(harness.killProcess).not.toHaveBeenCalled();
    expect(harness.childKill).not.toHaveBeenCalled();
  });

  it('kills the entire POSIX process group and rejects deterministically on timeout', async () => {
    const harness = createHarness();
    const result = harness.adapter.run(request());
    const rejection = expect(result).rejects.toEqual(
      expect.objectContaining({
        name: 'ExecFileFailure',
        code: 'ETIMEDOUT',
        stdout: '',
        stderr: '',
      }),
    );

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(harness.killProcess).toHaveBeenCalledOnce();
    expect(harness.killProcess).toHaveBeenCalledWith(-4242, 'SIGKILL');
    expect(harness.childKill).not.toHaveBeenCalled();

    harness.child.emit('close', 2, null);
    expect(harness.killProcess).toHaveBeenCalledOnce();
  });

  it('falls back to killing the direct child when process-group signaling fails', async () => {
    const harness = createHarness({ processGroupKillError: new Error('group unavailable') });
    const result = harness.adapter.run(request());
    const rejection = expect(result).rejects.toBeInstanceOf(ExecFileFailure);

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(harness.killProcess).toHaveBeenCalledWith(-4242, 'SIGKILL');
    expect(harness.childKill).toHaveBeenCalledWith('SIGKILL');
  });

  it('uses direct-child termination on Windows instead of a negative PID', async () => {
    const harness = createHarness({ platform: 'win32' });
    const result = harness.adapter.run(request());
    const rejection = expect(result).rejects.toMatchObject({ code: 'ETIMEDOUT' });

    expect(harness.capturedOptions()?.detached).toBe(false);
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(harness.killProcess).not.toHaveBeenCalled();
    expect(harness.childKill).toHaveBeenCalledWith('SIGKILL');
  });

  it('preserves command failures and captured output before the deadline', async () => {
    const harness = createHarness();
    const result = harness.adapter.run(request());
    const commandError = Object.assign(new Error('command failed'), { code: 'ENOENT' });

    harness.stdout.write('captured stdout');
    harness.stderr.write('captured stderr');
    harness.child.emit('error', commandError);

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: 'ExecFileFailure',
        code: 'ENOENT',
        stdout: 'captured stdout',
        stderr: 'captured stderr',
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(harness.killProcess).not.toHaveBeenCalled();
  });

  it('bounds captured output and terminates the process tree on overflow', async () => {
    const harness = createHarness();
    const result = harness.adapter.run({ ...request(), maxBufferBytes: 4 });
    const rejection = expect(result).rejects.toMatchObject({
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      stdout: '1234',
    });

    harness.stdout.write('12345');

    await rejection;
    expect(harness.killProcess).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });
});
