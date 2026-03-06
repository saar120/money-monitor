# Net Worth & Asset Tracking — Data Model

## Problem Statement

The app currently tracks bank account balances and credit card transactions via scrapers. But a large portion of wealth is invisible:

- **Brokerage investments** (stocks, כספית, matach/USD cash) — the scraper only returns ILS cash balance, not portfolio holdings
- **External investments** (Excelence, pension, קרן השתלמות, crypto, funds, real estate) — not scraped at all
- **Internal transfers** (Poalim → OneZero) are correctly ignored from spending, but there's no visibility into how much is being saved/invested
- **Liabilities** (loans) — a ₪40k loan exists with ₪1k/mo repayments, not reflected in net worth

### The OneZero Hybrid Problem

OneZero is both a bank account AND a brokerage. The scraped balance (`accounts.balance`) is **ILS cash only**. Everything else is invisible:

- USD cash (מטח) — built from `ILS/רכישת מטח` conversions
- Stock positions (TSLA, NFLX, etc.) — buy/sell transactions appear in ILS, USD details lost
- כספית — money market fund positions

When ₪249,260 was converted to USD (Mar–Apr 2025), that money vanished from the app's perspective. Stock purchases appear as ILS amounts with no share count or USD price.

### Current Transaction Patterns (from actual data)

| Pattern | Example | Current handling |
|---|---|---|
| Salary | `משכורת \|+₪23,362` | category: `income` |
| Bank → OneZero transfer | `העב' לאחר-נייד \|-₪26,500` | category: `transfer`, ignored |
| Buy כספית | `קניה/ כספית שקלית \|-₪50,013` | category: `savings`, ignored |
| Sell כספית | `מכירה/ כספית שקלית \|+₪50,943` | category: `savings`, ignored |
| ILS → USD conversion | `ILS/רכישת מטח \|-₪200,000` | category: `transfer`, ignored |
| Stock purchase | `טלפון ני/TESLA/קניה \|-₪6,931` | category: `savings`, ignored |
| Stock tax | `TSLA - מס ני"ע חיוב מס \|-₪1,267` | category: `other` |
| Recurring fund | `אנליסט קופ"ג \|-₪500` | category: `savings`, ignored |
| Credit card payment | `חיוב מ-דיינרס \|-₪8,076` | category: `credit-card-payments`, ignored |
| Loan disbursement | `הלואה קרן/כללי \|+₪40,000` | category: `loans` |
| Loan repayment | `הו"ק הלואה קרן \|-₪1,000` | category: `loans` |

---

## Schema Design

### Table 1: `assets`

Container for an investment account or standalone asset.

