# Phase 6: Polish

**Goal:** Add error handling, input validation, request logging, and serve the Vue dashboard as static files from Fastify in production mode. This phase hardens the MVP for real usage.

**Prerequisites:** Phase 1–5 complete — all backend + frontend features are working.

---

## Task 6.1 — Input Validation with Zod Schemas

Add request body/query validation to all API routes using Zod. Define schemas in a shared file and apply them in routes.

### File: `src/api/validation.ts`

```typescript
import { z } from 'zod';
import { COMPANY_IDS } from '../shared/types.js';

// ─── Accounts ───

export const createAccountSchema = z.object({
  companyId: z.enum(COMPANY_IDS),
  displayName: z.string().min(1).max(100),
  credentials: z.record(z.string().min(1), z.string()).refine(
    obj => Object.keys(obj).length > 0,
    'At least one credential field is required'
  ),
});

export const updateAccountSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});

// ─── Transactions Query ───

export const transactionQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  category: z.string().optional(),
  status: z.enum(['completed', 'pending']).optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sortBy: z.enum(['date', 'chargedAmount', 'description', 'processedDate']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Summary Query ───

export const summaryQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  groupBy: z.enum(['category', 'month', 'account']).default('category'),
});

// ─── AI ───

export const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(10000),
  })).min(1).max(100),
});

export const categorizeSchema = z.object({
  batchSize: z.number().int().min(1).max(500).default(50),
});

// ─── Scrape Logs Query ───

export const scrapeLogsQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
```

### How to Apply in Routes

In each route handler, parse the request body/query through the Zod schema. Example pattern:

```typescript
app.post('/api/accounts', async (request, reply) => {
  const parsed = createAccountSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const { companyId, displayName, credentials } = parsed.data;
  // ... rest of handler
});
```

Apply this pattern to **all** route handlers:
- `POST /api/accounts` → `createAccountSchema`
- `PUT /api/accounts/:id` → `updateAccountSchema`
- `GET /api/transactions` → `transactionQuerySchema`
- `GET /api/transactions/summary` → `summaryQuerySchema`
- `POST /api/ai/chat` → `chatSchema`
- `POST /api/ai/categorize` → `categorizeSchema`
- `GET /api/scrape/logs` → `scrapeLogsQuerySchema`

### Acceptance Criteria
- Invalid input returns 400 with `{ error, details }` shape
- All body/query params are validated before use
- Date strings must be in `YYYY-MM-DD` format
- String lengths are bounded
- Number params are coerced from query strings

---

## Task 6.2 — Global Error Handler

### Modify: `src/index.ts`

Add a global error handler to Fastify so unhandled errors return clean JSON rather than stack traces.

```typescript
// Add after Fastify creation
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  // Fastify validation errors
  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation error',
      details: error.message,
    });
  }

  // Known errors
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  // Unknown errors — don't leak internals
  return reply.status(500).send({
    error: 'Internal server error',
  });
});

// 404 handler
app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: `Route ${request.method} ${request.url} not found`,
  });
});
```

### Acceptance Criteria
- Unknown routes return `{ error: "Route GET /xyz not found" }` with 404
- Unhandled errors return `{ error: "Internal server error" }` with 500 (no stack traces)
- Validation errors return 400 with details
- All errors are logged to the Fastify logger

---

## Task 6.3 — Request Logging

Fastify has built-in logging via Pino. Enhance it with request timing.

### Modify: `src/index.ts`

```typescript
const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Request timing hook
app.addHook('onResponse', (request, reply, done) => {
  request.log.info(
    { responseTime: reply.elapsedTime, statusCode: reply.statusCode },
    `${request.method} ${request.url}`
  );
  done();
});
```

### Install pino-pretty:
```bash
npm install -D pino-pretty
```

### Acceptance Criteria
- Every request is logged with method, URL, status code, and response time
- Logs are human-readable in development (via pino-pretty)
- Error logs include full error details

---

## Task 6.4 — Serve Dashboard Static Files in Production

### Modify: `src/index.ts`

In production, serve the Vue build output from Fastify so the entire app runs on a single port.

```typescript
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dashboardDist = join(__dirname, '..', 'dashboard', 'dist');

// Serve dashboard static files in production
if (existsSync(dashboardDist)) {
  await app.register(fastifyStatic, {
    root: dashboardDist,
    prefix: '/',
    wildcard: false, // Don't catch /api/* routes
  });

  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` });
    }
    // Serve index.html for client-side routing
    return reply.sendFile('index.html');
  });
}
```

### Build the dashboard:
```bash
cd dashboard && npm run build
```

This produces `dashboard/dist/` with the static files.

### Production startup:
```bash
# Build backend
npm run build

