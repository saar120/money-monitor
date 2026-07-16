# Implementation plan

The safest delivery order is a thin, working private path first, followed by read-only product slices. Each phase ends in something testable on a physical iPhone.

This file is the concise roadmap. The issue-sized tasks, user stories, dependencies, acceptance scenarios, and evidence gates live in the canonical [iOS specification](../Specification/README.md). Product or scope changes should update that specification first.

## Status legend

- **Accepted:** implementation and required evidence gates passed.
- **Ready:** committed foundation exists in this folder.
- **Planned:** specified here but not implemented.
- **Blocked:** depends on a product or architecture decision.
- **Deferred:** intentionally moved outside the current technical-owner checkpoint.

## [Phase 0 — Foundation and private bridge](../Specification/PHASE_0_FOUNDATION.md)

### iOS foundation — Accepted

- Buildable SwiftUI application, unit-test, and UI-test targets.
- Feature-first source folders and dependency seams.
- Native `TabView` with Home, Activity, Plan, Advisor, and Search roles.
- Manual HTTPS address field and typed `GET /api/mobile/v1/health` smoke client.
- Semantic design tokens and placeholder feature states.

### Mac mobile bridge — Accepted

- Publish an isolated loopback mobile server through a stable private Tailscale HTTPS route. **Implemented and verified across two packaged-app cold restarts with distinct random ports.**
- Add QR pairing, claimant-bound status/exchange, device approval, rotation, and revocation. **Production routes, Mac/iPhone controls, single-mint retry hardening, same-device rotation, physical revocation, and fresh recovery pairing are implemented and accepted.**
- Issue a `mobile.read` token instead of the full desktop bearer token. **Digest-only registry, restart persistence, capability enforcement, and revocation are implemented.**
- Add `/api/mobile/v1/bootstrap` with masked, stable DTOs. **Production service ports and adapter are implemented with opaque IDs, charged currency, Jerusalem finance dates, future-row filtering, and safe partials.**
- Add shared server/Swift fixtures and compatibility tests. **Bootstrap and pairing fixtures are shared, the generated Draft 2020-12 bootstrap schema is drift-checked, and the updated Xcode simulator suite passes with every fixture.**
- Package and sign the Mac physical harness. **Ready at `dist/mac-arm64/Money Monitor.app`; fresh physical pairing and iOS app cold-launch persistence passed.**

**Exit criteria passed 2026-07-16:** a physical iPhone paired and stored its scoped token in Keychain; stable health followed random-port Mac restarts, and a later physical cold launch authenticated bootstrap from the saved credential. The bridge remained isolated from the LAN, rejected a revoked credential, and recovered through a fresh approved pairing. Final count-only scans found no registered-token, Bearer, private-route, or known-account leakage in inspected artifacts.

## [Phase 1 — Trust, security, and resilience](../Specification/PHASE_1_TRUST_AND_RESILIENCE.md) — Policy accepted; implementation next

Screens: Welcome, Connect to Mac, Face ID, Connected, Mac unavailable.

D-020 supersedes the historical sole-owner exception with a trusted-circle self-use audience. D-021 locks mandatory system authentication, a two-minute grace, one encrypted 30-day/24-hour-stale snapshot, wipe rules, and fresh pairing for replacement phones. Phase 1 now resumes before family/friend distribution or offline storage.

- QR scanner and manual-address fallback.
- Pairing approval and clear failure recovery.
- Face ID app lock with passcode/device-auth fallback.
- App-switcher privacy cover and foreground re-lock.
- Encrypted, versioned last-known snapshot.
- Live, cached, stale, incompatible, revoked, and unavailable root states.

**Exit criteria:** a paired user always knows whether data is live or saved, can browse the saved snapshot offline, and cannot expose financial content from the app switcher when locked.

## [Phase 2 — Everyday read-only experience](../Specification/PHASE_2_EVERYDAY_MONEY.md) — Phase 2A/2B accepted; full completion planned

Screens: Home, Activity, Search, Transaction detail, Filters.

