# Product specification

## Document control

| Field | Value |
| --- | --- |
| Product | Money Monitor for iOS |
| Platform | Native SwiftUI app, iOS 18+ |
| Status | Product policy accepted; implementation phased |
| Product source | [`docs/ios-mockups/PRODUCT.md`](../../docs/ios-mockups/PRODUCT.md) |
| Design source | [`docs/ios-mockups/DESIGN.md`](../../docs/ios-mockups/DESIGN.md) |
| Recommended first release scope | Phases 0–3, private trusted-circle read-only MVP |
| Source of truth | Money Monitor Mac app and local SQLite |
| First transport | Private Tailscale HTTPS connection to the Mac |

## 1. Problem statement

Money Monitor owners can see their full financial picture only while using the Mac application, even though the most common jobs—checking today's position, finding a transaction, reviewing a budget, or checking whether accounts are fresh—are short, mobile moments. A desktop-shaped remote interface would be slow and awkward, while a cloud migration would violate the user's requirement that bank credentials, scraping, and authoritative data remain on the Mac.

The iOS app must therefore provide a trustworthy native read experience over a private Mac connection, remain useful with a clearly timestamped saved snapshot, and never imply that cached or partially loaded information is live. The cost of not solving this is continued dependence on the Mac for routine review and a high risk that an expedient mobile solution weakens the product's privacy boundary.

## 2. Evidence and hypotheses

Confirmed inputs:

- The user requires bank credentials and scraping to stay on the Mac.
- The Mac app and local SQLite are authoritative.
- Tailscale-first, fully local connectivity is preferred before any cloud work.
- The intended audience is the maintainer plus a small trusted circle of family and friends; this is not a public or multi-tenant service.
- The approved mockup set contains 26 screens across setup, daily review, planning, Advisor, control, resilience, and appearance.
- The packaged Electron app currently uses a random loopback port and a process-scoped full-access token, so a stable mobile pairing boundary does not yet exist.

Product hypotheses to validate during dogfood:

- Home, transaction lookup, budgets, net worth, and freshness cover most mobile sessions.
- Users prefer a useful read-only app sooner to waiting for all desktop mutations.
- Clear live/cached language increases trust without forcing users to understand Tailscale, Fastify, or SQLite.
- Advisor is valuable after core financial data is reliable, not before.

## 3. Users and use contexts

### Primary persona — trusted-circle user

Uses a personally approved iPhone to access one trusted Money Monitor Mac. The Mac owner explicitly approves and can revoke every phone; approved users receive the same product surface without accounts or roles.

Typical contexts:

- one-handed daily check away from the desk;
- searching for a merchant or transaction while discussing a purchase;
- checking a budget before spending;
- confirming whether the latest scrape succeeded;
- browsing the last saved picture while the Mac sleeps or is unreachable.

### Operational actor — Mac owner approving a device

Uses the Mac app to begin pairing, verify the iPhone, grant capabilities, inspect paired devices, and revoke access. This is part of the end-user journey, not an invisible engineering step.

## 4. Jobs to be done

1. When I have a brief moment, help me understand my current financial position without opening the Mac.
2. When I remember a purchase, help me find and understand the transaction quickly.
3. When I am making a spending decision, help me see budget and net-worth context.
4. When data might be old, tell me plainly when it was generated and what is unavailable.
5. When I lose or replace an iPhone, let me revoke it from the Mac without changing bank credentials.
6. When I ask Advisor a question, use the correct Money Monitor context and do not take an action I did not approve.

## 5. Product goals

Targets are initial dogfood thresholds and should be revised after at least five representative sessions.

