# Phase 6 — Release readiness

## Outcome

Money Monitor is accessible, safe for mixed Hebrew/English financial content, resilient under real iPhone-to-Mac conditions, privacy-reviewed, signed, and reproducibly distributable to the approved audience.

Delivery checkpoint: **release candidate**  
Phase status: **private self-use distribution policy accepted under D-026; implementation planned**
Depends on: **the feature phases included in the release candidate**

Phase 6 is a hardening and evidence phase, not a place to add new product capability. A private development build may be shared earlier, but a release candidate cannot pass with unresolved security, accessibility, compatibility, or data-recovery failures.

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P6-01 | Must | As a VoiceOver or Switch Control user, I want every critical journey to be understandable and operable without relying on sight or precise gestures. |
| US-P6-02 | Must | As a user who prefers large text, I want all screens to reflow without clipping, overlap, or hidden actions. |
| US-P6-03 | Must | As a user whose financial data contains Hebrew, I want mixed Hebrew/English names and values to remain correctly ordered and unambiguous inside the English UI. |
| US-P6-04 | Must | As an owner whose Mac sleeps or network changes, I want recovery to be safe and understandable without losing cached data or duplicating commands. |
| US-P6-05 | Must | As a privacy-conscious owner, I want release artifacts, logs, diagnostics, screenshots, and caches to exclude credentials and avoid unnecessary financial exposure. |
| US-P6-06 | Must | As a tester installing an update, I want a Mac/iPhone contract mismatch explained while a compatible snapshot remains available and an incompatible one is safely discarded. |
| US-P6-07 | Must | As the maintainer, I want a signed, reproducible archive with tested installation, update, and fresh-pair recovery procedures. |
| US-P6-08 | Should | As a family or friend tester, I want one short guide for installation, pairing, updates, recovery, and contacting the maintainer. |

## Release lanes

### Development alpha

May use an Xcode Personal Team and direct device installation. It must still pass the security boundary, Keychain, cache, crash-free launch, and physical-device connectivity checks relevant to its implemented phases. Expiring provisioning and developer-device limits must be stated to testers.

### Private TestFlight release

Private TestFlight email invitations are the family/friend distribution lane when an Apple Developer Program account is available. External builds may require TestFlight App Review and test information. App Store publication is not part of this plan.

## Accepted release decisions

- Audience: maintainer plus individually invited family/friend testers.
- Distribution: direct Xcode development followed by private TestFlight; no App Store.
- Identity: team `CVP2NVLKL4`, organization `com.saaramrani`, bundle `com.saaramrani.moneymonitor`, display name `Money Monitor`; CI owns build numbers.
- Platform: iOS 18+, iPhone-only, portrait-first with functional landscape; no iPad optimization.
- Language: English UI with correct mixed Hebrew/English financial content; no full Hebrew UI requirement.
- Compatibility: support only the current pairing/mobile API contract and require updating the older app on mismatch; no N-1 promise or broad rollback matrix.
- Privacy/support: explicit redacted diagnostics, no cloud telemetry, backup-excluded financial cache, intentional screenshots allowed, direct maintainer support for private testers.
- Feature set: read-only Phases 0–3 first; commands and Advisor ship later as independently tested additions.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P6-PRD-01 | Product + release | Done — accepted under D-026 | Private TestFlight audience/lane, team/bundle identity, iOS 18/iPhone scope, current-contract compatibility, English/Hebrew-content scope, privacy/support defaults, and read-only-first feature set are locked. |
| P6-DES-01 | Design + product | Planned | Complete the visual/state audit for every included screen in light, dark, increased contrast, Reduce Transparency, Reduce Motion, and largest accessibility text. No critical state relies on glass/translucency, color, or animation alone. |
| P6-IOS-01 | iOS accessibility | Planned | Make all included screens reflow through the largest Dynamic Type sizes. Charts, rows, sheets, buttons, navigation titles, and tab content remain legible and operable without clipped meaning or horizontal page scrolling. |
| P6-IOS-02 | iOS accessibility | Planned | Add meaningful VoiceOver labels, values, traits, grouping, headings, adjustable chart summaries, logical focus order, Switch Control reachability, keyboard/focus support where applicable, and alternatives to swipe-only/context-menu actions. |
| P6-IOS-03 | iOS copy/formatting | Planned | Keep English user-facing copy in a String Catalog and use format styles for pluralization, dates, currencies, relative times, errors, and accessibility text. A translated UI catalog is not required. |
| P6-IOS-04 | iOS bidirectional content | Planned | Verify signed values, currencies, dates, account suffixes, charts, and mixed Hebrew/English merchant names inside the English UI. Full interface mirroring and Hebrew localization are out of scope. |
| P6-IOS-05 | iOS adaptation | Planned | Verify supported iPhone sizes, portrait/functional-landscape policy, sheets, safe areas, keyboard, and content-size changes. iPad adaptation is out of scope. |
| P6-REL-01 | iOS + Mac reliability | Planned | Harden recovery across Wi-Fi/cellular/VPN changes, Tailscale unavailable/reconnected, Mac sleep/wake, server restart, app background/foreground, token revocation, and clock skew. Retries are bounded and commands never repeat silently. |
| P6-DAT-01 | iOS persistence | Planned | Test compatible-snapshot preservation plus incompatible-snapshot discard/live-refetch, corrupt database, partial write, disk-full, protected-data-unavailable, Keychain-missing, server-identity-change, and fresh-install/update recovery. Preserve the last verified compatible snapshot unless the user explicitly wipes it. |
| P6-API-01 | Backend + iOS | Planned | Maintain fixtures for the current mobile contract, unknown additive fields, missing required fields, and explicit incompatible-version responses. The private product updates Mac/iPhone together and makes no previous-contract promise. |
| P6-SEC-01 | Security | Planned | Perform a final threat/privacy review of pairing, device registry, token scopes, commands, Advisor, cache, backup/file protection, lock-screen behavior, deep links, pasteboard, screenshots, diagnostics, and revocation. Resolve all high-risk findings. |
| P6-SEC-02 | Security + QA | Planned | Run automated secret/PII scans over source-controlled fixtures, logs, crash reports, diagnostic exports, streamed events, and release archive contents. No token, provider key, local path, raw account number, or unintended financial payload is present. |
| P6-SEC-03 | Product + security + iOS | Planned | Implement the accepted privacy policy: app-switcher redaction, no native push, intentional screenshots allowed, two-minute re-lock timing, protected/backup-excluded cache, explicit clipboard actions, and previewable redacted diagnostics. |
| P6-QA-01 | Performance QA | Planned | Measure cold/warm launch, cached screen render, live refresh, transaction paging/search, chart rendering, memory, energy, and Advisor streaming on the oldest supported physical device. Meet `QUALITY_GATES.md` budgets or record an approved exception. |
| P6-QA-02 | QA | Planned | Execute the full device/OS/locale/appearance/accessibility/connectivity matrix and every included phase acceptance scenario. Track evidence by requirement and close all release-blocking defects. |
| P6-QA-03 | QA + product | Planned | Run a clean physical-device end-to-end rehearsal: install, pair, authenticate, browse cached/live data, execute each included sensitive capability, revoke, recover, update, and reinstall/wipe. Retain redacted evidence. |
| P6-REL-02 | Release | Planned | Finalize icon/launch assets, bundle capabilities/entitlements, privacy manifest inputs, export-compliance answer, version/build scheme, TestFlight test information, one-page tester instructions, and Mac companion requirements. Public support/privacy sites and App Store metadata are out of scope. |
| P6-REL-03 | Release + engineering | Planned | Produce a clean signed archive from the documented toolchain, validate it, install the distributed artifact rather than a debug build, run smoke tests, and record the matching Mac/iPhone build pair. Recovery is update both apps or fresh-pair; no rollback matrix is maintained. |

