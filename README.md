# Money Monitor

A self-hosted personal finance platform that automatically scrapes transaction data from Israeli banks and credit cards, stores everything locally, and provides AI-powered analytics through an interactive dashboard. Available as a desktop app (macOS, Windows, Linux), a paired iPhone client, or a standalone Node.js server.

## Features

- **Desktop App** — Native Electron app with system tray, OS-level secret storage (Keychain / DPAPI / libsecret), and a guided setup wizard
- **iPhone App** — Expo/React Native client with Home, Activity, Explore, Advisor, Hebrew RTL, and authenticated pairing to the Mac. See [mobile/README.md](mobile/README.md).
- **Automatic Bank Scraping** — Connects to Israeli banks and credit card providers via headless browser automation
- **AI Financial Advisor** — Chat with your finances using natural language — get category suggestions, detect recurring charges, compare periods, and more
- **Net Worth Tracking** — Track assets (brokerage accounts, crypto, real estate), liabilities (loans, mortgages), and view historical net worth trends with multi-currency support
- **Interactive Dashboard** — Real-time charts, spending breakdowns, transaction search, insights, and account management
- **Recurring Payments** — Find subscriptions and service bills on desktop and iPhone, review uncertain matches, and save include or exclude choices on the Mac
- **Telegram Bot** — Chat with your AI advisor on the go, upload receipts for scanning, and receive spending alerts
- **MCP Server** — Expose your financial data to ChatGPT desktop, Codex, Claude Code, and other MCP clients (16 read tools, 25 with writes enabled)
- **Alerts** — Get notified about large charges, unusual spending, scrape errors, and monthly summaries via Telegram
- **Scheduled Scraping** — Configurable cron-based background scraping with live progress via SSE
- **Encrypted Credentials** — Bank login details encrypted with AES-256-GCM, never stored in plaintext
- **Demo Mode** — Try the app with seeded sample data, no bank credentials required
- **Local-First** — The Mac stores the authoritative financial database. The paired iPhone uses its private API; configured AI providers receive the context needed for their requests.

## Tech Stack

| Layer             | Technology                                                                          |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Desktop**       | Electron (macOS, Windows, Linux)                                                    |
| **Backend**       | Node.js + TypeScript, Fastify                                                       |
| **Desktop UI**    | Vue 3 (Composition API), Vite, Tailwind CSS                                         |
| **Database**      | SQLite via better-sqlite3, Drizzle ORM                                              |
| **Scraping**      | israeli-bank-scrapers, Puppeteer + Stealth Plugin                                   |
| **AI**            | Pi AI multi-provider framework (Anthropic, OpenAI, OpenCode Go, Google, OpenRouter) |
| **MCP**           | Model Context Protocol SDK (stdio transport)                                        |
| **Telegram**      | grammy                                                                              |
| **Scheduling**    | node-cron (Israel timezone)                                                         |
| **Charts**        | ECharts + vue-echarts (desktop); Victory Native + Skia (iPhone)                     |
| **UI Components** | Reka UI (headless), Lucide icons                                                    |
| **Testing**       | Vitest                                                                              |
| **Validation**    | Zod                                                                                 |

## Development and architecture

Read [docs/development.md](docs/development.md) for feature ownership, shared financial services, Advisor streaming, setup, native dependency recovery, validation, and synthetic UI QA. Desktop UI guidance is in [dashboard/README.md](dashboard/README.md); iPhone setup, fixtures, and pairing are in [mobile/README.md](mobile/README.md). [CONTEXT.md](CONTEXT.md) defines financial and synchronization terminology.

The desktop is Electron with a Vue dashboard and Fastify backend. The Mac owns calculations, credentials, scraping, and administration; the Expo/React Native iPhone client consumes a separate authenticated mobile API.

## Supported Institutions

**Banks:** Hapoalim, Leumi, Discount, Mizrahi, Otsar Hahayal, Mercantile, Massad, First International, Union, Yahav, One Zero

**Credit Cards:** Isracard, Amex (Israel), Max (Leumi Card), Visa Cal, Beyond (Beyahad), Behatsdaa, Pagi

## Getting Started

Building or running from source requires Node.js 22.22.2 or newer.

### Option A: Desktop App (recommended)