| Goal | Success threshold | Stretch | Measurement |
| --- | --- | --- | --- |
| Fast private activation | At least 90% of supported pairing attempts reach Home within 3 minutes | 95% within 2 minutes | Timed physical-device pairing script; local diagnostics event sequence |
| Immediate daily value | Cached Home becomes readable within 1 second p95; live Home within 3 seconds p95 after connection | 0.5 seconds cached; 2 seconds live | XCTest signposts and physical-device performance run |
| Glance comprehension | At least 90% of task participants correctly identify available money, current-period spending/budget state, and freshness within 10 seconds of unlock | 95% within 7 seconds | Seeded usability task with fixed start/end events |
| Efficient transaction lookup | At least 90% of usability tasks find the target transaction within 60 seconds | 95% within 30 seconds | Moderated task script using seeded data |
| Truthful freshness | 100% of cached, stale, partial, and offline test cases expose a human-readable timestamp/state | Same state is correct in VoiceOver | Automated state snapshots plus manual accessibility audit |
| Preserve privacy boundary | Zero bank credentials, scraper secrets, desktop bearer tokens, or unmasked account identifiers in iOS storage/logs/fixtures | Automated secret scan in CI | Storage inspection, log scan, API contract tests, security review |
| Accessible core journeys | Setup, Home, search, transaction detail, Plan, and offline browsing pass the accessibility matrix | No high-severity findings across all screens | Manual audit plus UI tests at accessibility text sizes |

## 6. Business and project goals

- Create a durable mobile API boundary that can later change transport without rewriting SwiftUI features.
- Validate that the local-first architecture provides enough mobile utility before investing in cloud infrastructure.
- Keep the Mac application backward compatible for people who never install the iOS app.
- Produce phase-sized work that can be implemented and verified incrementally in Xcode.

## 7. Non-goals

- **Cloud-hosted credentials or scraper execution:** contradicts the current trust boundary and is a separate architecture initiative.
- **Direct iPhone access to SQLite:** couples the client to storage and creates a second authority.
- **Bank login on iPhone:** credentials and institution automation stay on the Mac.
- **Broad LAN exposure:** Fastify must not bind to `0.0.0.0` as a shortcut for discovery.
- **Offline writes:** queued mutations introduce conflict and authorization behavior not needed for the first release.
- **Full desktop administration:** account deletion, credential editing, provider configuration, and destructive maintenance remain Mac-only unless separately approved.
- **Custom glass component library:** standard SwiftUI controls provide the native Liquid Glass behavior; financial content remains flat.
- **Analytics that transmit financial content:** product measurement must not export merchant names, amounts, account identifiers, messages, or tokens.

## 8. Product principles

1. **Glance first, details on demand.** Show the few numbers and decisions that matter now, then navigate natively for depth.
2. **Truth before freshness theater.** A saved value with an honest timestamp is better than a spinner or an unlabeled stale value.
3. **Mac authority is visible but quiet.** Explain what the user needs without exposing infrastructure jargon during normal use.
4. **Read before write.** Stabilize DTOs, caching, and recovery before granting command capabilities.
5. **Native before novel.** Prefer SwiftUI navigation, search, lists, sheets, typography, accessibility, and motion.
6. **Every amount has context.** Currency, period, source time, and comparison are explicit when they affect interpretation.
7. **Capabilities are narrow.** Pairing an iPhone never grants the full desktop API token.

## 9. Release increments

### Increment A — Internal connectivity prototype

Phase 0 only. Proves a physical iPhone can pair with a stable private Mac endpoint and decode a safe bootstrap fixture.

### Increment B — Private read-only MVP

Phases 1–3. Provides trustworthy setup, offline browsing, everyday money, planning, accounts, and sync history. This is the recommended first genuinely useful release.

### Increment C — Trusted commands

Phase 4. Adds only commands approved in the capability matrix, with audit and conflict behavior.

### Increment D — Advisor

Phase 5. Adds safe streaming conversations after the financial read model is reliable.

### Increment E — Distribution candidate

Phase 6. Completes scoped accessibility, mixed Hebrew/English content checks, resilience, privacy, signing, and release readiness for private distribution.

## 10. Critical user journeys

### Journey A — Pair a new iPhone

1. Owner opens “Connect iPhone” on the Mac.
2. Mac creates a short-lived pairing session and displays a QR code.
3. iPhone scans the code or accepts the private address manually.
4. Mac displays the requesting device and asks for approval.
5. Approval issues a revocable, scoped device token.
6. iPhone stores the token in Keychain, validates compatibility, loads bootstrap, and offers Face ID.
7. Both devices show success; the Mac lists the paired iPhone.

Failure branches: expired code, wrong Tailnet, Mac unavailable, approval denied, unsupported protocol, revoked token, TLS failure, and interrupted scan.

### Journey B — Daily check

1. User authenticates on cold launch or after the accepted two-minute background grace.
2. Home immediately shows the valid saved snapshot, if present.
3. App refreshes privately when the Mac is reachable.
4. Content updates atomically and shows a current timestamp.
5. Partial or failed sections do not erase the prior valid snapshot.