# Build dashboard
cd dashboard && npm run build && cd ..

# Start
NODE_ENV=production node dist/index.js
# → Serves both API and dashboard on port 3000
```

### Acceptance Criteria
- `http://localhost:3000/` serves the Vue SPA in production
- `http://localhost:3000/api/health` still returns JSON
- Client-side routing works (e.g. `http://localhost:3000/transactions` serves `index.html`)
- API 404s return JSON, non-API 404s serve `index.html`
- In development (no `dashboard/dist/`), the 404 handler still works for API routes

---

## Task 6.5 — Graceful Shutdown

### Modify: `src/index.ts`

Handle SIGINT/SIGTERM to cleanly stop the scheduler and close the database.

```typescript
import { stopScheduler } from './scraper/scheduler.js';
import { sqlite } from './db/connection.js';

async function shutdown() {
  app.log.info('Shutting down...');
  stopScheduler();
  await app.close();
  sqlite.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

### Acceptance Criteria
- Ctrl+C cleanly stops the server
- Scheduler is stopped before exit
- SQLite connection is closed
- No "unfinished" warnings in the log

---

## Task 6.6 — Dashboard Build Script

### Modify: root `package.json`

Add convenience scripts for building and running production:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc && cd dashboard && npm run build",
    "start": "node dist/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "dashboard:dev": "cd dashboard && npm run dev",
    "dashboard:build": "cd dashboard && npm run build"
  }
}
```

### Acceptance Criteria
- `npm run build` compiles both backend TypeScript and Vue dashboard
- `npm start` runs the production server
- `npm run dev` runs backend in dev mode with hot reload
- `npm run dashboard:dev` runs dashboard in dev mode

---

## Final Verification Checklist

```bash
# 1. Build everything
npm run build
# → dist/ has compiled backend
# → dashboard/dist/ has built Vue SPA

# 2. Run production
npm start
# → Server starts on port 3000
# → Dashboard loads at http://localhost:3000/
# → API works at http://localhost:3000/api/health

# 3. Test error handling
curl http://localhost:3000/api/nonexistent
# → { "error": "Route GET /api/nonexistent not found" }

curl -X POST http://localhost:3000/api/accounts -H 'Content-Type: application/json' -d '{}'
# → { "error": "Validation failed", "details": { ... } }

# 4. Test SPA routing
curl http://localhost:3000/transactions
# → Returns index.html (for client-side routing)

# 5. Ctrl+C
# → Shutting down...
# → Clean exit
```

---

## Files Created/Modified in This Phase

```
src/
├── api/
│   └── validation.ts           (NEW)
├── index.ts                     (MODIFIED — error handlers, logging, static files, shutdown)
│
dashboard/
└── dist/                        (BUILD OUTPUT — gitignored)

package.json                     (MODIFIED — new scripts)
```

---

## Summary: Full MVP File Tree

After all 6 phases, the complete project structure is:

```
money-monitor/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── .gitignore
├── PLAN.md
├── tasks/                        # Implementation plans (these files)
│   ├── phase1-foundation.md
│   ├── phase2-scraping-core.md
│   ├── phase3-data-api.md
│   ├── phase4-ai-analysis.md
│   ├── phase5-dashboard.md
│   └── phase6-polish.md
├── data/                         # Runtime data (gitignored)
│   ├── money-monitor.db
│   └── credentials.enc
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── connection.ts
│   │   └── migrations/
│   ├── scraper/
│   │   ├── scraper.service.ts
│   │   ├── scheduler.ts
│   │   └── credential-store.ts
│   ├── api/
│   │   ├── accounts.routes.ts
│   │   ├── transactions.routes.ts
│   │   ├── scrape.routes.ts
│   │   ├── summary.routes.ts
│   │   ├── ai.routes.ts
│   │   └── validation.ts
│   ├── ai/
│   │   ├── agent.ts
│   │   ├── tools.ts
│   │   └── prompts.ts
│   └── shared/
│       └── types.ts
└── dashboard/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.ts
        ├── App.vue
        ├── api/
        │   └── client.ts
        ├── composables/
        │   └── useApi.ts
        └── components/
            ├── AppLayout.vue
            ├── OverviewDashboard.vue
            ├── TransactionTable.vue
            ├── AccountManager.vue
            └── AiChat.vue
```
