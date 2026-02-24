# Money Monitor - MVP Plan

## Overview

A self-hosted backend service that aggregates financial data from Israeli banks and credit card companies using [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers), stores it locally, and exposes it through a REST API + dashboard with AI-powered analysis via the Anthropic Agent SDK.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | **Node.js + TypeScript** | `israeli-bank-scrapers` is a Node.js library; keeps everything unified |
| Web Framework | **Fastify** | Fast, typed, plugin ecosystem |
| Database | **SQLite (via better-sqlite3)** | Zero-config, single-file, perfect for self-hosted MVP |
| ORM / Query | **Drizzle ORM** | Lightweight, TypeScript-first, great SQLite support |
| Scraping | **israeli-bank-scrapers** | The core library for fetching bank/card data |
| Scheduling | **node-cron** | Cron-based scheduling, pinned to Israel timezone (`Asia/Jerusalem`) |
| AI Analysis | **Anthropic SDK (@anthropic-ai/sdk)** | Direct Claude API for transaction analysis and chat |
| Dashboard | **Vue 3 + Vite** | Fast dev experience, simple SPA, Composition API |
| Charts | **Chart.js (via vue-chartjs)** | Lightweight, flexible charting for Vue |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard (Vue 3 SPA)             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Overview  │  │ Transactions │  │  AI Chat      │  │
│  │ & Charts  │  │   Table      │  │  Interface    │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│                  Fastify API Server                  │
│                                                      │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ /accounts   │ │ /transactions│ │ /ai/chat     │  │
│  │ /scrape     │ │ /summary     │ │ /ai/analyze  │  │
│  └─────────────┘ └──────────────┘ └──────────────┘  │
│                                                      │
│  ┌─────────────────────┐  ┌───────────────────────┐  │
│  │   Scraper Service   │  │   AI Analysis Agent   │  │
│  │ (israeli-bank-      │  │ (Anthropic SDK)       │  │
│  │  scrapers)          │  │                       │  │
│  └─────────────────────┘  └───────────────────────┘  │
│                                                      │
│  ┌─────────────────────┐  ┌───────────────────────┐  │
│  │   Scheduler         │  │   Credential Store    │  │
│  │ (node-cron)         │  │ (encrypted JSON file) │  │
│  └─────────────────────┘  └───────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │   SQLite DB     │
              │  (local file)   │
              └─────────────────┘