- Accepted live bootstrap-driven Home with summary, cash flow, budget pulse, review count, calculation time, and recent activity.
- Memory-only financial DTOs; no snapshot, URL cache, `UserDefaults`, search-recents, query, filter, cursor, or detail persistence.
- Opaque app-switcher cover before any real amount renders.
- Phase 2B adds authenticated `GET /api/mobile/v1/transactions` and `GET /api/mobile/v1/transactions/:id`, where the detail ID is opaque and every response is an allow-listed mobile DTO.
- Bounded opaque keyset-cursor pages (30 by default, 50 maximum), chronological Activity, deduplication, and inline append retry without desktop offsets.
- Exactly 300 ms Search debounce with cancellation and no production query diagnostics.
- Supported Phase 2B filters are direction, status, date range, opaque account ID, review state, and excluded state.
- Full Phase 2 adds explicit Transfer exclusion plus category/owner/transfer filters; search recents and alternate sorts are out of scope.
- Pull to refresh with validated in-memory replacement is accepted; cached/offline replacement follows Phase 1.
- Locale-aware ILS values and mixed Hebrew/English merchant content.
- Loading, empty, partial, retry, offline, and decode-failure states.

**Phase 2A exit criteria:** live Home renders only validated, non-failed sections, uses truthful money/date labels, covers inactive scenes, persists no financial DTO, and exposes no mutation. Full Phase 2 still requires Phase 1, Activity/Search/Detail, cached fixtures, and the accessibility matrix.

Accepted on 2026-07-16 after the signed Mac/iPhone path passed live-data, refresh, recoverable Tailscale-off failure, app-switcher concealment, and force-quit/relaunch checks without adding financial persistence.

**Phase 2B exit criteria:** shared server/Swift fixtures prove allow-listed list/detail DTOs and redaction; cursor, duplicate, search-cancellation, filter, append-failure, revocation, and no-persistence tests pass; the full simulator suite stays green; then one consolidated physical-iPhone block validates Activity → Search/Filter → Detail → return, app-switcher concealment, network interruption, and relaunch refetch. Phase 2B still does not claim cached/offline browsing, Phase 1, or the full Phase 2 gate.

**Automated gate passed 2026-07-16:** the authenticated GET-only backend exposes exact allowlisted list/detail contracts with HMAC IDs, encrypted filter/snapshot-bound keyset cursors, redaction, and no adjacent routes. The full backend passed 49 files/555 tests plus main/Electron typechecks, lint, and Prettier. Native iOS now provides memory-only Activity, Search, supported filters, and read-only detail with exact 300 ms debounce; NFKC and shared ECMAScript whitespace/UTF-16 vectors; pagination/dedupe/retry; strict nested/nullables/enums/UTC decoding; detail ID/server identity binding; Keychain credential use; epoch-guarded revocation/re-pair races; sheet privacy cover; calendar-only dates; and no persistence, mutation, or edit controls. The iPhone 17 Pro iOS 26.5 simulator passed 140 tests/165 parameterized executions with zero failures, the generic simulator production build passed, independent security and UI reviews found no issues, and the source scan found no financial/query/filter/cursor/detail persistence or logging path. Shared canonical fixtures are `transaction-list-live.json`, `transaction-detail-live.json`, and `transaction-search-normalization.json`.

**Physical gate passed 2026-07-16:** the owner completed the combined Activity, filters/Search, detail/back, interruption/retry/retention, privacy-cover, and force-quit/refetch journey. Phase 2B is accepted.

## [Phase 3 — Planning, wealth, and connected data](../Specification/PHASE_3_PLANNING_AND_ACCOUNTS.md)

Screens: Plan, Budget detail, Net Worth, Asset detail, Accounts, Account detail, Sync history.

- Budget progress and period comparison.
- Net-worth composition and accessible history chart.
- Asset and liability summaries.
- Safe account identifiers and freshness.
- Human-readable scrape/sync history without exposing scraper internals.

D-023 locks monthly/yearly budgets, ILS/Mac-owned conversion, 3M/6M/1Y/All wealth ranges, server masking, bank-balance-only wording, and a safe public sync taxonomy. Product work is unblocked.

**Exit criteria:** all planning screens share one calculation timestamp, charts have spoken summaries, and account responses contain no credentials or unmasked account numbers.

## [Phase 4 — Explicit mobile commands](../Specification/PHASE_4_MOBILE_COMMANDS.md)

Screens: Review queue, Edit budget, Categories, Alerts, Settings, optional Sync command.

