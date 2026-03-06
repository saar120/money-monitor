# Net Worth Feature - Implementation Plan

## Overview

11 features (F1-F11) organized into 7 execution steps plus 3 review/validation gates. Steps within a phase run in parallel; phases run sequentially because of data/file dependencies.

**Total agents needed:** 12 (9 implementation + 3 review/validation)

---

## Completion Protocol (ALL agents MUST follow)

Before reporting work as done, every agent MUST run the `/simplify` skill. This reviews the code you changed for reuse opportunities, quality issues, and efficiency improvements — then fixes any issues found.

**Steps (in order):**
1. Finish all implementation work
2. Verify success criteria pass (tests, server starts, etc.)
3. Run `/simplify` — this will review your changed code and fix any issues
4. Verify nothing broke after simplify fixes
5. Only THEN report work as complete

This is non-negotiable. No agent should consider their work done until `/simplify` has run and any issues it found are resolved.

---

## Dependency Graph

```
                          F1 (Schema)
                         /     |     \
                        v      v      v
                    F2(Bal)  F3(FX)  F11(Seed)
                              |
                              v
                       F4+F5 (CRUD)
                       /           \
                      v             v
                  F6 (NW API)    F9 (Movements)
                      |             |
                      v             v
                F7+F8 (NW UI)   F10 (Detail UI)
```

## File Conflict Map

Files modified by multiple features (determines what can run in parallel):

| Shared File | Features | Conflict Resolution |
|---|---|---|
| `src/index.ts` | F3, F4, F5, F6 | Sequential: each adds one `app.register()` line |
| `src/api/validation.ts` | F4, F5, F9 | Sequential: each appends schemas |
| `dashboard/src/api/client.ts` | F4, F5, F6, F9, F10 | Sequential: each appends functions/types |
| `dashboard/src/main.ts` | F7, F10 | Sequential: each adds a route |

---

## Step 1: Schema & Migrations (BLOCKING - everything depends on this)

### Agent 1: F1 - Schema & Migrations

**Goal:** Add 6 new tables to the Drizzle ORM schema and generate a migration.

**Files to modify:**
- `src/shared/types.ts` — add type enum constants (`ASSET_TYPES`, `LIQUIDITY_TYPES`, `HOLDING_TYPES`, `MOVEMENT_TYPES`, `LIABILITY_TYPES`)
- `src/db/schema.ts` — add 6 table definitions: `assets`, `holdings`, `assetMovements`, `assetSnapshots`, `accountBalanceHistory`, `liabilities`

**Files to reference (read-only):**
- `docs/net-worth/net-worth-data-model.md` — exact SQL definitions for all tables
- `docs/net-worth/net-worth-feature-specs.md` — F1 section for validation criteria

**Key implementation details:**
- Follow existing `snake_case` DB columns with `camelCase` Drizzle field names (match `transactions` pattern)
- FK relationships: `assets.linked_account_id` -> `accounts.id` (SET NULL), `holdings.asset_id` -> `assets.id` (CASCADE), etc.
- Unique constraints: `holdings(asset_id, name)`, `assetSnapshots(asset_id, date)`, `accountBalanceHistory(account_id, date)`
- Type enums go in `src/shared/types.ts` as `as const` arrays (needed by both schema and validation)
- After schema changes: run `npm run db:generate` to produce migration
- Verify with `npm run dev` that server starts and tables are created

**Constraints:**
- Do NOT modify any existing table definitions
- Do NOT hand-write migration files (use drizzle-kit only — see MEMORY.md gotcha)
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
- [ ] `npm run db:generate` produces a clean migration
- [ ] `npm run dev` starts without errors
- [ ] All 6 tables exist with correct columns, types, constraints, and FKs
- [ ] Existing data unaffected

---

## Step 2: Independent Backend Services (3 agents in PARALLEL)

These 3 features have zero file conflicts and can run simultaneously.

### Agent 2: F2 - Balance History Auto-Capture

**Goal:** After the scraper updates a bank balance, also insert a row into `account_balance_history`.

**Files to modify:**
- `src/scraper/scraper.service.ts` — after the `db.update(accounts).set({ balance })` call (~line 224-228)

**Files to reference (read-only):**
- `src/db/schema.ts` — for the `accountBalanceHistory` table schema
- `src/shared/dates.ts` — for `toIsraelDateStr()` helper (Israel timezone dates)
- `docs/net-worth/net-worth-feature-specs.md` — F2 section
- `docs/net-worth/net-worth-data-model.md` — Table 5 (`account_balance_history`) schema definition