```

---

## Project Structure

```
money-monitor/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example                  # Template for env vars
├── data/                         # SQLite DB + encrypted credentials (gitignored)
│
├── src/
│   ├── index.ts                  # Entry point - starts Fastify server + scheduler
│   ├── config.ts                 # App configuration (env vars, defaults)
│   │
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema definitions
│   │   ├── connection.ts         # SQLite connection setup
│   │   └── migrations/           # Drizzle migrations
│   │
│   ├── scraper/
│   │   ├── scraper.service.ts    # Wraps israeli-bank-scrapers, runs scrapes
│   │   ├── scheduler.ts          # Cron job setup for periodic scraping
│   │   └── credential-store.ts   # Encrypted storage for bank credentials
│   │
│   ├── api/
│   │   ├── accounts.routes.ts    # CRUD for configured accounts/providers
│   │   ├── transactions.routes.ts# Query transactions (filters, pagination)
│   │   ├── scrape.routes.ts      # Trigger manual scrape, view scrape status
│   │   ├── summary.routes.ts     # Aggregated spending summaries
│   │   └── ai.routes.ts          # AI analysis and chat endpoints
│   │
│   ├── ai/
│   │   ├── agent.ts              # Anthropic SDK agent setup + tools
│   │   ├── tools.ts              # Custom tool definitions (query DB, categorize)
│   │   └── prompts.ts            # System prompts for financial analysis
│   │
│   └── shared/
│       └── types.ts              # Shared TypeScript types
│
├── dashboard/                    # Vue 3 SPA (Vite)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.vue
│       ├── main.ts
│       ├── api/                  # API client (fetch wrapper)
│       │   └── client.ts
│       ├── components/
│       │   ├── AppLayout.vue
│       │   ├── OverviewDashboard.vue   # Summary cards + charts
│       │   ├── TransactionTable.vue
│       │   ├── AccountManager.vue
│       │   └── AiChat.vue              # Chat interface for AI analysis
│       └── composables/
│           └── useApi.ts
│
└── PLAN.md
```

---

## Database Schema

### `accounts` table
Represents a configured bank/card provider that we scrape.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| company_id | TEXT | Scraper company type (e.g. `hapoalim`, `isracard`) |
| display_name | TEXT | User-friendly name |
| account_number | TEXT | As returned by scraper (nullable, populated after first scrape) |
| credentials_ref | TEXT | Reference key to credential store |
| is_active | BOOLEAN | Whether to include in scheduled scrapes |
| last_scraped_at | DATETIME | Last successful scrape time |
| created_at | DATETIME | |

### `transactions` table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| account_id | INTEGER FK | References accounts.id |
| identifier | INTEGER | Transaction identifier from scraper (nullable) |
| date | TEXT | Transaction date (ISO string) |
| processed_date | TEXT | Processing date (ISO string) |
| original_amount | REAL | Amount in original currency |
| original_currency | TEXT | Currency code |
| charged_amount | REAL | Amount actually charged (in ILS) |
| description | TEXT | Transaction description |
| memo | TEXT | Additional memo (nullable) |
| type | TEXT | `normal` or `installments` |
| status | TEXT | `completed` or `pending` |
| installment_number | INTEGER | Current installment (nullable) |
| installment_total | INTEGER | Total installments (nullable) |
| category | TEXT | AI-assigned category (nullable) |
| hash | TEXT UNIQUE | Dedup hash (date+amount+description+account) |
| created_at | DATETIME | |

### `scrape_logs` table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| account_id | INTEGER FK | References accounts.id |
| status | TEXT | `success`, `error` |
| error_type | TEXT | From scraper: `invalidPassword`, `timeout`, etc. |
| error_message | TEXT | |
| transactions_found | INTEGER | Count of transactions in this scrape |
| started_at | DATETIME | |
| completed_at | DATETIME | |

---

## API Endpoints

### Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List all configured accounts |
| POST | `/api/accounts` | Add a new bank/card account (with credentials) |
| PUT | `/api/accounts/:id` | Update account config |
| DELETE | `/api/accounts/:id` | Remove account and optionally its transactions |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/transactions` | List transactions (filterable by account, date range, category, status) |
| GET | `/api/transactions/summary` | Aggregated summary (total by category, by month, by account) |

### Scraping
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scrape/:accountId` | Trigger manual scrape for one account |
| POST | `/api/scrape/all` | Trigger scrape for all active accounts |
| GET | `/api/scrape/logs` | View recent scrape history/status |

### AI Analysis
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/chat` | Send a message to the AI agent (conversational) |
| POST | `/api/ai/categorize` | Batch-categorize uncategorized transactions |

---

## Component Details

### 1. Scraper Service (`src/scraper/`)

Wraps `israeli-bank-scrapers` with:
- **scraper.service.ts**: Creates a scraper instance per account, runs scrape with credentials, deduplicates transactions (hash-based), and upserts into DB.
- **scheduler.ts**: Uses `node-cron` to run scrapes on a configurable schedule (default: daily at 6am Israel time, `Asia/Jerusalem`). Scrapes all active accounts sequentially (scrapers use headless browser, so parallel would be resource-heavy). The cron schedule is pinned to Israel timezone to ensure consistent scrape times regardless of server location.
- **credential-store.ts**: Encrypts credentials at rest using AES-256 with a master key from env var. Stores as encrypted JSON in `data/credentials.enc`. Never exposes raw credentials via API.

**Supported providers (from israeli-bank-scrapers):**
- Banks: Hapoalim, Leumi, Discount, Mizrahi, Otsar Hahayal, Mercantile, Massad, Beinleumi, Union
- Cards: Isracard, Amex (Israel), Max (Leumi Card), Visa Cal, Beyond (Beyahad)

### 2. AI Analysis Agent (`src/ai/`)

