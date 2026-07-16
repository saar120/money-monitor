# Phase 0 — Foundation and private bridge

## Outcome

A packaged Money Monitor Mac and a physical iPhone can establish a stable, authenticated, least-privilege connection over Tailscale HTTPS; the phone can load one versioned, masked bootstrap payload; Mac and iPhone restarts do not break the pairing.

Delivery checkpoint: **internal connectivity prototype**  
Current phase status: **in progress — implementation and signed physical harness ready; physical acceptance pending**

## Why this phase exists

The current SwiftUI shell can call public health, but the packaged Mac app starts Fastify on a random loopback port and generates a new full-access desktop token on each launch. Hard-coding port `3000`, binding Fastify to the LAN, or copying the desktop token to iOS would create a demo that either breaks after restart or violates the privacy model.

Phase 0 creates a durable mobile boundary before feature screens consume financial data.

## User stories

| ID       | Priority | User story                                                                                                                                                 |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-P0-01 | Must     | As a Mac owner, I want to explicitly enable private mobile access so that the desktop server is not exposed to my LAN by default.                          |
| US-P0-02 | Must     | As an iPhone owner, I want to pair with a specific trusted Mac using a short-lived code so that a copied URL alone does not grant access.                  |
| US-P0-03 | Must     | As a Mac owner, I want to approve, name, inspect, rotate, and revoke each device so that lost devices do not retain indefinite access.                     |
| US-P0-04 | Must     | As a paired user, I want access to survive Mac and iPhone restarts so that pairing is not a per-session developer workflow.                                |
| US-P0-05 | Must     | As an iPhone user, I want a coherent masked bootstrap payload so that Home does not combine values calculated at different times.                          |
| US-P0-06 | Must     | As a user with a setup failure, I want to know whether the problem is Tailscale, expiry, approval, authentication, or compatibility so that I can recover. |
| US-P0-07 | Must     | As a developer, I want reproducible project generation, fixtures, and tests so that feature work starts from a stable baseline.                            |

## Scope

Included:

- Xcode project baseline and native navigation shell.
- Stable private URL lifecycle for the packaged random Fastify port.
- Mobile-specific authentication and authorization.
- Pairing session, Mac approval, device registry, rotation, and revocation.
- Versioned `/api/mobile/v1` envelope and bootstrap DTO.
- Minimal iOS pairing exchange, Keychain profile, authenticated bootstrap, and compatibility handling.
- Contract, authorization, restart, and physical-device verification.

Not included:

- Final onboarding presentation and Face ID choice; Phase 1.
- Encrypted financial snapshot and offline UI; Phase 1.
- Complete Home/Activity UI; Phase 2.
- Any mobile mutation or general desktop endpoint.
- Cloud relay, push notification, multi-Mac, or household roles.

## Proposed pairing protocol

This is the implementation starting point; `P0-SEC-01` freezes the final schema and threat model.

1. Owner enables Mobile Access in the Mac app.
2. Mac verifies Tailscale state and owns a stable HTTPS route to the current loopback port.
3. Mac creates a random, short-lived, single-use pairing session and stores only a digest of its nonce.
4. QR contains no bank credential or desktop token. Illustrative payload:

```json
{
  "protocolVersion": "1",
  "serverId": "opaque-stable-id",
  "baseURL": "https://money-monitor.example.ts.net/mobile",
  "pairingId": "opaque-session-id",
  "nonce": "single-use-random-value",
  "expiresAt": "2026-07-14T12:05:00Z"
}
```

5. iPhone submits device name, pairing ID, nonce, and supported versions. The successful starter receives a separate 256-bit claimant secret; later status/exchange calls require it, so another copy of the QR cannot race the accepted phone.
6. Mac hides the consumed QR, shows the pending device, and requires explicit approve/reject.
7. On approval, the server mints one opaque 256-bit device token. The same claimant may retry delivery until the pairing expires, but retry never mints a second device or credential.
8. Mac persists only the token digest and device metadata. The raw token exists temporarily in the approved in-memory pairing session for retry and durably only in iOS Keychain.
9. Protected mobile requests use the device token and explicit capabilities such as `mobile.read`.
10. Revocation immediately rejects future connected requests; offline cache behavior is defined in Phase 1.

Required errors include invalid payload, expired nonce, replay, rejected request, approval timeout, wrong server, Tailscale unavailable, authentication revoked, insufficient capability, and upgrade required.

## Task backlog

### P0-PRD-01 — Freeze MVP actor and security decisions

Owner: Product + security  
Status: **Done**  
Priority: Must  
Dependencies: none

