# Phase 5 — Advisor

## Outcome

The owner can start/resume a conversation, receive a resilient streamed answer grounded in explicitly timestamped Money Monitor data, read saved conversations offline, and trust that the mobile Advisor cannot mutate financial data.

Delivery checkpoint: **Advisor release / full capability parity with approved mockups**  
Phase status: **read-only product policy accepted under D-025; implementation planned**
Depends on: **Phase 3 read model and Phase 4 capability boundary**

## Accepted safety policy

Phase 5A is strictly read-only. Do not expose the current desktop `/api/ai/chat` and tool registry directly to the mobile token: the current agent can mutate transactions, categories, memory, assets, holdings, liabilities, budgets, and alerts.

Allowed mobile tool classes:

- transaction query/search/summary/trends;
- recurring-pattern and top-merchant analysis without mutation;
- masked balance/account freshness;
- category rule read;
- net worth, assets, liabilities, and history read;
- budget progress read;
- alert settings read;
- safe latest-sync summary.

Denied mobile tool classes:

- transaction/category mutation;
- AI memory write/update;
- asset/holding/movement/liability mutation;
- budget/alert mutation;
- file/table image generation that exposes local paths;
- provider configuration or arbitrary desktop command.

If actions are added later, Advisor proposes a structured Phase 4 command and the ordinary command UI asks for exact confirmation. The model never receives direct write authority or AI-memory write access.

The Mac owns the configured provider and credential. Each phone receives a first-use disclosure that relevant allowlisted financial context is sent to that provider. Sessions are private to the creating device; the Mac is authoritative and the phone may cache encrypted transcripts for 30 days. Every answer states the source calculation time and relevant period/sample when meaningful.

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P5-01 | Must | As a user with a financial question, I want suggestions and recent conversations so that I can start quickly. |
| US-P5-02 | Must | As a user, I want status and answer text to stream so that I know Advisor is working. |
| US-P5-03 | Must | As a user, I want each answer to disclose the financial snapshot time and relevant period/sample so that I can judge its context. |
| US-P5-04 | Must | As a user on an interrupted connection, I want cancel/retry/reconnect without duplicate questions or answers. |
| US-P5-05 | Must | As a privacy-conscious owner, I want certainty that mobile Advisor cannot mutate my financial data. |
| US-P5-06 | Must | As an offline user, I want to read saved conversations while the composer clearly remains unavailable. |
| US-P5-07 | Must | As a VoiceOver user, I want meaningful progress announcements without every streamed token being spoken. |
| US-P5-08 | Future | As a user, I want Advisor to propose an exact safe action that I can review and confirm through Phase 4. |

## Screen scope

- [Advisor home](../../docs/ios-mockups/rendered/screens/advisor.png)
- [Advisor conversation](../../docs/ios-mockups/rendered/screens/advisor-chat.png)
- [Advisor conversation Dark Mode](../../docs/ios-mockups/rendered/screens/advisor-dark.png)

## Mobile streaming contract

The desktop SSE stream has no resumable event IDs or dedicated cancellation contract. Mobile requires typed events:

```text
started     sessionId, messageId, eventId
status      stable safe status code
delta       ordered text fragment, eventId
completed   final text, freshness/scope metadata, eventId
cancelled   incomplete marker, eventId
error       safe code, retryability, requestId, eventId
```

