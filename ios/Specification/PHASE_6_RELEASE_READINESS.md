# Phase 6 — Release readiness

## Outcome

Money Monitor is accessible, localized, resilient under real iPhone-to-Mac conditions, privacy-reviewed, signed, and reproducibly distributable to the approved audience.

Delivery checkpoint: **release candidate**  
Phase status: **planned; distribution decision blocked**  
Depends on: **the feature phases included in the release candidate**

Phase 6 is a hardening and evidence phase, not a place to add new product capability. A private development build may be shared earlier, but a release candidate cannot pass with unresolved security, accessibility, compatibility, or data-recovery failures.

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P6-01 | Must | As a VoiceOver or Switch Control user, I want every critical journey to be understandable and operable without relying on sight or precise gestures. |
| US-P6-02 | Must | As a user who prefers large text, I want all screens to reflow without clipping, overlap, or hidden actions. |
| US-P6-03 | Must | As a Hebrew user, I want natural localized copy, correct right-to-left layout, and financial values that remain unambiguous. |
| US-P6-04 | Must | As an owner whose Mac sleeps or network changes, I want recovery to be safe and understandable without losing cached data or duplicating commands. |
| US-P6-05 | Must | As a privacy-conscious owner, I want release artifacts, logs, diagnostics, screenshots, and caches to exclude credentials and avoid unnecessary financial exposure. |
| US-P6-06 | Must | As a tester or user installing an update, I want schema and API compatibility failures handled without corrupting or silently discarding my last good snapshot. |
| US-P6-07 | Must | As the maintainer, I want a signed, reproducible archive with a tested installation, update, support, and rollback procedure. |
| US-P6-08 | Should | As an iPad user, I want a usable adaptive layout even if the first release remains optimized for iPhone. |

## Release lanes

### Development alpha

May use an Xcode Personal Team and direct device installation. It must still pass the security boundary, Keychain, cache, crash-free launch, and physical-device connectivity checks relevant to its implemented phases. Expiring provisioning and developer-device limits must be stated to testers.

### Distributable release candidate

Requires an approved distribution path, stable application identity, release signing, privacy/support metadata, full quality matrix, update/rollback rehearsal, and no open severity-one or severity-two defect. TestFlight is the recommended first distributable lane if an Apple Developer Program membership is available.

## Required decisions

Before scheduling the release candidate, approve:

- intended audience: owner-only internal build, invited testers, or App Store;
- distribution method and Apple team ownership;
- bundle identifier, display name, version/build ownership, and minimum supported iOS/macOS versions;
- whether iPad is supported, compatible-but-unoptimized, or explicitly unavailable;
- English-only first alpha versus English and Hebrew release requirement;
- privacy policy, support contact/URL, diagnostic export policy, and financial-data retention wording;
- Mac companion minimum version and supported mobile API compatibility window;
- whether Phase 4 commands and Phase 5 Advisor are included or ship after the read-only MVP.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P6-PRD-01 | Product + release | Blocked | Approve the release lane, audience, Apple team, bundle identity, minimum OS/companion versions, iPad status, localization scope, and included feature phases. Record the decision and consequences in the decision log. |
| P6-DES-01 | Design + product | Planned | Complete the visual/state audit for every included screen in light, dark, increased contrast, Reduce Transparency, Reduce Motion, and largest accessibility text. No critical state relies on glass/translucency, color, or animation alone. |
| P6-IOS-01 | iOS accessibility | Planned | Make all included screens reflow through the largest Dynamic Type sizes. Charts, rows, sheets, buttons, navigation titles, and tab content remain legible and operable without clipped meaning or horizontal page scrolling. |
| P6-IOS-02 | iOS accessibility | Planned | Add meaningful VoiceOver labels, values, traits, grouping, headings, adjustable chart summaries, logical focus order, Switch Control reachability, keyboard/focus support where applicable, and alternatives to swipe-only/context-menu actions. |
| P6-IOS-03 | iOS localization | Planned | Move all user-facing copy, pluralization, dates, currencies, relative times, errors, and accessibility text into String Catalogs/format styles. No concatenated translated sentence fragments or hard-coded locale assumptions remain. |
| P6-IOS-04 | iOS RTL | Planned | Verify Hebrew and right-to-left mirroring while preserving correct bidirectional presentation for signed values, currencies, dates, account suffixes, charts, and mixed Hebrew/English merchant names. Snapshot and manual tests cover representative screens. |
| P6-IOS-05 | iOS adaptation | Planned | Verify supported iPhone sizes, orientation policy, sheets, safe areas, keyboard, split-view behavior if iPad is supported, and content-size changes. The smallest and largest supported devices retain every primary action. |
| P6-REL-01 | iOS + Mac reliability | Planned | Harden recovery across Wi-Fi/cellular/VPN changes, Tailscale unavailable/reconnected, Mac sleep/wake, server restart, app background/foreground, token revocation, and clock skew. Retries are bounded and commands never repeat silently. |
| P6-DAT-01 | iOS persistence | Planned | Add forward-only cache migration tests plus corrupt database, partial write, disk-full, protected-data-unavailable, Keychain-missing, server-identity-change, and fresh-install/update recovery. Preserve the last verified snapshot unless the user explicitly wipes it. |
| P6-API-01 | Backend + iOS | Planned | Maintain compatibility fixtures for the oldest supported mobile contract, current contract, unknown additive fields, missing required fields, and explicit incompatible-version responses. CI verifies both server serialization and Swift decoding. |
| P6-SEC-01 | Security | Planned | Perform a final threat/privacy review of pairing, device registry, token scopes, commands, Advisor, cache, backup/file protection, lock-screen behavior, deep links, pasteboard, screenshots, diagnostics, and revocation. Resolve all high-risk findings. |
| P6-SEC-02 | Security + QA | Planned | Run automated secret/PII scans over source-controlled fixtures, logs, crash reports, diagnostic exports, streamed events, and release archive contents. No token, provider key, local path, raw account number, or unintended financial payload is present. |
| P6-SEC-03 | Product + security + iOS | Planned | Finalize and implement privacy presentation policy: app-switcher redaction, notification previews, screenshot behavior, Face ID re-lock timing, cache file protection, backup exclusion/inclusion, clipboard use, and diagnostic consent. |
| P6-QA-01 | Performance QA | Planned | Measure cold/warm launch, cached screen render, live refresh, transaction paging/search, chart rendering, memory, energy, and Advisor streaming on the oldest supported physical device. Meet `QUALITY_GATES.md` budgets or record an approved exception. |
| P6-QA-02 | QA | Planned | Execute the full device/OS/locale/appearance/accessibility/connectivity matrix and every included phase acceptance scenario. Track evidence by requirement and close all release-blocking defects. |
| P6-QA-03 | QA + product | Planned | Run a clean physical-device end-to-end rehearsal: install, pair, authenticate, browse cached/live data, execute each included sensitive capability, revoke, recover, update, and reinstall/wipe. Retain redacted evidence. |
| P6-REL-02 | Release | Planned | Finalize icon/launch assets, bundle capabilities/entitlements, privacy manifest and nutrition-label inputs, export-compliance answer, support/privacy URLs, version/build scheme, release notes, tester instructions, and Mac companion requirements. |
| P6-REL-03 | Release + engineering | Planned | Produce a clean signed archive from the documented toolchain, validate it, install the distributed artifact rather than a debug build, run smoke tests, record checksums/build metadata, and rehearse rollback to the last supported pair of iOS/Mac versions. |

