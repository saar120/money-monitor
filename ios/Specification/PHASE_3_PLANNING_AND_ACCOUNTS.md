# Phase 3 — Planning, wealth, accounts, and sync history

## Outcome

The owner can understand budgets, net worth, assets, liabilities, account balances/freshness, and recent Mac sync outcomes from one coherent live or saved read model.

Delivery checkpoint: **recommended private read-only MVP**  
Phase status: **product policy accepted under D-023; implementation planned**
Depends on: **Phase 2 DTO/repository, formatting, navigation, and state patterns**

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P3-01 | Must | As a budget-conscious user, I want total and individual budget progress, remaining amount, pace, and over-budget state so that I can decide whether spending is on track. |
| US-P3-02 | Must | As a wealth tracker, I want net worth, assets, liabilities, movement, trend, and allocation calculated at one point in time. |
| US-P3-03 | Must | As an asset owner, I want value history, liquidity, linked liability, and net equity without editing the authoritative record. |
| US-P3-04 | Must | As an account owner, I want balances, masked identifiers, freshness, and recent activity without exposing credential or scraper configuration. |
| US-P3-05 | Must | As a user diagnosing freshness, I want safe sync history translated into completed, running, attention-needed, cancelled, and failed states. |
| US-P3-06 | Must | As an offline user, I want all planning/account screens from the coherent saved snapshot. |
| US-P3-07 | Should | As a user with historical data, I want selectable periods without mixing labels, conversion rates, or timestamps. |
| US-P3-08 | Must | As a VoiceOver user, I want an equivalent textual and spoken interpretation of every chart. |

## Screen scope

- [Plan](../../docs/ios-mockups/rendered/screens/plan.png)
- [Budget detail](../../docs/ios-mockups/rendered/screens/budget-detail.png)
- [Net Worth](../../docs/ios-mockups/rendered/screens/net-worth.png)
- [Asset detail](../../docs/ios-mockups/rendered/screens/asset-detail.png)
- [Accounts](../../docs/ios-mockups/rendered/screens/accounts.png)
- [Account detail](../../docs/ios-mockups/rendered/screens/account-detail.png)
- [Sync history](../../docs/ios-mockups/rendered/screens/sync-history.png)

Budget Edit, asset Edit, account administration, and “Sync now” are not Phase 3 read behavior. Hide those affordances until the relevant Phase 4 command is approved.

## Contract requirements

### Budget read model

- list and detail/progress use one normalized envelope;
- support existing monthly/yearly category budgets; budget period, limit, spent, remaining/overspend, pace, included categories, and calculation time are explicit;
- current and comparison period semantics are frozen in fixtures;
- current periods end today and completed periods use the full month/year;
- exactly at limit is distinct from over; positive credits do not reduce v1 budget spend;
- overlapping budgets remain independent and are never summed into one total-remaining claim.

### Wealth read model

- current net worth and historical series use ILS base currency and declare calculation time;
- assets, liabilities, banks/liquid total, allocation, and movement reconcile;
- source-currency values and exchange-rate timestamp remain available in detail;
- ranges are 3M/6M/1Y/All with 1Y default; server-selected granularity is explicit and zero/one/negative series are valid;
- rates older than 72 hours are labeled stale, missing rates make aggregates partial rather than zero, and current-rate historical values are labeled Estimated.

### Account read model

Existing `GET /api/accounts` is not safe for reuse: it remains database-shaped and may expose unmasked `accountNumber` plus configuration flags. Mobile DTOs identify an account by institution, safe type/display name, and server-masked last four characters. Bank accounts may expose Balance; credit cards expose identity/freshness only until the Mac has a trustworthy amount-due model.

### Sync-history read model

Do not expose raw scrape sessions/logs. A translation service maps internal events to safe public states:

```text
neverRun | queued | running | completed | partial | attentionNeeded | cancelled | failed
```

