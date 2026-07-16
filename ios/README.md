# Money Monitor for iOS

This folder is the starting point for the native Money Monitor app. It contains a buildable SwiftUI shell, the Xcode project source, and the complete product-to-engineering handoff for the approved mockups.

The iPhone is a private client of the Mac app. The Mac remains the credential holder, scraper, and authoritative owner of the SQLite database.

## Current status

| Area                                        | Status                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Product and visual direction                | Approved; canonical files remain in [`docs/ios-mockups`](../docs/ios-mockups/README.md)                                                   |
| Detailed product and delivery specification | Ready for implementation review in [`Specification/`](Specification/README.md)                                                            |
| Implementation ledger                       | Active in [`IMPLEMENTATION_LEDGER.md`](IMPLEMENTATION_LEDGER.md)                                                                          |
| Xcode project shell                         | Ready; generated from [`project.yml`](project.yml)                                                                                        |
| Native navigation shell                     | Ready; Home, Activity, Plan, Advisor, and trailing Search destinations                                                                    |
| Connectivity smoke test                     | Implemented against isolated `GET /api/mobile/v1/health`                                                                                  |
| Private Mac bridge                          | Hardened signed harness is live; both servers are loopback-only, external-LAN refusal passed, and the private route is healthy            |
| Bootstrap contract                          | Production allow-listed DTO adapter, generated JSON Schema, shared TypeScript/Swift fixtures, and authenticated native client implemented |
| Stable Mac pairing endpoint                 | Phase 0 accepted: pairing, no-flash restoration, reboot persistence, rotation, revocation, recovery pairing, and final security QA passed |
| Feature data and final screens              | Phase 2A live, in-memory Home is code-complete and ready for physical local testing; offline cache, app lock, polished recovery, and full accessibility acceptance are deferred |

The packaged Mac app still keeps its desktop Fastify listener and rotating full-access bearer token private. The Phase 0 mobile bridge is a second loopback-only listener, mapped through a dedicated private Tailscale HTTPS path and protected by revocable per-device `mobile.read` tokens. See [Architecture](Documentation/ARCHITECTURE.md), [API contract](Documentation/API_CONTRACT.md), and the live [implementation ledger](IMPLEMENTATION_LEDGER.md).

## Open in Xcode

The checked-in `.xcodeproj` is generated from `project.yml` with XcodeGen. After changing the project specification, regenerate it:

```sh
cd ios
xcodegen generate
open MoneyMonitor.xcodeproj
```

In Xcode:

1. Select the `MoneyMonitor` target.
2. Choose your Personal Team or Apple Developer team under Signing & Capabilities.
3. Replace the placeholder bundle identifier `com.example.MoneyMonitor` with one you control.
4. Run on an iOS 18+ simulator for UI work.
5. Run the pairing and Tailscale flow on a physical iPhone before calling connectivity complete.

The project builds with the installed iOS 26 SDK and targets iOS 18. Standard SwiftUI components automatically adopt the current Liquid Glass appearance on iOS 26 while retaining compatible behavior on iOS 18–25.

## Folder guide

```text
ios/
├── MoneyMonitor.xcodeproj       Generated Xcode project
├── project.yml                  Source of truth for project settings and targets
├── Documentation/              Product, design, architecture, API, and delivery plan
├── Specification/              Canonical PRD, phase backlogs, quality gates, and traceability
├── References/                 Index to canonical mockups and existing app sources
├── Fixtures/                   Canonical cross-platform mobile contract fixtures
├── MoneyMonitor/               Application source
├── MoneyMonitorTests/          Swift Testing unit and integration tests
└── MoneyMonitorUITests/        XCTest UI smoke tests
```

Start with the [Implementation ledger](IMPLEMENTATION_LEDGER.md) for current execution status, then use the [Specification index](Specification/README.md) and [Product specification](Specification/PRODUCT_SPEC.md) for scope. The shorter [Implementation plan](Documentation/IMPLEMENTATION_PLAN.md) is the roadmap; consult the [Screen map](Documentation/SCREEN_MAP.md), [Design system](Documentation/DESIGN_SYSTEM.md), and per-phase task files while building each feature.

## Non-negotiable boundaries

- Bank credentials, scraper code, encryption keys, and authoritative financial data stay on the Mac.
- Do not bind the desktop Fastify server to `0.0.0.0` for mobile access.
- Use a private Tailscale HTTPS route and a scoped device token stored in iOS Keychain.
- During Phase 2A, keep every financial bootstrap/feature DTO in memory only; do not add `UserDefaults`, `@AppStorage`, file, URL-cache, or state-restoration persistence.
- Treat the phone cache as an encrypted, timestamped last-known snapshot, never a second source of truth.
- Limit Phase 2A to the sole technical owner on a passcode-protected, non-shared personal iPhone; foregrounding does not add a second app-authentication prompt yet.
- Resume Phase 1 before adding that encrypted cache or distributing beyond the sole technical owner.
- Keep financial content flat. Let system navigation and controls provide Liquid Glass on supported iOS versions.