**Key implementation details:**
```ts
// Add immediately after the existing balance update:
db.insert(accountBalanceHistory)
  .values({
    accountId: targetAccount.id,
    date: toIsraelDateStr(new Date()),
    balance: scraperAccount.balance,
  })
  .onConflictDoUpdate({
    target: [accountBalanceHistory.accountId, accountBalanceHistory.date],
    set: { balance: scraperAccount.balance },
  })
  .run();
```
- Use `onConflictDoUpdate` on the `(account_id, date)` unique constraint
- Only insert when `scraperAccount.balance != null` (inside existing guard)
- Use Israel timezone date via `toIsraelDateStr` or the `toIsraelDateString` helper from `src/shared/dates.ts`

**Constraints:**
- Only modify `scraper.service.ts` — no other files
- Do NOT change existing balance update logic, only add the history insert after it
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
- [ ] After scrape, `account_balance_history` has row per bank account with today's date
- [ ] Running scraper twice same day updates (not duplicates)
- [ ] Uses Israel timezone date

---

### Agent 3: F3 - Exchange Rate Service

**Goal:** Create a service that fetches USD/ILS, BTC/ILS, EUR/ILS exchange rates with caching.

**Files to create:**
- `src/services/exchange-rates.ts` — rate fetching + caching + `convertToIls()` helper
- `src/api/exchange-rates.routes.ts` — `GET /api/exchange-rates` endpoint

**Files to modify:**
- `src/index.ts` — register the new route module (add one `app.register()` call)

**Files to reference (read-only):**
- `docs/net-worth/net-worth-feature-specs.md` — F3 section
- `src/api/accounts.routes.ts` — reference for route definition pattern
- `src/index.ts` — see existing route registrations pattern

**Key implementation details:**

Service (`src/services/exchange-rates.ts`):
```ts
interface ExchangeRateResult {
  rates: Record<string, number>;  // ILS per 1 unit: { USD: 3.65, BTC: 347125, EUR: 3.95, ILS: 1 }
  stale: boolean;
  fetchedAt: string;
}
export async function getExchangeRates(): Promise<ExchangeRateResult>
export function convertToIls(amount: number, currency: string, rates: Record<string, number>): number
```
- Primary source: Bank of Israel API for fiat, CoinGecko for BTC
- Cache in memory for 1 hour (simple `lastFetched` + `cachedRates` module-level variables)
- If API fails + cache exists: return cached with `stale: true`
- If API fails + no cache: throw error
- `convertToIls('ILS')` returns amount unchanged
- `convertToIls` with unknown currency returns 0 and logs warning
- ILS rate is always 1

Route (`src/api/exchange-rates.routes.ts`):
- `GET /api/exchange-rates` → returns `ExchangeRateResult` JSON
- Follow existing route plugin pattern (`export async function exchangeRatesRoutes(app: FastifyInstance)`)

**Constraints:**
- Only touch `src/index.ts` to add route registration line — do not modify existing registrations
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
- [ ] `GET /api/exchange-rates` returns rates for USD, EUR, BTC
- [ ] Cached for 1 hour
- [ ] Stale fallback works
- [ ] `convertToIls()` handles ILS, known, and unknown currencies correctly

---

### Agent 4: F11 - Seed Initial Data

**Goal:** Create a backfill that seeds 7 assets and 1 liability for initial setup.

**Files to modify:**
- `src/db/backfills.ts` — add a new backfill function (follow existing pattern)

**Files to reference (read-only):**
- `src/db/backfills.ts` — understand existing backfill pattern and idempotency keys
- `src/db/schema.ts` — for the `assets`, `liabilities`, `accountBalanceHistory`, `accounts`, `transactions` tables
- `docs/net-worth/net-worth-feature-specs.md` — F11 section
- `docs/net-worth/net-worth-data-model.md` — seed data tables in Table 1 (`assets`) and Table 6 (`liabilities`), plus known liability data

**Key implementation details:**
- Use existing backfill key pattern for idempotency (check existing backfills in the file)
- Look up OneZero account dynamically: `db.select().from(accounts).where(eq(accounts.companyId, 'oneZero')).get()`
- Compute loan balance dynamically from existing transaction data (search for `הו"ק הלואה קרן` transactions)
- Seed 7 assets from the data model's seed data table
- Seed 1 liability (Poalim Loan)
- Also seed `account_balance_history` with current bank balances for all active accounts
- Use `INSERT OR IGNORE` or name uniqueness check for idempotency

**Constraints:**
- Only modify `backfills.ts`
- Follow existing backfill patterns exactly (idempotency keys, function structure)
- Do NOT hardcode account IDs — look up dynamically
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
- [ ] Running twice doesn't duplicate data
- [ ] 7 assets created with correct types, institutions, liquidity values
- [ ] OneZero linked to correct bank account
- [ ] Loan balance computed from transaction data
- [ ] Balance history seeded for all active bank accounts

---

## Step 3: CRUD APIs (1 agent - shared files make parallel unsafe)

### Agent 5: F4 + F5 - Asset & Holdings CRUD + Liability CRUD

**Goal:** Full CRUD API for assets (with holdings and auto-snapshots) and liabilities.

