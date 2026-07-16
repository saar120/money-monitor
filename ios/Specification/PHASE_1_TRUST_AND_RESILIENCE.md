# Phase 1 — Trust, security, and resilience

## Outcome

A non-technical owner can complete the approved onboarding flow, protect financial content with device authentication, and browse an encrypted last-known snapshot with truthful live/cached/stale/revoked/incompatible states.

Delivery checkpoint: **private dogfood build**  
Phase status: **ready for `P1-PRD-01` policy approval**\
Depends on: **Phase 0 exit gate — passed 2026-07-16**

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P1-01 | Must | As a new user, I want setup to explain that credentials and scraping stay on the Mac so that I can trust the connection model. |
| US-P1-02 | Must | As a user, I want QR pairing with a manual fallback so that camera or scanning problems do not block me. |
| US-P1-03 | Must | As a user, I want financial content locked on launch and after the accepted background interval so that another person cannot read it. |
| US-P1-04 | Must | As a user, I want the app-switcher preview to hide amounts and merchants so that background snapshots do not leak information. |
| US-P1-05 | Must | As an offline user, I want to browse the last complete snapshot and know exactly when it was generated. |
| US-P1-06 | Must | As a user viewing old data, I want a plain stale warning and retry path rather than numbers that appear live. |
| US-P1-07 | Must | As a revoked or incompatible user, I want an explicit recovery path rather than a misleading connection error. |
| US-P1-08 | Must | As a user with unavailable biometrics, I want the accepted device-passcode/fallback behavior so that I am not trapped. |
| US-P1-09 | Must | As a VoiceOver/large-text user, I want the full setup and offline journey to remain operable. |

## Scope

Screens: Welcome, Connect to Mac, Protect with Face ID, Connected and ready, Mac unavailable.

Included:

- final pairing presentation over the Phase 0 protocol;
- app lock and app-switcher privacy;
- encrypted, versioned, server-bound snapshot;
- refresh/cache coordinator;
- root state derived from independent security/connectivity facts;
- live/cached/stale/unavailable/revoked/incompatible/corrupt recovery;
- explicit disconnect and re-pair handling.

Not included:

- final Home/Activity financial presentation; Phase 2;
- offline writes or background scrape execution;
- remote cache deletion while the phone remains offline;
- notifications or household identity.

## Root-state model

Do not replace the current `ConnectionState` with one larger connection enum. Track independent facts:

```text
pairing:       unpaired | pairing | paired | revoked
privacy:      covered | locked | unlocked
compatibility: compatible | clientUpdateRequired | serverUpdateRequired | unknown
reachability: unknown | checking | reachable | unreachable
data:         none | live | cached | stale | corrupt
refresh:      idle | refreshing | failed
```

The coordinator derives the visible root state with this precedence:

1. privacy cover or locked;
2. unpaired/pairing;
3. revoked;
4. incompatible;
5. unlocked with live data;
6. unlocked with cached data;
7. unlocked with stale data;
8. unavailable with no valid snapshot.

This prevents a timeout from disguising revocation or an upgrade requirement.

## Task backlog

### P1-PRD-01 — Approve lock, freshness, retention, and wipe policy

Owner: Product + security  
Status: **Blocked pending approval**  
Priority: Must  
Dependencies: P0-PRD-01

How:

- Choose whether app lock is mandatory, default-on, or optional.
- Define cold-start behavior, background grace interval, and device-passcode fallback.
- Define live/cached/stale thresholds using server `generatedAt`, not request completion time.
- Define snapshot retention and behavior on explicit disconnect, remote revocation, key loss, app reinstall, and incompatible version.
- State explicitly that a Mac cannot destroy an offline phone cache until it reconnects.

Acceptance:

- [ ] OQ-03 and OQ-04 have accepted decisions.
- [ ] Every transition in the root-state model has one expected presentation/recovery action.
- [ ] Wipe/retain behavior is consistent across Keychain profile and snapshot files.
- [ ] Policies are testable with an injected clock and storage dependencies.

### P1-DES-01 — Complete onboarding and resilience state designs

Owner: Product design + UX writing  
Status: **Planned**  
Priority: Must  
Dependencies: P1-PRD-01

How:

- Extend approved happy-path mockups with camera denied, invalid/expired QR, approval pending/rejected/timed out, Tailscale unavailable, Keychain failure, biometric denied/unavailable/lockout, first bootstrap failure, and re-pair.
- Specify live/cached/stale/partial/no-cache/revoked/incompatible/corrupt states in Light/Dark and accessibility text sizes.
- Use plain language; expose infrastructure details only in troubleshooting.
- Keep financial content flat and system controls native.

Acceptance:

- [ ] Every Phase 1 state has title, body, primary/secondary actions, dismissal rules, and VoiceOver focus target.
- [ ] Status meaning uses text/symbol as well as color.
- [ ] Copy never implies remote credentials or cloud storage.
- [ ] Long text and largest Dynamic Type keep recovery actions reachable.

### P1-IOS-01 — Build production QR and manual connection entry

Owner: iOS + design  
Status: **Planned**  
Priority: Must  
Dependencies: P0-IOS-04, P1-DES-01