```sql
CREATE TABLE assets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,        -- brokerage | pension | keren_hishtalmut | crypto | fund | real_estate
  institution       TEXT,                 -- oneZero | excelence | analyst | ...
  liquidity         TEXT NOT NULL DEFAULT 'liquid',  -- liquid | restricted | locked
  linked_account_id INTEGER REFERENCES accounts(id), -- links to scraped bank account (prevents ILS cash double-counting)
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`liquidity` values:**

| Value | Meaning | Examples |
|---|---|---|
| `liquid` | Accessible anytime | Brokerage accounts, crypto |
| `restricted` | Accessible with penalties or conditions | קופ"ג before maturity |
| `locked` | Cannot access until maturity | Pension (until retirement), קרן השתלמות (6-year lock) |

**`linked_account_id`:** When an asset is linked to a scraped bank account, the bank's `accounts.balance` already tracks the ILS cash for that institution. The system should prevent adding ILS Cash holdings to linked assets to avoid double-counting.

**Seed data:**

| name | type | institution | liquidity | linked_account_id |
|---|---|---|---|---|
| OneZero Portfolio | brokerage | oneZero | liquid | → OneZero (accounts.id=4) |
| Excelence | brokerage | excelence | liquid | NULL |
| Pension | pension | | locked | NULL |
| קרן השתלמות | keren_hishtalmut | | locked | NULL |
| Bitcoin | crypto | | liquid | NULL |
| Analyst Fund | fund | analyst | restricted | NULL |
| US Real Estate | real_estate | | restricted | NULL |

### Table 2: `holdings`

Individual positions within an asset. Simple assets have 1 holding. Portfolios have many.

```sql
CREATE TABLE holdings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id        INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,         -- "TSLA", "USD Cash", "כספית שקלית", "Balance"
  type            TEXT NOT NULL,         -- stock | etf | cash | fund_units | crypto | balance
  currency        TEXT NOT NULL,         -- USD | ILS | BTC
  quantity        REAL NOT NULL DEFAULT 0,
  cost_basis      REAL NOT NULL DEFAULT 0,  -- running total in holding's own currency (see note on crypto)
  last_price      REAL,                  -- current market price per unit (for stock/crypto; NULL for cash/balance)
  last_price_date TEXT,                  -- when last_price was last updated
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset_id, name)
);
```

**How `type` determines value calculation:**

| type | quantity means | current value = | last_price used? |
|---|---|---|---|
| `stock` / `etf` | shares | quantity x last_price | Yes |
| `cash` | monetary amount | quantity | No |
| `fund_units` | monetary value | quantity | No |
| `crypto` | coins | quantity x last_price | Yes |
| `balance` | monetary value | quantity | No |

**Example — OneZero Portfolio (asset_id=1, linked to OneZero bank account):**

| name | type | currency | quantity | cost_basis | last_price |
|---|---|---|---|---|---|
| TSLA | stock | USD | 15 | 2800.00 | 350.00 |
| NFLX | stock | USD | 8 | 4200.00 | 950.00 |
| כספית שקלית | fund_units | ILS | 120000 | 119500.00 | NULL |
| USD Cash (מטח) | cash | USD | 12000 | 12000.00 | NULL |

Note: No "ILS Cash" holding here — that's the OneZero bank balance (₪60,712), tracked via `linked_account_id`.

**Example — Simple assets:**

| asset | name | type | currency | quantity | last_price |
|---|---|---|---|---|---|
| Pension | Balance | balance | ILS | 85000 | NULL |
| Bitcoin | BTC | crypto | BTC | 0.5 | 95000.00 |
| Analyst Fund | Balance | balance | ILS | 5500 | NULL |
| US Real Estate | Balance | balance | USD | 20000 | NULL |

### Table 3: `asset_movements`

Log of money/asset movements. Tracks deposits, withdrawals, buys, sells for cost basis and ROI calculation. This is the **source of truth** for "how much did I originally invest."

```sql
CREATE TABLE asset_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id         INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  holding_id       INTEGER REFERENCES holdings(id) ON DELETE SET NULL,
  date             TEXT NOT NULL,          -- YYYY-MM-DD
  type             TEXT NOT NULL,          -- deposit | withdrawal | buy | sell | dividend | fee | adjustment
  quantity         REAL NOT NULL,          -- positive = in, negative = out
  currency         TEXT NOT NULL,          -- native currency of the holding
  price_per_unit   REAL,                   -- for stock buy/sell: price per share
  source_amount    REAL,                   -- what was paid in source currency
  source_currency  TEXT,                   -- where the money came from (ILS, USD, etc.)
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Movement types:**

| type | use case | quantity sign |
|---|---|---|
| `deposit` | new money entering an asset | positive |
| `withdrawal` | money leaving an asset | negative |
| `buy` | purchasing shares/units within an asset | positive |
| `sell` | selling shares/units within an asset | negative |
| `dividend` | income received from a holding | positive |
| `fee` | taxes, commissions, management fees | 0 (cost tracked in source_amount) |
| `adjustment` | corrections, stock splits, reclassifications | +/- |

**Example — TSLA investment history:**

| date | type | qty | currency | price/unit | source_amount | source_currency | notes |
|---|---|---|---|---|---|---|---|
| 2025-03-18 | buy | 20 | USD | 180.00 | 13,100 | ILS | first purchase |
| 2025-07-08 | buy | 5 | USD | 240.00 | 6,931 | ILS | added more |
| 2025-12-17 | fee | 0 | USD | | 1,267.92 | ILS | מס ני"ע |