## Release validation matrix

The selected lane must document exact devices and OS versions. At minimum, exercise:

| Dimension | Required coverage |
| --- | --- |
| Device | Smallest supported iPhone, current reference iPhone, and one older iOS 18-capable physical iPhone |
| OS | Minimum supported iOS and current shipping iOS/SDK combination |
| Appearance | Light, Dark, Increased Contrast, Reduce Transparency, Reduce Motion |
| Text/input | Default and largest accessibility text; VoiceOver; Switch Control; hardware keyboard where supported |
| Locale/content | English UI, mixed Hebrew/English content, bidirectional-value cases, and a locale using different number/date separators |
| Connectivity | Live, offline cached, slow, interrupted, Tailscale reconnect, Mac asleep, Mac server restart |
| Identity | Fresh pair, expired/revoked token, replaced Mac identity, incompatible companion version |
| Data | Empty, typical, large history, stale cache, corrupt cache, compatible snapshot, and incompatible-snapshot discard/live-refetch |
| Lifecycle | Clean install, update, background/foreground, device reboot, and reinstall/wipe with fresh pairing |

## Acceptance scenarios

### Accessible daily journey

Given VoiceOver and an accessibility text size, when the user pairs, checks Home, searches Activity, opens a transaction, and reviews an account, then all information and actions are announced in a logical order, content reflows, and no required action depends on color, translucency, or gesture-only discovery.

### Mixed Hebrew and financial bidirectionality

Given an English interface containing Hebrew merchant/category text, when mixed-direction names, negative currency values, dates, charts, and account suffixes appear, then each label and financial value remains correctly ordered and understandable without requiring a fully mirrored UI.

### Interrupted private connection

Given the last verified snapshot and a sleeping Mac, when the app opens and Tailscale later reconnects, then cached data remains available with explicit freshness, retries remain bounded, live state recovers, and no command or Advisor turn is duplicated.

### Safe update and compatibility failure

Given an existing paired installation, when the app updates, then a compatible snapshot remains available. When the snapshot or companion API is incompatible, the app discards that snapshot, live-refetches after both apps update, or offers fresh pairing when required, rather than crashing or silently decoding incompatible data.

### Distributed artifact rehearsal

Given the release candidate archive, when a tester installs the actual distributed artifact on a clean physical device, then pairing and every included critical journey pass using documented companion requirements, revocation works, and update/fresh-pair recovery instructions are reproducible.

## Exit gate

Phase 6 passes only when:

- the accepted private lane, identity, audience, iPhone scope, language scope, and included phases remain correctly configured;
- all included phase exit gates and the global Definition of Done pass with traceable evidence;
- critical journeys pass at largest text size with VoiceOver and non-gesture alternatives;
- English UI and mixed Hebrew/English financial content render unambiguously;
- compatibility, incompatible-snapshot discard/live-refetch, corruption, sleep/reconnect, and update scenarios preserve the last verified compatible snapshot and avoid duplicate commands;
- the final threat/privacy review has no unresolved high-risk finding and scans find no forbidden secret/data leakage;
- performance budgets pass on the oldest supported physical device or have an explicit accepted exception;
- a clean signed distributed artifact—not only a debug build—passes installation and end-to-end smoke testing;
- private TestFlight information, maintainer contact, companion requirements, diagnostics policy, and update/fresh-pair path are complete.