**Depends on:** Step 1 (F1 - schema), Step 2/Agent 3 (F3 - exchange rates for snapshot generation)

**Files to create:**
- `src/api/assets.routes.ts` — asset + holding + snapshot endpoints
- `src/api/liabilities.routes.ts` — liability endpoints

**Files to modify:**
- `src/api/validation.ts` — add Zod schemas for assets, holdings, liabilities
- `src/index.ts` — register both new route modules
- `dashboard/src/api/client.ts` — add frontend API functions and types for assets, holdings, liabilities

**Files to reference (read-only):**
- `docs/net-worth/net-worth-feature-specs.md` — F4 and F5 sections (full endpoint specs, response shapes, validation rules)
- `docs/net-worth/net-worth-data-model.md` — Tables 1-4 (`assets`, `holdings`, `asset_movements`, `asset_snapshots`) and Table 6 (`liabilities`) — schema, value calculation formulas, snapshot lifecycle, double-counting prevention
- `src/api/accounts.routes.ts` — reference for route/CRUD pattern
- `src/api/helpers.ts` — for `validateBody()`, `validateQuery()`, `parseIntParam()`
- `src/services/exchange-rates.ts` — for `getExchangeRates()` and `convertToIls()`
- `dashboard/src/api/client.ts` — for existing API function patterns

**Key implementation details:**

**Assets routes (`src/api/assets.routes.ts`):**
- `GET /api/assets` — list active assets with holdings + computed ILS values. Query: `includeInactive`
- `GET /api/assets/:id` — single asset with holdings
- `POST /api/assets` — create asset (validate unique name, valid linkedAccountId if provided)
- `PUT /api/assets/:id` — update asset fields
- `DELETE /api/assets/:id` — soft delete (set `is_active = false`)
- `POST /api/assets/:id/holdings` — add holding with double-counting guard (reject ILS cash on linked assets)
- `PUT /api/holdings/:id` — update holding, set `updated_at`
- `DELETE /api/holdings/:id` — hard delete holding
- `GET /api/assets/:id/snapshots` — historical snapshots for value-over-time chart

**Value calculation per holding:**
- `stock`/`etf`/`crypto`: `currentValue = quantity * lastPrice`, convert to ILS via exchange rate. If `lastPrice` is NULL → value=0, `stale: true`
- `cash`/`fund_units`/`balance`: `currentValue = quantity`, convert to ILS. `stale` always false
- `gainLoss = currentValue - costBasis`, `gainLossPercent = (gainLoss / costBasis) * 100`
- For crypto type: `gainLoss`/`gainLossPercent` = null (ROI from movements only)

**Auto-snapshot generation:**
After every holding create/update/delete:
1. Fetch all holdings for the asset
2. Get exchange rates via `getExchangeRates()`
3. Compute `total_value_ils` by summing each holding's ILS value
4. Build `holdings_snapshot` JSON
5. `INSERT OR REPLACE` into `asset_snapshots` for `(asset_id, today's Israel date)`

Extract as: `async function generateAssetSnapshot(assetId: number): Promise<void>`

**Liabilities routes (`src/api/liabilities.routes.ts`):**
- `GET /api/liabilities` — list active liabilities with ILS-converted balances
- `POST /api/liabilities` — create (validate unique name)
- `PUT /api/liabilities/:id` — update
- `DELETE /api/liabilities/:id` — soft delete

**Zod schemas to add to `validation.ts`:**
- `createAssetSchema`, `updateAssetSchema`
- `createHoldingSchema`, `updateHoldingSchema`
- `createLiabilitySchema`, `updateLiabilitySchema`

**Frontend types and functions to add to `client.ts`:**
- Types: `Asset`, `Holding`, `Liability`
- Functions: `getAssets()`, `getAsset(id)`, `createAsset()`, `updateAsset()`, `deleteAsset()`,
  `createHolding()`, `updateHolding()`, `deleteHolding()`,
  `getLiabilities()`, `createLiability()`, `updateLiability()`, `deleteLiability()`,
  `getAssetSnapshots(id)`

**Constraints:**
- Follow existing route patterns exactly (plugin export, validateBody/validateQuery/parseIntParam)
- All Select dropdowns sentinel values: NEVER use empty string `""` (reka-ui gotcha)
- Use Israel timezone for snapshot dates
- The snapshot generation must be blocking (await exchange rates, write snapshot before responding)
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
See F4 and F5 success criteria in the feature specs (20+ items total).

---

## Step 4: Aggregation APIs (2 agents — CAN be parallel with worktrees, or sequential)

### Option A: Sequential (Recommended — simpler, no merge conflicts)

#### Agent 6: F6 - Net Worth API

**Goal:** Aggregation endpoint that combines banks + assets - liabilities into a single net worth response, plus historical time series.

**Depends on:** Step 3 (F4 + F5 - CRUD APIs)

**Files to create:**
- `src/api/net-worth.routes.ts`