Accepted baseline, 2026-07-15:

- Owner-only private beta with multiple individually approved personal devices and no household roles.
- Mobile Access is opt-in; missing Tailscale never blocks the desktop app.
- Pairing proof and approval expire after five minutes, are single-use, and are rate-limited to five invalid attempts per minute per source/session before a safe temporary rejection.
- Device credentials are opaque 256-bit values, returned once, long-lived until explicit rotation/revocation, digest-only on Mac, and initially carry only `mobile.read`.
- `serverId` is a persisted random identifier; pairing `protocolVersion` and mobile `apiVersion` start at `1` and remain independent of app marketing versions.
- Remote revocation takes effect on the next connected request; it cannot erase a phone that remains offline. Phase 1 owns cache retention and lock policy.
- Decisions are recorded as D-011 through D-016 and [ADR-001](../Documentation/ADR-001-MOBILE-ACCESS-BRIDGE.md).

How:

- Confirm the private prototype is owner-only and whether multiple owner devices are allowed.
- Record pairing nonce lifetime, approval timeout, request rate limits, token lifetime/rotation, device naming, and revocation behavior.
- Define stable `serverId`, `protocolVersion`, `apiVersion`, and `minimumClientVersion` semantics.
- Confirm mobile access is opt-in and that the Mac remains usable when Tailscale is unavailable.
- Threat-model QR replay, Tailnet member access, lost phone, token/log leakage, downgrade, and LAN exposure.

Acceptance:

- [x] OQ-01 and OQ-02 in the product spec are accepted or explicitly deferred with a safe default.
- [x] No mobile payload or QR contains a desktop bearer token, bank credential, or encryption master key.
- [x] The spec states that server revocation cannot erase an offline phone until it reconnects.
- [x] The accepted decisions are recorded in [`DECISIONS.md`](../Documentation/DECISIONS.md).

### P0-IOS-01 — Establish reproducible Xcode baseline

Owner: iOS + QA  
Status: **Done**  
Priority: Must  
Dependencies: none

Implemented:

- XcodeGen `project.yml` is the project-setting source of truth.
- Application, Swift Testing, and UI-test targets exist.
- Project targets iOS 18 with Swift 6 and the current iOS 26 SDK.

Verified evidence:

- [x] Project regenerates and opens in Xcode.
- [x] Generic simulator build passes.
- [x] Unit tests and launch UI smoke test pass.
- [x] No third-party runtime dependency or sample financial data is bundled.

### P0-IOS-02 — Establish native app/navigation shell

Owner: iOS  
Status: **Done**  
Priority: Must  
Dependencies: P0-IOS-01

Implemented:

- SwiftUI app lifecycle and injected `AppEnvironment`.
- Home, Activity, Plan, Advisor, and system Search destinations.
- Semantic tint/spacing scaffold and feature-first source tree.
- Standard controls that receive native Liquid Glass behavior on iOS 26.

Acceptance:

- [x] Shell compiles for both simulator architectures.
- [x] Navigation does not manually recreate the tab bar or glass materials.
- [x] Feature placeholders make unimplemented scope explicit.

### P0-IOS-03 — Establish public health client

Owner: iOS networking  
Status: **Done**  
Priority: Must  
Dependencies: P0-IOS-01

Implemented:

- Typed `GET /api/mobile/v1/health` endpoint and versioned ISO-8601 response decoder.
- HTTPS-only manual address normalization.
- Timeout and non-2xx classification at the networking boundary.

Acceptance:

- [x] URL and response decoding tests pass.
- [x] No token or financial response is required for the health smoke check.
- [x] Starter failure copy does not claim pairing is complete.

### P0-QA-01 — Protect the starter baseline

Owner: QA  
Status: **Done**  
Priority: Must  
Dependencies: P0-IOS-01 through P0-IOS-03

Acceptance:

- [x] Swift 6 compile passes with strict sendability at the networking seam.
- [x] UI test proves launch reaches Connect to Mac.
- [x] Asset catalogs and local documentation links validate.

### P0-ARC-01 — Choose and document stable endpoint ownership

Owner: Mac + backend architecture  
Status: **Done**  
Priority: Must  
Dependencies: P0-PRD-01

How:

- Compare two acceptable implementations: reconfigure a Money Monitor-owned Tailscale Serve route after each random port start, or introduce a stable loopback mobile gateway that proxies to Fastify.
- Preserve unrelated existing Serve routes and fail closed if ownership is ambiguous.
- Keep Fastify bound to `127.0.0.1`; do not add an ATS exception or LAN listener.
- Define startup ordering, shutdown cleanup, Mac sleep/wake behavior, and diagnostic states.
- Record the selection as an ADR before implementation.

