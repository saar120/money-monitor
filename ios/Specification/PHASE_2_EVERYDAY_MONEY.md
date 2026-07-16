# Phase 2 — Everyday money

## Outcome

The owner can use Home, Activity, Search, filters, and transaction detail against live or saved data without any mobile mutation capability.

Delivery checkpoint: **daily-use read-only slice**  
Phase status: **Phase 2A in progress — live Home for technical-owner dogfood; full Phase 2 remains planned**\
Depends on: **Phase 0 bootstrap/client plus the app-switcher subset of P1-SEC-02 for Phase 2A; full Phase 2 still depends on Phase 1**

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P2-01 | Must | As a daily checker, I want to see available money, current-period spending, comparison, budget pulse, review count, recent activity, and freshness so that I can understand my position quickly. |
| US-P2-02 | Must | As a transaction browser, I want chronological activity grouped by date so that I can scan recent money movement. |
| US-P2-03 | Must | As a transaction finder, I want to search mixed Hebrew/English merchant text and combine filters so that I can find a known charge in under a minute. |
| US-P2-04 | Must | As a user, I want a safe read-only transaction detail so that I can understand a charge without exposing internal fields or accidentally editing it. |
| US-P2-05 | Must | As an offline user, I want the same screens backed by the last valid snapshot with an unmistakable saved timestamp. |
| US-P2-06 | Must | As a user refreshing data, I want readable content to remain visible until a complete replacement exists. |
| US-P2-07 | Should | As a returning search user, I want optional recent searches stored locally and easy to clear. |
| US-P2-08 | Must | As an assistive-technology user, I want transaction rows and amounts to communicate the same meaning without relying on visual layout or color. |

## Current delivery slice — Phase 2A live Home

Phase 2A is an internal execution exception recorded in D-018. It is restricted to the sole technical owner on a passcode-protected, non-shared personal iPhone and does not satisfy the full Phase 1 or Phase 2 exit gates. The accepted limitation is that foregrounding can reveal data without an additional app-authentication prompt until Phase 1 resumes; the standalone app-switcher cover prevents financial content from appearing in inactive/background snapshots.

In scope now:

- render live Home values from the already validated `AppEnvironment.latestBootstrap` payload;
- keep all financial DTOs in memory only and fetch again after relaunch;
- add an opaque app-switcher cover before real values render;
- support loading, live, pull-to-refresh, partial-section suppression, unavailable, revoked, and incompatible outcomes;
- format decimal money, currencies, financial dates, mixed Hebrew/English merchant names, and signs truthfully;
- retain the Phase 0 `mobile.read` route allowlist, ephemeral cacheless networking, Keychain-only token, and redacted diagnostics.

Explicitly deferred:

- encrypted snapshots, cached/offline browsing, and retention/wipe policy;
- Face ID/app lock, background grace, and polished onboarding;
- Activity, Search, filters, pagination, detail, and local search recents;
- full accessibility/device matrix and any claim of wider dogfood or release readiness.

Phase 2A acceptance:

- failed or partial bootstrap sections are hidden or named unavailable; fallback zeroes are never presented as real money;
- no label claims “available money,” a comparison delta, or “up to date” until `P2-PRD-01` freezes those semantics;
- inactive/background scenes expose no financial content in the app switcher;
- refresh replaces the in-memory payload only after validation and preserves the current live payload on transport failure;
- no financial DTO, search text, response body, or device token is persisted outside the existing Keychain credential;
- all visible controls remain read-only.

## Screen scope

- [Home](../../docs/ios-mockups/rendered/screens/home.png)
- [Activity](../../docs/ios-mockups/rendered/screens/activity.png)
- [Search](../../docs/ios-mockups/rendered/screens/search.png)
- [Transaction detail](../../docs/ios-mockups/rendered/screens/transaction.png)
- [Filters](../../docs/ios-mockups/rendered/screens/filters.png)
- [Home Dark Mode](../../docs/ios-mockups/rendered/screens/home-dark.png) as token validation

The transaction mockup contains “Add note,” “Mark as recurring,” and editable rows that have no accepted mobile contract. Phase 2 hides those controls. Category/owner/review changes belong to Phase 4.

## Contract requirements

### Home/bootstrap

The Phase 0 bootstrap schema is finalized with:

- one snapshot ID and `generatedAt`;
- current period and comparison period;
- available cash/bank total with currency;
- income, expense, and cash-flow summary;
- budget remaining/attention summary;
- review count;
- recent transaction cards;
- safe account/sync freshness summary;
- complete/partial/cacheable metadata.

The exact definition of “available money” and desktop calculation parity must be frozen in fixtures before UI implementation.

### Transaction list/search

- `GET /api/mobile/v1/transactions`
- opaque cursor pagination rather than exposing desktop offsets;
- filter inputs: date range, transaction type/status, masked account ID, category, review state, excluded state, owner, and sort;
- normalized query matching for supported mixed-direction merchant content;
- stable `hasMore` and next cursor;
- one safe response shape for initial/search/filter/append.

### Transaction detail