**Files to modify:**
- `src/index.ts` — register route
- `dashboard/src/api/client.ts` — add frontend types and functions

**Files to reference (read-only):**
- `docs/net-worth/net-worth-feature-specs.md` — F6 section (full response shapes, calculation logic)
- `docs/net-worth/net-worth-data-model.md` — "Net Worth Calculation" section (exact formula for total/liquid, double-counting prevention, historical calculation method)
- `src/api/assets.routes.ts` — for understanding how assets/holdings are queried
- `src/services/exchange-rates.ts` — for `getExchangeRates()` and `convertToIls()`
- `src/db/schema.ts` — for `accounts`, `assets`, `holdings`, `liabilities`, `accountBalanceHistory`, `assetSnapshots`

**Key implementation details:**

**`GET /api/net-worth`:**
1. Query bank accounts (`account_type = 'bank'`, `is_active = true`) → sum balances
2. Query active assets with holdings → compute each holding's ILS value → sum per asset → total
3. Query active liabilities → sum `current_balance` converted to ILS
4. `total = banksTotal + assetsTotal - liabilitiesTotal`
5. `liquidTotal` = only `liquidity = 'liquid'` assets + all banks - all liabilities

Response shape includes: `total`, `liquidTotal`, `banks[]`, `banksTotal`, `assets[]`, `assetsTotal`, `liabilities[]`, `liabilitiesTotal`, `exchangeRates`, `calculatedAt`

**`GET /api/net-worth/history`:**
- Query params: `startDate`, `endDate`, `granularity` (`daily`|`weekly`|`monthly`, default monthly)
- For each date point:
  - Banks: latest `account_balance_history` per account on or before date
  - Assets: latest `asset_snapshots.total_value_ils` per asset on or before date
  - Liabilities: current `current_balance` (no history table yet — approximate)
  - `total = banks + assets - liabilities`
- Monthly: one point per month (1st of month). Weekly: Mondays. Daily: every day.
- Empty history → return empty `series[]`, not error

**Zod schema:** `netWorthHistoryQuerySchema` with optional date range and granularity

**Frontend types:**
- `NetWorth` — full breakdown
- `NetWorthHistoryPoint` — `{ date, total, banks, assets, liabilities }`
- `NetWorthHistory` — `{ series: NetWorthHistoryPoint[] }`
- Functions: `getNetWorth()`, `getNetWorthHistory(params?)`

**Constraints:**
- Date range defaults to 12 months ago → today
- Use carry-forward logic: if no snapshot exists for an asset on a given date, use the most recent prior one
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
See F6 success criteria in the feature specs.

---

#### Agent 7: F9 - Movement Recording

**Goal:** API for recording movements (buy, sell, deposit, withdrawal, etc.) with automatic cost basis updates and snapshot generation.

**Depends on:** Step 3 (F4 - Asset CRUD for the route file and holdings)

**Files to modify:**
- `src/api/assets.routes.ts` — add movement endpoints to existing asset routes
- `src/api/validation.ts` — add movement Zod schemas
- `dashboard/src/api/client.ts` — add movement frontend functions and types

**Files to reference (read-only):**
- `docs/net-worth/net-worth-feature-specs.md` — F9 section (CRITICAL: cost basis logic, side effects table, sell validation)
- `docs/net-worth/net-worth-data-model.md` — Table 3 (`asset_movements`) schema, "Design Decisions" section for cost basis update logic (average cost method), movement type examples with real data
- `src/db/schema.ts` — `assetMovements`, `holdings` tables

**Key implementation details:**

**`GET /api/assets/:id/movements`:**
- Paginated, filterable by `holdingId`, `type`, `startDate`, `endDate`
- Join `holdings.name` for `holdingName` field
- Order by date DESC (newest first)

**`POST /api/assets/:id/movements` (most complex endpoint):**
Records movement AND updates the affected holding. All in a SQLite transaction.

Side effects by movement type:
| type | holding.quantity | holding.cost_basis | snapshot? |
|---|---|---|---|
| `deposit` | += quantity | += quantity | yes |
| `withdrawal` | += quantity (neg) | proportional reduction | yes |
| `buy` | += quantity | += qty * pricePerUnit | yes |
| `sell` | += quantity (neg) | proportional reduction | yes |
| `dividend` | no change | no change | no |
| `fee` | no change | no change | no |
| `adjustment` | += quantity | no change | yes |

**Buy cost basis:** `holding.cost_basis += movement.quantity * movement.pricePerUnit`

**Sell cost basis (average cost):**
```
sellQuantity = abs(quantity)
proportion = sellQuantity / holding.quantity  // BEFORE updating quantity
holding.cost_basis -= holding.cost_basis * proportion
holding.quantity += quantity  // adds negative
```

**Sell validation:** `abs(quantity)` must be <= `holding.quantity`

