import { createServer as createHttpServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanonicalHarness, type CanonicalHarness } from './test-harness.js';

const execFileAsync = promisify(execFile);
const swiftCompilerAvailable = spawnSync('swiftc', ['--version'], { stdio: 'ignore' }).status === 0;
const runLiveSwiftIntegration = process.env.CANONICAL_SWIFT_LIVE_TEST === '1';
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

  const liveTest = swiftCompilerAvailable && runLiveSwiftIntegration ? it : it.skip;

  liveTest(
    'authenticates, preserves the mounted prefix, and decodes real reference and transaction responses',
    async () => {
      const harness = await createCanonicalHarness({ clock: () => GENERATED_AT });
      harnesses.push(harness);
      harness.sqlite.exec(`
        INSERT INTO accounts
          (id, company_id, display_name, account_number, account_type, credentials_ref)
        VALUES (1, 'bank', 'Daily bank', '1234', 'bank', 'secret-ref');
        INSERT INTO transactions
          (id, account_id, date, processed_date, original_amount, charged_amount, description, hash)
        VALUES (1, 1, '2026-08-08', '2026-08-08', -42.5, -42.5, 'Coffee House', 'swift-live-1');
      `);
      const receivedPaths: string[] = [];
      const proxy = createHttpServer(async (request, response) => {
        const receivedPath = request.url ?? '';
        receivedPaths.push(receivedPath);
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

      try {
        const proxyPort = await listen(proxy);
        const { stdout } = await execFileAsync('swift', [
          'run',
          '--package-path',
          join(process.cwd(), 'ios/CanonicalAPI'),
          'CanonicalAPILiveRunner',
          `http://127.0.0.1:${proxyPort}/money-monitor`,
          harness.macToken,
        ]);

        expect(receivedPaths).toEqual([
          '/money-monitor/api/v1/reference?id=1',
          '/money-monitor/api/v1/transactions',
        ]);
        expect(stdout.trim()).toBe('1|123.45|ILS|1|Coffee House|false');
      } finally {
        if (proxy.listening) await close(proxy);
      }
    },
    30_000,
  );
});