From this:
- **Total invested (USD):** 20x$180 + 5x$240 = **$4,800**
- **Total cost (ILS):** ₪13,100 + ₪6,931 = **₪20,031**
- **Current value:** 25 shares x $350 = **$8,750** → **₪31,937** (at 3.65)
- **ROI (USD):** 82.3% | **ROI (ILS):** 59.4%

**Example — Matach (USD Cash) movements:**

| date | type | qty | currency | source_amount | source_currency | notes |
|---|---|---|---|---|---|---|
| 2025-03-06 | deposit | 54,795 | USD | 200,000 | ILS | רכישת מטח |
| 2025-03-18 | deposit | 8,000 | USD | 29,260 | ILS | רכישת מטח |
| 2025-03-18 | withdrawal | -3,600 | USD | | | → bought TSLA (internal) |
| 2025-04-07 | deposit | 5,500 | USD | 20,000 | ILS | רכישת מטח |

### Table 4: `asset_snapshots`

Periodic snapshots of total asset value for net worth history. **Auto-generated** whenever holdings are updated for an asset. `UNIQUE(asset_id, date)` means updating twice in one day overwrites the previous snapshot for that day.

```sql
CREATE TABLE asset_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id          INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  holdings_snapshot TEXT,              -- JSON: [{name, quantity, currency, price}]
  total_value_ils   REAL NOT NULL,     -- computed total in ILS at snapshot time
  exchange_rates    TEXT,              -- JSON: {USD: 3.65, BTC: 347125} rates used
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset_id, date)
);
```

Snapshots are normalized to ILS because portfolios are multi-currency. The `exchange_rates` JSON preserves the rates used so snapshots are auditable and reproducible.

### Table 5: `account_balance_history`

Historical bank account balances. Currently the scraper overwrites `accounts.balance` on every run — this table preserves history for net worth over time.

```sql
CREATE TABLE account_balance_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  date        TEXT NOT NULL,
  balance     REAL NOT NULL,
  UNIQUE(account_id, date)
);
```

Auto-populated by the scraper whenever it updates a balance. One row per account per day. Uses `INSERT OR REPLACE` so multiple scrapes in one day keep the latest value.

### Table 6: `liabilities`

Debts and obligations. Required for accurate net worth (Net Worth = Assets − Liabilities).

```sql
CREATE TABLE liabilities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL,        -- loan | mortgage | credit_line | other
  currency         TEXT NOT NULL DEFAULT 'ILS',
  original_amount  REAL NOT NULL,        -- original loan amount
  current_balance  REAL NOT NULL,        -- remaining balance (updated over time)
  interest_rate    REAL,                 -- annual rate, for reference
  start_date       TEXT,
  notes            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Current known liabilities:**

| name | type | original_amount | current_balance | notes |
|---|---|---|---|---|
| Poalim Loan | loan | 40,000 | ~32,000 | Taken Jul '25, ₪1k/mo repayments |

Credit card balances are transient (paid monthly) and already visible through the scraper — they don't need to be modeled as liabilities unless there's revolving debt.

---

## Net Worth Calculation

```
Net Worth =

  Bank Accounts (auto, from accounts.balance):
    + Poalim ILS cash
    + OneZero ILS cash          ← ONLY the ILS cash (linked_account_id prevents double-counting)

  + Investment Assets (manual, from holdings):
    OneZero Portfolio:
      TSLA:     quantity x last_price x USD/ILS rate
      NFLX:     quantity x last_price x USD/ILS rate
      כספית:    quantity (ILS, no conversion needed)
      USD Cash: quantity x USD/ILS rate
    + Excelence holdings (same pattern)
    + Pension balance (ILS)
    + קרן השתלמות balance (ILS)
    + Bitcoin:  quantity x last_price x BTC/ILS rate
    + Analyst Fund balance (ILS)
    + US Real Estate balance x USD/ILS rate

  − Liabilities:
    − Poalim Loan current_balance

  ═══════════════════════════════════════
  = TOTAL NET WORTH
