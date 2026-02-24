# Phase 1: Foundation

**Goal:** Set up the project skeleton — TypeScript, Fastify, Drizzle ORM, SQLite database, credential encryption, and configuration loading. After this phase the server boots, connects to the DB, and runs migrations.

**Prerequisites:** Node.js >= 22.12.0 installed.

---

## Task 1.1 — Project Init & Dependencies

### Steps

1. Initialize the root project:
   ```bash
   cd money-monitor
   npm init -y
   ```

2. Install production dependencies:
   ```bash
   npm install fastify @fastify/cors @fastify/static \
     better-sqlite3 drizzle-orm \
     israeli-bank-scrapers \
     node-cron \
     @anthropic-ai/sdk \
     dotenv zod
   ```

3. Install dev dependencies:
   ```bash
   npm install -D typescript @types/node @types/better-sqlite3 @types/node-cron \
     drizzle-kit tsx
   ```

4. Create `tsconfig.json`:
   ```jsonc
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "esModuleInterop": true,
       "strict": true,
       "outDir": "dist",
       "rootDir": "src",
       "declaration": true,
       "sourceMap": true,
       "skipLibCheck": true,
       "resolveJsonModule": true,
       "forceConsistentCasingInFileNames": true
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist", "dashboard"]
   }
   ```

5. Add scripts to `package.json`:
   ```json
   {
     "type": "module",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js",
       "db:generate": "drizzle-kit generate",
       "db:migrate": "drizzle-kit migrate",
       "db:studio": "drizzle-kit studio"
     }
   }
   ```

6. Create `.env.example`:
   ```env
   # Server
   PORT=3000
   HOST=0.0.0.0

   # Credentials encryption
   CREDENTIALS_MASTER_KEY=<random-32-byte-hex>

   # Scraping
   SCRAPE_CRON="0 6 * * *"
   SCRAPE_TIMEZONE=Asia/Jerusalem
   SCRAPE_START_DATE_MONTHS_BACK=3

   # Anthropic
   ANTHROPIC_API_KEY=<your-api-key>
   ANTHROPIC_MODEL=claude-sonnet-4-6

   # Dashboard
   VITE_API_URL=http://localhost:3000
   ```

7. Create `.gitignore`:
   ```
   node_modules/
   dist/
   data/
   .env
   *.db
   *.db-journal
   dashboard/node_modules/
   dashboard/dist/
   ```

### Acceptance Criteria
- `npm install` succeeds
- `npx tsc --noEmit` succeeds (once source files exist)
- `.env.example` documents all env vars

---

## Task 1.2 — Configuration Module

### File: `src/config.ts`

Use `zod` to parse and validate env vars from `process.env`. Load `dotenv` at the top.

```typescript
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CREDENTIALS_MASTER_KEY: z.string().min(1, 'CREDENTIALS_MASTER_KEY is required'),
  SCRAPE_CRON: z.string().default('0 6 * * *'),
  SCRAPE_TIMEZONE: z.string().default('Asia/Jerusalem'),
  SCRAPE_START_DATE_MONTHS_BACK: z.coerce.number().default(3),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
```

### Acceptance Criteria
- Importing `config` throws if `CREDENTIALS_MASTER_KEY` is missing
- All defaults are applied for optional fields

---

## Task 1.3 — Database Connection & Schema

### File: `src/db/connection.ts`

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });

const sqlite = new Database('data/money-monitor.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };
```

### File: `src/db/schema.ts`

Define all three tables using Drizzle's SQLite column builders. This is the exact schema from PLAN.md.

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id').notNull(),
  displayName: text('display_name').notNull(),
  accountNumber: text('account_number'),
  credentialsRef: text('credentials_ref').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastScrapedAt: text('last_scraped_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  identifier: integer('identifier'),
  date: text('date').notNull(),
  processedDate: text('processed_date').notNull(),
  originalAmount: real('original_amount').notNull(),
  originalCurrency: text('original_currency').notNull().default('ILS'),
  chargedAmount: real('charged_amount').notNull(),
  description: text('description').notNull(),
  memo: text('memo'),
  type: text('type').notNull().default('normal'),  // 'normal' | 'installments'
  status: text('status').notNull().default('completed'),  // 'completed' | 'pending'
  installmentNumber: integer('installment_number'),
  installmentTotal: integer('installment_total'),
  category: text('category'),
  hash: text('hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const scrapeLogs = sqliteTable('scrape_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  status: text('status').notNull(),  // 'success' | 'error'
  errorType: text('error_type'),
  errorMessage: text('error_message'),
  transactionsFound: integer('transactions_found').default(0),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});
```

### File: `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'data/money-monitor.db',
  },
});
```

### Steps
1. Create the files above
2. Run `npx drizzle-kit generate` to produce the initial migration SQL
3. Run `npx drizzle-kit migrate` to apply it

### Acceptance Criteria
- `data/money-monitor.db` is created
- All three tables exist with correct columns (verify via `sqlite3 data/money-monitor.db ".schema"`)
- Foreign keys are enforced

---

## Task 1.4 — Credential Store

### File: `src/scraper/credential-store.ts`

Encrypts/decrypts bank credentials using AES-256-GCM with the master key from config.

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { config } from '../config.js';

const CREDENTIALS_FILE = 'data/credentials.enc';
const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  return scryptSync(config.CREDENTIALS_MASTER_KEY, 'money-monitor-salt', 32);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as: iv:authTag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

interface CredentialMap {
  [ref: string]: Record<string, string>;
}

function loadAll(): CredentialMap {
  mkdirSync('data', { recursive: true });
  if (!existsSync(CREDENTIALS_FILE)) return {};
  const raw = readFileSync(CREDENTIALS_FILE, 'utf8');
  return JSON.parse(decrypt(raw));
}

function saveAll(credentials: CredentialMap): void {
  mkdirSync('data', { recursive: true });
  writeFileSync(CREDENTIALS_FILE, encrypt(JSON.stringify(credentials)));
}

export function getCredentials(ref: string): Record<string, string> | null {
  const all = loadAll();
  return all[ref] ?? null;
}

export function setCredentials(ref: string, creds: Record<string, string>): void {
  const all = loadAll();
  all[ref] = creds;
  saveAll(all);
}

export function deleteCredentials(ref: string): void {
  const all = loadAll();
  delete all[ref];
  saveAll(all);
}
```