Every client message has an idempotency ID. Reconnect/retry with the same ID resumes or returns the same server message rather than adding a second user turn. A separate cancel endpoint aborts server work; cancelled output is visibly incomplete.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P5-PRD-01 | Product + AI + security | Done — accepted under D-025 | The read-only tool allowlist, provider/data disclosure, device-private conversation scope, 30-day phone cache, freshness wording, no-memory-write rule, and future Phase 4 action boundary are locked. |
| P5-AI-01 | Backend AI/security | Planned | Extract a mobile read-only tool registry. Classification is deny-by-default; a test fails when any newly registered tool lacks explicit allowed/denied classification. |
| P5-AI-02 | Backend AI | Planned | Run mobile conversations only with the read registry. Database/settings/memory before-and-after tests prove adversarial prompts cannot mutate state. |
| P5-API-01 | Backend API | Planned | Add mobile session list/create/detail endpoints with safe title/timestamps, cursor pagination, explicit retention, and no filesystem path/internal session representation. |
| P5-API-02 | Backend streaming | Planned | Define/implement typed SSE events with session/message/event IDs, safe status/error codes, freshness metadata, and robust framing. No raw provider errors or tool arguments in client events. |
| P5-API-03 | Backend reliability | Planned | Add message idempotency and reconnect semantics; repeated client message ID returns/resumes the same turn and duplicate event IDs are safe to ignore. |
| P5-API-04 | Backend cancellation | Planned | Add explicit cancel endpoint wired to agent abort. Cancelled output is incomplete, stored/represented consistently, and cannot later appear as a second completed answer. |
| P5-API-05 | Backend context | Planned | Attach snapshot `generatedAt`, requested date range, transaction/sample count when meaningful, model/provider availability state, and safe rate-limit/auth errors. |
| P5-DAT-01 | iOS persistence | Planned | Define encrypted conversation cache separate from authoritative financial snapshot, including retention, server identity, incomplete/cancelled message representation, and wipe behavior. |
| P5-IOS-01 | iOS Advisor home | Planned | Build suggestions, recent sessions, new-session action, loading/empty/cached/offline/provider-unavailable states, and navigation to transcript. |
| P5-IOS-02 | iOS conversation | Planned | Build transcript/composer with long-answer layout, selection/copy, mixed-direction content, freshness disclosure, safe citations/context labels, and cached history. |
| P5-IOS-03 | iOS networking | Planned | Implement/test SSE parser for fragmented UTF-8, CRLF/LF boundaries, multiple events/chunk, unknown optional event, malformed event, event-ID de-duplication, cancellation, and background disconnect. |
| P5-IOS-04 | iOS state | Planned | Implement connecting/status/streaming/completed/cancelled/reconnecting/retryable/fatal state machine. Composer prevents double-submit and retry uses original message ID. |
| P5-IOS-05 | iOS accessibility | Planned | Coalesce VoiceOver announcements to meaningful status changes and final/paragraph-level progress; never announce every token. Preserve reading position during append. |
| P5-DES-01 | Design + UX writing | Planned | Specify connecting, tool-status, long answer, cancelled partial, retry/reconnect, stale-data disclosure, provider unavailable/rate limited, max-turn, deleted session, and offline transcript states. |
| P5-QA-01 | Security QA | Planned | Run adversarial prompts requesting delete/recategorize/budget/asset/alert/memory changes and secret disclosure. Assert no write tool is callable and tracked database/settings remain byte/semantically unchanged. |
| P5-QA-02 | Reliability QA | Planned | Chaos-test fragmented/malformed SSE, disconnect, Mac sleep, cancellation, repeated client ID, duplicate event, token revocation, provider rate limit/auth, and app backgrounding. No duplicate turn. |
| P5-QA-03 | Privacy QA | Planned | Scan events, transcripts, diagnostics, and crash/log output for provider keys, tool arguments, local paths, tokens, and financial payload leakage beyond the displayed user-approved conversation. |
| P5-QA-04 | Accessibility/offline QA | Planned | Verify cached conversations remain readable offline, composer/actions are unavailable with explanation, and VoiceOver receives useful non-noisy progress. |

## Required state coverage

- no sessions, cached sessions, loading, deleted session elsewhere;
- connecting, safe tool status, first delta, long stream, completed;
- user-cancelled, network disconnect, reconnect, duplicate event, duplicate submit;
- max turns, provider missing/auth expired/rate limited/unavailable;
- Mac sleep/unreachable, revoked token, incompatible API;
- stale financial snapshot and changed context between turns;
- offline transcript with disabled composer.

## Acceptance scenarios

### Read-only proof

Given a mobile Advisor session, when the user asks directly or indirectly to alter transactions, categories, budgets, assets, alerts, or memory, then no write tool is available, no database/settings state changes, and the answer explains the limitation safely.

### Reconnect without duplication

Given an interrupted stream after a submitted client message ID, when the app reconnects/retries, then it resumes or retrieves the same server message and does not append a duplicate user or assistant turn.

### Cancellation

Given an active stream, when the user cancels, then client parsing and server generation stop promptly, the partial output is marked incomplete, and retry behavior is explicit.

### Offline conversation

Given encrypted saved sessions and unreachable Mac, when the user opens Advisor, then existing transcripts are readable with their context/freshness while the composer is disabled and no fake response begins.

## Exit gate

Phase 5 passes only when:

- mobile Advisor uses only the explicit read-only registry;
- automated before/after tests prove zero financial/settings/memory mutation;
- session and typed SSE contracts are versioned, redacted, cancellable, and idempotent;
- cancellation/reconnect/background chaos tests create no duplicate messages;
- every answer discloses relevant freshness/scope and safe provider failure;
- VoiceOver announces useful progress without token-by-token noise;
- saved conversations remain encrypted/readable offline while new prompts are unavailable;
- future action proposals, if displayed, cannot bypass Phase 4 confirmation/capabilities.
