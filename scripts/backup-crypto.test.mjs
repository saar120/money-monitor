import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptBackup, decryptBackup } from './backup-crypto.mjs';

test('backup encryption round trips and rejects wrong passwords and tampering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-backup-test-'));
  const file = (name) => join(dir, name);
  try {
    writeFileSync(file('source'), 'synthetic financial backup');
    await encryptBackup(file('source'), file('sealed'), 'synthetic independent passphrase');
    assert.equal(
      readFileSync(file('sealed')).includes(Buffer.from('synthetic financial backup')),
      false,
    );
    await decryptBackup(file('sealed'), file('restored'), 'synthetic independent passphrase');
    assert.equal(readFileSync(file('restored'), 'utf8'), 'synthetic financial backup');
    await assert.rejects(
      decryptBackup(file('sealed'), file('wrong'), 'another independent passphrase'),
    );
    const bytes = readFileSync(file('sealed'));
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(file('tampered'), bytes);
    await assert.rejects(
      decryptBackup(file('tampered'), file('bad'), 'synthetic independent passphrase'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
