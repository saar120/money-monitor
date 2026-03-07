# Simplify Asset System — Design Doc

## Problem

The current asset system forces every asset type through a single complex pipeline: `asset -> holdings -> movements -> snapshots`. This creates:

- Unnecessary complexity for simple assets (pension, real estate)
- Currency mixing bugs in P&L calculations (costBasis in native currency displayed as ILS)
- A confusing UX where pension users see 7 movement types and stock-oriented fields
- A developer experience that's hard to navigate (snapshot replay, holding state mutations, dual-currency conversions)

## Approach

**Type-aware UI on the same tables.** Keep the existing `assets`, `holdings`, `assetMovements`, `assetSnapshots` tables but make the API and frontend render different experiences per asset type category. Only brokerage uses the full complexity.

## Asset Type Categories

### Category 1: Simple Value — Pension, Keren Hishtalmut, Fund

**Model:**
- Auto-create a single `balance` holding when the asset is created (hidden from user)
- `holding.quantity` = current value (ILS)
- `holding.costBasis` = total contributed (ILS)
- P&L = current value - total contributed

**User actions:**
- **Update Value** — set the new current value; optionally record how much was contributed this period
- Updates write a snapshot (just the total) and optionally a `contribution` movement

**Movement types:** `contribution` (new type)

**Snapshots:** stored on each value update, no replay needed

### Category 2: Real Estate

**Model:**
- Auto-create a single `balance` holding (hidden from user)
- `holding.quantity` = current property value (ILS)
- `holding.costBasis` = purchase price (ILS)
- Rent income logged as `rent_income` movements
- P&L = (current value + total rent earned) - purchase price

**User actions:**
- **Update Value** — set new property value estimate
- **Record Rent** — log a rent payment received (amount + date)

**Movement types:** `rent_income` (new type)

**Snapshots:** stored on each value update, no replay needed

### Category 3: Crypto Wallet

**Model:**
- Multiple coin holdings per wallet (BTC, ETH, etc.)
- Each holding: `quantity` (coins), `costBasis` (ILS — what you paid), `currency` (coin symbol)
- P&L per coin = (quantity x current price in ILS) - costBasis (ILS)

**User actions:**
- **Add Coin** — name, quantity, ILS cost
- **Buy** — quantity purchased + ILS cost -> increases quantity and costBasis
- **Sell** — quantity sold + ILS received -> decreases quantity, proportionally reduces costBasis
- **Update Price** — set current price per coin (or auto-fetch via exchange rate service)

**Movement types:** `buy`, `sell`

**costBasis is always ILS** — no currency mixing possible

**Snapshots:** store total wallet value periodically (on any update), no replay

### Category 4: Brokerage

**Model:**
- Cash balance holding (in account's native currency, e.g. USD) + stock/ETF holdings
- Stock costBasis in native currency (USD)
- ILS cost tracked at the deposit level (sourceAmount on deposit movements)

**User actions:**
- **Deposit** — "added $2,700, paid 10K ILS" -> increases cash balance, records ILS cost
- **Withdraw** — decreases cash balance
- **Buy Stock** — decreases cash, creates/updates stock holding
- **Sell Stock** — increases cash, reduces stock holding proportionally
- **Dividend** — increases cash balance

**Movement types:** `deposit`, `withdrawal`, `buy`, `sell`, `dividend`

Dropped from current: `fee`, `adjustment`

**P&L:**
- Per-stock: native currency only (qty x price - costBasis, both in USD)
- Account-level ILS: (total value in ILS) - (sum of ILS deposited across all deposits)

**Snapshots:** full movement replay (existing system), only for this category

## What Changes

### Database
- Add `contribution` and `rent_income` to `MOVEMENT_TYPES`
- Remove `fee` and `adjustment` from `MOVEMENT_TYPES` (migration: re-type existing ones as `deposit` adjustments or delete)
- No new tables

### API
- New endpoint: `PUT /api/assets/:id/value` — simplified value update for simple-value types
  - Sets holding quantity (= new value)
  - Optionally records a contribution/rent_income movement
  - Creates a snapshot
- Existing endpoints remain but are gated by asset type validation (e.g. reject `buy` movement on a pension)
- Fix P&L computation: per-stock P&L only in native currency, ILS P&L at account level for brokerage
- Remove costBasisIls/gainLossIls fields added in the bugfix attempt (the currency mixing approach is dropped)

### Frontend
- `AssetDetailPage.vue` checks `asset.type` and renders one of 4 UIs:
  - **Simple Value UI** (pension/KH/fund): value card, contribution history, "Update Value" button
  - **Real Estate UI**: value card, purchase price, rent log, "Update Value" / "Record Rent" buttons
  - **Crypto UI**: coin list with buy/sell history per coin, "Add Coin" button
  - **Brokerage UI**: cash balance + stock table + full movement history (current UI, cleaned up)
- `NetWorthPage.vue` asset creation dialog: type selection drives which fields appear
- Holdings table only visible for crypto and brokerage types

### Net Worth Aggregation
- No change — still sums `currentValueIls` across all holdings regardless of type

## What Stays the Same
- Database tables structure (assets, holdings, assetMovements, assetSnapshots)
- Exchange rate service
- Net worth calculation
- Snapshot storage format

## Summary Table

| | Pension / KH / Fund | Real Estate | Crypto Wallet | Brokerage |
|---|---|---|---|---|
| Holdings | 1 auto "balance" (hidden) | 1 auto "balance" (hidden) | Multiple coins | Cash + stocks |
| User actions | Update Value (+contribution) | Update Value, Record Rent | Add Coin, Buy, Sell, Update Price | Deposit, Withdraw, Buy, Sell, Dividend, Update Prices |
| costBasis currency | ILS | ILS | ILS | Native (USD) |
| P&L | value - contributions | (value + rent) - purchase price | per-coin ILS | per-stock native; account-level ILS |
| Snapshots | On update (simple) | On update (simple) | On update (simple) | Movement replay |