Uses the **Anthropic SDK** (`@anthropic-ai/sdk`) with tool use to build a financial analysis agent:

**Tools the agent can call:**
- `query_transactions` - Search/filter transactions from the DB (by date, amount, description pattern)
- `get_spending_summary` - Get aggregated spending by category/month/account
- `categorize_transaction` - Assign a category to a transaction
- `get_account_balances` - Get latest balance info per account

**Agent capabilities:**
- Categorize transactions into meaningful categories (food, transport, housing, utilities, entertainment, health, etc.)
- Analyze spending patterns and trends over time
- Compare month-over-month spending
- Identify unusual transactions or spending spikes
- Provide savings insights and recommendations
- Answer natural language questions about finances ("How much did I spend on restaurants last month?")

**System prompt** instructs the agent to be a personal financial advisor with access to the user's transaction data, using tools to query real data before making claims.

### 3. Dashboard (`dashboard/`)

Vue 3 SPA (Composition API + `<script setup>`) with four main views:

**Overview page:**
- Total spending this month vs last month
- Spending breakdown by category (pie/donut chart via vue-chartjs)
- Monthly spending trend (bar chart via vue-chartjs)
- Per-account summary cards

**Transactions page:**
- Sortable, filterable table of all transactions
- Filters: date range, account, category, min/max amount, search text
- Pagination
- Inline category display (AI-assigned)

**Accounts page:**
- List of configured bank/card accounts
- Add new account form (select provider, enter credentials)
- Trigger manual scrape per account
- View last scrape status/time

**AI Chat page:**
- Chat interface to ask questions about your finances
- Renders markdown responses (via vue-markdown or v-html with sanitization)
- Shows when agent is "thinking" or using tools
- Suggested starter questions ("What are my top spending categories?", "Any unusual charges this month?")

---

## Implementation Order (MVP Phases)

### Phase 1: Foundation
1. Project setup (package.json, tsconfig, eslint, env config)
2. Database schema + Drizzle setup + migrations
3. Credential store (encrypt/decrypt)

### Phase 2: Scraping Core
4. Scraper service (wrap israeli-bank-scrapers, dedup logic)
5. Scrape API routes (manual trigger)
6. Scheduler (cron-based auto scraping)

### Phase 3: Data API
7. Accounts CRUD routes
8. Transactions query routes (with filters + pagination)
9. Summary/aggregation routes

### Phase 4: AI Analysis
10. Anthropic SDK agent setup with tool definitions
11. AI routes (chat + batch categorize)

### Phase 5: Dashboard
12. Vite + Vue 3 project setup (Composition API, `<script setup>`)
13. Overview page with charts (vue-chartjs)
14. Transactions table page
15. Account management page
16. AI chat interface

### Phase 6: Polish
17. Error handling, logging, input validation across all routes
18. Serve dashboard static files from Fastify in production

---

## Configuration (.env)

```
# Server
PORT=3000
HOST=0.0.0.0

# Credentials encryption
CREDENTIALS_MASTER_KEY=<random-32-byte-hex>

# Scraping
SCRAPE_CRON="0 6 * * *"          # Daily at 6am Israel time
SCRAPE_TIMEZONE=Asia/Jerusalem    # All scheduling pinned to Israel timezone
SCRAPE_START_DATE_MONTHS_BACK=3   # How far back to scrape on first run

# Anthropic
ANTHROPIC_API_KEY=<your-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-6  # Cost-effective for analysis tasks

# Dashboard
VITE_API_URL=http://localhost:3000
```

---

## Security Considerations (MVP)

- **Credentials**: Encrypted at rest, never returned in API responses, master key in env var
- **Local only**: MVP is designed for `localhost` access only - no auth on the API
- **No secrets in DB**: Bank credentials stored separately from SQLite DB
- **Scraper runs headless**: Puppeteer in headless mode, no visible browser

---

## Out of Scope for MVP (Future)

- User authentication / multi-user support
- Budget setting and alerts
- Recurring transaction detection
- Export to CSV/YNAB/other formats
- Mobile app
- Webhook notifications
- Docker containerization
- Two-factor auth flow handling in UI
- Historical balance tracking
