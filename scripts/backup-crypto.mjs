import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, writeFile, appendFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('MMBACKUP1');
const HEADER_LENGTH = MAGIC.length + 16 + 12;
const TAG_LENGTH = 16;

function key(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error(
      'Set MM_BACKUP_PASSPHRASE to an independent passphrase of at least 16 characters. Keep it separately from the backup.',
    );
  }
  return scryptSync(passphrase, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 });
}

export async function encryptBackup(source, destination, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  await writeFile(destination, Buffer.concat([MAGIC, salt, iv]), { flag: 'wx', mode: 0o600 });
  await pipeline(
    createReadStream(source),
    cipher,
    createWriteStream(destination, { flags: 'a', mode: 0o600 }),
  );
  await appendFile(destination, cipher.getAuthTag());
}

/** Decrypt only into a private temporary directory; use output only after authentication succeeds. */
export async function decryptBackup(source, destination, passphrase) {
  const file = await open(source, 'r');
  try {
    const { size } = await file.stat();
    if (size <= HEADER_LENGTH + TAG_LENGTH) throw new Error('Invalid backup');
    const header = Buffer.alloc(HEADER_LENGTH);
    await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error('Unsupported backup format');
    const tag = Buffer.alloc(TAG_LENGTH);
    await file.read(tag, 0, tag.length, size - TAG_LENGTH);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(passphrase, header.subarray(MAGIC.length, MAGIC.length + 16)),
      header.subarray(MAGIC.length + 16),
    );
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { start: HEADER_LENGTH, end: size - TAG_LENGTH - 1 }),
      decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } finally {
    await file.close();
  }
}
