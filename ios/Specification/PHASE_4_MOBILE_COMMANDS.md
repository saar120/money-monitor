# Phase 4 — Explicit mobile commands

## Outcome

The owner can perform a deliberately approved set of focused actions on Mac-owned data. Every command is live-only, separately authorized, idempotent, conflict-aware, auditable, and recoverable.

Delivery checkpoint: **trusted command release**  
Phase status: **blocked until command capability matrix is approved**  
Depends on: **read-only MVP gate through Phase 3**

## Product rule

The approved mockups imply more write behavior than the current mobile trust model authorizes. A visible edit control is design intent, not permission to expose the desktop CRUD route.

No command implementation starts until `P4-PRD-01` records:

- exact verb and target;
- required device capability;
- confirmation and reversibility;
- validation and version/conflict rule;
- idempotency behavior;
- offline rule;
- audit fields;
- user-facing success/error copy.

There is no generic `mobile.write` capability.

## Candidate command scope

Recommended first allowlist, subject to approval:

- resolve or skip one review item;
- change transaction category, owner, or report-exclusion state;
- create, update, or delete a budget;
- update only alert preferences that the current delivery architecture actually supports;
- request a single-account or all-account sync on the Mac.

Possible follow-up:

- create/update categories after stable-name, ordering, deletion, and reassignment behavior is defined;
- change a narrow set of non-credential account preferences;
- cancel a running sync if backend semantics are reliable.

Explicitly excluded from this phase unless separately re-specified:

- add/delete bank accounts or enter/change credentials;
- submit OTP or manual-login input from iPhone;
- edit assets, holdings, movements, or liabilities;
- household administration;
- AI provider/API-key or general desktop settings;
- transaction notes or recurring flags, which lack an accepted schema/route;
- offline mutation queues.

## User stories

| ID | Priority | User story |
| --- | --- | --- |
| US-P4-01 | Must | As a reviewer, I want to resolve or skip an uncertain transaction and see the queue advance only after the Mac confirms it. |
| US-P4-02 | Must | As a planner, I want to create/edit an approved budget and intentionally confirm deletion. |
| US-P4-03 | Must | As a user, I want validation, conflict, and unknown-outcome errors to preserve my entered values so that I can recover safely. |
| US-P4-04 | Must | As an account owner, I want to ask the Mac to sync and monitor its safe status without running scraper logic on my phone. |
| US-P4-05 | Must | As a privacy-conscious owner, I want every mobile command separately scoped, revocable, and audited. |
| US-P4-06 | Should | As an organizer, I want to maintain categories without orphaning or silently reclassifying historical transactions. |
| US-P4-07 | Must | As an offline user, I want commands clearly disabled so that the app never implies a queued or successful change. |
| US-P4-08 | Must | As an assistive-technology user, I want confirmations and errors to identify the exact action and consequence. |

## Screen scope

- [Review queue](../../docs/ios-mockups/rendered/screens/review.png)
- [Transaction detail](../../docs/ios-mockups/rendered/screens/transaction.png), accepted edit rows only
- [Budget edit](../../docs/ios-mockups/rendered/screens/budget-edit.png)
- [Categories](../../docs/ios-mockups/rendered/screens/categories.png)
- [Alerts](../../docs/ios-mockups/rendered/screens/alerts.png)
- [Settings](../../docs/ios-mockups/rendered/screens/settings.png)
- [Account detail](../../docs/ios-mockups/rendered/screens/account-detail.png) and [Sync history](../../docs/ios-mockups/rendered/screens/sync-history.png), accepted sync command only

Known design/backend mismatches:

- Category mockup implies rename/reorder, but current schema has no explicit sort order and stable-name semantics differ from display label.
- Alerts mockup reads like iPhone notifications, while current settings primarily drive Telegram alerts. Delivery channel/ownership must be decided first.
- Settings shows Household, which is outside current product scope.
- Asset detail shows Edit, but no mobile-safe asset command is specified.
- Raw scrape routes include OTP/manual operations that must remain Mac-only in the initial command release.

## Command protocol

Every command request includes:

- device credential with one required capability;
- opaque command/request ID and idempotency key;
- target opaque ID;
- expected record/version when conflict is possible;
- allowlisted payload;
- current mobile API version.

Every response returns authoritative outcome or stable uncertainty/conflict/error:

```text
confirmed | validationFailed | conflict | forbidden | revoked |
alreadyRunning | attentionNeeded | retryable | unknownOutcome
```

Timeout after submission is not automatically a failure: the server may have committed. Retry with the same idempotency key must return the original outcome rather than applying twice.

## Task backlog

