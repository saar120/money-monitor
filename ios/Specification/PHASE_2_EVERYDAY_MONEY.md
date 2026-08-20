# Phase 2 — Everyday money

## Outcome

The owner can use Home, Activity, Search, filters, and transaction detail against live or saved data without any mobile mutation capability.

Delivery checkpoint: **daily-use read-only slice**  
Phase status: **Phase 2A and Phase 2B accepted on 2026-07-16; full Phase 2 product policy accepted and remaining implementation planned**\
Depends on: **Phase 0 bootstrap/client; full saved/offline Phase 2 still depends on Phase 1 implementation**

## User stories

| ID       | Priority | User story                                                                                                                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-P2-01 | Must     | As a daily checker, I want to see available money, current-period spending, comparison, budget pulse, review count, recent activity, and freshness so that I can understand my position quickly. |
| US-P2-02 | Must     | As a transaction browser, I want chronological activity grouped by date so that I can scan recent money movement.                                                                                |
| US-P2-03 | Must     | As a transaction finder, I want to search mixed Hebrew/English merchant text and combine filters so that I can find a known charge in under a minute.                                            |
| US-P2-04 | Must     | As a user, I want a safe read-only transaction detail so that I can understand a charge without exposing internal fields or accidentally editing it.                                             |
| US-P2-05 | Must     | As an offline user, I want the same screens backed by the last valid snapshot with an unmistakable saved timestamp.                                                                              |
| US-P2-06 | Must     | As a user refreshing data, I want readable content to remain visible until a complete replacement exists.                                                                                        |
| US-P2-07 | Future   | As a returning search user, I may later want optional recent searches; they are out of scope for the private self-use plan.                                                                      |
| US-P2-08 | Must     | As an assistive-technology user, I want transaction rows and amounts to communicate the same meaning without relying on visual layout or color.                                                  |

## Accepted delivery slice — Phase 2A live Home

Phase 2A was delivered under the historical sole-owner D-018 exception and does not satisfy the full Phase 1 or Phase 2 exit gates. D-020 now supersedes that audience limit for planned trusted-circle use; Phase 1 resumes before wider installs or financial persistence.

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

## Accepted delivery slice — Phase 2B live transactions

D-019 historically extended the sole-owner lane through live Activity, Search, supported filters, and transaction detail while keeping `mobile.read`, ephemeral cacheless networking, a Keychain-only device credential, the app-switcher cover, and memory-only financial state. D-020 supersedes the audience limit but does not retroactively claim Phase 1 or saved/offline Phase 2 behavior.

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

Automated evidence recorded on 2026-07-16:

- the authenticated GET-only backend uses exact allowlisted list/detail contracts, HMAC public IDs, encrypted filter/snapshot-bound keyset cursors, safe redaction, and no adjacent desktop or mutation routes;
- the full backend passed 49 files/555 tests; main and Electron TypeScript typechecks, lint, and Prettier passed;
- native iOS implements memory-only Activity, Search, direction/status/date/account/review/excluded filters, and read-only detail with exact 300 ms debounce, NFKC plus shared ECMAScript whitespace/UTF-16 vectors, pagination/dedupe/retry, strict nested/nullables/enums/UTC decoding, detail ID/server identity binding, Keychain credential use, epoch-guarded revocation/re-pair handling, sheet privacy cover, and calendar-only dates;
- the iPhone 17 Pro iOS 26.5 simulator passed 140 tests/165 parameterized executions with zero failures, and the generic simulator production build passed;
- independent final security and UI reviews reported no findings, and a source scan found no financial/query/filter/cursor/detail persistence or logging path;
- TypeScript and Swift share `transaction-list-live.json`, `transaction-detail-live.json`, and `transaction-search-normalization.json` as canonical fixtures.

Phase 2B was accepted on 2026-07-16 after the owner completed the consolidated physical-iPhone journey covering Activity, filters/Search, detail/back, network interruption/retry/retention, sheet/detail app-switcher concealment, and force-quit live refetch with no recent-search state. The clean Apple Development-signed Mac harness is valid on disk and satisfies its designated requirement.

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

The accepted Home semantics are:

- **Available money** is Mac `liquidTotal`: active bank balances plus explicitly liquid assets minus active liabilities;
- cash flow is calendar month-to-date through today in `Asia/Jerusalem`, compared with the same elapsed dates in the previous month;
- positive settled rows are income and negative settled rows are spending; ignored and explicit Transfer-category rows are excluded;
- ILS is the base currency and only the Mac converts non-ILS values; missing required inputs produce partial/unavailable output, never fabricated zeroes.

These rules must be frozen in seeded fixtures before the remaining Home implementation.

### Transaction list/search

- `GET /api/mobile/v1/transactions`
- bounded server pages (30 by default, 50 maximum) and an opaque encrypted keyset cursor bound to the canonical filters and snapshot rather than exposed desktop offsets;
- Phase 2B filter inputs: direction, status, date range, opaque account ID, review state, and excluded state;
- normalized query matching for supported mixed-direction merchant content;
- exactly 300 ms client debounce with cancellation of superseded searches;
- stable `hasMore` and next cursor;
- one safe response shape for initial/search/filter/append.

Full Phase 2 adds multi-select category/owner filters and `All / Exclude transfers / Transfers only`. Explicit Transfer-category rows remain separate because the database has no pair identity, but they are excluded from aggregates and budgets. Newest-first is the only accepted sort and search recents remain out of scope.