## Release validation matrix

The selected lane must document exact devices and OS versions. At minimum, exercise:

| Dimension | Required coverage |
| --- | --- |
| Device | Smallest supported iPhone, current reference iPhone, oldest supported physical iPhone; iPad classes if declared supported |
| OS | Minimum supported iOS and current shipping iOS/SDK combination |
| Appearance | Light, Dark, Increased Contrast, Reduce Transparency, Reduce Motion |
| Text/input | Default and largest accessibility text; VoiceOver; Switch Control; hardware keyboard where supported |
| Locale | English, Hebrew/RTL if in release scope, and a locale using different number/date separators |
| Connectivity | Live, offline cached, slow, interrupted, Tailscale reconnect, Mac asleep, Mac server restart |
| Identity | Fresh pair, expired/revoked token, replaced Mac identity, incompatible companion version |
| Data | Empty, typical, large history, stale cache, corrupt cache, migration from previous release |
| Lifecycle | Clean install, update, background/foreground, device reboot, reinstall/wipe, rollback rehearsal |

## Acceptance scenarios

### Accessible daily journey

Given VoiceOver and an accessibility text size, when the user pairs, checks Home, searches Activity, opens a transaction, and reviews an account, then all information and actions are announced in a logical order, content reflows, and no required action depends on color, translucency, or gesture-only discovery.

### Hebrew and financial bidirectionality

Given Hebrew and right-to-left layout, when mixed-direction merchant names, negative currency values, dates, charts, and account suffixes appear, then navigation mirrors naturally while each financial value remains correctly ordered and understandable.

### Interrupted private connection

Given the last verified snapshot and a sleeping Mac, when the app opens and Tailscale later reconnects, then cached data remains available with explicit freshness, retries remain bounded, live state recovers, and no command or Advisor turn is duplicated.

### Safe update and compatibility failure

Given an existing paired installation, when the app updates and encounters either a supported cache migration or an unsupported companion API, then migration is atomic, the last good snapshot survives, and incompatibility is explained with a safe upgrade path rather than a crash or destructive reset.

### Distributed artifact rehearsal

Given the release candidate archive, when a tester installs the actual distributed artifact on a clean physical device, then pairing and every included critical journey pass using documented companion requirements, revocation works, and rollback/update instructions are reproducible.

## Exit gate

Phase 6 passes only when:

- the release lane, identity, audience, supported platforms, localization scope, and included phases are approved;
- all included phase exit gates and the global Definition of Done pass with traceable evidence;
- critical journeys pass at largest text size with VoiceOver and non-gesture alternatives;
- declared locales and RTL render financial content unambiguously;
- compatibility, migration, corruption, sleep/reconnect, and update scenarios preserve the last verified snapshot and avoid duplicate commands;
- the final threat/privacy review has no unresolved high-risk finding and scans find no forbidden secret/data leakage;
- performance budgets pass on the oldest supported physical device or have an explicit accepted exception;
- a clean signed distributed artifact—not only a debug build—passes installation and end-to-end smoke testing;
- release metadata, support/privacy information, companion requirements, diagnostics policy, update path, and rollback procedure are complete.