| ID | Owner | Status | Task — how and acceptance |
| --- | --- | --- | --- |
| P4-PRD-01 | Product + security | Blocked | Approve command matrix row-by-row: verb, target, capability, confirmation, audit, offline, conflict, idempotency, and reversibility. No undecided row enters engineering. |
| P4-PRD-02 | Product + backend | Blocked | Resolve category stable name/display label, duplicates, ordering schema, deletion, and transaction reassignment. Decide Alerts delivery/channel ownership and keep Household/asset edits deferred. |
| P4-SEC-01 | Backend security | Planned | Add granular capabilities such as `mobile.review.write`, `mobile.transaction.write`, `mobile.budget.write`, `mobile.category.write`, `mobile.alert.write`, and `mobile.sync.start`; route addition is denied until classified. |
| P4-API-01 | Backend command infra | Planned | Add idempotency, expected-version/ETag conflict detection, stable errors, and redacted audit events with device, command, target type/opaque reference, time, request ID, and outcome—never financial values/secrets. |
| P4-API-02 | Backend review | Planned | Add narrow review resolve/skip endpoints. Replayed idempotency key returns original result; already-resolved item returns a safe conflict and current state. |
| P4-API-03 | Backend transaction | Planned | Add only accepted category/owner/exclusion commands. Reject unsupported note/recurring fields rather than ignoring them. |
| P4-API-04 | Backend budgets | Planned | Add mobile budget create/update/delete with validation, versioning, deletion confirmation metadata, and audit. Responses return authoritative refreshed DTO. |
| P4-API-05 | Backend categories | Blocked | After P4-PRD-02, implement accepted category operations and schema/order migration if required. Prevent orphaned transactions and ambiguous duplicate labels. |
| P4-API-06 | Backend alerts/settings | Blocked | Expose only accepted settings with explicit local-vs-Mac ownership. Never reuse general `/api/settings`; do not claim iPhone notification delivery when only Telegram exists. |
| P4-API-07 | Backend sync | Planned | Add mobile-safe sync start/status/optional cancel facade. Translate already-running, demo-disabled, attention-needed, partial, and completion; never authorize OTP/manual-confirm/credential routes. |
| P4-API-08 | Backend device/settings | Planned | Add safe paired-device/Mac/app status and accepted account-preference endpoints. General provider, secret, credential, and destructive settings remain absent. |
| P4-IOS-01 | iOS command infra | Planned | Implement reusable state machine: clean/dirty → validating → submitting → confirmed or validation/conflict/forbidden/revoked/unknown. Preserve user input after recoverable error and never queue offline. |
| P4-IOS-02 | iOS Review | Planned | Build Review queue with category/owner choice as approved, skip, count/position, server-confirmed advancement, conflict refresh, and cached/offline disabled state. |
| P4-IOS-03 | iOS transaction | Planned | Enable only accepted transaction rows with explicit save/confirmation. Hide unsupported notes/recurring/options. Refresh detail/list authoritatively after success. |
| P4-IOS-04 | iOS budgets | Planned | Build create/edit sheet with validation, dirty-dismiss confirmation, server conflict, successful refresh, and destructive delete dialog. |
| P4-IOS-05 | iOS Categories | Blocked | Implement approved label/rule/order/create/delete behaviors and make stable identifier vs display label clear in model/UI. |
| P4-IOS-06 | iOS Alerts/Settings | Blocked | Render only accepted delivery/settings. Local Face ID/appearance/cache preferences update locally; Mac preferences use scoped commands. Hide Household and unsupported controls. |
| P4-IOS-07 | iOS sync | Planned | Enable account/all sync with status, background navigation, safe attention messaging, duplicate-start behavior, and optional cancel. Phone submits a command only; Mac performs scraping. |
| P4-DES-01 | Design + UX writing | Planned | Specify validation, dirty dismissal, destructive confirmation, conflict, forbidden/revoked, timeout-before/after commit, unknown outcome, success, offline-disabled, and attention-needed states. |
| P4-QA-01 | Security QA | Planned | For every capability, prove intended command succeeds and every undeclared desktop/mobile route is forbidden. Test stolen/revoked/expired/wrong-capability tokens. |
| P4-QA-02 | Reliability QA | Planned | Inject timeout before and after commit; same idempotency key never executes twice and UI can reconcile unknown outcome. Test concurrent edits/conflicts. |
| P4-QA-03 | Audit/privacy QA | Planned | Every success/rejection/conflict/forbidden command creates the required redacted audit outcome; logs contain no payload values/secrets and no offline command is stored. |
| P4-QA-04 | Accessibility QA | Planned | VoiceOver and maximum Dynamic Type complete Review, budget edit/delete confirmation, sync start/status, and error recovery without ambiguous consequences. |

## Required state coverage

- clean, dirty, invalid, validating, submitting, confirmed;
- server validation, conflict with current value, forbidden capability, revoked token;
- cached/offline, duplicate request, already running, attention required;
- timeout before commit, timeout after possible commit/unknown outcome, idempotent retry;
- partial refresh after success and destructive cancellation;
- category deletion/reassignment and budget exactly-at/over validation where applicable.

## Acceptance scenarios

### Capability isolation

Given a token with only `mobile.review.write`, when it resolves a review item then the command may succeed; when it edits a budget, settings, account, asset, scraper OTP, or desktop route then the server denies it and records no side effect.

### Unknown outcome

Given a command times out after reaching the Mac, when the client retries with the same idempotency key, then the server returns the original result or authoritative status and never performs the command twice.

### Offline rule

Given saved/cached mode, when the user opens a command-capable screen, then the app explains that live Mac access is required and creates no local queue or success state.

### Sync ownership

Given the user requests sync, when the server accepts it, then only the Mac performs institution automation; the iPhone observes safe status and never requests credentials/OTP/manual-login input.

## Exit gate

Phase 4 passes only when:

- every shipped command has an approved matrix row, granular capability, idempotency, conflict behavior, and audit evidence;
- mobile tokens cannot call undeclared desktop operations;
- bank credentials, OTP/manual login, account deletion, asset mutation, provider settings, Household, and unsupported controls remain unreachable;
- offline UI never queues or implies a successful command;
- timeout/retry tests prove no command executes twice;
- validation/conflict/revocation paths preserve user data and recover accessibly;
- unsupported mockup controls are hidden or explicitly deferred.

