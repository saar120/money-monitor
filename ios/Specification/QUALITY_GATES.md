# Cross-phase quality gates

These gates apply to every phase. Phase 6 completes the full release matrix, but it does not postpone security, accessibility, state handling, or tests that belong to an earlier feature.

**Trusted-circle scope:** the historical D-018/D-019 exception ended with accepted Phase 2A/2B. D-020 resumes ordinary core accessibility and privacy gates before family/friend distribution. The supported private-release matrix is intentionally limited to iPhone, English UI, and mixed Hebrew/English financial content.

## 1. Definition of done for an implementation task

A task is done only when:

- the observable behavior and negative behavior in its acceptance criteria pass;
- implementation follows the accepted trust boundary and architectural decisions;
- unit/contract tests cover presentation or domain logic;
- failure and cancellation paths are deterministic;
- previews or fixtures exist for every new visual state;
- user-facing copy is centralized and final enough to test;
- accessibility labels, reading order, targets, and Dynamic Type behavior are verified;
- logs and diagnostics contain no prohibited fields or values;
- documentation and traceability links are updated;
- the generated Xcode project and relevant Mac/backend test suites remain green.

“Works on my simulator” is not sufficient for pairing, Tailscale transport, Face ID, app-switcher privacy, background behavior, Keychain accessibility, or performance acceptance; those require a physical iPhone.

## 2. Required state matrix

Every remote-content feature must decide whether each state is applicable and provide evidence for applicable states:

| State | Required behavior |
| --- | --- |
| Initial loading | Preserve navigation chrome; no fabricated financial values. |
| Live | Show data and relevant calculation period/freshness. |
| Refreshing | Keep valid content readable; native progress is secondary. |
| Cached | Show absolute saved timestamp and disable unavailable actions. |
| Stale | Add warning label/symbol and recovery without hiding saved content. |
| Partial | Render valid sections and identify failed sections; never call it complete/cacheable. |
| Empty | Explain what belongs here and give one relevant next action. |
| Offline/unreachable | Use valid snapshot or a no-snapshot recovery state. |
| Authentication revoked | Stop sending the token, protect content per policy, and offer re-pairing. |
| Incompatible version | Preserve compatible snapshot and explain which app must update. |
| Decode/schema failure | Reject response; retain prior snapshot; attach safe request ID. |
| Server failure | Plain-language error and bounded retry; no raw provider/server details. |
| Cancelled | Stop work promptly and leave a coherent prior state. |

Lists additionally cover first page, pagination, append error, filtered empty, no results, duplicate data, and preserved navigation state. Commands and Advisor have additional matrices in their phase files.

## 3. Test strategy

### Contract tests

- TypeScript validates success/error fixtures against the mobile schema.
- Swift decodes the identical checked-in fixtures.
- The current supported schema version remains in the suite; this private product makes no previous-version compatibility promise.
- Unknown optional fields decode safely; unknown required versions fail before feature decoding.
- Secret/redaction tests fail if a prohibited key or known sentinel value appears.

### Unit tests

- Pure presentation state/reducer logic.
- Money/date/freshness formatting with fixed locale and clock.
- URL/request/error classification without live networking.
- Cache validation, encryption/decryption, migration, and atomic replacement.
- Capability and command policy logic.
- SSE frame parsing and event de-duplication.

### Integration tests

- Fastify mobile routes against isolated database fixtures.
- Device-token issue, use, rotation, expiry, and revocation.
- Mac service adapters with Tailscale/process seams stubbed.
- iOS repository with mocked API, Keychain, clock, and snapshot store.

### UI tests

- One happy-path critical journey per phase.
- One cached/offline journey where applicable.
- Authentication, incompatibility, and error recovery.
- Navigation/query/filter preservation.
- Accessibility identifiers represent user concepts, not implementation hierarchy.

### Physical-device tests

- Pairing and Mac approval on the real Tailnet.
- Stable endpoint across Mac restart and random backend-port change.
- Face ID/passcode, app-switcher cover, background re-lock, and Keychain behavior.
- Network interruption, Mac sleep/wake, and Tailscale disconnect.
- Release-build performance.

## 4. Security and privacy gate

### Forbidden on iPhone

- bank/institution credentials;
- scraper session secrets, OTPs, browser state, or selectors;
- credential encryption/master keys;
- desktop API bearer token;
- AI provider API keys or OAuth tokens;
- unmasked account numbers;
- raw Drizzle/SQLite rows or internal hashes;
- plaintext device tokens outside Keychain or a single in-memory request lifetime.

### Authorization evidence

