# money-monitor

Backend service for aggregating and analyzing Israeli financial data from multiple banks and credit cards.

## What it does

1. **Scrapes** transaction data from Israeli banks & credit cards via [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)
2. **Stores** everything in a local SQLite database with encrypted credentials at rest
3. **Exposes** a REST API for querying transactions, triggering scrapes, and managing accounts
4. **Analyzes** your finances using a Claude-powered agent that can query the DB and provide insights

## Supported providers

Hapoalim, Leumi, Discount, Mizrahi, Mercantile, Beinleumi, Union, Otsar Hahayal, Massad, Yahav, Behatsdaa, Beyahad Bishvilha, OneZero, Pagi, Isracard, Visa Cal, Max, Amex.

## Setup

```bash
# Install dependencies
npm install

# Copy env template and fill in your keys
cp .env.example .env

# Generate an encryption key for storing bank credentials
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Start the dev server
npm run dev
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/accounts` | List all accounts |
| `POST` | `/api/accounts` | Add a new account (bank/card) |
| `DELETE` | `/api/accounts/:id` | Remove an account |
| `POST` | `/api/scrape` | Scrape all accounts |
| `POST` | `/api/scrape/:id` | Scrape a single account |
| `GET` | `/api/transactions` | Query transactions (with filters) |
| `GET` | `/api/transactions/summary` | Aggregated financial summary |
| `GET` | `/api/transactions/monthly` | Monthly income vs expenses |
| `GET` | `/api/transactions/top-expenses` | Biggest expenses |
| `PATCH` | `/api/transactions/:id/category` | Categorize a transaction |
| `POST` | `/api/analysis` | Ask the AI agent a financial question |
| `POST` | `/api/analysis/categorize` | Auto-categorize transactions via AI |

## Architecture

```
src/
├── index.ts                  # Entry point — wires everything together
├── config.ts                 # Env vars + credential encryption
├── types/index.ts            # Shared domain types
├── storage/
│   ├── database.ts           # SQLite setup + migrations
│   └── repositories/         # Data access layer
├── scraper/index.ts          # Bank scraping orchestration
├── api/
│   ├── index.ts              # Express app
│   └── routes/               # REST endpoints
└── analysis/
    ├── agent.ts              # Claude agentic loop for financial analysis
    └── tools.ts              # Tools the agent can call (DB queries)
```