Acceptance:

- [x] Stable public-to-Tailnet URL ownership and cleanup behavior are unambiguous.
- [x] Two Mac restarts with different Fastify ports remain addressable through the same private URL.
- [x] Missing/logged-out Tailscale does not prevent the desktop app from launching.
- [x] Disabling Mobile Access removes only Money Monitor-owned exposure.

### P0-MAC-01 — Implement Tailscale Serve/mobile-gateway coordinator

Owner: Mac/Electron  
Status: **Done**  
Priority: Must  
Dependencies: P0-ARC-01

How:

- Start the coordinator only after Fastify reports its actual loopback port.
- Use an injected process or Tailscale LocalAPI adapter; never interpolate a shell command from user input.
- Prefer the direct Tailscale app executable over launcher scripts, resolve packaged-GUI-safe fallback locations, and set `TAILSCALE_BE_CLI=1` for app-bundled CLI use.
- Before inspecting or mutating Serve, run a bounded, peer-free Tailnet readiness preflight and reduce its response to fixed diagnostic enums without retaining domain or peer data.
- Detect not installed, logged out, machine authorization required, HTTPS-certificate consent required, not ready, route conflict, running, disabled, and failed states.
- Stop before Serve mutation and ownership writes when readiness or HTTPS-certificate consent is missing.
- On timeout or output overflow, terminate the entire owned CLI process tree so launcher children cannot survive the attempt.
- Reapply/verify mapping after app restart and resume as required by the ADR.
- Redact URLs if they ever contain sensitive query material; the chosen route should not.

Acceptance:

- [x] Stable HTTPS route reaches the current random port across repeated restarts.
- [x] Fastify still listens only on loopback.
- [x] Unrelated Serve configuration is preserved byte-for-byte or semantically unchanged.
- [x] Desktop-only users see no startup regression.
- [x] Coordinator behavior is integration-tested through its adapter seam.

### P0-MAC-02 — Add Mobile Access settings to the Mac app

Owner: Mac UI + design  
Status: **Done**  
Priority: Must  
Dependencies: P0-MAC-01, P0-SEC-01, P0-SEC-02

How:

- Add opt-in enable/disable, transport status, stable address, “Pair iPhone,” QR refresh, pending requests, paired devices, last used, rotate/re-pair, and revoke.
- Keep port/token/Tailscale implementation details behind progressive disclosure.
- Display the requesting device before approval and require an explicit action.
- Make QR/session expiry visible without logging its contents.

Acceptance:

- [x] Mobile Access is off until intentionally enabled.
- [x] Rejecting or expiring a request creates no device record.
- [x] Revoked devices visibly remain revoked and cannot silently reactivate.
- [x] Tokens, nonce text, bank data, and credential references are never shown or logged; the nonce exists only inside the expiring QR.
- [x] Mac settings remain fully operable without an iPhone.

### P0-SEC-01 — Freeze and implement pairing-session protocol

Owner: Security + shared API  
Status: **Done**  
Priority: Must  
Dependencies: P0-PRD-01, P0-ARC-01

How:

- Define QR, request, approval polling/status, claim, rejection, expiry, and retry schemas.
- Generate cryptographically random pairing ID/nonce and a separate claimant secret; retain only their digests with expiry in the session state.
- Make nonce single-use and invalidate pending sessions safely on Mac restart.
- Rate-limit invalid attempts and avoid distinguishing secrets through timing or verbose errors.
- Check protocol compatibility before accepting approval.

Acceptance:

- [x] Captured QR cannot be claimed after expiry or by a second scanner after the first accepted start; claimant retry is bound to its separate secret.
- [x] Mac approval is mandatory before token delivery.
- [x] Restart invalidates pending sessions without creating devices.
- [x] TypeScript and Swift decode the same success/error fixtures.
- [x] Invalid, expired, replayed, rejected, and incompatible requests have stable safe error codes.

### P0-SEC-02 — Persist paired devices and enforce scoped tokens

Owner: Mac/backend security  
Status: **Done**  
Priority: Must  
Dependencies: P0-SEC-01, P0-API-01

How:

- Store device ID, user-visible name, token digest, capabilities, created/last-used/expiry/revoked timestamps, and protocol metadata.
- Mint the raw token once after approval; allow only the bound claimant to retry delivery from the expiring in-memory session.
- Verify tokens using a timing-safe digest comparison and deny by default.
- Support immediate revoke and explicit rotation/re-pair.
- Update `lastUsedAt` without making the financial request depend on a fragile write.

