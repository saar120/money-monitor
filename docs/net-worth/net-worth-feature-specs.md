# Net Worth Feature Specs

Detailed specifications for each feature in the net worth tracking system. Each spec references the [data model](./net-worth-data-model.md) and follows existing project conventions (Fastify routes, Zod validation, Vue 3 + shadcn/reka-ui frontend, Chart.js charts).

---

## F1. Schema & Migrations

### Goal

Add the 6 new tables defined in the data model to the Drizzle ORM schema and generate a migration.

### Files to modify

- `src/db/schema.ts` — add table definitions for `assets`, `holdings`, `assetMovements`, `assetSnapshots`, `accountBalanceHistory`, `liabilities`

### Implementation details

Define all 6 tables using `sqliteTable()` from drizzle-orm, matching the SQL in the data model exactly. Column naming follows the existing `snake_case` DB convention with `camelCase` Drizzle field names (matching how `transactions` uses `accountId` → `account_id`).

**Type enums to define as exported const arrays in `src/shared/types.ts`** (needed by both `schema.ts` and `validation.ts`):
```ts
export const ASSET_TYPES = ['brokerage', 'pension', 'keren_hishtalmut', 'crypto', 'fund', 'real_estate'] as const;
export const LIQUIDITY_TYPES = ['liquid', 'restricted', 'locked'] as const;
export const HOLDING_TYPES = ['stock', 'etf', 'cash', 'fund_units', 'crypto', 'balance'] as const;
export const MOVEMENT_TYPES = ['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'adjustment'] as const;
export const LIABILITY_TYPES = ['loan', 'mortgage', 'credit_line', 'other'] as const;
```

**Key relationships:**
- `assets.linked_account_id` → `accounts.id` (nullable FK, SET NULL on account delete)
- `holdings.asset_id` → `assets.id` (CASCADE delete)
- `assetMovements.asset_id` → `assets.id` (CASCADE delete)
- `assetMovements.holding_id` → `holdings.id` (SET NULL on delete)
- `assetSnapshots.asset_id` → `assets.id` (CASCADE delete)
- `accountBalanceHistory.account_id` → `accounts.id`

**Indexes:**
- `holdings`: unique on `(asset_id, name)`
- `assetSnapshots`: unique on `(asset_id, date)`
- `accountBalanceHistory`: unique on `(account_id, date)`

### Success criteria

- [ ] `npm run db:generate` produces a clean migration file
- [ ] `npm run dev` starts without errors, tables are created
- [ ] All 6 tables exist in SQLite with correct columns, types, constraints, and foreign keys
- [ ] Existing tables and data are unaffected

---

## F2. Balance History Auto-Capture

### Goal

Automatically record bank account balances every time the scraper updates them, building a historical record for net worth over time.

### Data model reference

Table: `account_balance_history` — one row per account per day.

### Files to modify

- `src/scraper/scraper.service.ts` — after the balance update at line ~224-228

### Implementation details

Immediately after the existing `db.update(accounts).set({ balance }).where(...)` call, add:

```ts
db.insert(accountBalanceHistory)
  .values({
    accountId: targetAccount.id,
    date: toIsraelDateString(new Date()), // YYYY-MM-DD in Israel timezone
    balance: scraperAccount.balance,
  })
  .onConflictDoUpdate({
    target: [accountBalanceHistory.accountId, accountBalanceHistory.date],
    set: { balance: scraperAccount.balance },
  })
  .run();
```

Uses `onConflictDoUpdate` on the `(account_id, date)` unique constraint so multiple scrapes in one day keep the latest value.

### Success criteria

- [ ] After a scrape completes, `account_balance_history` contains a row for each bank account with today's date
- [ ] Running the scraper twice in the same day updates the existing row (not duplicates)
- [ ] Only accounts where `scraperAccount.balance != null` get a history row (matching existing guard)
- [ ] Uses Israel timezone date (consistent with transaction date handling)
- [ ] No performance regression — single INSERT per account, no batching needed

---

## F3. Exchange Rate Service

### Goal

Provide current exchange rates (USD/ILS, BTC/ILS, etc.) for multi-currency net worth calculations and snapshot generation.

### Files to create

- `src/services/exchange-rates.ts` — rate fetching logic with caching
- `src/api/exchange-rates.routes.ts` — API endpoint

### Files to modify

- `src/index.ts` — register new route module

### Implementation details

**Service (`src/services/exchange-rates.ts`):**

```ts
interface ExchangeRateResult {
  rates: Record<string, number>;  // { USD: 3.65, BTC: 347125, EUR: 3.95 }
  stale: boolean;
  fetchedAt: string;              // ISO timestamp
}
export async function getExchangeRates(): Promise<ExchangeRateResult>
```

- `rates` values = how many ILS per 1 unit of that currency
- ILS rate is always `1`
- Primary source: Bank of Israel API for fiat currencies, free crypto API (e.g., CoinGecko) for BTC
- Caches rates in memory for 1 hour (simple `lastFetched` + `cachedRates` pattern)
- Fallback: if API fails AND cache exists, return last cached rates with `stale: true`
- Fallback: if API fails AND no cache (cold start), throw an error — caller should handle gracefully (e.g., skip ILS conversion, show warning)
- Export a helper: `convertToIls(amount: number, currency: string, rates: Record<string, number>): number`
  - If `currency` is `'ILS'`, returns `amount` (no conversion)
  - If `currency` is not found in `rates`, returns `0` and logs a warning (unknown currency)