D-024 accepts the live-only review/transaction/budget/category/Telegram/sync allowlist, destructive-confirmation rules, idempotency, conflicts, auditing, and Mac-only exclusions. Implementation remains after the read-only MVP.

- Add one narrow capability per command.
- Disable commands in cached/offline mode.
- Confirm destructive or consequential changes.
- Surface server validation, conflicts, partial failures, and retry behavior.
- Audit device, command, target, timestamp, and outcome on the Mac.

**Exit criteria:** no mobile token can call an undeclared desktop operation, and every command has contract, UI-state, security, and audit tests.

## [Phase 5 — Advisor](../Specification/PHASE_5_ADVISOR.md)

Screens: Advisor home and conversation.

- Session list and conversation history.
- SSE streaming, cancel, retry, and provider-unavailable states.
- Freshness disclosure for data used in an answer.
- Read-only tool allowlist first; confirmations for any later action.
- Offline state clearly disables Advisor without blocking saved financial data.

D-025 locks a read-only, provider-disclosed, device-private Advisor with no AI memory writes or direct actions.

**Exit criteria:** streaming survives cancellation and reconnect, VoiceOver announces useful progress without reading every token, and no unconfirmed mutation is possible.

## [Phase 6 — Release hardening](../Specification/PHASE_6_RELEASE_READINESS.md)

- Full Light/Dark Mode matrix across all screens.
- Dynamic Type through accessibility sizes.
- VoiceOver, Switch Control, Bold Text, Increased Contrast, Reduce Transparency, and Reduce Motion.
- supported iPhone sizes and functional landscape; iPad is out of scope.
- English UI plus mixed Hebrew/English and bidirectional financial-content audit; full Hebrew UI is out of scope.
- Network interruption, Mac sleep/wake, token revocation, schema migration, and corrupted-cache tests.
- Privacy manifest, app icon, launch assets, locked `com.saaramrani.moneymonitor` identity, signing, direct-install, and private-TestFlight plan.

## Next development tickets

1. **Implemented:** standalone `P1-SEC-02` inactive/app-switcher privacy cover and lifecycle policy tests.
2. **Implemented:** `P2-IOS-01` Home formatting subset with `Decimal`, locale-aware currency/date/sign output, strict decoder validation, and partial-section suppression.
3. **Implemented:** live in-memory `P2-IOS-02` Home presentation with single-flight refresh and fixture-driven tests.
4. **Accepted:** the paired physical iPhone passed Phase 2A live-data, refresh-failure, relaunch, and app-switcher acceptance checks.
5. **Accepted:** Phase 2B shared contracts, native browsing, automated gates, signed harness, and consolidated physical journey passed.
6. **Next:** implement Phase 1 app lock, encrypted snapshot, freshness, recovery, and replacement-phone behavior under D-021.

Phase 0 is complete: the stable private URL survived random-port Mac restarts, a full iPhone reboot preserved Keychain authentication, a Tailscale-disabled iPhone could not reach either listener through Wi-Fi, same-device re-pair atomically rotated the token, revocation blocked the saved credential, and fresh recovery pairing created a distinct active device without reactivating the revoked audit row. The hardened signed harness forces loopback binds and owner-only local-data permissions.

The starter Xcode/build tasks `P0-IOS-01` through `P0-IOS-03` and `P0-QA-01` are already complete; see the detailed Phase 0 status for their evidence.

## Definition of done for every feature

The complete cross-phase definition and release evidence rules are in [Quality gates](../Specification/QUALITY_GATES.md); screen-to-story/task coverage is maintained in [Traceability](../Specification/TRACEABILITY.md).

Phase 2A and Phase 2B remain accepted historical live-only slices. D-020/D-021 replace their sole-owner limitation for future trusted-circle work; every new feature follows the full definition below.

- Matches the approved screen hierarchy and semantic tokens.
- Handles live, loading, empty, cached/stale, offline, authentication, and server-error states.
- Has fixture-driven previews plus unit tests for presentation logic.
- Has VoiceOver labels, Dynamic Type behavior, 44-point targets, and non-color status meaning.
- Redacts secrets and sensitive identifiers from logs and analytics.
- Uses the mobile contract only; no view decodes raw desktop database rows.
