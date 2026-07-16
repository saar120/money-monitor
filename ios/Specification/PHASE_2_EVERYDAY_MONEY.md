# Phase 2 — Everyday money

## Outcome

The owner can use Home, Activity, Search, filters, and transaction detail against live or saved data without any mobile mutation capability.

Delivery checkpoint: **daily-use read-only slice**  
Phase status: **Phase 2A accepted on 2026-07-16; Phase 2B live transaction browsing is in progress for technical-owner dogfood**\
Depends on: **Phase 0 bootstrap/client plus the app-switcher subset of P1-SEC-02 under D-018/D-019; full Phase 2 still depends on Phase 1**

## User stories

| ID       | Priority | User story                                                                                                                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-P2-01 | Must     | As a daily checker, I want to see available money, current-period spending, comparison, budget pulse, review count, recent activity, and freshness so that I can understand my position quickly. |
| US-P2-02 | Must     | As a transaction browser, I want chronological activity grouped by date so that I can scan recent money movement.                                                                                |
| US-P2-03 | Must     | As a transaction finder, I want to search mixed Hebrew/English merchant text and combine filters so that I can find a known charge in under a minute.                                            |
| US-P2-04 | Must     | As a user, I want a safe read-only transaction detail so that I can understand a charge without exposing internal fields or accidentally editing it.                                             |
| US-P2-05 | Must     | As an offline user, I want the same screens backed by the last valid snapshot with an unmistakable saved timestamp.                                                                              |
| US-P2-06 | Must     | As a user refreshing data, I want readable content to remain visible until a complete replacement exists.                                                                                        |
| US-P2-07 | Should   | As a returning search user, I want optional recent searches stored locally and easy to clear.                                                                                                    |
| US-P2-08 | Must     | As an assistive-technology user, I want transaction rows and amounts to communicate the same meaning without relying on visual layout or color.                                                  |

## Accepted delivery slice — Phase 2A live Home

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

Accepted on 2026-07-16 after simulator/security regression, signed-harness verification, and physical checks for live rendering, Recent compatibility, Search scoping, pull-to-refresh, recoverable Tailscale-off retention, app-switcher concealment, and force-quit/relaunch refetch. This acceptance does not expand the slice beyond the limitations above.

## Current delivery slice — Phase 2B live transactions

D-019 extends D-018 only for the same sole technical owner and trusted personal iPhone. Phase 2B adds live Activity, Search, supported filters, and transaction detail while keeping the Phase 2A trust boundary: `mobile.read`, ephemeral cacheless networking, Keychain-only device credential, opaque app-switcher cover, and memory-only financial state. It does not satisfy Phase 1 or the full Phase 2 exit gate.

In scope now:

- authenticated `GET /api/mobile/v1/transactions` with a mobile-only field allowlist;
- authenticated `GET /api/mobile/v1/transactions/:id`, where `:id` is an opaque transaction ID and the response contains no editable affordance;
- bounded server pages with opaque cursor pagination, chronological grouping, duplicate defense, and inline append retry;
- exactly 300 ms debounced Search with cancellation of superseded work, mixed Hebrew/English literal matching, and no query diagnostics;
- filters for direction, status, date range, opaque account ID, review state, and excluded state;
- in-memory query, applied-filter, result, cursor, scroll, and detail state that is cleared on revocation/disconnect and refetched after relaunch;
- one consolidated owner validation block only after contract, authorization, redaction, state, cancellation, privacy, and simulator suites pass.

Explicitly deferred from Phase 2B:

- encrypted snapshots, cached/offline browsing, state restoration, and every other financial persistence path;
- local or synced search recents;
- transfer-specific filtering or semantics, category filters, owner filters, and additional sort modes;
- category, owner, review, excluded-state, note, recurring, or any other transaction mutation/edit control;
- Face ID/app lock, full recovery/accessibility/device matrices, broader dogfood, and release claims.

Phase 2B acceptance target:

- list/detail DTOs are validated by shared server/Swift fixtures before presentation and reject raw database fields, secret sentinels, unmasked identifiers, malformed money/dates/IDs, and duplicate page IDs;
- missing, malformed, expired, revoked, and wrong-capability credentials fail before any transaction read, while adjacent desktop and mutation routes remain absent;
- cursor tampering, cross-filter reuse, repeated cursors, append failure, duplicate results, and cancellation cannot corrupt or replace accepted in-memory rows;
- Search/filter/detail navigation preserves the active in-memory journey, while revocation/disconnect clears it and late responses cannot resurrect data;
- no financial DTO, query, filter, cursor, detail, response body, or device token is persisted outside the existing Keychain credential;
- every visible Phase 2B control is read-only, and the root app-switcher cover conceals every new screen.

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
- bounded server pages and opaque cursor pagination rather than exposing desktop offsets;
- Phase 2B filter inputs: direction, status, date range, opaque account ID, review state, and excluded state;
- normalized query matching for supported mixed-direction merchant content;
- exactly 300 ms client debounce with cancellation of superseded searches;
- stable `hasMore` and next cursor;
- one safe response shape for initial/search/filter/append.

Transfer-specific behavior, category/owner filters, and additional sort modes remain outside Phase 2B and must not be accepted silently by this route.

### Transaction detail

`GET /api/mobile/v1/transactions/:id` must be added; no equivalent single-detail route currently exists, and `:id` is opaque at the mobile boundary. It returns only approved merchant, signed money, financial date, masked account, category display, owner display, status/review/excluded display state, safe description, and other explicitly accepted read-only fields. It excludes hash, metadata blobs, scrape session, ownership reasoning/confidence internals, database-only fields, and every edit action.

## Task backlog