For each mobile capability:

- positive test proves the intended mobile route succeeds;
- negative test proves every adjacent desktop route remains forbidden;
- revoked, expired, malformed, and wrong-capability credentials fail with safe codes;
- logs redact authorization headers and payloads;
- a route added later is denied by default until explicitly classified.

### Threat scenarios

At minimum, test or review:

- captured/expired/replayed QR code;
- malicious member of the Tailnet;
- LAN client without Tailnet access;
- lost unlocked phone;
- extracted app container or backup;
- token copied from logs or diagnostics;
- remote revocation while phone is offline;
- downgrade/incompatible client;
- compromised or malicious Advisor prompt;
- timeout after a command may already have committed.

## 5. Accessibility gate

Each phase validates its critical journey with:

- VoiceOver reading/focus order and useful combined financial labels;
- default and largest accessibility Dynamic Type sizes;
- Bold Text and Button Shapes;
- Increased Contrast and Differentiate Without Color;
- Reduce Transparency and Reduce Motion;
- Switch Control or Voice Control checkpoint;
- 44 by 44 point interactive targets where practical;
- errors announced once with focus moved to recovery context;
- locked/covered content absent from the accessibility tree;
- charts accompanied by a textual summary and accessible values.

No status may rely only on blue, green, red, orange, opacity, or animation.

## 6. Formatting and bidirectional-content gate

- English user-facing strings live in a String Catalog before release hardening; translated catalogs are not required.
- Amounts, dates, percentages, and relative times use `FormatStyle` or equivalent locale-aware formatting.
- No sentence is built by concatenating fragments that break formatting or accessibility output.
- Hebrew merchant/category content is tested inside the English UI from Phase 2 onward.
- Bidirectional-content testing covers charts, punctuation, Latin digits, masked account suffixes, and mixed-direction search without requiring full interface mirroring.
- Long financial labels and maximum text size do not hide actions or freshness.

## 7. Design and Liquid Glass gate

- Screen hierarchy matches the approved mockup or has an accepted documented deviation.
- Standard SwiftUI navigation and controls are used before custom equivalents.
- Financial content remains on flat/system backgrounds without decorative glass cards or cast shadows.
- Liquid Glass is confined to navigation and interactive controls on supported systems.
- Light, Dark, Increased Contrast, and Reduce Transparency states remain legible.
- Placeholder/mock financial numbers do not appear in production data paths.
- Unsupported future controls are hidden or explicitly unavailable; they must not pretend to work.

## 8. Data-integrity gate

- Money is decoded as a decimal representation with explicit currency.
- Financial dates and UTC timestamps are different types or parsing paths.
- Aggregate screens state calculation range and timestamp.
- One coherent snapshot ID/timestamp spans sections expected to reconcile.
- A response is cacheable only after full envelope/schema/identity validation.
- Atomic write failure, corruption, wrong server identity, missing key, and unknown schema preserve or safely discard according to policy without fabricating data.
- UI totals reconcile against server fixtures and calculation expectations.

## 9. Performance budgets

Initial budgets; revise only with measured evidence:

| Operation | Budget |
| --- | --- |
| Warm cached launch to readable Home | 1 second p95 |
| Established-connection bootstrap | 3 seconds p95 |
| Transaction search first page | 2 seconds p95 after debounce |
| Search debounce | 250–350 ms |
| Pagination append | No visible main-thread stall; prior rows remain interactive |
| App lock response | Authentication prompt/covered state appears before financial content is exposed |
| Snapshot replacement | No content blanking and no partially visible new snapshot |

Measure release builds with representative fixture size. A long-running Mac scrape is not hidden inside the bootstrap budget; it is a separate observable state.

## 10. Diagnostics and observability

Allowed fields include:

- event/state name;
- monotonic duration bucket;
- app, Mac, API, and schema versions;
- safe error code and request ID;
- device class/OS major version when explicitly included in exported diagnostics.

Forbidden fields include raw URLs containing secrets, authorization headers, QR payloads, merchant/search text, amounts, balances, account/transaction IDs, Advisor content, and API bodies.

Remote analytics remains off by default. Diagnostics export is explicit and owner-controlled unless a separate privacy decision is accepted.

## 11. Phase exit evidence

Each phase review should attach:

- completed task/story/requirement traceability;
- automated test result summary;
- physical-device evidence where required;
- screenshots for Light, Dark, cached/error, and maximum-text states;
- accessibility audit notes;
- contract fixture diff and redaction scan;
- known limitations and deferred tasks;
- accepted decisions or unresolved blockers.