Acceptance:

- [x] Pairing remains valid through a fresh registry/process instance over the same database.
- [x] Plaintext device token is absent from SQLite, config, logs, errors, diagnostics, and backups.
- [x] Revoked token returns `401 authentication_revoked` on its next connected request.
- [x] Rotation invalidates the previous token.
- [x] A `mobile.read` token cannot access any desktop route or undeclared mobile capability.

### P0-API-01 — Add isolated `/api/mobile/v1` route and envelope

Owner: Backend API  
Status: **Done**  
Priority: Must  
Dependencies: P0-PRD-01

How:

- Register an encapsulated mobile route plugin separate from the general desktop routes.
- Authenticate protected mobile paths with device credentials; keep desktop auth unchanged.
- Exempt only health and explicitly named short-lived pairing endpoints.
- Implement consistent `data/meta` success and `error/meta` failure envelopes.
- Deny newly added mobile routes unless their required capability is declared.
- Apply `Cache-Control: no-store` to every mobile response.

Acceptance:

- [x] Existing desktop auth tests remain green.
- [x] Missing, malformed, expired, revoked, and wrong-capability tokens return distinct safe errors.
- [x] Mobile token receives forbidden/unauthorized from accounts deletion, settings, scraping, AI, and all desktop routes.
- [x] Error/log output contains no token, stack trace, filesystem path, or payload.
- [x] Every mobile response disables HTTP storage with `Cache-Control: no-store`.

### P0-API-02 — Freeze bootstrap schema and fixtures

Owner: Shared API + iOS  
Status: **Done**  
Priority: Must  
Dependencies: P0-API-01

How:

- Maintain the executable Zod contract and canonical success/error fixtures; export formal JSON Schema or OpenAPI before marking this task Done.
- Minimum content: server identity/version/capabilities, snapshot ID, generated time, Home aggregates/periods, budget pulse, review count, recent transactions, masked account freshness, and latest sync summary.
- Use decimal-string money with currency, opaque IDs, safe enums, and server-side masking.
- Define completeness/cacheability and compatibility metadata before feature payload decoding.
- Include empty, partial-error, incompatible, redaction, mixed-language, and mixed-currency fixtures.

Acceptance:

- [x] Every aggregate states its period and calculation timestamp.
- [x] No accepted response fixture contains credential references, full account numbers, hashes, raw rows, or floating-point money; the explicit negative redaction fixture is rejected.
- [x] Unknown optional fields decode; unknown required schema versions are rejected.
- [x] TypeScript validation and Swift decoding use identical fixture files.
- [x] Formal Draft 2020-12 JSON Schema is generated from and drift-checked against the frozen executable contract.

### P0-API-03 — Implement bootstrap DTO adapter

Owner: Backend API/services  
Status: **Done**  
Priority: Must  
Dependencies: P0-SEC-02, P0-API-02

How:

- Build DTOs directly over existing service seams; do not call desktop HTTP routes internally or serialize Drizzle rows wholesale.
- Capture one snapshot ID and `generatedAt` for the assembled response.
- Allowlist every field and mask account identifiers before serialization.
- Treat a section failure according to the frozen complete/partial contract; never mark an invalid partial response cacheable.

Acceptance:

- [x] Authorized `mobile.read` request returns the approved envelope.
- [x] All required sections reconcile to one snapshot/calculation point and explicit Jerusalem finance date.
- [x] Account identifiers are masked server-side.
- [x] Contract, redaction, capability, and service-failure tests pass.

### P0-IOS-04 — Implement minimal pairing exchange client

Owner: iOS networking  
Status: **Done**  
Priority: Must  
Dependencies: P0-SEC-01

How:

- Add typed QR payload, pairing request/status/claim models, and endpoint cases.
- Keep payload input dependency-injected for tests and previews; the native one-shot VisionKit QR camera flow was implemented early and is wired into the production app.
- Validate HTTPS, protocol version, server identity, expiry, and required fields before network use.
- Keep invalid/cancelled sessions out of persistent storage.

Acceptance:

- [x] Valid typed responses can request, wait for approval, and claim a credential.
- [x] Invalid, expired, non-HTTPS, and unsupported-version payloads never create a paired profile.
- [x] Cancellation stops polling and creates no Keychain item.
- [x] Errors remain distinct enough for Phase 1 recovery copy.

### P0-SEC-03 — Store paired profile in Keychain