**`DELETE /api/movements/:id`:**
- Only most recent movement per holding can be deleted (prevents inconsistency)
- Reverses holding changes (buy deletion: subtract qty, sell deletion: restore pre-sell state)

**Zod schemas:** `createMovementSchema`, `movementQuerySchema`

**Frontend functions:** `getMovements(assetId, params)`, `createMovement(assetId, data)`, `deleteMovement(id)`

**Constraints:**
- Use SQLite transaction (BEGIN/COMMIT) for movement + holding + snapshot consistency
- Reuse `generateAssetSnapshot()` from F4 for snapshot generation
- `pricePerUnit` is required for buy/sell on stock/etf/crypto types
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
See F9 success criteria in the feature specs.

---

### Option B: Parallel with Worktrees (Faster but needs merge)

If using worktrees, Agent 6 and Agent 7 can run simultaneously since they create/modify different primary files. After both complete, merge the worktree branches, resolving any conflicts in `client.ts`, `validation.ts`, and `index.ts` (these will be simple additive conflicts).

---

## Step 4b: Architecture Review Gate (REVIEW — blocks frontend work)

### Agent 10: Architecture Review Agent

**Goal:** Validate that the backend implementation (Steps 1-4) matches the specs and data model. Read-only review — flags issues, does not fix code.

**Depends on:** Step 4 (all backend APIs complete — F1, F2, F3, F4, F5, F6, F9, F11)

**What to validate:**
- Schema in `src/db/schema.ts` matches `docs/net-worth/net-worth-data-model.md` exactly (all 6 tables, columns, types, constraints, FKs)
- API response shapes match `docs/net-worth/net-worth-feature-specs.md` for F4, F5, F6, F9
- Value calculation formulas correct (holding types -> value calc per data model)
- Double-counting prevention: linked assets don't allow ILS cash holdings
- Net worth formula: `total = banks + assets - liabilities`, `liquidTotal` excludes restricted/locked
- Cost basis math: average cost method for sells matches spec exactly
- Snapshot generation triggers on every holding mutation
- Exchange rate integration consistent across all routes (assets, liabilities, net worth)
- SQLite transactions used for movement recording (movement + holding + snapshot atomic)
- Zod validation schemas cover all required/optional fields per spec
- Frontend types in `client.ts` match backend response shapes
- All routes registered in `src/index.ts`
- Error responses follow existing patterns (400 for validation, 404 for not found, 409 for duplicates)

**Files to review:** All files created/modified in Steps 1-4:
- `src/db/schema.ts`
- `src/shared/types.ts`
- `src/scraper/scraper.service.ts`
- `src/services/exchange-rates.ts`
- `src/api/exchange-rates.routes.ts`
- `src/api/assets.routes.ts`
- `src/api/liabilities.routes.ts`
- `src/api/net-worth.routes.ts`
- `src/api/validation.ts`
- `src/db/backfills.ts`
- `src/index.ts`
- `dashboard/src/api/client.ts`

**Reference docs (read-only):**
- `docs/net-worth/net-worth-data-model.md`
- `docs/net-worth/net-worth-feature-specs.md`
- `docs/net-worth/designs/f7-net-worth-page-design.md` (for response shape expectations)

**Output:** List of issues found with severity (critical/warning) and which agent needs to fix them. Example format:
```
[CRITICAL] Agent 5 — holdings value calc missing exchange rate conversion for fund_units type
[WARNING] Agent 6 — net worth response missing `calculatedAt` field per F6 spec
```

**Constraints:**
- This is a READ-ONLY review — do NOT modify any code
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

---

## Step 5: Main UI Page (1 agent)

### Agent 8: F7 + F8 - Net Worth Page + Asset Management UI

**Goal:** Build the main Net Worth page with hero card, charts, asset list, bank balances, liabilities, and all CRUD dialogs.

**Depends on:** Step 4/Agent 6 (F6 - Net Worth API), Step 3 (F4+F5 - CRUD APIs)

**Files to create:**
- `dashboard/src/components/NetWorthPage.vue` — main page component (large file)
- `dashboard/src/lib/net-worth-constants.ts` — asset type colors, liquidity badge styles, label maps

**Files to modify:**
- `dashboard/src/main.ts` — add route `{ path: '/net-worth', ... }`
- `dashboard/src/components/AppLayout.vue` — add sidebar nav item (icon: `TrendingUp`)

**Files to reference (read-only):**
- `docs/net-worth/designs/f7-net-worth-page-design.md` — FULL design spec (hero card, charts, layout, animations)
- `docs/net-worth/designs/f8-asset-management-ui-design.md` — FULL dialog specs (asset, holding, liability dialogs, quick update flow)
- `dashboard/src/components/OverviewDashboard.vue` — pattern for chart setup, card layout, data fetching
- `dashboard/src/components/AccountManager.vue` — pattern for CRUD dialogs, AlertDialog confirmations
- `dashboard/src/composables/useApi.ts` — for data fetching pattern
- `dashboard/src/api/client.ts` — for available API functions
- `dashboard/src/lib/format.ts` — for `formatCurrency()` and date formatting

