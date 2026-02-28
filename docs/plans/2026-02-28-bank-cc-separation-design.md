# Bank vs Credit Card Separation — Design

## Problem

Banks and credit cards are treated identically in the system. They return different data, serve different purposes, and should be viewed differently:
- Banks → balance tracking, income/expense flow
- Credit cards → spending analysis by category, installments, future charges

## Approach

Metadata-only separation. Add `accountType` to accounts, add `meta` JSON field to transactions. No separate tables.

## Schema Changes

### `accounts` table — new fields

| Field | Type | Description |
|-------|------|-------------|
| `accountType` | text, required | `'bank'` or `'credit_card'`, auto-derived from `companyId` on creation |
| `balance` | real, nullable | Updated on each scrape. Available for all banks + OneZero + Visa Cal |

### `transactions` table — new field

| Field | Type | Description |
|-------|------|-------------|
| `meta` | text, nullable | JSON blob with provider-specific metadata that aids AI categorization |

### `meta` field contents (by provider type)

**Credit cards:**
```json
{ "bankCategory": "מסעדות" }
```

**Banks:** generally `null`, except OneZero which provides category data:
```json
{ "bankCategory": "שופרסל" }
```

Additional fields may be added to `meta` in the future without schema changes.

### `category` field — unchanged

Remains exclusively AI-assigned. The `meta.bankCategory` field is an input signal for the AI, not a replacement.

## Provider-to-Type Mapping

Hardcoded constant:

**Banks:** `hapoalim`, `leumi`, `discount`, `mizrahi`, `otsarHahayal`, `mercantile`, `massad`, `beinleumi`, `union`, `yahav`, `oneZero`

**Credit cards:** `isracard`, `amex`, `max`, `visaCal`, `beyahadBishvilha`, `behatsdaa`, `pagi`

## Scraper Changes

### Type-specific options
- Credit cards: add `futureMonthsToScrape: 1` to `createScraper` options
- All providers: no other option changes

### Data capture changes
- `mapTransaction`: populate `meta` JSON from `txn.category` (bank-provided category)
- After scraping: read `scraperAccount.balance` → update `accounts.balance`

### AI categorization input
The AI agent receives `description` + `memo` + `meta.bankCategory` as context signals when categorizing.

## API Changes

- `GET /api/accounts` — response includes `accountType` and `balance`
- `GET /api/transactions` — add `accountType` query param (joins to accounts, filters by type)
- `GET /api/transactions/summary` — add `accountType` param for per-type summaries

No new endpoints.

## Dashboard UI Changes

### Overview page — split into two sections
- **Banks:** cards showing each bank account with current balance, last scraped time
- **Credit cards:** spending breakdown by category (doughnut chart), total monthly spending

### Transaction table
- Bank / credit card filter toggle (alongside existing account filter)
- Show `category` column (AI-assigned, populated for all transactions)

### Accounts page
- Group accounts visually: banks section, then credit cards section
- Show balance badge on bank account cards