Messages may say that the Mac needs attention, but the first read-only release never requests bank credentials, OTP, selectors, browser actions, or manual-login input on iPhone.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P3-PRD-01 | Product + finance logic | Done — accepted under D-023 | Monthly/yearly budget behavior, overlapping-budget limits, 3M/6M/1Y/All wealth ranges, ILS/mixed-currency disclosure, rate age, account masking/wording, and public sync taxonomy are locked in fixtures and copy. |
| P3-API-01 | Shared API | Planned | Define budget list/detail/progress DTOs with period, comparison, pace, categories, recent activity, and `calculatedAt`; validate identical server/Swift fixtures. |
| P3-API-02 | Shared API + backend | Planned | Define/implement current and historical net-worth DTOs with base currency, source context, range/granularity, allocation, rate timestamp, and one calculation point. |
| P3-API-03 | Backend | Planned | Add safe asset list/detail/history DTOs with accepted liquidity, linked liability, and net equity fields. Exclude notes/internal linked IDs and all edit data unless explicitly required. |
| P3-API-04 | Backend | Planned | Add safe account list/detail DTOs with server-masked identifier, institution label, balance/due semantics, freshness, and recent activity. Never adapt the current account row wholesale. |
| P3-API-05 | Backend services | Planned | Create sync translation service from raw scrape sessions/logs to stable public states and localizable safe codes. Remove provider errors, selectors, filesystem paths, secrets, and operational internals. |
| P3-API-06 | Backend | Planned | Add cursor-paginated mobile sync history and safe summary. Account/all scope and running/attention states are explicit; no OTP/manual-confirm endpoint is authorized. |
| P3-API-07 | Backend | Planned | Extend bootstrap/snapshot manifest so budget, wealth, account, and sync summaries declare the same snapshot ID/calculation time or explicitly identify independent freshness. |
| P3-DAT-01 | iOS data | Planned | Extend encrypted snapshot/repositories for Phase 3 DTOs and migrations. Period changes can fetch detail/history without corrupting the coherent base snapshot. |
| P3-IOS-01 | iOS Plan | Planned | Build Plan overview and budget/net-worth entry points without duplicate refreshes. Selected period and navigation state persist through detail/retry. |
| P3-IOS-02 | iOS budgets | Planned | Build Budget detail with limit, spent, remaining/over, pace projection, included categories, recent transactions, freshness, and exactly-at/over/no-data states. No edit affordance. |
| P3-IOS-03 | iOS wealth | Planned | Build Net Worth with Swift Charts, allocation, movement/comparison, accessible text summary, selected range, and zero/negative net-worth handling. |
| P3-IOS-04 | iOS assets | Planned | Build read-only Asset detail with current/source value, accessible history, liquidity, linked liability, net equity, conversion context, and no Edit action. |
| P3-IOS-05 | iOS accounts | Planned | Build Accounts and Account detail with server-masked identifier, correct balance/due language, freshness, recent activity, and account-filtered Activity navigation. Hide add/delete/credential/config controls. |
| P3-IOS-06 | iOS sync | Planned | Build Sync history timeline with safe status, pagination, account filter, and attention messaging. Do not expose raw error, OTP entry, or scraper controls. |
| P3-DES-01 | Design + UX writing | Planned | Specify no budgets, inactive/exact/over, no assets, negative net worth, missing/stale rate, mixed currency, zero/one chart point, inactive/stale account, no sync history, partial sync, and attention states. |
| P3-DES-02 | Design + accessibility | Planned | Specify textual chart summaries, VoiceOver point/series behavior, Audio Graph support, non-color series differentiation, large values, and maximum Dynamic Type layouts. |
| P3-QA-01 | Finance/data QA | Planned | Reconcile displayed totals/progress/history against fixture calculations and assert expected sections use the same snapshot/calculation timestamp. |
| P3-QA-02 | Security QA | Planned | Scan account/sync JSON, snapshot, logs, and diagnostics for credential references, configuration flags, full account numbers, provider errors, selectors, filesystem paths, and secret sentinels. |
| P3-QA-03 | Accessibility QA | Planned | Test charts with zero, one, negative, large, mixed-currency, missing-rate, and stale-rate data using VoiceOver, text summaries, and Audio Graph where supported. |
| P3-QA-04 | End-to-end QA | Planned | Automate Home → Plan → Budget/Net Worth/Asset and Profile → Accounts → Detail → Sync history in live/cached/stale/partial states on a physical iPhone. |

## Required state coverage

- all universal Phase 2 states;
- no budget, inactive budget, exactly-at-limit, over-limit, refund/negative spend;
- no assets/liabilities, negative net worth, zero/one chart point;
- missing/stale exchange rate and mixed currencies;
- no accounts, inactive/stale account, multiple accounts with identical suffix;
- no sync history, queued/running/completed/partial/attention/cancelled/failed sync;
- redacted safe failure and account-specific freshness mismatch.

## Acceptance scenarios

### Coherent planning snapshot

Given Plan is loaded from one refresh, when the user opens budgets, net worth, accounts, and sync summary, then values expected to reconcile share the declared snapshot/calculation time and no section silently mixes a newer/older calculation.

### Accessible chart

Given any valid history including zero, one, or negative points, when a VoiceOver user reaches the chart, then an equivalent summary, range, trend, and selectable values are available without depending on color.

### Safe account identity

Given the server stores full account/configuration details, when the iPhone requests account list/detail, then the identifier is masked before serialization and no credential/configuration fields enter the response or cache.

### Safe sync history

Given a raw scrape failure with provider/automation details, when it is represented on iPhone, then the user receives a stable safe state and useful Mac-attention guidance without raw error, credential, OTP, path, or selector information.

## Read-only MVP exit gate

Phase 3 and the recommended read-only MVP pass only when:

- Phases 0–3 Must tasks are Done and their exit gates remain green;
- planning, wealth, account, and sync screens work live and offline;
- expected sections reconcile to one declared snapshot/calculation time;
- account identifiers are masked on the server and sync messages reveal no internals/secrets;
- every chart has equivalent spoken/textual interpretation;
- no Phase 3 UI or device token can edit budgets/assets/accounts or start scraping;
- Home and transaction usability targets plus accessibility/performance gates pass on physical devices;
- deferred controls are absent or explicitly unavailable, not visually functional placeholders.