### Journey C — Find a transaction

1. User opens the trailing Search tab or Activity.
2. Search debounces input and preserves filters.
3. Results identify merchant, category/date, account context, and amount.
4. Detail explains status, ownership, notes, and review state using mobile-safe fields.
5. Returning preserves the query, filters, and scroll position.

### Journey D — Browse while the Mac is unavailable

1. App unlocks the encrypted saved snapshot.
2. Root state clearly says the Mac is unavailable and when data was saved.
3. Read screens remain available.
4. Network-only and command controls are disabled with an explanation.
5. Retry restores live data without losing navigation context.

### Journey E — Revoke a lost device

1. Owner opens paired devices on the Mac.
2. Owner identifies the device by name and last-used time.
3. Owner revokes it with confirmation.
4. Subsequent requests fail with a stable revocation error.
5. The iOS app locks protected content and follows the accepted cache-retention policy.

### Journey F — Ask Advisor

1. User sees whether Advisor is available and what data timestamp it will use.
2. User starts or resumes a session.
3. Response streams with cancel/retry behavior.
4. Read-only answers cite the relevant period/context in plain language.
5. Any later action requires an explicit, narrow confirmation before execution.

## 11. Cross-app user stories

| ID | Priority | User story | Phase |
| --- | --- | --- | --- |
| US-G-01 | Must | As a Mac owner, I want bank credentials and scraping to remain on my Mac so that mobile access does not weaken my privacy model. | All |
| US-G-02 | Must | As a Mac owner, I want to approve and revoke each iPhone so that possession of a private URL alone does not grant access. | 0–1 |
| US-G-03 | Must | As an iPhone user, I want every financial view to disclose whether it is live or saved so that I can judge the information correctly. | 1–6 |
| US-G-04 | Must | As an iPhone user, I want the latest valid snapshot to remain browsable when the Mac is unavailable so that the app is still useful away from home. | 1–6 |
| US-G-05 | Must | As an iPhone user, I want financial content protected by device authentication and the app switcher so that nearby people cannot see it. | 1 |
| US-G-06 | Must | As an iPhone user, I want native navigation, search, lists, sheets, and accessible controls so that the app behaves like iOS. | All |
| US-G-07 | Must | As a VoiceOver or large-text user, I want the same financial meaning and task completion as a sighted default-text user. | All |
| US-G-08 | Must | As an iPhone user, I want errors to preserve valid content and explain recovery so that a temporary connection problem is not a dead end. | All |
| US-G-09 | Should | As a Mac owner, I want safe diagnostics without financial content so that pairing or sync problems can be debugged privately. | 0–6 |
| US-G-10 | Must | As a trusted-circle user, I want my phone individually approved and revocable so that private sharing requires no cloud account or household-role system. | 0–1 |

Phase-specific stories live in each phase file.

## 12. Global requirements

### Must-have requirements

| ID | Requirement |
| --- | --- |
| REQ-PRIV-01 | No bank credential, scraper secret, provider key, encryption master key, or desktop bearer token may enter the iOS bundle, storage, logs, fixtures, screenshots, or diagnostics. |
| REQ-PRIV-02 | The Mac and SQLite remain authoritative; the iPhone cache is replaceable and non-authoritative. |
| REQ-NET-01 | Mobile traffic uses a private Tailscale HTTPS route while Fastify remains on loopback. |
| REQ-SEC-01 | Each iPhone receives a unique, revocable, least-privilege device credential stored in Keychain. |
| REQ-SEC-02 | Pairing requires short-lived proof plus explicit Mac approval; scanning a code alone is insufficient. |
| REQ-SEC-03 | Protected financial content is covered while locked and in app-switcher snapshots. |
| REQ-API-01 | iOS consumes `/api/mobile/v1` DTOs, never raw desktop database rows. |
| REQ-API-02 | Responses use stable envelopes, schema version, generated timestamp, safe error code, and request ID where applicable. |
| REQ-DAT-01 | A complete successful refresh replaces the saved snapshot atomically; partial or incompatible data cannot overwrite it. |
| REQ-DAT-02 | Saved mobile DTOs are encrypted at rest and have an explicit retention/wipe policy. |
| REQ-FRESH-01 | Live, refreshing, cached, stale, partial, unavailable, revoked, and incompatible states are distinguishable in text and accessibility output. |
| REQ-UI-01 | The five top-level destinations are Home, Activity, Plan, Advisor, and trailing Search, matching the approved information architecture. |
| REQ-UI-02 | Financial content remains flat; Liquid Glass is limited to standard navigation and interactive control layers. |
| REQ-A11Y-01 | Core workflows support Dynamic Type, VoiceOver, Bold Text, Increased Contrast, Reduce Transparency, Reduce Motion, Switch Control, and non-color status meaning. |
| REQ-FMT-01 | Money carries decimal value and currency; dates distinguish financial dates from UTC instants; formatting is locale-aware. |
| REQ-CMD-01 | Commands are unavailable offline and require an explicit capability; no general desktop CRUD token is accepted. |
| REQ-AI-01 | Advisor cannot perform an unconfirmed mutation and must disclose unavailable/stale context. |
| REQ-COMP-01 | Incompatible required API versions preserve the prior snapshot and direct the user to update rather than decoding partially. |