**API endpoint:**

`GET /api/exchange-rates`

Response:
```json
{
  "rates": { "USD": 3.65, "BTC": 347125, "EUR": 3.95 },
  "stale": false,
  "fetchedAt": "2026-03-05T12:00:00Z"
}
```

### Success criteria

- [ ] `GET /api/exchange-rates` returns current rates for at least USD, EUR, BTC
- [ ] Rates are cached — subsequent calls within 1 hour don't re-fetch
- [ ] If external API is down and cache exists, returns last cached rates with `stale: true`
- [ ] If external API is down and no cache (cold start), throws an error
- [ ] `convertToIls()` correctly converts: `convertToIls(100, 'USD', { USD: 3.65 })` → `365`
- [ ] `convertToIls(100, 'ILS', rates)` → `100` (no conversion)
- [ ] `convertToIls(100, 'GBP', { USD: 3.65 })` → `0` (unknown currency, logs warning)
- [ ] Route is registered in `src/index.ts`

---

## F4. Asset & Holdings CRUD

### Goal

Full CRUD API for managing assets and their holdings. When holdings are updated, auto-generate a snapshot for net worth history.

### Data model reference

Tables: `assets`, `holdings`, `asset_snapshots`

### Files to create

- `src/api/assets.routes.ts` — all asset and holding endpoints

### Files to modify

- `src/api/validation.ts` — add Zod schemas
- `src/index.ts` — register route module
- `dashboard/src/api/client.ts` — add frontend API functions and types

### API Endpoints

#### `GET /api/assets`

Returns all active assets with their holdings and computed current values.

Query params: `includeInactive` (boolean, default false)

Response:
```json
[
  {
    "id": 1,
    "name": "OneZero Portfolio",
    "type": "brokerage",
    "institution": "oneZero",
    "liquidity": "liquid",
    "linkedAccountId": 4,
    "linkedAccountName": "One Zero",
    "isActive": true,
    "notes": null,
    "holdings": [
      {
        "id": 1,
        "name": "TSLA",
        "type": "stock",
        "currency": "USD",
        "quantity": 15,
        "costBasis": 2800.0,
        "lastPrice": 350.0,
        "lastPriceDate": "2026-03-01",
        "currentValue": 5250.0,
        "currentValueIls": 19162.5,
        "gainLoss": 2450.0,
        "gainLossPercent": 87.5,
        "stale": false
      }
    ],
    "totalValueIls": 223477.0
  }
]
```

**Value calculation logic (per holding):**
- `stock`/`etf`/`crypto`: `currentValue = quantity × last_price` (native currency), `currentValueIls = currentValue × exchangeRate[currency]`. If `last_price` is NULL, both are 0 and `stale: true`.
- `cash`/`fund_units`/`balance`: `currentValue = quantity` (native currency), `currentValueIls = quantity × exchangeRate[currency]`. `stale` is always `false`.

