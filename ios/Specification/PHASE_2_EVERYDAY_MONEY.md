# Phase 2 — Everyday money

## Outcome

The owner can use Home, Activity, Search, filters, and transaction detail against live or saved data without any mobile mutation capability.

Delivery checkpoint: **daily-use read-only slice**  
Phase status: **planned**  
Depends on: **Phase 1 repository, freshness, app lock, and root-state gate**

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
| P2-IOS-01 | iOS models/formatting | Planned | Add stable DTOs, unknown-enum handling, decimal money, financial-date/instant types, locale-aware formatting, signed VoiceOver wording, and bidirectional merchant tests. Depends on P2-API-01. |
| P2-IOS-02 | iOS Home | Planned | Build Home from repository bootstrap: primary value, period context, spending/comparison, budget pulse, review prompt, freshness, and recent rows. Refresh keeps content visible and replaces the snapshot only after validation. |
| P2-IOS-03 | iOS Activity | Planned | Build grouped Activity with initial load, incremental cursor append, refresh, preserved scroll position, inline append retry, and navigation to detail. Duplicate IDs must not render twice. |
| P2-IOS-04 | iOS filters | Planned | Model filters as draft vs applied state. Apply changes results, Reset returns accepted defaults, Cancel changes nothing, and filtered-empty differs from genuinely empty activity. |
| P2-IOS-05 | iOS Search | Planned | Implement 250–350 ms debounce, cancellation of superseded requests, query/filter preservation through detail navigation, no-results recovery, keyboard behavior, and optional clearable local recents. Search text never enters production diagnostics. |
| P2-IOS-06 | iOS detail | Planned | Build read-only Transaction detail. Category/account/owner/status rows do not imply editability. Hide Options, note, recurring, and review actions until Phase 4/schema support exists. |
| P2-DAT-01 | iOS data | Planned | Extend the encrypted snapshot/repository for Phase 2 DTOs and cached transaction window. Define whether offline search covers the full cached list or a bounded window; cache failure never erases prior valid data. |
| P2-DES-01 | Design + UX writing | Planned | Specify loading, empty, filtered-empty, no results, partial, cached, stale, unavailable, revoked, incompatible, append error, and malformed response states for all screens. |
| P2-DES-02 | Design + accessibility | Planned | Specify long/negative/large amounts, refunds, maximum Dynamic Type, Hebrew/English names, masked identifiers, and review state without color-only meaning. |
| P2-QA-01 | QA | Planned | Contract-test server fixtures against Swift decoding and verify raw rows, hashes, unmasked account numbers, search text, and secrets never enter snapshots/logs. |
| P2-QA-02 | QA | Planned | Automate Home → Activity → Filter/Search → Detail for live, cached, empty, slow, revoked, incompatible, and append-error states. Verify query/filter/scroll restoration. |
| P2-QA-03 | Accessibility + performance QA | Planned | Verify VoiceOver and maximum Dynamic Type on physical device; measure cached/live Home and search against global budgets with representative 500+ transaction fixtures. |

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

Phase 2 passes only when:

- Home glance and transaction lookup pass on a physical iPhone using live and cached fixtures;
- all financial sections in one refresh share one snapshot/calculation timestamp;
- search/filter state survives detail navigation and pagination errors recover inline;
- no Phase 2 UI or token can issue a mutation;
- VoiceOver, largest Dynamic Type, Light/Dark, Reduce Transparency, and mixed Hebrew/English content pass;
- contract tests prove no raw rows, hashes, unmasked account numbers, search strings, or secrets cross the mobile boundary;
- cached/live/search performance budgets pass or have an explicitly accepted exception.