```

**Liquid Net Worth** = same calculation but only include assets where `liquidity = 'liquid'`.

**No double counting:** For assets with `linked_account_id` set, the bank's `accounts.balance` tracks ILS cash. The asset's holdings track everything else (matach, stocks, funds). The system should prevent adding ILS Cash holdings to linked assets.

**Historical net worth** at any date:
- `Σ(latest account_balance_history per bank on or before date)`
- `+ Σ(latest asset_snapshot.total_value_ils per asset on or before date)`
- `− Σ(liability current_balance as of that date)` (requires liability balance history — see Future Considerations)

---

## Design Decisions

### Holdings `cost_basis` vs Movements `source_amount`

- `cost_basis` on holdings = running total in the holding's native currency. Denormalized convenience cache, updated on each buy/sell.
- `source_amount` on movements = what was actually paid in the source currency each time.
- Movements are the **source of truth** for ROI. cost_basis is derived.

### Cost basis update logic (average cost method)

**On buy:**
1. Insert movement
2. `holding.quantity += bought_quantity`
3. `holding.cost_basis += cost_in_native_currency`

**On sell:**
1. `proportion = sold_quantity / holding.quantity`
2. `holding.cost_basis -= holding.cost_basis x proportion`
3. `holding.quantity -= sold_quantity`
4. Insert movement (realized gain = sell proceeds − proportional cost basis)

### Simple assets: distinguishing deposits from growth

When pension updates from ₪80k to ₪85k, was that a deposit or market growth? The UI should ask:
- **New deposit:** record a movement (type: `deposit`, quantity: deposit amount). Then update holding.
- **Market growth:** just update the holding quantity. No movement needed.

Growth = current value − Σ(deposit movements). This only works if deposits are consistently recorded.

### Crypto cost_basis

`cost_basis` in BTC on a Bitcoin holding is meaningless (0.5 BTC costs 0.5 BTC). For crypto, the `cost_basis` field on the holding is skipped. ROI is computed entirely from movements: "bought 0.5 BTC, source_amount=₪15,000 ILS."

### Multi-currency

All holdings stored in native currency (USD stocks in USD, BTC in BTC, ILS funds in ILS). Conversion to ILS happens at display time using live exchange rates. Snapshots capture the rates used at snapshot time for auditability.

### Snapshot lifecycle

Snapshots are **auto-generated** whenever holdings for an asset are updated. The `UNIQUE(asset_id, date)` constraint means multiple updates on the same day produce one snapshot (latest wins, using `INSERT OR REPLACE`). This gives natural monthly granularity for monthly updaters without requiring manual "take snapshot" actions.

### Stock prices — manual now, live later

For now, user updates `last_price` on holdings when reviewing their portfolio. The schema supports auto-fetching prices later (Yahoo Finance API, etc.) without changes — just update `last_price` and `last_price_date` programmatically.

---

## Future Considerations (not in scope now)

- **Layer 3: Smart transaction linking** — auto-detect bank transactions that correspond to asset movements (e.g., `קניה/ כספית שקלית` → auto-record a buy movement on OneZero Portfolio). Add `transaction_id` FK to `asset_movements`.
- **Live stock/crypto prices** — fetch current prices via API to auto-update `holdings.last_price`.
- **Savings rate calculation** — `(Income - Real Expenses) / Income`, using category data to distinguish real expenses from transfers/investments.
- **Liability balance history** — track `current_balance` over time for historical net worth accuracy. Could auto-detect repayments from bank transactions (e.g., `הו"ק הלואה קרן|-₪1,000`).
- **Realized gains tracking** — data exists in sell movements, but no dedicated reporting yet. Useful for tax purposes.
- **Related movement linking** — connect paired movements (e.g., matach withdrawal ↔ TSLA buy) via a `related_movement_id` FK. Notes field is sufficient for now.
- **Recurring investment detection** — auto-detect patterns like `אנליסט קופ"ג|-₪500` monthly and auto-create movements.