**Gain/loss calculation (all in holding's native currency):**
- `gainLoss` = `currentValue - costBasis`
- `gainLossPercent` = `(gainLoss / costBasis) × 100` (NULL if costBasis is 0)
- For crypto: `gainLoss` and `gainLossPercent` are NULL (cost_basis in native currency is meaningless — ROI comes from movements)

#### `GET /api/assets/:id`

Returns a single asset with holdings and computed values. Same response shape as one element of the `GET /api/assets` array.

Returns: asset object (200) or 404.

#### `POST /api/assets`

Create a new asset.

Body:
```json
{
  "name": "OneZero Portfolio",
  "type": "brokerage",
  "institution": "oneZero",
  "liquidity": "liquid",
  "linkedAccountId": 4,
  "notes": null
}
```

Validation:
- `name`: required, string, 1-100 chars, unique
- `type`: required, one of `ASSET_TYPES`
- `institution`: optional, string, max 100
- `liquidity`: optional, one of `LIQUIDITY_TYPES`, default `'liquid'`
- `linkedAccountId`: optional, integer, must reference a valid `accounts.id` with `account_type = 'bank'`
- `notes`: optional, string, max 500

Returns: created asset object (201)

#### `PUT /api/assets/:id`

Update an asset. Same fields as POST, all optional.

Returns: updated asset object (200) or 404.

#### `DELETE /api/assets/:id`

Soft delete (set `is_active = false`). Holdings, movements, and snapshots are preserved.

Returns: 204 or 404.

#### `POST /api/assets/:id/holdings`

Add a holding to an asset.

Body:
```json
{
  "name": "TSLA",
  "type": "stock",
  "currency": "USD",
  "quantity": 15,
  "costBasis": 2800.0,
  "lastPrice": 350.0,
  "notes": null
}
```

Validation:
- `name`: required, string, 1-100 chars
- `type`: required, one of `HOLDING_TYPES`
- `currency`: required, string, 1-10 chars (e.g., `USD`, `ILS`, `BTC`)
- `quantity`: required, number
- `costBasis`: optional, number, default 0
- `lastPrice`: optional, number. If omitted for `stock`/`etf`/`crypto` types, holding value will show as 0 and be flagged `stale: true` until a price is set.
- `notes`: optional, string, max 500

**Double-counting guard:** If the asset has a `linked_account_id` AND the holding's `currency` is `ILS` AND `type` is `cash`, reject with 400: `"ILS cash for this institution is already tracked via the linked bank account"`

Returns: created holding (201). **Triggers snapshot generation** (see below).

#### `PUT /api/holdings/:id`

Update a holding (quantity, lastPrice, costBasis, notes).

Body (all optional):
```json
{
  "quantity": 20,
  "lastPrice": 380.0,
  "costBasis": 3600.0,
  "notes": "updated after purchase"
}
```

Sets `updated_at` to now. **Triggers snapshot generation.**

Returns: updated holding (200) or 404.

#### `DELETE /api/holdings/:id`

Hard delete the holding. Related movements keep `asset_id` but lose `holding_id` (SET NULL).

Returns: 204 or 404. **Triggers snapshot generation.**

### Auto-snapshot generation

Whenever a holding is created, updated, or deleted, the system generates a snapshot for the parent asset:

1. Fetch all holdings for the asset
2. Fetch current exchange rates via `getExchangeRates()`
3. Compute `total_value_ils` by summing each holding's value in ILS
4. Build `holdings_snapshot` JSON: `[{ name, quantity, currency, price, valueIls }]`
5. `INSERT OR REPLACE` into `asset_snapshots` for `(asset_id, today's date)`

This is an internal function, not a separate endpoint. Extracted into a reusable helper:
```ts
export async function generateAssetSnapshot(assetId: number): Promise<void>
```

**Blocking behavior:** Snapshot generation awaits the exchange rate fetch (~100ms) and runs synchronously within the request. The holding update response is not sent until the snapshot is written. This ensures the snapshot always reflects the latest holding state.

### Zod schemas to add (`src/api/validation.ts`)

```ts
// ─── Assets ───
export const createAssetSchema = z.object({ ... });
export const updateAssetSchema = z.object({ ... });
export const createHoldingSchema = z.object({ ... });
export const updateHoldingSchema = z.object({ ... });
```

### Frontend types to add (`dashboard/src/api/client.ts`)

```ts
interface Holding { id, name, type, currency, quantity, costBasis, lastPrice, lastPriceDate, currentValue, currentValueIls, gainLoss, gainLossPercent, stale, notes }
interface Asset { id, name, type, institution, liquidity, linkedAccountId, linkedAccountName, isActive, notes, holdings: Holding[], totalValueIls }
```

### Success criteria

- [ ] `GET /api/assets` returns all active assets with holdings and computed ILS values
- [ ] `GET /api/assets/:id` returns a single asset with holdings, or 404
- [ ] `POST /api/assets` creates an asset, validates all fields, enforces unique name
- [ ] `PUT /api/assets/:id` updates fields, returns 404 for missing asset
- [ ] `DELETE /api/assets/:id` soft-deletes (sets `is_active = false`)
- [ ] `POST /api/assets/:id/holdings` creates a holding, rejects ILS cash on linked assets
- [ ] `PUT /api/holdings/:id` updates holding fields and sets `updated_at`
- [ ] `DELETE /api/holdings/:id` hard-deletes the holding
- [ ] Every holding create/update/delete triggers an asset snapshot for today
- [ ] Snapshot contains correct `total_value_ils` using current exchange rates
- [ ] `holdings_snapshot` JSON matches current holdings state
- [ ] Stock/crypto holdings with NULL `last_price` show value as 0 and are flagged as stale
- [ ] All endpoints use `validateBody`/`validateQuery`/`parseIntParam` from `src/api/helpers.ts`
- [ ] Route registered in `src/index.ts`

---

## F5. Liability CRUD

### Goal

CRUD API for managing liabilities (loans, mortgages, etc.) so they can be subtracted from net worth.

### Data model reference

Table: `liabilities`

### Files to create

- `src/api/liabilities.routes.ts` — liability endpoints (separate file, following existing one-domain-per-file convention)

### Files to modify

- `src/api/validation.ts` — add Zod schemas
- `src/index.ts` — register route module
- `dashboard/src/api/client.ts` — add frontend API functions and types

### API Endpoints

#### `GET /api/liabilities`

Returns all active liabilities.

Query params: `includeInactive` (boolean, default false)

Response:
```json
[
  {
    "id": 1,
    "name": "Poalim Loan",
    "type": "loan",
    "currency": "ILS",
    "originalAmount": 40000,
    "currentBalance": 32000,
    "interestRate": 5.5,
    "startDate": "2025-07-04",
    "notes": "₪1k/mo repayments",
    "isActive": true,
    "currentBalanceIls": 32000
  }
]
```

`currentBalanceIls` is `current_balance × exchangeRate[currency]` for multi-currency support.

#### `POST /api/liabilities`

Body:
```json
{
  "name": "Poalim Loan",
  "type": "loan",
  "currency": "ILS",
  "originalAmount": 40000,
  "currentBalance": 32000,
  "interestRate": 5.5,
  "startDate": "2025-07-04",
  "notes": "₪1k/mo repayments"
}
```

Validation:
- `name`: required, string, 1-100 chars, unique
- `type`: required, one of `LIABILITY_TYPES`
- `currency`: optional, string, default `'ILS'`
- `originalAmount`: required, number, positive
- `currentBalance`: required, number, >= 0
- `interestRate`: optional, number
- `startDate`: optional, YYYY-MM-DD string
- `notes`: optional, string, max 500

Returns: created liability (201)

#### `PUT /api/liabilities/:id`

Update any field. All fields optional.

Returns: updated liability (200) or 404.

#### `DELETE /api/liabilities/:id`

Soft delete (set `is_active = false`).

Returns: 204 or 404.

### Zod schemas

```ts
// ─── Liabilities ───
export const createLiabilitySchema = z.object({ ... });
export const updateLiabilitySchema = z.object({ ... });
```

### Frontend types

```ts
interface Liability { id, name, type, currency, originalAmount, currentBalance, interestRate, startDate, notes, isActive, currentBalanceIls }
```

### Success criteria

- [ ] `GET /api/liabilities` returns all active liabilities with ILS-converted balances
- [ ] `POST /api/liabilities` creates with validation, enforces unique name
- [ ] `PUT /api/liabilities/:id` partially updates, returns 404 for missing
- [ ] `DELETE /api/liabilities/:id` soft-deletes
- [ ] Currency conversion works for non-ILS liabilities

---

## F6. Net Worth API

### Goal

Provide current net worth calculation and historical time series, combining bank balances, asset holdings, and liabilities.

### Data model reference

Net Worth Calculation section of the data model. Uses: `accounts.balance`, `holdings`, `liabilities`, `account_balance_history`, `asset_snapshots`.

### Files to create

- `src/api/net-worth.routes.ts`

### Files to modify

- `src/index.ts` — register route module
- `dashboard/src/api/client.ts` — add frontend API functions and types

### API Endpoints

#### `GET /api/net-worth`

Returns current net worth breakdown.

Response:
```json
{
  "total": 664253,
  "liquidTotal": 420000,
  "banks": [
    { "id": 1, "name": "Poalim", "balance": 25472.67, "balanceIls": 25472.67 },
    { "id": 4, "name": "One Zero", "balance": 60712.27, "balanceIls": 60712.27 }
  ],
  "banksTotal": 86184.94,
  "assets": [
    {
      "id": 1,
      "name": "OneZero Portfolio",
      "type": "brokerage",
      "liquidity": "liquid",
      "totalValueIls": 223477.0,
      "holdings": [
        { "name": "TSLA", "currency": "USD", "valueIls": 19162.5 },
        { "name": "NFLX", "currency": "USD", "valueIls": 27740.0 },
        { "name": "כספית שקלית", "currency": "ILS", "valueIls": 120000 },
        { "name": "USD Cash (מטח)", "currency": "USD", "valueIls": 43800 }
      ]
    }
  ],
  "assetsTotal": 610069.0,
  "liabilities": [
    { "id": 1, "name": "Poalim Loan", "currentBalanceIls": 32000 }
  ],
  "liabilitiesTotal": 32000,
  "exchangeRates": { "USD": 3.65, "BTC": 347125 },
  "calculatedAt": "2026-03-05T14:30:00Z"
}
```

**Calculation logic:**
1. Query all bank accounts (`accounts` WHERE `account_type = 'bank'` AND `is_active = true`) → sum balances
2. Query all active assets with holdings → compute each holding's ILS value using exchange rates → sum per asset → sum total
3. Query all active liabilities → sum `current_balance` converted to ILS
4. `total = banksTotal + assetsTotal - liabilitiesTotal`
5. `liquidTotal` = same but only assets with `liquidity = 'liquid'` + all bank balances - all liabilities

#### `GET /api/net-worth/history`

Returns time series data for net worth over time.

Query params:
- `startDate` (YYYY-MM-DD, optional, default: 12 months ago)
- `endDate` (YYYY-MM-DD, optional, default: today)
- `granularity` (optional: `daily` | `weekly` | `monthly`, default: `monthly`)

Response:
```json
{
  "series": [
    {
      "date": "2025-04-01",
      "total": 380000,
      "banks": 75000,
      "assets": 320000,
      "liabilities": 15000
    },
    {
      "date": "2025-05-01",
      "total": 410000,
      "banks": 80000,
      "assets": 345000,
      "liabilities": 15000
    }
  ]
}
```

**Calculation logic per date point:**
1. For each date in the series:
   - Banks: find latest `account_balance_history` row per bank account on or before this date. Sum balances.
   - Assets: find latest `asset_snapshots.total_value_ils` per asset on or before this date. Sum values.
   - Liabilities: use `liabilities.current_balance` (no history table yet — uses current balance as approximation for all dates; see Future Considerations in data model).
2. `total = banks + assets - liabilities`

**Monthly granularity:** generate one data point per month (first of month).
**Weekly:** one per week (Monday).
**Daily:** one per day.

### Zod schemas

```ts
export const netWorthHistoryQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});
```

### Frontend types

```ts
interface NetWorth {
  total: number;
  liquidTotal: number;
  banks: { id: number; name: string; balance: number; balanceIls: number }[];
  banksTotal: number;
  assets: { id: number; name: string; type: string; liquidity: string; totalValueIls: number; holdings: { name: string; currency: string; valueIls: number }[] }[];
  assetsTotal: number;
  liabilities: { id: number; name: string; currentBalanceIls: number }[];
  liabilitiesTotal: number;
  exchangeRates: Record<string, number>;
  calculatedAt: string;
}

interface NetWorthHistoryPoint { date: string; total: number; banks: number; assets: number; liabilities: number }
interface NetWorthHistory { series: NetWorthHistoryPoint[] }
```

### Success criteria

- [ ] `GET /api/net-worth` returns correct total = banks + assets − liabilities
- [ ] `liquidTotal` excludes restricted/locked assets
- [ ] Bank balances come from `accounts.balance` (not history table — current value)
- [ ] Asset values computed correctly using exchange rates, with correct `type`-based formulas
- [ ] Holdings with NULL `last_price` (stock/crypto) contribute 0 to value
- [ ] Liabilities subtracted correctly
- [ ] `GET /api/net-worth/history` returns time series with correct date range
- [ ] History correctly uses `account_balance_history` and `asset_snapshots` (latest-before-date)
- [ ] Dates with no data for an asset use the most recent prior snapshot (carry-forward)
- [ ] Monthly granularity returns ~12 points for a 1-year range
- [ ] Empty history (no snapshots yet) returns empty series, not an error
- [ ] Exchange rates included in response for frontend reference

---

## F7. Net Worth Page (UI)

### Goal

New dashboard page showing total net worth, breakdown by asset type, asset list, liabilities, and bank balances.

### Files to create

- `dashboard/src/components/NetWorthPage.vue`

### Files to modify

- `dashboard/src/main.ts` — add route `{ path: '/net-worth', component: () => import('./components/NetWorthPage.vue') }`
- `dashboard/src/components/AppLayout.vue` — add sidebar nav item (icon: `TrendingUp` from lucide-vue-next)

### Layout

```
┌─────────────────────────────────────────────────┐
│  Net Worth Overview                             │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Total NW │  │ Liquid   │  │ Change   │      │
│  │ ₪650,000 │  │ ₪420,000 │  │ +₪28,000 │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  ┌─────────────────┐  ┌─────────────────┐      │
│  │ Breakdown       │  │ Net Worth Trend │      │
│  │ (Doughnut)      │  │ (Line chart)    │      │
│  │                 │  │                 │      │
│  └─────────────────┘  └─────────────────┘      │
│                                                 │
│  Assets                                         │
│  ┌─────────────────────────────────────────┐   │
│  │ OneZero Portfolio    brokerage  ₪223k   │   │
│  │ Pension              pension    ₪85k    │   │
│  │ Bitcoin              crypto     ₪173k   │   │
│  │ ...                                     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Bank Balances                                  │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ Poalim       │  │ OneZero      │            │
│  │ ₪25,472      │  │ ₪60,712      │            │
│  └──────────────┘  └──────────────┘            │
│                                                 │
│  Liabilities                                    │
│  ┌─────────────────────────────────────────┐   │
│  │ Poalim Loan   ₪32,000 / ₪40,000 orig  │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Component details

**Data fetching:** On mount, call `GET /api/net-worth` and `GET /api/net-worth/history` in parallel using `useApi()`.

**Top cards:**
- Total Net Worth: `netWorth.total` formatted with `formatCurrency()`
- Liquid Net Worth: `netWorth.liquidTotal`
- Change: delta from last month's history point vs current. Green if positive, red if negative. Use `Badge` component for the indicator.

**Breakdown doughnut chart:**
- Slices: one per asset type (brokerage, pension, crypto, etc.) + one for "Banks"
- Colors: assign distinct colors per type
- Use `Doughnut` from `vue-chartjs` (same pattern as `OverviewDashboard.vue`)

**Net Worth Trend chart:**
- Line chart from history API (default: last 12 months, monthly granularity)
- Primary line: total net worth. Optional toggle: stacked area with breakdown (banks, assets, liabilities).
- X axis: formatted month labels (e.g., "Mar 25", "Apr 25"). Y axis: ILS values with K/M suffixes.
- Use `Line` from `vue-chartjs` (register `LineElement`, `PointElement`, `Filler` from chart.js)
- Graceful handling: no data → show "Start tracking your assets to see net worth history"; single point → dot with label; gaps → connect lines across missing months

**Asset list:**
- Rows: each asset with name, type badge, total value, % of total net worth
- Clicking an asset navigates to `/net-worth/assets/:id` (F10, Phase 2)
- For Phase 1: clicking expands inline to show holdings

**Bank balances:**
- Cards for each bank account (same pattern as existing `OverviewDashboard.vue` bank balance section)

**Liabilities:**
- Card or row per liability showing name, current balance, original amount, progress bar (paid off %)

### UI components used

- `Card`, `CardHeader`, `CardTitle`, `CardContent` — for stat cards
- `Badge` — for type labels and change indicator
- `Button` — for "Manage Assets" action
- `Doughnut`, `Line` (vue-chartjs) — charts
- `TrendingUp` icon — sidebar

### Success criteria

- [ ] `/net-worth` route loads the page
- [ ] Sidebar shows "Net Worth" nav item with icon
- [ ] Total and Liquid net worth cards display correctly formatted ILS values
- [ ] Change card shows delta from last month (or "No history" if no prior data)
- [ ] Doughnut chart shows breakdown by asset type
- [ ] Line chart shows net worth trend (handles empty history gracefully)
- [ ] All assets listed with type, value, and percentage
- [ ] Bank balances displayed as cards
- [ ] Liabilities displayed with remaining balance and progress
- [ ] Page handles loading state (skeletons or spinner)
- [ ] Page handles empty state (no assets configured yet — shows setup prompt)

---

## F8. Asset Management UI

### Goal

UI for creating, editing, and deleting assets and their holdings. Integrated into the net worth page via dialogs.

### Files to modify

- `dashboard/src/components/NetWorthPage.vue` — add action buttons and dialogs

### Files to create (if dialogs become complex enough to extract)

- `dashboard/src/components/AssetDialog.vue` — create/edit asset dialog
- `dashboard/src/components/HoldingDialog.vue` — create/edit holding dialog

### UI Flows

#### Create Asset

1. User clicks "Add Asset" button on net worth page
2. Dialog opens with form fields: name, type (select), institution, liquidity (select), linked account (select from bank accounts, optional), notes
3. On submit: `POST /api/assets`
4. On success: close dialog, refresh asset list

#### Edit Asset

1. User clicks edit icon on an asset row
2. Same dialog as create, pre-filled with current values
3. On submit: `PUT /api/assets/:id`

#### Delete Asset

1. User clicks delete icon on an asset row
2. `AlertDialog` confirmation: "This will hide {name} from your net worth. Holdings and history will be preserved."
3. On confirm: `DELETE /api/assets/:id`

#### Manage Holdings

1. User expands an asset to see its holdings
2. "Add Holding" button opens `HoldingDialog`:
   - Fields: name, type (select), currency (input), quantity, cost basis, last price (conditional on type), notes
   - Validation: prevent ILS cash on linked assets (frontend mirrors backend validation)
3. Edit holding: click edit icon → same dialog pre-filled
4. Delete holding: click delete → `AlertDialog` confirmation

#### Manage Liabilities

1. User clicks "Add Liability" button in the Liabilities section of the net worth page
2. Dialog opens with form fields: name, type (select), currency, original amount, current balance, interest rate, start date, notes
3. On submit: `POST /api/liabilities`
4. Edit: click edit icon on liability row → same dialog pre-filled → `PUT /api/liabilities/:id`
5. Delete: click delete icon → `AlertDialog` confirmation → `DELETE /api/liabilities/:id`

#### Update Holdings (Quick Update Flow)

1. For the monthly update workflow: user clicks "Update Values" on an asset
2. Inline editing mode: holding rows become editable (quantity, last_price fields)
3. User updates values and clicks "Save"
4. Sends `PUT /api/holdings/:id` for each changed holding in parallel
5. Shows per-holding success/error indicators. Failed updates remain editable. No rollback of successful updates.

### Form components

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` — from shadcn/reka-ui
- `Input` — text/number inputs
- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` — for type/liquidity/currency dropdowns
  - Remember: **never use `value=""`** for SelectItem (reka-ui gotcha from MEMORY.md). Use sentinel values like `"all"`.
- `Button` — submit/cancel
- `AlertDialog` — delete confirmations

### Success criteria

- [ ] Can create a new asset with all fields via dialog
- [ ] Can edit an existing asset
- [ ] Can soft-delete an asset with confirmation
- [ ] Can add holdings to an asset
- [ ] ILS cash holdings are rejected for linked assets (frontend + backend)
- [ ] Can edit holdings (quantity, price, etc.)
- [ ] Can delete holdings with confirmation
- [ ] Quick update flow allows inline editing of multiple holdings
- [ ] After any holding change, asset value updates immediately in the list
- [ ] Can create, edit, and delete liabilities via dialogs
- [ ] All form validation errors shown clearly
- [ ] Select dropdowns never use empty string values

---

## F9. Movement Recording

### Goal

API and UI for recording money movements (deposits, buys, sells, withdrawals, etc.) with automatic cost basis updates.

### Data model reference

Table: `asset_movements`. Cost basis update logic from Design Decisions section.

### Files to create

- Movement endpoints in `src/api/assets.routes.ts` (co-located with asset routes)

### Files to modify

- `src/api/validation.ts` — add movement Zod schemas
- `dashboard/src/api/client.ts` — add frontend functions and types

### API Endpoints

#### `GET /api/assets/:id/movements`

List movements for an asset, paginated.

Query params:
- `holdingId` (optional, filter by specific holding)
- `type` (optional, filter by movement type)
- `startDate` / `endDate` (optional)
- `offset` / `limit` (pagination, defaults: 0 / 50)

Response:
```json
{
  "movements": [
    {
      "id": 1,
      "assetId": 1,
      "holdingId": 1,
      "holdingName": "TSLA",
      "date": "2025-03-18",
      "type": "buy",
      "quantity": 20,
      "currency": "USD",
      "pricePerUnit": 180.0,
      "sourceAmount": 13100,
      "sourceCurrency": "ILS",
      "notes": "first purchase",
      "createdAt": "2025-03-18T10:00:00Z"
    }
  ],
  "total": 15
}
```

Joins `holdings.name` for the `holdingName` field (or NULL if holding was deleted).

#### `POST /api/assets/:id/movements`

Record a new movement. This is the most complex endpoint — it both records the movement AND updates the affected holding.

Body:
```json
{
  "holdingId": 1,
  "date": "2025-03-18",
  "type": "buy",
  "quantity": 20,
  "currency": "USD",
  "pricePerUnit": 180.0,
  "sourceAmount": 13100,
  "sourceCurrency": "ILS",
  "notes": "first purchase"
}
```

Validation:
- `holdingId`: optional, integer, must belong to the same asset
- `date`: required, YYYY-MM-DD
- `type`: required, one of `MOVEMENT_TYPES`
- `quantity`: required, number. Must be positive for `deposit`/`buy`/`dividend`. Must be negative for `withdrawal`/`sell`. Either for `adjustment`.
- `currency`: required, string
- `pricePerUnit`: optional, number, positive (required for `buy`/`sell` on stock/etf/crypto holdings)
- `sourceAmount`: optional, number, positive
- `sourceCurrency`: optional, string
- `notes`: optional, string, max 500

**Side effects by type:**

| type | holding.quantity | holding.cost_basis | snapshot |
|---|---|---|---|
| `deposit` | += quantity | += quantity (for balance types, cost = value) | yes |
| `withdrawal` | += quantity (negative) | proportional reduction (avg cost) | yes |
| `buy` | += quantity | += quantity × pricePerUnit | yes |
| `sell` | += quantity (negative) | proportional reduction (avg cost) | yes |
| `dividend` | no change | no change | no |
| `fee` | no change | no change | no |
| `adjustment` | += quantity | no change (manual adjustment to cost_basis via separate update) | yes |

**Buy cost basis update:**
```
holding.cost_basis += movement.quantity × movement.pricePerUnit
```

**Sell cost basis update (average cost method):**
```
// quantity is negative (e.g., -5 for selling 5 shares)
sellQuantity = abs(quantity)
proportion = sellQuantity / holding.quantity    // compute BEFORE updating quantity
holding.cost_basis -= holding.cost_basis × proportion
holding.quantity += quantity                     // adds negative, reducing quantity
```

**Sell validation:** `abs(quantity)` must be <= `holding.quantity` (can't sell more than you own).

All operations run in a **transaction** (SQLite BEGIN/COMMIT) to keep movement + holding + snapshot consistent.

Returns: created movement (201)

#### `DELETE /api/movements/:id`

Delete a movement. To prevent holding state from becoming inconsistent, **only the most recent movement for a given holding can be deleted**. If the movement is not the most recent for its holding, return 400: `"Can only delete the most recent movement for this holding"`.

When deleting the most recent movement, **reverse the holding changes**:
- Buy deletion: `holding.quantity -= movement.quantity`, `holding.cost_basis -= movement.quantity × movement.pricePerUnit`
- Sell deletion: reverse the average cost calculation (restore pre-sell cost_basis and quantity)
- Deposit/withdrawal deletion: reverse the quantity change

Returns: 204 or 404 or 400.

### Zod schemas

```ts
export const createMovementSchema = z.object({
  holdingId: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number(),
  currency: z.string().min(1).max(10),
  pricePerUnit: z.number().positive().optional(),
  sourceAmount: z.number().positive().optional(),
  sourceCurrency: z.string().min(1).max(10).optional(),
  notes: z.string().max(500).optional(),
});

export const movementQuerySchema = z.object({
  holdingId: z.coerce.number().int().positive().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
```

### Success criteria

- [ ] `GET /api/assets/:id/movements` returns paginated movements with holding names
- [ ] Filters by holdingId, type, date range work correctly
- [ ] `POST /api/assets/:id/movements` creates movement and updates holding in a single DB transaction
- [ ] Buy: quantity added, cost_basis increased by `qty × price`
- [ ] Sell: quantity reduced, cost_basis proportionally reduced (average cost method)
- [ ] Sell rejected if quantity > holding's current quantity
- [ ] Deposit/withdrawal: quantity updated accordingly
- [ ] Dividend/fee: no holding quantity/cost_basis changes
- [ ] Snapshot auto-generated after movements that change holdings
- [ ] `pricePerUnit` required for buy/sell on stock/etf/crypto types
- [ ] `DELETE /api/movements/:id` removes the movement record

---

## F10. Asset Detail Page (UI)

### Goal

Dedicated page for viewing a single asset's holdings, performance, and movement history.

### Files to create

- `dashboard/src/components/AssetDetailPage.vue`

### Files to modify

- `dashboard/src/main.ts` — add route `{ path: '/net-worth/assets/:id', component: () => import('./components/AssetDetailPage.vue') }`
- `dashboard/src/api/client.ts` — add functions for movement API calls

### Layout

```
┌─────────────────────────────────────────────────┐
│  ← Back to Net Worth                            │
│                                                 │
│  OneZero Portfolio                               │
│  brokerage · oneZero · liquid                   │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Value    │  │ Invested │  │ Return   │      │
│  │ ₪223,477 │  │ ₪180,000 │  │ +₪43,477 │      │
│  │          │  │          │  │ +24.2%   │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  Holdings                          [Add Holding]│
│  ┌─────────────────────────────────────────┐   │
│  │ Name    │ Qty │ Price │ Value  │ P&L    │   │
│  │ TSLA    │  15 │ $350  │ ₪19.1k │ +87.5% │   │
│  │ NFLX    │   8 │ $950  │ ₪27.7k │ +12.3% │   │
│  │ כספית   │     │       │ ₪120k  │ +0.4%  │   │
│  │ USD Cash│     │       │ ₪43.8k │        │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Value Over Time                                │
│  ┌─────────────────────────────────────────┐   │
│  │         📈 (line chart from snapshots)   │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Movement History                 [Add Movement]│
│  ┌─────────────────────────────────────────┐   │
│  │ Date    │ Type │ Holding │ Qty │ Cost   │   │
│  │ Feb 24  │ sell │ כספית   │ +50k│ —      │   │
│  │ Feb 17  │ buy  │ כספית   │ -50k│ ₪50k   │   │
│  │ Jan 28  │ buy  │ NFLX   │  +8 │ ₪20k   │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Data fetching

On mount (using asset ID from route params):
1. `GET /api/assets/:id` → asset with holdings and computed values
2. `GET /api/assets/:id/movements` → movement history
3. `GET /api/assets/:id/snapshots` → for the value-over-time chart (see endpoint below)

#### Additional endpoint needed: `GET /api/assets/:id/snapshots`

Returns historical snapshots for a single asset.

Query params: `startDate`, `endDate` (optional, defaults to last 12 months)

Response:
```json
{
  "snapshots": [
    { "date": "2025-04-01", "totalValueIls": 180000 },
    { "date": "2025-05-01", "totalValueIls": 195000 }
  ]
}
```

This endpoint should be added to F4 (`src/api/assets.routes.ts`).

### Performance summary cards

- **Value:** total current value in ILS (sum of holdings)
- **Invested:** sum of all `deposit`/`buy` movements' `source_amount`, converted to ILS. For movements where `source_currency = 'ILS'`, use `source_amount` directly. For non-ILS `source_currency`, convert using the current exchange rate (approximate, since we don't store historical rates).
- **Return:** value − invested, and percentage

### Holdings table

Uses `Table` component from shadcn/reka-ui. Columns: Name, Quantity, Price, Value (ILS), Cost Basis, P&L (amount + %), Actions (edit/delete).

### Movement history

Chronological list (newest first). Each row shows: date, type (color-coded badge), holding name, quantity, source cost, notes. Pagination with "Load more."

### Value over time chart

Line chart from `asset_snapshots` for this asset. X axis: dates, Y axis: `total_value_ils`.

### Success criteria

- [ ] Page loads with asset details from route param `:id`
- [ ] Back navigation to `/net-worth`
- [ ] Performance summary shows correct value, invested total, and return
- [ ] Holdings table shows all holdings with computed P&L
- [ ] Movement history loads paginated, newest first
- [ ] Value chart renders from snapshot history
- [ ] "Add Holding" and "Add Movement" buttons open appropriate dialogs
- [ ] Empty states handled (no holdings, no movements, no snapshots)

---

## F11. Seed Initial Data

### Goal

Provide a way to set up the user's initial assets, holdings, and liabilities with known data, and backfill historical movements from existing transaction data.

### Implementation options

**Option A: Backfill script** — one-time Node script in `src/db/backfills.ts` (matching existing backfill pattern)

**Option B: UI wizard** — guided setup flow on first visit to net worth page

**Recommended: Option A** for initial data, with the UI (F8) for ongoing management.

### Backfill content

```ts
// Look up OneZero account dynamically — DO NOT hardcode account ID
const oneZeroAccount = db.select().from(accounts).where(eq(accounts.companyId, 'oneZero')).get();

const SEED_ASSETS = [
  { name: 'OneZero Portfolio', type: 'brokerage', institution: 'oneZero', liquidity: 'liquid', linkedAccountId: oneZeroAccount?.id ?? null },
  { name: 'Excelence', type: 'brokerage', institution: 'excelence', liquidity: 'liquid' },
  { name: 'Pension', type: 'pension', liquidity: 'locked' },
  { name: 'קרן השתלמות', type: 'keren_hishtalmut', liquidity: 'locked' },
  { name: 'Bitcoin', type: 'crypto', liquidity: 'liquid' },
  { name: 'Analyst Fund', type: 'fund', institution: 'analyst', liquidity: 'restricted' },
  { name: 'US Real Estate', type: 'real_estate', liquidity: 'restricted' },
];

// Compute loan balance dynamically from transaction data
const loanPayments = db.select({ total: sql`SUM(ABS(charged_amount))` })
  .from(transactions)
  .where(and(like(transactions.description, '%הו"ק הלואה קרן%'), lt(transactions.chargedAmount, 0)))
  .get();
const loanBalance = 40000 - (loanPayments?.total ?? 0);

const SEED_LIABILITY = {
  name: 'Poalim Loan',
  type: 'loan',
  currency: 'ILS',
  originalAmount: 40000,
  currentBalance: loanBalance,
  interestRate: null,
  startDate: '2025-07-04',
};
```

Holdings and movements need to be entered manually by the user (they have the actual current values). The backfill only creates the asset/liability containers.

**Idempotency:** Use a backfill key (matching the existing `backfills.ts` pattern) to prevent re-running on subsequent startups.

**Balance history backfill:** Scan existing `accounts.balance` and insert a row per bank account for today, so the history starts from deployment day.

### Success criteria

- [ ] Backfill creates 7 assets and 1 liability if they don't exist (idempotent)
- [ ] `linked_account_id` correctly references the OneZero bank account
- [ ] Backfill runs on app startup alongside existing backfills
- [ ] Running twice doesn't duplicate data (uses unique name check)
- [ ] Balance history seeded with current bank balances for today

---

## Implementation Order

```
Phase 1: Foundation
  F1 (schema) ──→ F2 (balance history) ──→ F3 (exchange rates)
       │
       └──→ F4 (asset CRUD) + F5 (liability CRUD) ──→ F6 (net worth API)
                                                          │
                                                          └──→ F7 (net worth page) + F8 (asset mgmt UI)
                                                                       │
                                                                       └──→ F12 (seed data)

Phase 2: Depth
  F9 (movements) ──→ F10 (asset detail page) ──→ F11 (history chart)
```

Each feature builds on the previous. F1 is the prerequisite for everything. F2/F3 are independent and can be done in parallel with F4/F5. The UI features (F7, F8, F10, F11) depend on their respective APIs.
