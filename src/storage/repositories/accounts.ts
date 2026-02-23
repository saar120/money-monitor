import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Account, ProviderCredentials, ProviderType } from '../../types/index.js';
import { encrypt, decrypt } from '../../config.js';

export class AccountRepository {
  constructor(
    private db: Database.Database,
    private encryptionKey: string,
  ) {}

  create(
    name: string,
    provider: ProviderType,
    credentials: ProviderCredentials,
  ): Account {
    const id = uuidv4();
    const encryptedCredentials = encrypt(
      JSON.stringify(credentials),
      this.encryptionKey,
    );
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO accounts (id, name, provider, encrypted_credentials, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, provider, encryptedCredentials, now, now);

    return {
      id,
      name,
      provider,
      encryptedCredentials,
      createdAt: now,
      updatedAt: now,
      lastScrapedAt: null,
    };
  }

  findAll(): Omit<Account, 'encryptedCredentials'>[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, provider, created_at, updated_at, last_scraped_at
         FROM accounts ORDER BY name`,
      )
      .all() as Array<{
      id: string;
      name: string;
      provider: ProviderType;
      created_at: string;
      updated_at: string;
      last_scraped_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastScrapedAt: row.last_scraped_at,
    }));
  }

  findById(id: string): Account | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(id) as
      | {
          id: string;
          name: string;
          provider: ProviderType;
          encrypted_credentials: string;
          created_at: string;
          updated_at: string;
          last_scraped_at: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      encryptedCredentials: row.encrypted_credentials,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastScrapedAt: row.last_scraped_at,
    };
  }

  getCredentials(id: string): ProviderCredentials | null {
    const account = this.findById(id);
    if (!account) return null;

    const decrypted = decrypt(
      account.encryptedCredentials,
      this.encryptionKey,
    );
    return JSON.parse(decrypted) as ProviderCredentials;
  }

  updateLastScraped(id: string, scrapedAt: string): void {
    this.db
      .prepare(
        `UPDATE accounts SET last_scraped_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(scrapedAt, new Date().toISOString(), id);
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM accounts WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