**Key implementation details:**

**Page structure (from F7 design doc):**
1. Hero Card — total net worth (big number), liquid net worth, vs-last-month change
2. Charts row — allocation doughnut (by asset type) + net worth trend line (12mo)
3. Asset list — expandable rows with inline holdings, hover actions
4. Bank balances — card grid (reuse OverviewDashboard pattern)
5. Liabilities — rows with progress bars

**Charts:**
- Doughnut: one slice per asset type + "Banks" slice, colors from palette
- Line: monthly data from `GET /api/net-worth/history`, purple line with gradient fill
- Register `LineElement`, `PointElement`, `Filler` from chart.js (in addition to existing registrations)

**Dialogs (from F8 design doc):**
- Asset Dialog (create/edit): name, type select, institution, liquidity select, linked account select, notes
- Holding Dialog (create/edit): name, type select, currency, quantity, cost basis, last price (conditional), notes
- Liability Dialog (create/edit): name, type select, currency, original amount, current balance, interest rate, start date, notes
- Delete confirmations: AlertDialog with soft-delete language for assets/liabilities, hard-delete for holdings
- Quick Update Flow: inline editing of holdings quantity/price with Save All

**CRITICAL: reka-ui Select gotcha:**
- NEVER use `value=""` for SelectItem
- Use sentinel values: linked account default = `"none"`, mapped to `null` before API call
- Type/liquidity/liability-type: use actual values, no empty sentinel needed

**Data flow:**
```ts
onMounted(() => {
  netWorth.execute()   // GET /api/net-worth
  history.execute()    // GET /api/net-worth/history
})
// After any CRUD operation: re-fetch netWorth to refresh values
```

**State management:** Dialog refs, editing refs, delete confirmation refs — all in `NetWorthPage.vue`

**Animations:** `animate-fade-in-up` for page, stagger for sections, `max-height` transition for accordion

**Responsive:** Charts stack below 1024px, hero stacks below 768px

**Constraints:**
- Follow the design docs exactly for styling (class names, spacing, colors)
- Start with dialogs inline in NetWorthPage.vue; extract to separate files only if > ~100 lines each
- Use existing shadcn/reka-ui components (Card, Dialog, AlertDialog, Button, Input, Select, Badge, Table)
- Asset type colors exported as constant map for reuse in F10
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
See F7 and F8 success criteria in the feature specs (combined ~25 items).

---

## Step 6: Detail Page UI (1 agent)

### Agent 9: F10 - Asset Detail Page

**Goal:** Dedicated page for a single asset showing performance summary, holdings table, value chart, and movement history.

**Depends on:** Step 4/Agent 7 (F9 - Movements API), Step 3 (F4 - Asset API), Step 5 (F7 - for shared constants)

**Files to create:**
- `dashboard/src/components/AssetDetailPage.vue`

**Files to modify:**
- `dashboard/src/main.ts` — add route `{ path: '/net-worth/assets/:id', ... }`
- `dashboard/src/api/client.ts` — add movement API functions if not already added by Agent 7

**Files to reference (read-only):**
- `docs/net-worth/designs/f10-asset-detail-page-design.md` — FULL design spec
- `dashboard/src/lib/net-worth-constants.ts` — asset type colors (created in Step 5)
- `dashboard/src/components/NetWorthPage.vue` — for holding dialog/update patterns to reuse
- `dashboard/src/api/client.ts` — for available API functions
- `dashboard/src/composables/useApi.ts` — data fetching pattern

**Key implementation details:**

**Data fetching (3 parallel calls on mount):**
```ts
const asset = useApi(() => getAsset(assetId))       // GET /api/assets/:id
const movements = useApi(() => getMovements(assetId)) // GET /api/assets/:id/movements
const snapshots = useApi(() => getAssetSnapshots(assetId)) // GET /api/assets/:id/snapshots
```

**Page sections (from F10 design doc):**
1. Back navigation — text button to `/net-worth`
2. Asset header — name, type badge (colored), institution, liquidity badge
3. Performance summary cards — Current Value, Total Invested, Total Return (3-col grid)
4. Holdings table — shadcn Table with columns: Name, Type, Qty, Price, Value, Cost Basis, P&L, Actions
5. Value over time chart — line chart from snapshots, colored by asset type
6. Movement history — card-based list (newest first) with type badges, pagination ("Load More")
7. Movement dialog — form for recording new movements (date, type, holding, quantity, currency, price, source amount, notes)

**Performance calculation:**
- Value: sum of holdings' `currentValueIls`
- Invested: sum of deposit/buy movements' `sourceAmount` (convert non-ILS at current rates)
- Return: value - invested, percentage