`GET /api/mobile/v1/transactions/:id` must be added; no equivalent single-detail route currently exists. It returns only approved merchant, signed money, financial date, masked account, category, owner, status/review, safe description, and other explicitly accepted display fields. It excludes hash, metadata blobs, scrape session, ownership reasoning/confidence internals, and database-only fields.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P2-PRD-01 | Product + finance logic | Blocked | Freeze exact Home metrics, period boundaries, comparisons, available-cash definition, sign convention, base currency, and stale thresholds. Acceptance: seeded fixture has expected values documented independently of the UI. |
| P2-API-01 | Shared API | Planned | Define JSON Schema/OpenAPI fixtures for Home, transaction list/detail, cursors, filters, partial sections, and errors. Swift/server validate the same fixtures; money is decimal string + currency; IDs are opaque. |
| P2-API-02 | Backend | Planned | Complete `/bootstrap` Home DTO with one snapshot/calculation time. No section carries a conflicting timestamp; failed required sections make the payload non-cacheable. Depends on P2-PRD-01 and P2-API-01. |
| P2-API-03 | Backend | Planned | Implement cursor-paginated `/transactions` over service queries. Cursor is opaque/signed or server-defined, superseded requests are cheap to cancel, and append returns `hasMore`. Do not expose raw offset semantics. |
| P2-API-04 | Backend | Planned | Implement `/transactions/:id` with allowlisted fields and safe `404 transaction_not_found`. Never serialize raw transaction rows or internal hashes/meta/scrape fields. |
| P2-API-05 | Backend + QA | Planned | Add compatibility, redaction, Hebrew/English, long merchant, empty, partial, mixed-currency, unknown enum, malformed, and pagination-boundary fixtures. Secret sentinel scan must fail on forbidden fields/values. |
| P2-IOS-01 | iOS models/formatting | In progress | Phase 2A Home subset is code-complete with strict decoder-boundary decimal/currency/date/ID/mask validation, locale-aware formatting, mixed-direction content, and failed-section suppression. Full transaction DTO and spoken-wording acceptance still depend on later Phase 2 work. |
| P2-IOS-02 | iOS Home | In progress | Phase 2A live, memory-only Home and single-flight refresh are code-complete pending physical acceptance. It does not claim cached/offline behavior; the full repository-backed task remains dependent on Phase 1. |
| P2-IOS-03 | iOS Activity | Planned | Build grouped Activity with initial load, incremental cursor append, refresh, preserved scroll position, inline append retry, and navigation to detail. Duplicate IDs must not render twice. |
| P2-IOS-04 | iOS filters | Planned | Model filters as draft vs applied state. Apply changes results, Reset returns accepted defaults, Cancel changes nothing, and filtered-empty differs from genuinely empty activity. |
| P2-IOS-05 | iOS Search | Planned | Implement 250–350 ms debounce, cancellation of superseded requests, query/filter preservation through detail navigation, no-results recovery, keyboard behavior, and optional clearable local recents. Search text never enters production diagnostics. |
| P2-IOS-06 | iOS detail | Planned | Build read-only Transaction detail. Category/account/owner/status rows do not imply editability. Hide Options, note, recurring, and review actions until Phase 4/schema support exists. |
| P2-DAT-01 | iOS data | Deferred | Full encrypted snapshot/repository and cached transaction window move with Phase 1; Phase 2A persists no financial DTOs. |
| P2-DES-01 | Design + UX writing | In progress | Phase 2A flat native Home implements live, refreshing, partial, unavailable, revoked, and incompatible semantics; physical visual acceptance is pending, while cached/stale and remaining-screen matrices stay planned for the full phase. |
| P2-DES-02 | Design + accessibility | Deferred | Full accessibility/design acceptance moves to the later Phase 1/6 hardening path; Phase 2A still uses native semantics, flexible layouts, and non-color meaning by default. |
| P2-QA-01 | QA | In progress | Phase 2A fixture, refresh, privacy-boundary, and full simulator suites pass; source scan finds no financial persistence path. Physical live-data/app-switcher/relaunch evidence remains before this subset can be accepted; transaction contract and snapshot coverage remain planned. |
| P2-QA-02 | QA | Planned | Automate Home → Activity → Filter/Search → Detail for live, cached, empty, slow, revoked, incompatible, and append-error states. Verify query/filter/scroll restoration. |
| P2-QA-03 | Accessibility + performance QA | Deferred | Full VoiceOver, maximum Dynamic Type, cached/search, and representative-device matrix is deferred; targeted live Home performance checks may run without closing this task. |

## Required state coverage

- initial loading, live, refreshing, cached, stale, and partial bootstrap;
- empty account/data, empty transaction history, filtered empty, and no search results;
- first-page failure, append failure, duplicate cursor/result, timeout, server error, and cancellation;
- revoked token, incompatible schema, malformed/corrupt response;
- long/zero/negative/refund amounts, unknown category/status, mixed currency;
- mixed Hebrew/English merchant names and accessibility text sizes.

## Acceptance scenarios

### Daily glance

Given a valid live or saved Home snapshot, when the user unlocks Home, then available money, current-period spending/budget context, and freshness are readable within the defined task threshold and share one calculation time.

### Refresh failure

Given readable cached content, when refresh times out or returns a malformed payload, then the existing content remains, state changes truthfully, and no new snapshot is persisted.

### Search and return

Given a query and active filters, when the user opens a transaction and navigates back, then the query, applied filters, result set, and meaningful scroll position are preserved.

### Read-only guarantee

Given any Phase 2 screen, when the app is live or cached, then no control can submit a transaction/category/review mutation and the `mobile.read` token cannot call one.

## Exit gate

The following remains the **full Phase 2** exit gate. Phase 2A does not claim it while Phase 1, cached/offline behavior, Activity/Search, and the full accessibility matrix are deferred.

Phase 2 passes only when:

- Home glance and transaction lookup pass on a physical iPhone using live and cached fixtures;
- all financial sections in one refresh share one snapshot/calculation timestamp;
- search/filter state survives detail navigation and pagination errors recover inline;
- no Phase 2 UI or token can issue a mutation;
- VoiceOver, largest Dynamic Type, Light/Dark, Reduce Transparency, and mixed Hebrew/English content pass;
- contract tests prove no raw rows, hashes, unmasked account numbers, search strings, or secrets cross the mobile boundary;
- cached/live/search performance budgets pass or have an explicitly accepted exception.