### Should-have requirements

| ID | Requirement |
| --- | --- |
| REQ-DIAG-01 | Users can export redacted diagnostics containing versions, state transitions, request IDs, and timing but no financial payload. |
| REQ-NET-02 | Retry behavior uses bounded backoff and cancels when the app or task no longer needs the request. |
| REQ-UI-03 | Navigation state, search query, filters, and scroll position survive ordinary detail navigation. |
| REQ-A11Y-02 | Swift Charts expose text summaries and Audio Graphs where appropriate. |
| REQ-L10N-01 | English UI correctly lays out Hebrew merchant content, signed values, and bidirectional punctuation without requiring full UI localization. |
| REQ-OBS-01 | Performance and reliability measurement is privacy-safe and disabled from sending financial content by construction. |

### Explicit out-of-scope constraints

| ID | Requirement |
| --- | --- |
| REQ-ROLE-01 | No household roles or per-person permissions; every approved trusted device receives the accepted product surface. |
| REQ-CLOUD-01 | No Money Monitor cloud transport, identity, storage, or scraper execution. |
| REQ-PUSH-01 | No APNs/native iPhone push; Telegram alerts remain Mac-owned. |
| REQ-MULTI-01 | One paired Mac per iPhone installation; switching requires Disconnect and fresh pairing. |
| REQ-OFFCMD-01 | No offline command queue. Commands require a live Mac. |

## 13. Non-functional requirements

### Performance

- Warm cached launch to readable Home: at most 1 second p95 on the oldest supported test device.
- Live bootstrap after an established private connection: at most 3 seconds p95, excluding an explicitly surfaced long-running Mac scrape.
- Search input debounce: 250–350 ms; first page visible within 2 seconds p95 under the standard test dataset and healthy Tailnet.
- Scrolling lists maintain responsive interaction with at least 500 fixture transactions.
- Refresh never blanks already valid content.

### Reliability

- Mac sleep/wake, app relaunch, Tailnet interruption, request cancellation, token revocation, and schema mismatch have deterministic recovery paths.
- Corrupted or partially written snapshot data is rejected without crashing.
- One failing bootstrap section does not erase other valid sections or the prior snapshot.
- Repeated retries are bounded and visible when user action is required.

### Security and privacy

- Threat model covers lost phone, stolen pairing code, replay, token extraction, malicious LAN client, log leakage, revoked device, and compromised Tailnet member.
- Device credentials are random, individually identifiable, least privilege, rotatable, and revocable.
- Sensitive values use appropriate Keychain accessibility and are not synchronized through iCloud unless explicitly accepted.
- Production logging is metadata-only and redacted.

### Accessibility and localization

- No fixed-height production text containers.
- Controls have at least a 44 by 44 point target where practical.
- Amounts announce sign, currency, and context.
- Status always combines icon/label with color.
- Mixed Hebrew/English merchant data and accessibility text sizes are covered before the read-only MVP gate.

## 14. Measurement plan

The product is local-first, so measurement should default to local test evidence rather than introducing a cloud analytics dependency.

Allowed measurement sources:

- XCTest metrics and signposts using synthetic or redacted fixtures;
- structured physical-device QA scripts;
- TestFlight crash/hang metrics if that distribution channel is chosen;
- optional local diagnostic counters exportable by the owner;
- moderated usability sessions using seeded data.

Disallowed analytics payloads:

- merchant/search text;
- amounts, balances, budgets, categories, account identifiers, or transaction IDs;
- Advisor prompts or responses;
- Tailnet URL, bearer token, pairing nonce, or device credential;
- raw API bodies.

## 15. Assumptions and dependencies

- The Mac is powered on and reachable for the accepted Phase 2A/2B live lane; Phase 1 saved data will cover temporary unavailability in the broader MVP.
- Both devices can use the same Tailnet for the first implementation.
- Existing services remain the calculation source behind mobile DTOs.
- The iOS app can require iOS 18 while building with the stable iOS 26 SDK.
- A physical iPhone is available for Phase 0 and Phase 1 acceptance.
- The owner can update the Mac app when a compatible mobile gateway is introduced.
- Direct Xcode installation remains the development lane; private TestFlight is the family/friend distribution target after the read-only gate.

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pairing bridge leaks full desktop authority | Critical privacy/security failure | Separate route/plugin, scoped device credentials, negative authorization tests |
| Random packaged port breaks a static Serve mapping | Onboarding works only until restart | Own Serve lifecycle or stable loopback gateway and test restart recovery |
| DTOs mirror SQLite rows | Client breakage and sensitive field leakage | Explicit schemas, allowlisted serialization, fixture/secret scans |
| Offline snapshot is mistaken for live data | Incorrect financial decisions | Generated timestamp and root freshness state in visual and spoken output |
| Scope expands to mutations before read model stabilizes | Slow delivery and unsafe authorization | Make Phases 0–3 a standalone release gate; block Phase 4 on capability matrix |
| Advisor can call mutating tools | Unapproved data changes | Read-only tool allowlist first; confirmation contract before any command |
| Trusted-circle use expands beyond one technical owner | Private financial data is shown without sufficient protection | Resume Phase 1 before family/friend distribution and keep native accessibility checks in every feature |
| No cloud telemetry hides reliability issues | Slow debugging | Redacted local diagnostics and structured dogfood scripts |

## 17. Resolved product questions

| ID | Resolution | Decision |
| --- | --- | --- |
| OQ-01 | Trusted-circle owner-equivalent access | D-020 |
| OQ-02 | Long-lived, per-device, rotatable, individually revocable mobile credentials | D-014/D-020 |
| OQ-03 | Latest encrypted snapshot, 30-day retention, 24-hour stale threshold, explicit wipe rules | D-021 |
| OQ-04 | Mandatory system device authentication, passcode fallback, two-minute background grace | D-021 |
| OQ-05 | Jerusalem month-to-date, matching prior-month elapsed days, ILS, Mac-owned conversion | D-022 |
| OQ-06 | Mac-owned ILS conversion with original value/rate timestamp and stale/partial disclosure | D-023 |
| OQ-07 | Narrow live-only review/transaction/budget/category/Telegram/sync command allowlist | D-024 |
| OQ-08 | iPhone may request Mac sync; OTP/manual attention stays on Mac | D-024 |
| OQ-09 | Advisor v1 is read-only with no AI memory writes or direct actions | D-025 |
| OQ-10 | Direct Xcode development, then private TestFlight; no App Store | D-026 |
| OQ-11 | Cloud, native push, roles, and simultaneous multi-Mac profiles are out of scope | D-020/D-026 |

The exact accepted behavior is centralized in [Locked product policy](../Documentation/LOCKED_PRODUCT_POLICY.md).

## 18. Timeline considerations

- Phase 2A and Phase 2B are accepted historical live-only slices. Their sole-owner exception is superseded by D-020 for planned trusted-circle use.
- Phase 1 product policy is resolved and its coordinated Mac/iOS implementation is next before family/friend distribution or offline storage.
- Phase 2 can begin against frozen fixtures while Phase 0 server work proceeds, but live integration cannot pass early.
- Phase 3 should reuse the Phase 2 repository/state patterns rather than create separate networking behavior.
- Phase 4 and Phase 5 policies are accepted but their implementation may ship after the private read-only MVP.
- Phase 6 accessibility and reliability tasks are partly continuous quality gates; only final matrix completion waits until the end.