### Acceptance Criteria
- `setCredentials('test', { user: 'a', pass: 'b' })` then `getCredentials('test')` returns `{ user: 'a', pass: 'b' }`
- `data/credentials.enc` is not readable as plain JSON
- Changing `CREDENTIALS_MASTER_KEY` makes old data undecryptable

---

## Task 1.5 — Fastify Server Entry Point

### File: `src/index.ts`

Minimal server that boots, applies CORS, registers a health endpoint, and is ready for route registration in later phases.

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { db } from './db/connection.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Health check
app.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Server running on http://${config.HOST}:${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, db };
```

### Acceptance Criteria
- `npm run dev` starts the server on the configured port
- `GET /api/health` returns `{ status: "ok", timestamp: "..." }`
- Server logs are visible in the console

---

## Task 1.6 — Shared Types

### File: `src/shared/types.ts`

Define TypeScript types matching the DB schema and the `israeli-bank-scrapers` transaction shape for use across modules.

```typescript
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { accounts, transactions, scrapeLogs } from '../db/schema.js';

// DB row types
export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;
export type Transaction = InferSelectModel<typeof transactions>;
export type NewTransaction = InferInsertModel<typeof transactions>;
export type ScrapeLog = InferSelectModel<typeof scrapeLogs>;
export type NewScrapeLog = InferInsertModel<typeof scrapeLogs>;

// Scraper result types (from israeli-bank-scrapers)
export interface ScraperTransaction {
  type: string;             // 'normal' | 'installments'
  identifier?: number;
  date: string;             // ISO date
  processedDate: string;    // ISO date
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo?: string;
  installments?: {
    number: number;
    total: number;
  };
  status: string;           // 'completed' | 'pending'
}

export interface ScraperAccountResult {
  accountNumber: string;
  balance?: number;
  txns: ScraperTransaction[];
}

export interface ScraperResult {
  success: boolean;
  accounts?: ScraperAccountResult[];
  errorType?: string;       // 'INVALID_PASSWORD' | 'CHANGE_PASSWORD' | 'ACCOUNT_BLOCKED' | 'UNKNOWN_ERROR' | 'TIMEOUT' | 'GENERIC'
  errorMessage?: string;
}

// Supported company IDs (from israeli-bank-scrapers CompanyTypes)
export const COMPANY_IDS = [
  'hapoalim', 'leumi', 'discount', 'mizrahi', 'otsarHahayal',
  'mercantile', 'massad', 'beinleumi', 'union',
  'isracard', 'amex', 'max', 'visaCal',
  'beyahadBishvilha', 'yahav', 'oneZero', 'behatsdaa', 'pagi',
] as const;

export type CompanyId = typeof COMPANY_IDS[number];
```

### Acceptance Criteria
- All types compile without errors
- Types are importable from other modules

---

## Final Verification

After all tasks are done:

```bash
# Should compile without errors
npx tsc --noEmit

# Should boot the server
npm run dev
# → Visit http://localhost:3000/api/health

# DB should have tables
npx drizzle-kit migrate
sqlite3 data/money-monitor.db ".tables"
# → accounts  scrape_logs  transactions
```

---

## Files Created in This Phase

```
money-monitor/
├── .env.example
├── .gitignore
├── tsconfig.json
├── drizzle.config.ts
├── package.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── connection.ts
│   │   └── migrations/         (auto-generated by drizzle-kit)
│   ├── scraper/
│   │   └── credential-store.ts
│   └── shared/
│       └── types.ts
└── data/                        (gitignored, created at runtime)
```