### Transaction detail

`GET /api/mobile/v1/transactions/:id` is implemented with an opaque mobile-boundary `:id`. It returns only approved merchant, signed money, financial date, masked account, category display, owner display, status/review/excluded display state, safe description, and other explicitly accepted read-only fields. It excludes hash, metadata blobs, scrape session, ownership reasoning/confidence internals, database-only fields, and every edit action.

## Task backlog

| ID        | Owner                          | Status                                     | Task — how and acceptance                                                                                                                                                                                                                                                       |
| --------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-PRD-01 | Product + finance logic        | Done — accepted under D-022                 | Home metrics, period/comparison, signs, ILS conversion ownership, Transfer exclusion, category/owner/transfer filters, sort, and no-recents policy are locked in fixtures independently of UI.                                                                                 |
| P2-API-01 | Shared API                     | Implemented — Phase 2B accepted             | Shared Swift/server fixtures define the bounded-page transaction list, opaque keyset cursor/detail ID, supported filters, and safe errors; money is decimal string + currency and IDs are opaque.                                                                               |
| P2-API-02 | Backend                        | Planned                                    | Complete `/bootstrap` Home DTO with one snapshot/calculation time. No section carries a conflicting timestamp; failed required sections make the payload non-cacheable. Depends on P2-PRD-01 and P2-API-01.                                                                     |
| P2-API-03 | Backend                        | Implemented — Phase 2B accepted             | `/transactions` uses bounded date/ID keyset pages with an encrypted opaque cursor bound to the canonical query, supported filters, finance date, and snapshot ceiling; append returns stable `hasMore`, with no raw offsets or deferred filters.                                 |
| P2-API-04 | Backend                        | Implemented — Phase 2B accepted             | `/transactions/:id` uses opaque IDs, allowlisted read-only fields, and safe `404 transaction_not_found`; raw transaction rows and internal hash/meta/scrape fields are never serialized.                                                                                        |
| P2-API-05 | Backend + QA                   | Done — Phase 2B accepted                    | Compatibility, redaction, mixed-direction literal Search/normalization, malformed/duplicate/cursor-abuse/cross-filter/pagination-boundary, authorization, GET-only, and adjacent-route-negative coverage passed.                                                               |
| P2-IOS-01 | iOS models/formatting          | Phase 2A/2B accepted                        | Strict transaction list/detail/cursor decoding covers nested allowlists, nullables, enums, UTC instants, calendar-only dates, ID kinds, masks, decimal money, server/detail identity binding, and equivalent locale-aware/spoken meaning.                                         |
| P2-IOS-02 | iOS Home                       | Phase 2A done; full task planned           | The live, memory-only Home, single-flight refresh, recoverable failure retention, and relaunch refetch passed physical acceptance. It does not claim cached/offline browsing; the full repository-backed task remains dependent on Phase 1.                                     |
| P2-IOS-03 | iOS Activity                   | Implemented — Phase 2B accepted             | Grouped live Activity implements initial load, keyset-cursor append, refresh, preserved in-memory journey, inline append retry, deduplication, and navigation to detail.                                                                                                      |
| P2-IOS-04 | iOS filters                    | Phase 2B accepted; full filters planned     | Direction/status/date/account/review/excluded behavior is accepted. Full Phase 2 adds the locked transfer/category/owner filters without alternate sorts.                                                                                                                      |
| P2-IOS-05 | iOS Search                     | Implemented — Phase 2B accepted             | Exactly 300 ms debounce, cancellation of superseded requests, NFKC plus shared ECMAScript whitespace/UTF-16 normalization vectors, query/filter preservation, no-results recovery, and no diagnostics, persistence, or recents are covered.                                   |
| P2-IOS-06 | iOS detail                     | Implemented — Phase 2B accepted             | Read-only Transaction detail binds the opaque request ID and server identity. Category/account/owner/status/review/excluded rows are non-editable; Options, note, recurring, and every edit action stay hidden.                                                                |
| P2-DAT-01 | iOS data                       | Planned after Phase 1                       | Full encrypted snapshot/repository and cached transaction window use D-021. Phase 2A/2B remain memory-only until that repository exists; search recents remain out of scope.                                                                                                  |
| P2-DES-01 | Design + UX writing            | Phase 2A/2B accepted; offline states planned | The flat native hierarchy passed live Activity/Search/filter/detail review and physical use. Saved/stale/corrupt states remain with full Phase 2.                                                                                                                             |
| P2-DES-02 | Design + accessibility         | Planned                                    | Apply core VoiceOver, large-text, and non-color meaning to the complete live/saved journey; broad release-matrix work remains Phase 6.                                                                                                                                          |
| P2-QA-01  | QA                             | Phase 2A done; Phase 2B automated evidence passed | Fixture, refresh, privacy-boundary, normalization, and full simulator suites pass; the source scan finds no financial/query/filter/cursor/detail persistence or logging path. Full encrypted-snapshot coverage remains deferred with Phase 1.                                  |
| P2-QA-02  | QA                             | Done — Phase 2B accepted                    | Live/empty/slow/revoked/incompatible/duplicate/cursor-abuse/cancellation/append-error coverage, race protection, privacy cover, no-persistence checks, and the physical journey passed.                                                                                         |
| P2-QA-03  | Accessibility + performance QA | Planned                                    | Verify the supported iPhone/private-release matrix for the complete live/saved journey without adding iPad or full-localization scope.                                                                                                                                        |

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