How:

- Add camera permission description and scanner using system camera/metadata APIs.
- Inject scanner output for UI tests; validate payload with the Phase 0 decoder.
- Provide manual private HTTPS address/pairing-code fallback.
- Show the stable Mac identity before the user commits.
- Stop capture/polling when view leaves or pairing is cancelled.

Acceptance:

- [ ] Valid QR proceeds to Mac approval.
- [ ] Invalid, expired, non-HTTPS, wrong-server, and unsupported versions save nothing.
- [ ] Camera denial/restriction offers manual entry and Settings recovery.
- [ ] VoiceOver completes QR guidance and manual entry.
- [ ] QR/nonce is absent from logs, analytics, screenshots, and accessibility values.

### P1-IOS-02 — Complete approval, Face ID choice, ready, and retry flow

Owner: iOS + design  
Status: **Planned**  
Priority: Must  
Dependencies: P1-IOS-01, P1-SEC-01, P1-DAT-02

How:

- Implement Welcome → Connect → waiting for Mac approval → Face ID choice → first bootstrap → Ready → Home.
- Separate requesting, approved-but-claiming, claimed-but-bootstrap-failed, and fully ready states.
- Persist pairing only after Keychain succeeds; show Ready only after the first valid bootstrap is securely saved.
- Provide back/cancel/retry cleanup at each step.

Acceptance:

- [ ] Half-paired state never masquerades as Ready.
- [ ] Rejected/expired requests return to a recoverable connection step.
- [ ] Bootstrap failure preserves the valid credential and can retry without a second Mac approval, if protocol allows.
- [ ] Onboarding completion survives app restart.
- [ ] Reduce Motion uses native crossfades/system transitions.

### P1-IOS-03 — Implement root application state coordinator

Owner: iOS architecture  
Status: **Planned**  
Priority: Must  
Dependencies: P1-PRD-01, P0-IOS-05

How:

- Model the independent axes above using pure state/reducer logic and injected clock.
- Define events for launch, scene phase, unlock, pairing, refresh start/result, clock threshold, revocation, incompatibility, disconnect, cache load/corruption, and re-pair.
- Cancel or ignore stale async results using request generation/snapshot identity.
- Make root rendering depend on the derived state, not ad-hoc view flags.

Acceptance:

- [ ] Exhaustive transition tests cover every axis combination used by the UI.
- [ ] Timeout with valid snapshot becomes cached/stale, not onboarding.
- [ ] Revoked/incompatible cannot be overwritten by a later generic transport error.
- [ ] Locked state never renders/exposes financial descendants to accessibility.
- [ ] Older refresh result cannot replace a newer state/snapshot.

### P1-SEC-01 — Implement LocalAuthentication app lock

Owner: iOS security  
Status: **Planned**  
Priority: Must  
Dependencies: P1-PRD-01, P1-IOS-03

How:

- Wrap `LAContext` behind a protocol for deterministic tests.
- Use the accepted biometric/passcode policy and localized reason.
- Re-evaluate on cold start and after the accepted background grace interval.
- Treat success, user cancel, system cancel, interruption, unavailable biometric, lockout, and passcode fallback distinctly.
- Never place financial values under a translucent lock overlay.

Acceptance:

- [ ] Cold start and background return follow policy exactly.
- [ ] Failed/cancelled authentication reveals no underlying data or VoiceOver elements.
- [ ] Lockout/fallback cannot trap the user outside the documented recovery.
- [ ] “Not now” onboarding choice persists according to the accepted policy.

### P1-SEC-02 — Add scene/app-switcher privacy cover

Owner: iOS + design  
Status: **Planned**  
Priority: Must  
Dependencies: P1-IOS-03

How:

- Cover content immediately when a scene becomes inactive and before the OS captures a switcher snapshot.
- Remove the cover only after the coordinator confirms the app may display unlocked data.
- Use branding and neutral status only; no amount, merchant, chart, or freshness detail.
- Test rapid inactive/background/foreground transitions and supported multi-window behavior.

Acceptance:

- [ ] App-switcher snapshot contains zero financial content.
- [ ] VoiceOver cannot focus covered content.
- [ ] Rapid lifecycle changes produce no one-frame data flash.
- [ ] Cover does not permanently block an already authorized return.

### P1-DAT-01 — Define and implement encrypted snapshot container

Owner: iOS persistence + security  
Status: **Planned**  
Priority: Must  
Dependencies: P1-PRD-01, P0-API-02

How:

- Encode mobile DTOs only with server ID, snapshot/schema/API versions, generated/received times, and completeness metadata.
- Encrypt with CryptoKit AES-GCM using a separate random key protected by Keychain.
- Use iOS file protection and atomic replacement in Application Support.
- Bind snapshot to `serverId`; a different paired Mac cannot read/display it.
- Quarantine/reject truncation, authentication failure, wrong key, and unknown schema.

Acceptance:

- [ ] Snapshot file contains no searchable known merchant, amount, account, token, or fixture sentinel.
- [ ] Interrupted write leaves the previous valid snapshot intact.
- [ ] Wrong key, tampered ciphertext, truncation, and unknown required version fail closed.
- [ ] Snapshot from another server ID is never displayed.
- [ ] Key loss follows the accepted recovery/wipe policy.

### P1-DAT-02 — Implement bootstrap repository and atomic refresh/cache coordinator

Owner: iOS data + networking  
Status: **Planned**  
Priority: Must  
Dependencies: P1-DAT-01, P0-IOS-05

How:

- Load and validate saved snapshot at launch before deciding data state.
- Fetch bootstrap through the authenticated client; validate identity, compatibility, envelope, completeness, and DTOs before persistence.
- Atomically replace cache only after full validation.
- Coalesce/cancel duplicate refreshes and use server `generatedAt` for freshness.
- Return structured repository outcomes to the root coordinator.

Acceptance:

- [ ] Successful bootstrap produces one encrypted snapshot and live state.
- [ ] Timeout, 5xx, TLS, and decode failure preserve the last valid snapshot.
- [ ] Offline launch derives cached/stale using injected clock.
- [ ] Partial/non-cacheable response never overwrites complete data.
- [ ] Pull/retry does not produce concurrent out-of-order replacement.

### P1-IOS-04 — Build freshness components and resilience screens

Owner: iOS + design  
Status: **Planned**  
Priority: Must  
Dependencies: P1-IOS-03, P1-DAT-02, P1-DES-01

How:

- Create reusable visible/accessible freshness label for live, cached, stale, refreshing, and partial.
- Build no-cache unavailable, cached/stale browsing, revoked, incompatible, and corrupt-cache recovery states.
- Show an absolute saved timestamp; relative text may supplement but not replace it.
- Keep saved content visible during retry when policy allows.
- Disable network-only/command/Advisor controls with a concise explanation.

Acceptance:

- [ ] Each state has distinct copy/action and accessibility output.
- [ ] Retry never erases readable saved content before a valid replacement.
- [ ] State meaning is not color-only.
- [ ] Mac unavailable screen summarizes what saved content remains.
- [ ] Incompatible/corrupt states do not pretend content is live.

### P1-IOS-05 — Implement disconnect, revocation, and re-pair cleanup

Owner: iOS security  
Status: **Planned**  
Priority: Must  
Dependencies: P1-PRD-01, P1-IOS-03, P1-DAT-01

How:

- On detected revocation, stop retries with the known token and delete it immediately.
- Apply the accepted cache lock/wipe behavior separately from token cleanup.
- Make explicit disconnect confirm consequences and remove the paired identity.
- Prevent a new server ID from showing prior Mac data.
- Preserve compatible cache across upgrade-required only if policy permits.

Acceptance:

- [ ] Known-revoked token is not sent repeatedly.
- [ ] Disconnect removes Keychain profile and cache exactly as policy states.
- [ ] Re-pair to another Mac never displays the previous snapshot.
- [ ] Incompatible response cannot overwrite compatible cache.
- [ ] Recovery routes lead only to update, re-pair, retry, or safe reset as applicable.

### P1-QA-01 — Complete security, state, and fault-injection matrix

Owner: QA + iOS + Mac  
Status: **Planned**  
Priority: Must  
Dependencies: all Phase 1 tasks

Acceptance:

- [ ] Test live, Tailscale off, Mac asleep, timeout, TLS failure, 401, 426, 5xx, malformed JSON, unknown schema, partial response, corrupt cache, missing key, and clock threshold.
- [ ] Test Face ID/passcode success, cancel, interruption, unavailable, and lockout on physical device.
- [ ] Verify app switcher/screenshots and VoiceOver expose no locked data.
- [ ] Verify cache encryption, server binding, and atomic replacement.
- [ ] Verify live → cached → stale → live and revoked/incompatible recovery on a physical phone.

## Phase acceptance scenarios

### First setup

Given an approved Phase 0 Mac, when the owner completes QR/manual pairing, accepts the lock policy, and receives the first valid bootstrap, then Ready appears and the app can relaunch into a protected saved state.

### Offline relaunch

Given a valid encrypted snapshot and unreachable Mac, when the user unlocks the app, then saved content is readable with its absolute timestamp and network-only actions are unavailable.

### Corrupt response

Given a valid prior snapshot, when refresh returns an incompatible or malformed payload, then the prior snapshot remains intact and the app shows the appropriate recovery state.

### Remote revocation

Given a paired phone that reconnects after being revoked on the Mac, when the server returns `authentication_revoked`, then the token is removed, content follows cache policy, and re-pairing is offered; generic retry does not continue.

## Exit gate

Phase 1 passes only when:

- every Must task is Done;
- the full Welcome → Connect → approval → Face ID → Ready journey passes on a physical iPhone;
- app-switcher and locked accessibility tree reveal no financial content;
- encrypted snapshot survives network loss and atomic-write fault tests;
- live, cached, stale, unavailable, revoked, incompatible, and corrupt states are visually and verbally distinct;
- token, cache, disconnect, and re-pair cleanup follow the accepted policy;
- the app is ready for Phase 2 screens to consume one repository/state model rather than feature-specific networking.
