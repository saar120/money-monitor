# Money Monitor

A self-hosted personal finance platform that automatically scrapes transaction data from Israeli banks and credit cards, stores everything locally, and provides AI-powered analytics through an interactive dashboard. Available as a desktop app (macOS, Windows, Linux) or a standalone Node.js server.

## Features

- **Desktop App** — Native Electron app with system tray, OS-level secret storage (Keychain / DPAPI / libsecret), and a guided setup wizard
- **Automatic Bank Scraping** — Connects to 10 Israeli banks and 7 credit card providers via headless browser automation
- **AI Financial Advisor** — Chat with your finances using natural language — get category suggestions, detect recurring charges, compare periods, and more
- **Net Worth Tracking** — Track assets (brokerage accounts, crypto, real estate), liabilities (loans, mortgages), and view historical net worth trends with multi-currency support
- **Interactive Dashboard** — Real-time charts, spending breakdowns, transaction search, insights, and account management
- **Telegram Bot** — Chat with your AI advisor on the go, upload receipts for scanning, and receive spending alerts
- **MCP Server** — Expose your financial data to Claude Desktop and other MCP-compatible clients (19 tools)
- **Alerts** — Get notified about large charges, unusual spending, scrape errors, and monthly summaries via Telegram
- **Scheduled Scraping** — Configurable cron-based background scraping with live progress via SSE
- **Encrypted Credentials** — Bank login details encrypted with AES-256-GCM, never stored in plaintext
- **Demo Mode** — Try the app with seeded sample data, no bank credentials required
- **Local-First** — All data stays on your machine in a SQLite database. No cloud, no third-party data sharing

## Screenshots

| Overview                                   | AI Chat                               |
| ------------------------------------------ | ------------------------------------- |
| ![Overview](docs/screenshots/overview.png) | ![AI Chat](docs/screenshots/chat.png) |

| Transactions                               | Accounts                                   |
| ------------------------------------------ | ------------------------------------------ |
| ![Transactions](docs/screenshots/txns.png) | ![Accounts](docs/screenshots/accounts.png) |

| Net Worth                                    | Insights                                   |
| -------------------------------------------- | ------------------------------------------ |
| ![Net Worth](docs/screenshots/net_worth.png) | ![Insights](docs/screenshots/insights.png) |

| Scraping                                   | Telegram Bot                               |
| ------------------------------------------ | ------------------------------------------ |
| ![Scraping](docs/screenshots/scraping.png) | ![Telegram](docs/screenshots/telegram.png) |

## Tech Stack

| Layer             | Technology                                                             |
| ----------------- | ---------------------------------------------------------------------- |
| **Desktop**       | Electron (macOS, Windows, Linux)                                       |
| **Backend**       | Node.js + TypeScript, Fastify                                          |
| **Frontend**      | Vue 3 (Composition API), Vite, Tailwind CSS                            |
| **Database**      | SQLite via better-sqlite3, Drizzle ORM                                 |
| **Scraping**      | israeli-bank-scrapers, Puppeteer + Stealth Plugin                      |
| **AI**            | Pi AI multi-provider framework (Anthropic, OpenAI, Google, OpenRouter) |
| **MCP**           | Model Context Protocol SDK (stdio transport)                           |
| **Telegram**      | grammy                                                                 |
| **Scheduling**    | node-cron (Israel timezone)                                            |
| **Charts**        | Chart.js + vue-chartjs                                                 |
| **UI Components** | Reka UI (headless), Lucide icons                                       |
| **Testing**       | Vitest                                                                 |
| **Validation**    | Zod                                                                    |

## Architecture

### System Overview

![System Architecture](docs/architecture/system-architecture.png)

### Data Flow

![Data Flow](docs/architecture/data-flow.png)

## Supported Institutions

**Banks:** Hapoalim, Leumi, Discount, Mizrahi, Otsar Hahayal, Mercantile, Massad, First International, Union, Yahav, One Zero

**Credit Cards:** Isracard, Amex (Israel), Max (Leumi Card), Visa Cal, Beyond (Beyahad), Behatsdaa, Pagi

## Getting Started

### Option A: Desktop App (recommended)

Download the latest release for your platform, or build from source:

```bash
git clone https://github.com/saar120/money-monitor.git
cd money-monitor
npm install

# Build for your platform
npm run electron:build          # macOS
npm run electron:build:win      # Windows
npm run electron:build:linux    # Linux
```

The desktop app includes a setup wizard that guides you through initial configuration — no manual `.env` editing required.

For development with hot reload:

```bash
npm run electron:dev
```

### Option B: Standalone Server

#### 1. Clone and install dependencies

```bash
git clone https://github.com/saar120/money-monitor.git
cd money-monitor
npm install
```

#### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Server
PORT=3000
HOST=127.0.0.1

# Authentication (recommended — protects all /api/* routes)
API_TOKEN=<generate with: openssl rand -hex 32>

# Credentials encryption
CREDENTIALS_MASTER_KEY=<generate with: openssl rand -hex 32>

# Scraping
SCRAPE_CRON="0 6 * * *"
SCRAPE_TIMEZONE=Asia/Jerusalem
SCRAPE_START_DATE_MONTHS_BACK=3

# AI (Anthropic by default — see config.ts for OpenAI, Google, OpenRouter options)
ANTHROPIC_API_KEY=<your-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-6