Owner: iOS security  
Status: **Done**
Priority: Must  
Dependencies: P0-IOS-04, P0-SEC-02

How:

- Store token with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` unless the security review selects a stricter compatible class.
- Persist server ID, base URL, device ID, capabilities, and compatibility metadata as a validated paired profile.
- Keep device token separate from the later snapshot-encryption key.
- Inject a protocol-backed credential store for tests.
- Permit re-pair replacement only when both stable server ID and device ID match the stored profile.

Acceptance:

- [x] Pairing survives app/device restart and never falls back to `UserDefaults` for secrets.
- [x] Keychain failure cannot report successful pairing.
- [x] Disconnect deletes the credential/profile according to policy.
- [x] Token is absent from logs, crash descriptions, previews, accessibility, and test snapshots.
- [x] Unit tests cover create/read/update/delete/duplicate/inaccessible errors and same-server-and-device re-pair replacement.

### P0-IOS-05 — Add authenticated bootstrap and compatibility client

Owner: iOS networking + models  
Status: **Done**  
Priority: Must  
Dependencies: P0-API-02, P0-API-03, P0-SEC-03

How:

- Attach device bearer token only to approved base URL/mobile endpoints.
- Decode success/error envelopes and enforce server identity/version before payload use.
- Classify transport, TLS, timeout, authentication, capability, compatibility, server, and decode failures separately.
- Keep authorization headers out of request descriptions and diagnostics.
- Use an ephemeral URLSession with request cache bypass and no shared URL cache, cookies, or credential storage.

Acceptance:

- [x] Valid paired profile reaches health and bootstrap.
- [x] `401 authentication_revoked` is never presented as generic unavailability.
- [x] `426 upgrade_required` prevents payload decoding/cache replacement.
- [x] TLS, timeout, 5xx, malformed JSON, and identity mismatch remain distinguishable in the typed client boundary.
- [x] Pairing and bootstrap requests bypass shared URLCache, cookies, and credential storage.

### P0-QA-02 — Add shared contract and authorization suite

Owner: QA + shared API  
Status: **Done**  
Priority: Must  
Dependencies: P0-API-03, P0-IOS-05

Acceptance:

- [x] Same fixtures pass TypeScript validation and Swift decoding.
- [x] Secret/account sentinel scan fails on forbidden fields or values.
- [x] Mobile token positive/negative capability matrix is automated.
- [x] Desktop token behavior and existing API tests remain unchanged.
- [x] Current and incompatible version behavior is covered.
- [x] Production bootstrap adapter and authenticated Swift client pass the same fixture-driven integration suite.

### P0-QA-03 — Complete physical private-path acceptance

Owner: QA + Mac + iOS  
Status: **In progress**  
Priority: Must  
Dependencies: all Phase 0 tasks

Acceptance:

- [x] Fresh physical iPhone pairs with a packaged Mac on the same Tailnet.
- [x] Pairing remains valid after both devices and apps restart.
- [x] Mac backend port changes while the stable private URL still works.
- [x] A LAN-only client cannot reach Fastify.
- [ ] Revoked phone cannot call bootstrap; desktop routes reject its token.
- [ ] Logs, database/config files, and iOS container pass token/credential/full-account-number scans.

## Phase acceptance scenarios

### Happy path

Given Mobile Access is enabled and both devices are on the same Tailnet, when the owner approves the iPhone and it claims the device credential, then the iPhone stores a paired profile and loads the versioned bootstrap through the stable HTTPS address.

### Restart path

Given a paired phone, when the Mac restarts and Fastify receives a different port, then the stable private address reaches the new process and the existing device token remains valid.

### Authorization boundary

Given a valid `mobile.read` token, when it calls a declared read route then the request succeeds; when it calls any desktop, mutation, scraping, settings, or Advisor route then it is denied and no side effect occurs.

### Pairing replay

Given an expired or previously claimed QR payload, when another client submits it, then the server creates no device and returns a safe expiry/replay error.

## Exit gate

Phase 0 passes only when:

- every Must task above is Done;
- a physical-device pairing survives Mac/iPhone restart and backend-port change;
- `/api/mobile/v1/bootstrap` and all errors are validated by shared fixtures;
- mobile credentials are unique, scoped, persisted, rotatable, and revocable;
- Fastify remains loopback-only and unrelated Tailscale configuration is preserved;
- mobile token cannot call any desktop or undeclared route;
- secret/redaction scans find zero prohibited material;
- the limitations are explicit: no offline snapshot, polished onboarding, feature parity, or commands yet.