Download the latest release for your platform, or build from source:

```bash
git clone https://github.com/saar120/money-monitor.git
cd money-monitor
npm ci

# Build for your platform
npm run electron:build          # macOS ZIP
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
npm ci
```

#### 2. Configure environment

```bash
cp .env.example .env
```

Configure `.env` using the comments in [.env.example](.env.example). Environment validation and provider choices live in `src/config.ts`. Vite proxies `/api` to the standalone backend; the dashboard does not use a separate `VITE_API_URL` setting.

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

Money Monitor exposes its live local app data over stdio using MCP protocol revision 2026-07-28, with compatibility for older MCP clients. The server is started on demand by the client; the Money Monitor window does not need to stay open.

The installed macOS app is the recommended entry point because it automatically uses the app's current database:

```text
/Applications/Money Monitor.app/Contents/Resources/money-monitor-mcp
```

Access is read-only by default (16 tools). To enable all 25 tools, including categorization and budget, asset, liability, and alert updates, add `--mcp-access=read-write`.

### ChatGPT desktop and Codex

ChatGPT desktop, the Codex app/CLI, and the Codex IDE extension share MCP configuration. In ChatGPT desktop, open **Settings → MCP Servers → Add server**, choose **STDIO**, then use the command above. Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.money-monitor]
command = "/Applications/Money Monitor.app/Contents/Resources/money-monitor-mcp"
```

Restart the client and use `/mcp` to verify the connection. ChatGPT on the web cannot run this local stdio server; use the macOS desktop app.

### Claude Code

Add it for every project with:

```bash
claude mcp add --transport stdio --scope user money-monitor -- \
  "/Applications/Money Monitor.app/Contents/Resources/money-monitor-mcp"
```

For read-write access, append `--mcp-access=read-write` to the command.

### Development checkout

To run from source instead of the installed app:

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

The source command uses the checkout's configured data directory. Prefer the installed app command when you want the same live database as the desktop app.

## Telegram Bot

To enable the Telegram bot, create a bot via [@BotFather](https://t.me/BotFather) and add the token to your config:

```env
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_ALLOWED_USERS=<comma-separated-telegram-user-ids>
```

The bot supports AI-powered financial chat, receipt/image scanning, session management, and spending alerts.

## Project structure

| Location                                  | Responsibility                                               |
| ----------------------------------------- | ------------------------------------------------------------ |
| `src/services/`, `src/db/`, `src/shared/` | Authoritative calculations, storage, shared semantics        |
| `src/api/`, `src/server.ts`               | Desktop/standalone HTTP API                                  |
| `src/mobile/`                             | Pairing, authenticated mobile API, contracts and projections |
| `src/ai/`                                 | Advisor, charts, categorization and saved sessions           |
| `src/scraper/`, `src/telegram/`           | Bank collection, schedules and messaging                     |
| `electron/`                               | Desktop lifecycle, safe storage and Tailscale access         |
| `dashboard/`                              | Vue desktop UI; installed by the root npm workspace          |
| `mobile/`                                 | Expo iPhone client; separate npm install and lockfile        |
| `scripts/`, `patches/`                    | Build/QA helpers and scraper compatibility patches           |

## Validation

```bash
npm run check
npm run build
npm --prefix mobile ci
npm --prefix mobile run typecheck
npm --prefix mobile test
```

The package.json scripts are the source of truth for commands. Native QA and synthetic browser checks are described in [the development guide](docs/development.md#synthetic-ui-qa).

## Backup and restore

The existing commands below handle **standalone repository data**: a consistent SQLite snapshot from `data/money-monitor.db`, `data/credentials.enc`, and `.env`. Install the `sqlite3` CLI before taking a snapshot. Archives contain secrets and should be stored privately.

```bash
npm run backup                         # writes to ./backups/
npm run backup -- /path/to/backup-dir
npm run restore -- /path/to/archive.tar.gz
```

Restore prompts before overwriting repository files; stop the standalone server first. With no archive argument, it selects the latest archive in `backups/`.

These scripts do not back up the desktop app's OS user-data directory, encrypted `config.json`, or chat sessions. See [data and backups](docs/development.md#data-and-backups) for desktop paths and OS keychain constraints.

## License

ISC
