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

## [Phase 1 — Trust, security, and resilience](../Specification/PHASE_1_TRUST_AND_RESILIENCE.md) — Deferred

Screens: Welcome, Connect to Mac, Face ID, Connected, Mac unavailable.

D-018 postpones this phase for the current sole technical owner. It remains required before offline storage or broader dogfood. Only the opaque app-switcher cover is pulled forward into Phase 2A.

- QR scanner and manual-address fallback.
- Pairing approval and clear failure recovery.
- Face ID app lock with passcode/device-auth fallback.
- App-switcher privacy cover and foreground re-lock.
- Encrypted, versioned last-known snapshot.
- Live, cached, stale, incompatible, revoked, and unavailable root states.

**Exit criteria:** a paired user always knows whether data is live or saved, can browse the saved snapshot offline, and cannot expose financial content from the app switcher when locked.

## [Phase 2 — Everyday read-only experience](../Specification/PHASE_2_EVERYDAY_MONEY.md) — Phase 2A active

Screens: Home, Activity, Search, Transaction detail, Filters.

- Live bootstrap-driven Home with summary, cash flow, budget pulse, review count, calculation time, and recent activity.
- Memory-only financial DTOs; no snapshot, URL cache, `UserDefaults`, or search-recents persistence.
- Opaque app-switcher cover before any real amount renders.
- Transaction pagination, search debounce, filters, and detail.
- Pull to refresh with validated in-memory replacement; cached/offline replacement remains deferred.
- Locale-aware ILS values and mixed Hebrew/English merchant content.
- Loading, empty, partial, retry, offline, and decode-failure states.

**Phase 2A exit criteria:** live Home renders only validated, non-failed sections, uses truthful money/date labels, covers inactive scenes, persists no financial DTO, and exposes no mutation. Full Phase 2 still requires Phase 1, Activity/Search/Detail, cached fixtures, and the accessibility matrix.

## [Phase 3 — Planning, wealth, and connected data](../Specification/PHASE_3_PLANNING_AND_ACCOUNTS.md)

Screens: Plan, Budget detail, Net Worth, Asset detail, Accounts, Account detail, Sync history.

- Budget progress and period comparison.
- Net-worth composition and accessible history chart.
- Asset and liability summaries.
- Safe account identifiers and freshness.
- Human-readable scrape/sync history without exposing scraper internals.

**Exit criteria:** all planning screens share one calculation timestamp, charts have spoken summaries, and account responses contain no credentials or unmasked account numbers.

## [Phase 4 — Explicit mobile commands](../Specification/PHASE_4_MOBILE_COMMANDS.md)

Screens: Review queue, Edit budget, Categories, Alerts, Settings, optional Sync command.

This phase is **blocked** until allowed commands, confirmations, auditing, and offline behavior are accepted.

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

**Exit criteria:** streaming survives cancellation and reconnect, VoiceOver announces useful progress without reading every token, and no unconfirmed mutation is possible.

## [Phase 6 — Release hardening](../Specification/PHASE_6_RELEASE_READINESS.md)

- Full Light/Dark Mode matrix across all screens.
- Dynamic Type through accessibility sizes.
- VoiceOver, Switch Control, Bold Text, Increased Contrast, Reduce Transparency, and Reduce Motion.
- iPhone SE-size, current Pro sizes, landscape, and iPad layouts.
- RTL and localization audit.
- Network interruption, Mac sleep/wake, token revocation, schema migration, and corrupted-cache tests.
- Privacy manifest, app icon, launch assets, production bundle ID, signing, and distribution plan.

## Next development tickets

1. **Implemented:** standalone `P1-SEC-02` inactive/app-switcher privacy cover and lifecycle policy tests.
2. **Implemented:** `P2-IOS-01` Home formatting subset with `Decimal`, locale-aware currency/date/sign output, strict decoder validation, and partial-section suppression.
3. **Implemented:** live in-memory `P2-IOS-02` Home presentation with single-flight refresh and fixture-driven tests.
4. **Next:** install the current build on the paired physical iPhone and complete the Phase 2A live-data, refresh-failure, relaunch, and app-switcher acceptance checks.

Phase 0 is complete: the stable private URL survived random-port Mac restarts, a full iPhone reboot preserved Keychain authentication, a Tailscale-disabled iPhone could not reach either listener through Wi-Fi, same-device re-pair atomically rotated the token, revocation blocked the saved credential, and fresh recovery pairing created a distinct active device without reactivating the revoked audit row. The hardened signed harness forces loopback binds and owner-only local-data permissions.

The starter Xcode/build tasks `P0-IOS-01` through `P0-IOS-03` and `P0-QA-01` are already complete; see the detailed Phase 0 status for their evidence.

## Definition of done for every feature

The complete cross-phase definition and release evidence rules are in [Quality gates](../Specification/QUALITY_GATES.md); screen-to-story/task coverage is maintained in [Traceability](../Specification/TRACEABILITY.md).

Phase 2A is an internal technical-owner exception and does not claim the full definition below. Security boundaries, redaction, native semantics, flexible layout, and read-only contracts still apply; offline/resilience and complete accessibility certification are deferred, not waived for release.

- Matches the approved screen hierarchy and semantic tokens.
- Handles live, loading, empty, cached/stale, offline, authentication, and server-error states.
- Has fixture-driven previews plus unit tests for presentation logic.
- Has VoiceOver labels, Dynamic Type behavior, 44-point targets, and non-color status meaning.
- Redacts secrets and sensitive identifiers from logs and analytics.
- Uses the mobile contract only; no view decodes raw desktop database rows.