| ID        | Owner                          | Status                                     | Task — how and acceptance                                                                                                                                                                                                                                                       |
| --------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-PRD-01 | Product + finance logic        | Blocked                                    | Freeze exact Home metrics, period boundaries, comparisons, available-cash definition, sign convention, base currency, and stale thresholds. Acceptance: seeded fixture has expected values documented independently of the UI.                                                  |
| P2-API-01 | Shared API                     | In progress — Phase 2B subset              | Define shared fixtures/schema for the fixed-page transaction list, opaque cursor/detail ID, supported filters, and safe errors. Swift/server validate the same fixtures; money is decimal string + currency; IDs are opaque.                                                    |
| P2-API-02 | Backend                        | Planned                                    | Complete `/bootstrap` Home DTO with one snapshot/calculation time. No section carries a conflicting timestamp; failed required sections make the payload non-cacheable. Depends on P2-PRD-01 and P2-API-01.                                                                     |
| P2-API-03 | Backend                        | In progress — Phase 2B subset              | Implement bounded cursor-paginated `/transactions` with date/ID keyset ordering. Bind the opaque cursor to the canonical query, supported filters, and finance-date ceiling; append returns stable `hasMore`. Do not expose raw offsets or accept deferred filters.             |
| P2-API-04 | Backend                        | In progress — Phase 2B subset              | Implement `/transactions/:id` with opaque IDs, allowlisted read-only fields, and safe `404 transaction_not_found`. Never serialize raw transaction rows or internal hashes/meta/scrape fields.                                                                                  |
| P2-API-05 | Backend + QA                   | In progress — Phase 2B subset              | Add compatibility, redaction, Hebrew/English literal Search, long merchant, empty, mixed-currency, unknown enum, malformed, duplicate, cursor-abuse, cross-filter, and pagination-boundary fixtures. Secret sentinel scan must fail on forbidden fields/values.                 |
| P2-IOS-01 | iOS models/formatting          | Phase 2A done; Phase 2B subset in progress | The accepted Home subset enforces strict decoder-boundary decimal/currency/date/ID/mask validation. Phase 2B adds strict transaction list/detail/cursor validation and equivalent locale-aware/spoken transaction meaning.                                                      |
| P2-IOS-02 | iOS Home                       | Phase 2A done; full task planned           | The live, memory-only Home, single-flight refresh, recoverable failure retention, and relaunch refetch passed physical acceptance. It does not claim cached/offline browsing; the full repository-backed task remains dependent on Phase 1.                                     |
| P2-IOS-03 | iOS Activity                   | In progress — Phase 2B                     | Build grouped live Activity with initial load, keyset cursor append, refresh, preserved scroll position, inline append retry, and navigation to detail. Duplicate IDs must not render twice.                                                                                    |
| P2-IOS-04 | iOS filters                    | In progress — Phase 2B subset              | Model direction/status/date/account/review/excluded filters as draft vs applied state. Apply changes results, Reset returns accepted defaults, Cancel changes nothing, and filtered-empty differs from genuinely empty activity. Transfer/category/owner filters stay hidden.   |
| P2-IOS-05 | iOS Search                     | In progress — Phase 2B subset              | Implement exactly 300 ms debounce, cancellation of superseded requests, query/filter preservation through detail navigation, no-results recovery, and keyboard behavior. Search text never enters production diagnostics or persistence; local recents remain deferred.         |
| P2-IOS-06 | iOS detail                     | In progress — Phase 2B                     | Build read-only Transaction detail from an opaque ID. Category/account/owner/status/review/excluded rows do not imply editability. Hide Options, note, recurring, category/owner/review, and all other edit actions.                                                            |
| P2-DAT-01 | iOS data                       | Deferred                                   | Full encrypted snapshot/repository and cached transaction window move with Phase 1; Phase 2A and Phase 2B persist no financial DTO, query, filter, cursor, detail, or recent-search state.                                                                                      |
| P2-DES-01 | Design + UX writing            | Phase 2A done; Phase 2B subset in progress | The flat native Home passed physical visual acceptance. Phase 2B applies the same native hierarchy to live Activity/Search/filter/detail loading, empty, append-error, unavailable, revoked, and incompatible states; cached/stale matrices stay planned for the full phase.    |
| P2-DES-02 | Design + accessibility         | Deferred                                   | Full accessibility/design acceptance moves to the later Phase 1/6 hardening path; Phase 2A still uses native semantics, flexible layouts, and non-color meaning by default.                                                                                                     |
| P2-QA-01  | QA                             | Phase 2A done; full task planned           | Fixture, refresh, privacy-boundary, and full simulator suites pass; source scan finds no financial persistence path. Physical live-data, refresh-failure, app-switcher, and relaunch evidence passed; transaction-contract and encrypted-snapshot coverage remain planned.      |
| P2-QA-02  | QA                             | In progress — Phase 2B subset              | Automate Home → Activity → Filter/Search → Detail for live, empty, slow, revoked, incompatible, duplicate/cursor-abuse, cancellation, and append-error states. Verify query/filter/scroll restoration and no persistence; cached/offline fixtures remain deferred with Phase 1. |
| P2-QA-03  | Accessibility + performance QA | Deferred                                   | Full VoiceOver, maximum Dynamic Type, cached/search, and representative-device matrix is deferred; targeted live Home performance checks may run without closing this task.                                                                                                     |

## Required state coverage

- initial loading, live, and refreshing for Phase 2B; cached, stale, and persisted offline transaction browsing remain full-Phase-2 work after Phase 1;
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

Given any Phase 2B screen, when the app is live, then no control can submit a transaction/category/owner/review/excluded mutation and the `mobile.read` token cannot call one.

## Exit gate

The following remains the **full Phase 2** exit gate. Neither Phase 2A nor Phase 2B claims it while Phase 1, cached/offline behavior, deferred transaction filters, and the full accessibility matrix remain open.

Phase 2 passes only when:

- Home glance and transaction lookup pass on a physical iPhone using live and cached fixtures;
- all financial sections in one refresh share one snapshot/calculation timestamp;
- search/filter state survives detail navigation and pagination errors recover inline;
- no Phase 2 UI or token can issue a mutation;
- VoiceOver, largest Dynamic Type, Light/Dark, Reduce Transparency, and mixed Hebrew/English content pass;
- contract tests prove no raw rows, hashes, unmasked account numbers, search strings, or secrets cross the mobile boundary;
- cached/live/search performance budgets pass or have an explicitly accepted exception.