# Dashboard API URL
VITE_API_URL=http://localhost:3000
```

#### 3. Run in development

```bash
# Both backend + frontend in one command
npm run dev:all

# Or separately:
npm run dev              # Backend (auto-reloads)
npm run dashboard:dev    # Frontend (Vite dev server)
```

- Backend API: http://localhost:3000
- Dashboard: http://localhost:5173

#### 4. Production build

```bash
npm run build    # Compiles TypeScript + builds Vue SPA
npm run start    # Serves API + dashboard from compiled output
```

The production build serves the dashboard as static files through Fastify, so only port 3000 is needed.

## MCP Server

Money Monitor exposes an MCP server for use with Claude Desktop and other MCP-compatible clients. Add it to your Claude Desktop config:

```json
{
  "mcpServers": {
    "money-monitor": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/money-monitor"
    }
  }
}
```

This gives Claude access to 19 tools: query transactions, get spending summaries, compare periods, manage assets/liabilities, track net worth, and more.

## Telegram Bot

To enable the Telegram bot, create a bot via [@BotFather](https://t.me/BotFather) and add the token to your config:

```env
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_ALLOWED_USERS=<comma-separated-telegram-user-ids>
```

The bot supports AI-powered financial chat, receipt/image scanning, session management, and spending alerts.

## Project Structure

```
money-monitor/
├── src/                        # Backend source
│   ├── index.ts                # Server entry point + scheduler
│   ├── server.ts               # Fastify server setup
│   ├── config.ts               # Zod-validated env config
│   ├── mcp-server.ts           # MCP server (stdio transport)
│   ├── api/                    # Route handlers
│   │   ├── accounts.routes.ts
│   │   ├── transactions.routes.ts
│   │   ├── scrape.routes.ts
│   │   ├── summary.routes.ts
│   │   ├── ai.routes.ts
│   │   ├── categories.routes.ts
│   │   ├── assets.routes.ts
│   │   ├── liabilities.routes.ts
│   │   ├── net-worth.routes.ts
│   │   ├── alerts.routes.ts
│   │   ├── exchange-rates.routes.ts
│   │   ├── settings.routes.ts
│   │   └── demo.routes.ts
│   ├── ai/                     # Multi-provider AI agent + financial tools
│   ├── db/                     # Schema, connection, migrations
│   ├── scraper/                # Bank scraping + credential encryption
│   ├── services/               # Business logic (assets, net worth, etc.)
│   ├── telegram/               # Telegram bot + alerts
│   └── shared/                 # Shared types
├── electron/                   # Electron main process
│   ├── main.ts                 # Window management, tray, menus
│   └── preload.mts             # Context bridge
├── dashboard/                  # Vue 3 SPA
│   └── src/
│       ├── components/         # Pages and UI components
│       ├── api/                # HTTP client
│       ├── composables/        # Vue composables
│       └── lib/                # Provider definitions, utilities
├── scripts/                    # Backup, restore, icon generation
├── .env.example                # Environment template
├── drizzle.config.ts           # ORM configuration
└── package.json
```

## Available Scripts

| Script                         | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `npm run dev`                  | Start backend with hot reload (tsx watch)                          |
| `npm run dev:all`              | Start backend + frontend concurrently                              |
| `npm run build`                | Compile TypeScript backend + build Vue dashboard                   |
| `npm run start`                | Run production server                                              |
| `npm run dashboard:dev`        | Start Vite dev server for the dashboard                            |
| `npm run electron:dev`         | Build and launch the Electron desktop app                          |
| `npm run electron:build`       | Package macOS desktop app (.dmg)                                   |
| `npm run electron:build:win`   | Package Windows desktop app                                        |
| `npm run electron:build:linux` | Package Linux desktop app                                          |
| `npm run electron:build:all`   | Package for all platforms                                          |
| `npm run mcp`                  | Start the MCP server (stdio)                                       |
| `npm run db:generate`          | Generate Drizzle migration from schema changes                     |
| `npm run db:studio`            | Open Drizzle Studio (interactive DB browser)                       |
| `npm run test`                 | Run tests (Vitest)                                                 |
| `npm run test:watch`           | Run tests in watch mode                                            |
| `npm run test:coverage`        | Run tests with coverage report                                     |
| `npm run lint`                 | Lint with ESLint                                                   |
| `npm run format`               | Format with Prettier                                               |
| `npm run backup`               | Back up database, credentials, and config to a timestamped archive |
| `npm run restore`              | Restore from the latest backup (or specify an archive path)        |

## Backup & Restore

All your data lives in three files. The backup script bundles them into a single `.tar.gz` archive:

| File                    | Contents                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `data/money-monitor.db` | Transactions, accounts, categories, assets, liabilities, scrape logs |
| `data/credentials.enc`  | Encrypted bank login credentials                                     |
| `.env`                  | Master key, API tokens, and configuration                            |

### Create a backup

```bash
npm run backup                        # saves to ./backups/
npm run backup -- /path/to/usb/drive  # saves to a custom directory
```

### Restore on another machine

```bash
git clone https://github.com/saar120/money-monitor.git
cd money-monitor
npm install

# Restore from archive
npm run restore -- /path/to/money-monitor-backup-20260305_120000.tar.gz

npm run dev
```

Running `npm run restore` with no arguments restores the latest archive from `./backups/`.

## License

ISC



