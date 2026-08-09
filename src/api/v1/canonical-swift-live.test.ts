import { createServer as createHttpServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanonicalHarness, type CanonicalHarness } from './test-harness.js';

const execFileAsync = promisify(execFile);
const swiftCompilerAvailable = spawnSync('swiftc', ['--version'], { stdio: 'ignore' }).status === 0;
const GENERATED_AT = new Date('2026-08-09T10:00:00.000Z');

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Swift live proxy did not expose an ephemeral port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('generated Swift client over a live canonical listener', () => {
  const harnesses: CanonicalHarness[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  });

  const liveTest = swiftCompilerAvailable ? it : it.skip;

  liveTest('authenticates, preserves the mounted prefix, and decodes a real response', async () => {
    const harness = await createCanonicalHarness({ clock: () => GENERATED_AT });
    harnesses.push(harness);
    let receivedPath = '';
    const proxy = createHttpServer(async (request, response) => {
      receivedPath = request.url ?? '';
      if (!receivedPath.startsWith('/money-monitor/')) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const upstreamPath = receivedPath.slice('/money-monitor'.length) || '/';
      const upstream = await fetch(`${harness.macBaseUrl}${upstreamPath}`, {
        method: request.method,
        headers: { authorization: String(request.headers.authorization ?? '') },
      });
      response.statusCode = upstream.status;
      response.setHeader(
        'content-type',
        upstream.headers.get('content-type') ?? 'application/json',
      );
      response.end(Buffer.from(await upstream.arrayBuffer()));
    });

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'money-monitor-swift-live-'));
    const binaryPath = join(temporaryDirectory, 'canonical-swift-live-runner');
    try {
      const proxyPort = await listen(proxy);
      await execFileAsync('swiftc', [
        join(process.cwd(), 'ios/MoneyMonitor/Generated/CanonicalAPI.swift'),
        join(process.cwd(), 'scripts/canonical-swift-live-runner.swift'),
        '-parse-as-library',
        '-o',
        binaryPath,
      ]);
      const { stdout } = await execFileAsync(binaryPath, [
        `http://127.0.0.1:${proxyPort}/money-monitor`,
        harness.macToken,
      ]);

      expect(receivedPath).toBe('/money-monitor/api/v1/reference?id=1');
      expect(stdout.trim()).toBe('1|123.45|ILS');
    } finally {
      if (proxy.listening) await close(proxy);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
