# Money Monitor

A self-hosted personal finance platform that automatically scrapes transaction data from Israeli banks and credit cards, stores everything locally, and provides AI-powered analytics through an interactive dashboard.

## Features

- **Automatic Bank Scraping** — Connects to 9 Israeli banks and 8 credit card providers via headless browser automation
- **AI Financial Advisor** — Chat with Claude about your spending habits, get category suggestions, detect recurring charges, and compare periods
- **Interactive Dashboard** — Real-time charts, spending breakdowns, transaction search, and account management
- **Scheduled Scraping** — Configurable cron-based background scraping with live progress via SSE
- **Encrypted Credentials** — Bank login details encrypted with AES-256-GCM, never stored in plaintext
- **Local-First** — All data stays on your machine in a SQLite database. No cloud, no third-party data sharing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js + TypeScript, Fastify |
| **Frontend** | Vue 3 (Composition API), Vite, Tailwind CSS |
| **Database** | SQLite via better-sqlite3, Drizzle ORM |
| **Scraping** | israeli-bank-scrapers, Puppeteer + Stealth Plugin |
| **AI** | Anthropic Claude SDK (MCP tools for data queries) |
| **Scheduling** | node-cron (Israel timezone) |
| **Charts** | Chart.js + vue-chartjs |
| **UI Components** | Reka UI (headless), Lucide icons |
| **Validation** | Zod |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Vue 3 Dashboard                       │
│          (Charts, Tables, AI Chat, Account Mgmt)        │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  Fastify REST API                        │
│  /accounts  /transactions  /summary  /scrape  /ai/chat  │
└───┬──────────┬───────────┬──────────┬───────────────────┘
    │          │           │          │
    ▼          ▼           ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────────┐
│Scraper │ │Drizzle │ │  Cron  │ │   Claude AI Agent    │
│Service │ │Queries │ │Scheduler│ │  (MCP Tools)         │
│        │ │        │ │        │ │                      │
│Puppeteer│ │ SQLite │ │Daily @ │ │ query_transactions   │
│Headless│ │  + FTS │ │ 6am IL │ │ spending_summary     │
│Browser │ │        │ │        │ │ categorize           │
└───┬────┘ └───┬────┘ └───┬────┘ │ detect_recurring     │
    │          │           │      │ compare_periods      │
    │          ▼           │      │ spending_trends      │
    │   ┌───────────┐      │      └──────────┬───────────┘
    │   │  SQLite   │◄─────┘               │
    │   │  Database │◄─────────────────────┘
    └──►│           │
        └───────────┘

┌─────────────────────────────┐
│  Encrypted Credential Store │
│  (AES-256-GCM, file-based)  │
└─────────────────────────────┘
```

**Scrape flow:**
1. User adds a bank/card account with credentials (encrypted and stored)
2. A manual trigger or scheduled cron job starts a scrape session
3. For each account: launch headless browser → log in → scrape transactions
4. Transactions are deduplicated (SHA-256 hash) and inserted into SQLite
5. AI auto-categorizes new transactions in the background
6. Dashboard updates in real-time via Server-Sent Events

## Supported Institutions

**Banks:** Hapoalim, Leumi, Discount, Mizrahi Tefahot, Otsar Hahayal, Mercantile, Massad, Beinleumi, Union, Yahav, OneZero

**Credit Cards:** Isracard, Amex (Israel), Max (Leumi Card), Visa Cal, Beyond (Beyahad Bishvilha), Behatsdaa, Pagi

## Prerequisites

- **Node.js** 18 or later
- **npm**
- **Anthropic API key** (for AI features — get one at [console.anthropic.com](https://console.anthropic.com))

## Local Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/saar120/money-monitor.git
cd money-monitor
npm install
cd dashboard && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Server
PORT=3000
HOST=127.0.0.1

# Protect API routes (recommended)
API_TOKEN=<generate with: openssl rand -hex 32>

# Encrypt stored bank credentials (required)
CREDENTIALS_MASTER_KEY=<generate with: openssl rand -hex 32>

# Scraping schedule
SCRAPE_CRON="0 6 * * *"
SCRAPE_TIMEZONE=Asia/Jerusalem
SCRAPE_START_DATE_MONTHS_BACK=3

# AI (required for AI features)
ANTHROPIC_API_KEY=<your-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-6

# Dashboard API URL
VITE_API_URL=http://localhost:3000
```

### 3. Run in development

Start the backend and frontend in two terminals:

```bash
# Terminal 1 — Backend (auto-reloads on changes)
npm run dev

# Terminal 2 — Frontend (Vite dev server)
npm run dashboard:dev
```

- Backend API: http://localhost:3000
- Dashboard: http://localhost:5173

### 4. Production build

```bash
npm run build    # Compiles TypeScript + builds Vue SPA
npm run start    # Serves API + dashboard from compiled output
```

The production build serves the dashboard as static files through Fastify, so only port 3000 is needed.

## Project Structure

```
money-monitor/
├── src/                        # Backend source
│   ├── index.ts                # Server entry point + scheduler
│   ├── config.ts               # Zod-validated env config
│   ├── api/                    # Route handlers
│   │   ├── accounts.routes.ts
│   │   ├── transactions.routes.ts
│   │   ├── scrape.routes.ts
│   │   ├── summary.routes.ts
│   │   ├── ai.routes.ts
│   │   └── categories.routes.ts
│   ├── ai/                     # Claude integration + MCP tools
│   ├── db/                     # Schema, connection, migrations
│   ├── scraper/                # Bank scraping + credential encryption
│   └── shared/                 # Shared types
├── dashboard/                  # Vue 3 SPA
│   └── src/
│       ├── components/         # Pages and UI components
│       ├── api/                # HTTP client
│       └── composables/        # Vue composables
├── .env.example                # Environment template
├── drizzle.config.ts           # ORM configuration
└── package.json
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start backend with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript backend + build Vue dashboard |
| `npm run start` | Run production server |
| `npm run dashboard:dev` | Start Vite dev server for the dashboard |
| `npm run db:generate` | Generate Drizzle migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio (interactive DB browser) |

## License

ISC