**Holdings table P&L colors:** green (`text-success`) for positive, red (`text-destructive`) for negative

**Movement type badge colors:**
- deposit=green, withdrawal=red, buy=purple, sell=amber, dividend=cyan, fee=gray, adjustment=indigo

**Chart:** Line chart using asset type color (from palette), gradient fill, same options as NW trend chart

**Movement dialog:** conditional fields (pricePerUnit only for buy/sell on stock/etf/crypto), holding select auto-fills currency, sell validation (max = holding quantity)

**Responsive:** 3-col cards → 2-col → stacked. Table hides Cost Basis + Type columns on mobile.

**Constraints:**
- Reuse holding/movement dialogs patterns from F8 (don't reinvent)
- Use `net-worth-constants.ts` for colors and labels
- Movement dialog: holding select default = `"none"` sentinel (not empty string)
- "Load More" pagination: track offset, append to existing list
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

**Success criteria:**
See F10 success criteria in the feature specs.

---

## Step 6b: UX Review Gate (REVIEW — blocks integration testing)

### Agent 11: UX Review Agent

**Goal:** Validate that the frontend implementation (Steps 5-6) matches the three design docs. Read-only review — flags issues, does not fix code.

**Depends on:** Step 6 (all frontend complete — F7, F8, F10)

**What to validate:**

**`NetWorthPage.vue` vs `docs/net-worth/designs/f7-net-worth-page-design.md`:**
- Hero card layout, styling classes, typography
- Doughnut chart config (cutout, legend, tooltip, center text)
- Line chart config (gradient fill, tension, point styles, axis formatting)
- Asset list row structure (color dot, metadata line, value, percentage, expand/collapse)
- Bank balances grid pattern (matches OverviewDashboard)
- Liability rows with progress bars
- Animations and stagger timing
- Responsive breakpoints (1024, 768, 640)
- Empty states and loading states (skeletons)

**Asset/Holding/Liability dialogs vs `docs/net-worth/designs/f8-asset-management-ui-design.md`:**
- All form fields present with correct components (Input vs Select vs Textarea)
- Select sentinel values (NEVER empty string — use "none" for linked account)
- Conditional field visibility (lastPrice only for stock/etf/crypto)
- Double-counting warning for ILS cash on linked assets
- Delete confirmations use correct language ("Hide Asset" vs "Delete Holding")
- Quick update flow: inline editing, per-row status indicators, Save All
- Validation display pattern (inline errors, timing)

**`AssetDetailPage.vue` vs `docs/net-worth/designs/f10-asset-detail-page-design.md`:**
- Back navigation pattern
- Performance summary cards (3-col grid)
- Holdings table columns and P&L styling
- Value over time chart (asset-type colored line)
- Movement history list with type badges and colors
- Movement dialog fields and conditional logic
- Responsive degradation (table -> card list on mobile)
- Loading and error states

**General patterns:**
- Uses existing shadcn/reka-ui components consistently
- Chart.js registration includes all needed elements
- Asset type color palette used consistently from `net-worth-constants.ts`
- Liquidity badge styles consistent
- `formatCurrency()` and date formatting from existing utils
- Navigation: sidebar item added, routes registered, asset rows link to detail page

**Files to review:**
- `dashboard/src/components/NetWorthPage.vue`
- `dashboard/src/components/AssetDetailPage.vue`
- `dashboard/src/lib/net-worth-constants.ts`
- `dashboard/src/main.ts`
- `dashboard/src/components/AppLayout.vue`

**Reference docs (read-only):**
- `docs/net-worth/designs/f7-net-worth-page-design.md`
- `docs/net-worth/designs/f8-asset-management-ui-design.md`
- `docs/net-worth/designs/f10-asset-detail-page-design.md`

**Output:** List of issues found with severity (critical/warning) and which agent needs to fix them. Example format:
```
[CRITICAL] Agent 8 — doughnut chart missing center text plugin per F7 design
[WARNING] Agent 9 — movement type badge colors don't match F10 spec (fee should be gray, not slate)
```

**Constraints:**
- This is a READ-ONLY review — do NOT modify any code
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

---

## Step 7: Integration Testing (FINAL VALIDATION)

### Agent 12: Integration Agent

**Goal:** Verify the full end-to-end flow works by actually running the app and testing API calls against the dev server.

**Depends on:** Steps 4b and 6b (all review fixes applied)

**What to test (using curl/fetch against running dev server):**

**1. Setup flow:**
- Verify backfill ran (7 assets + 1 liability exist)
- `GET /api/exchange-rates` returns rates
- `GET /api/assets` returns seeded assets (no holdings yet)
- `GET /api/liabilities` returns Poalim Loan with computed balance

**2. Asset management flow:**
- `POST /api/assets` — create a test asset
- `POST /api/assets/:id/holdings` — add a stock holding (TSLA, qty=10, price=$300)
- `POST /api/assets/:id/holdings` — add a cash holding (USD, qty=5000)
- Verify `GET /api/assets/:id` returns computed ILS values
- Verify snapshot was auto-generated in `asset_snapshots`
- `PUT /api/holdings/:id` — update price to $350
- Verify snapshot updated with new value

**3. Double-counting guard:**
- For an asset with `linkedAccountId`, try `POST /api/assets/:id/holdings` with `currency: "ILS"`, `type: "cash"` — expect 400

**4. Movement flow:**
- `POST /api/assets/:id/movements` — record a buy (20 shares @ $180)
- Verify holding quantity and cost_basis updated
- `POST /api/assets/:id/movements` — record a sell (5 shares @ $250)
- Verify cost_basis reduced proportionally (average cost method)
- Verify sell of more than owned quantity returns 400

**5. Net worth calculation:**
- `GET /api/net-worth` — verify total = banks + assets - liabilities
- Verify `liquidTotal` excludes locked/restricted assets
- Verify exchange rates included in response

**6. History:**
- `GET /api/net-worth/history` — verify returns series (may be sparse initially)
- `GET /api/assets/:id/snapshots` — verify snapshots exist after holding updates

**7. Cleanup:** Delete test asset created in step 2

**Output:** Pass/fail for each test with actual vs expected values for failures. Example format:
```
[PASS] Setup: GET /api/assets returns 7 seeded assets
[FAIL] Movement: sell cost basis — expected 2400, got 3000 (proportional reduction not applied)
[PASS] Double-counting: ILS cash on linked asset correctly returns 400
```

**Constraints:**
- Start the dev server with `npm run dev` before testing
- Wait for server to be ready before issuing requests
- Clean up test data after tests complete
- Before finishing: run `/simplify` on your changes (see Completion Protocol above)

---

## Execution Summary

```
Step 1:  [Agent 1: F1 Schema]                                    SEQUENTIAL
              |
Step 2:  [Agent 2: F2]  [Agent 3: F3]  [Agent 4: F11]           PARALLEL (3)
              |              |
Step 3:  [Agent 5: F4+F5 CRUD]                                   SEQUENTIAL
              |
Step 4:  [Agent 6: F6 NW API] → [Agent 7: F9 Movements]         SEQUENTIAL*
              |
Step 4b: [Agent 10: Architecture Review]                          REVIEW GATE
              |
Step 5:  [Agent 8: F7+F8 NW UI]                                  SEQUENTIAL
              |
Step 6:  [Agent 9: F10 Detail UI]                                 SEQUENTIAL
              |
Step 6b: [Agent 11: UX Review]                                    REVIEW GATE
              |
Step 7:  [Agent 12: Integration]                                  FINAL VALIDATION
```

*Step 4 agents can run in parallel with worktrees if desired (see Option B).

**Total: 12 agents across 7 steps + 2 review gates (9 implementation + 3 review/validation)**

### Parallel Execution Opportunities

| Step | Agents | Parallelism | Why |
|---|---|---|---|
| 1 | 1 | None | Everything depends on schema |
| 2 | 3 | Full parallel | Zero file conflicts |
| 3 | 1 | None | Shared files (validation.ts, index.ts, client.ts) |
| 4 | 2 | Possible with worktrees | Different primary files, shared client.ts/index.ts |
| 4b | 1 | None | Review gate — must complete before frontend work |
| 5 | 1 | None | Single complex UI page |
| 6 | 1 | None | Single page, depends on Step 5 constants |
| 6b | 1 | None | Review gate — must complete before integration |
| 7 | 1 | None | Final validation — runs against full stack |

### Integration Checkpoints

After each step, verify:
1. **Step 1:** `npm run dev` starts, tables exist
2. **Step 2:** Scraper records balance history, exchange rates API works, backfill runs
3. **Step 3:** All CRUD endpoints return correct data, snapshots auto-generate
4. **Step 4:** Net worth calculation correct, movements update holdings correctly
5. **Step 4b:** Architecture Review Agent validates backend against specs — all critical issues resolved before proceeding
6. **Step 5:** Net worth page renders with real data, all dialogs work
7. **Step 6:** Asset detail page shows holdings, movements, charts
8. **Step 6b:** UX Review Agent validates frontend against design docs — all critical issues resolved before proceeding
9. **Step 7:** Integration Agent runs full end-to-end tests — all API flows pass, calculations verified with real data

### Risk Areas

| Risk | Mitigation |
|---|---|
| Exchange rate API downtime | Stale cache fallback + graceful error handling |
| reka-ui Select empty string bug | Sentinel values documented in every agent prompt |
| Drizzle migration conflicts | Never hand-write migrations, always use `db:generate` |
| Cost basis math errors (F9) | Test with known values from data model examples |
| Timezone bugs | Always use `toIsraelDateStr()` for dates |
| Large NetWorthPage.vue | Extract dialogs to separate files if > ~100 lines each |
