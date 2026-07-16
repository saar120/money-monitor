# Specification traceability

This matrix connects product requirements and user stories to the approved mockups, implementation tasks, mobile contracts, and evidence required to call the work complete. It is the coverage ledger for issue planning and release review; it does not replace the detailed acceptance criteria in each phase.

Status: **Draft baseline; Phase 2B technical-owner transaction lane in progress under D-019**
Canonical screen inventory: [Screen map](../Documentation/SCREEN_MAP.md)  
Contract baseline: [Mobile API contract](../Documentation/API_CONTRACT.md)  
Global gates: [Quality gates](QUALITY_GATES.md)

## Evidence legend

| Code | Evidence                                                                  |
| ---- | ------------------------------------------------------------------------- |
| `C`  | Shared server/Swift contract fixture and schema validation                |
| `U`  | Deterministic unit or component test                                      |
| `I`  | Integration test across the Mac API and iOS client/repository             |
| `UI` | Automated UI journey or state screenshot test                             |
| `P`  | Physical-device validation over the real private route                    |
| `A`  | Accessibility, Dynamic Type, contrast, motion, or localization evidence   |
| `S`  | Security/privacy negative test, threat review, or secret scan             |
| `R`  | Signed archive, installation, update, compatibility, or rollback evidence |

## User story ownership

Every defined story is owned by exactly one detailed phase backlog. Screen and journey rows below may reference the same story where it produces observable UI behavior.

| Phase | Defined stories                                                                                            | Owning specification                                               |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | `US-P0-01`, `US-P0-02`, `US-P0-03`, `US-P0-04`, `US-P0-05`, `US-P0-06`, `US-P0-07`                         | [Foundation and private bridge](PHASE_0_FOUNDATION.md)             |
| 1     | `US-P1-01`, `US-P1-02`, `US-P1-03`, `US-P1-04`, `US-P1-05`, `US-P1-06`, `US-P1-07`, `US-P1-08`, `US-P1-09` | [Trust, security, and resilience](PHASE_1_TRUST_AND_RESILIENCE.md) |
| 2     | `US-P2-01`, `US-P2-02`, `US-P2-03`, `US-P2-04`, `US-P2-05`, `US-P2-06`, `US-P2-07`, `US-P2-08`             | [Everyday money](PHASE_2_EVERYDAY_MONEY.md)                        |
| 3     | `US-P3-01`, `US-P3-02`, `US-P3-03`, `US-P3-04`, `US-P3-05`, `US-P3-06`, `US-P3-07`, `US-P3-08`             | [Planning and connected data](PHASE_3_PLANNING_AND_ACCOUNTS.md)    |
| 4     | `US-P4-01`, `US-P4-02`, `US-P4-03`, `US-P4-04`, `US-P4-05`, `US-P4-06`, `US-P4-07`, `US-P4-08`             | [Mobile commands](PHASE_4_MOBILE_COMMANDS.md)                      |
| 5     | `US-P5-01`, `US-P5-02`, `US-P5-03`, `US-P5-04`, `US-P5-05`, `US-P5-06`, `US-P5-07`, `US-P5-08`             | [Advisor](PHASE_5_ADVISOR.md)                                      |
| 6     | `US-P6-01`, `US-P6-02`, `US-P6-03`, `US-P6-04`, `US-P6-05`, `US-P6-06`, `US-P6-07`, `US-P6-08`             | [Release readiness](PHASE_6_RELEASE_READINESS.md)                  |

Cross-app stories from the product specification are covered as follows:

| Story                                           | Coverage                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `US-G-01` Mac-owned credentials and scraping    | `REQ-PRIV-01`, `REQ-PRIV-02`, `REQ-NET-01`; P0 security/API work and recurring secret scans |
| `US-G-02` Approve and revoke each iPhone        | `REQ-SEC-01`, `REQ-SEC-02`; P0-SEC-01/02, P1-IOS-05                                         |
| `US-G-03` Truthful live/saved state             | `REQ-FRESH-01`; P1-IOS-03/04 and every feature state matrix                                 |
| `US-G-04` Browse last valid snapshot offline    | `REQ-DAT-01`, `REQ-DAT-02`; P1-DAT-01/02 and feature repositories                           |
| `US-G-05` Protect financial content             | `REQ-SEC-03`; P1-SEC-01/02 and P6-SEC-03                                                    |
| `US-G-06` Native iOS behavior                   | `REQ-UI-01`, `REQ-UI-02`; navigation and design tasks across all phases                     |
| `US-G-07` Equivalent accessible meaning         | `REQ-A11Y-01`, `REQ-A11Y-02`; phase accessibility checks and P6-IOS-01/02                   |
| `US-G-08` Preserve content and explain recovery | `REQ-FRESH-01`, `REQ-COMP-01`, `REQ-NET-02`; data/recovery tasks across all phases          |
| `US-G-09` Redacted diagnostics                  | `REQ-DIAG-01`, `REQ-OBS-01`; P6-SEC-02/03 and phase privacy QA                              |
| `US-G-10` Future limited household access       | `REQ-ROLE-01`; deferred pending actor/role specification                                    |

## Global requirement coverage

| Requirement                                                                   | Primary phase/task ownership                                       | Required evidence |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| `REQ-PRIV-01` No credentials or forbidden secrets on iOS                      | P0-SEC-01/02/03, P0-QA-02, P2-QA-01, P3-QA-02, P5-QA-03, P6-SEC-02 | C, S, R           |
| `REQ-PRIV-02` Mac/SQLite authoritative; iPhone cache replaceable              | P0-API-03, P1-DAT-01/02, P6-DAT-01                                 | U, I, P           |
| `REQ-NET-01` Private Tailscale HTTPS route; Fastify loopback                  | P0-ARC-01, P0-MAC-01/02, P0-QA-03                                  | I, P, S           |
| `REQ-SEC-01` Unique revocable least-privilege device credential               | P0-SEC-02/03, P1-IOS-05, P4-SEC-01                                 | I, P, S           |
| `REQ-SEC-02` Short-lived proof plus explicit Mac approval                     | P0-SEC-01, P0-IOS-04, P1-IOS-01/02                                 | I, P, S           |
| `REQ-SEC-03` Locked/app-switcher content protection                           | P1-SEC-01/02, P6-SEC-03                                            | UI, P, A, S       |
| `REQ-API-01` Mobile DTOs only under `/api/mobile/v1`                          | P0-API-01/03 and every later `API` task                            | C, I, S           |
| `REQ-API-02` Stable envelopes/version/time/safe errors/request IDs            | P0-API-01/02, P6-API-01                                            | C, I              |
| `REQ-DAT-01` Atomic complete-snapshot replacement                             | P1-DAT-01/02, P2-DAT-01, P3-DAT-01, P6-DAT-01                      | U, I, P           |
| `REQ-DAT-02` Encrypted cache with retention/wipe policy                       | P1-PRD-01, P1-DAT-01, P1-IOS-05, P5-DAT-01, P6-SEC-03              | U, P, S           |
| `REQ-FRESH-01` Truthful live/cached/stale/partial/revoked/incompatible states | P1-IOS-03/04, P1-DAT-02, each feature `DES` task, P6-QA-02         | C, UI, P, A       |
| `REQ-UI-01` Approved top-level navigation                                     | P0-IOS-02, P2-IOS-02/03/05, P3-IOS-01, P5-IOS-01                   | UI, A             |
| `REQ-UI-02` Flat financial content; restrained system glass                   | P0-IOS-02, each feature `DES` task, P6-DES-01                      | UI, A             |
| `REQ-A11Y-01` Full assistive-technology support                               | Each phase accessibility acceptance, P6-IOS-01/02, P6-QA-02/03     | UI, P, A          |
| `REQ-FMT-01` Decimal money, distinct dates/instants, locale formatting        | P0-API-02, P2-IOS-01, P3-PRD-01, P6-IOS-03/04                      | C, U, A           |
| `REQ-CMD-01` Capability-scoped online commands only                           | P4-PRD-01, P4-SEC-01, P4-API-01, P4-IOS-01, P4-QA-01/02/03         | I, P, S           |
| `REQ-AI-01` No unconfirmed AI mutation; disclose context                      | P5-PRD-01, P5-AI-01/02, P5-API-05, P5-QA-01                        | I, UI, S          |
| `REQ-COMP-01` Incompatibility preserves prior snapshot                        | P0-IOS-05, P1-IOS-03/04, P6-API-01, P6-DAT-01                      | C, I, R           |
| `REQ-DIAG-01` Redacted diagnostics only                                       | P1-QA-01, P4-QA-03, P5-QA-03, P6-SEC-02/03                         | U, S, R           |
| `REQ-NET-02` Bounded retry and cancellation                                   | P1-IOS-03, P2-IOS-05, P5-IOS-03/04, P6-REL-01                      | U, I, P           |
| `REQ-UI-03` Preserve navigation/search/filter/scroll state                    | P2-IOS-03/04/05, P3-IOS-01, P6-QA-02                               | U, UI             |
| `REQ-A11Y-02` Accessible chart summaries/Audio Graphs                         | P3-IOS-03/04, P3-DES-02, P3-QA-03, P6-IOS-02                       | U, P, A           |
| `REQ-L10N-01` Correct Hebrew/bidirectional content                            | P2-IOS-01, P2-DES-02, P6-IOS-03/04                                 | C, UI, A          |
| `REQ-OBS-01` Privacy-safe performance/reliability measurement                 | P1-QA-01, P6-QA-01, P6-SEC-02                                      | U, P, S           |
| `REQ-ROLE-01` Future household role limits                                    | Deferred; architecture constraint for P0-SEC-02 and P4-SEC-01      | Future C, I, S    |
| `REQ-CLOUD-01` Future transport can preserve mobile contract                  | P0-ARC-01 and contract isolation; no current feature task          | Future C, I       |
| `REQ-PUSH-01` Notifications require approved local-first architecture         | Blocked in P4-PRD-02/P4-API-06/P4-IOS-06                           | Future P, S       |
| `REQ-MULTI-01` Explicit future multi-Mac source separation                    | P1-DAT-01 includes server identity; otherwise deferred             | Future U, I       |
| `REQ-OFFCMD-01` Offline queue needs separate conflict/auth spec               | Explicitly excluded by P4-PRD-01/P4-IOS-01/P4-QA-03                | Negative I, UI, S |

## Approved screen coverage

Every approved mockup has a product story, owning implementation task, data/command boundary, and minimum evidence. Dark Mode references are appearance coverage of the same view, not duplicate implementations.

| #   | Screen/reference                                                                            | Story coverage                         | Owning tasks                                 | Contract or capability boundary                                                                                | Evidence             |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | [Welcome](../../docs/ios-mockups/rendered/screens/welcome.png)                              | US-P1-01, US-P1-09                     | P1-DES-01, P1-IOS-02                         | Local content; explains Mac-owned scraping/private route                                                       | UI, P, A             |
| 2   | [Connect to Mac](../../docs/ios-mockups/rendered/screens/connect.png)                       | US-P0-02, US-P1-02                     | P0-SEC-01, P0-IOS-04, P1-IOS-01              | Short-lived pair start/status/exchange; never desktop token in QR                                              | C, I, P, S, A        |
| 3   | [Protect with Face ID](../../docs/ios-mockups/rendered/screens/faceid.png)                  | US-P1-03, US-P1-08/09                  | P1-IOS-02, P1-SEC-01                         | LocalAuthentication policy; accepted passcode/fallback behavior                                                | UI, P, A, S          |
| 4   | [Connected and ready](../../docs/ios-mockups/rendered/screens/ready.png)                    | US-P0-04/05, US-P1-07                  | P0-IOS-05, P1-IOS-02/03                      | Authenticated compatibility/bootstrap must pass before “ready”                                                 | C, I, UI, P          |
| 5   | [Home](../../docs/ios-mockups/rendered/screens/home.png)                                    | US-P2-01, US-P2-05/06/08               | P2-PRD-01, P2-API-02, P2-IOS-02, P2-DAT-01   | `GET /bootstrap`; one coherent snapshot/time                                                                   | C, U, I, UI, P, A    |
| 6   | [Activity](../../docs/ios-mockups/rendered/screens/activity.png)                            | US-P2-02, US-P2-05/06/08               | P2-API-03, P2-IOS-03, P2-DAT-01              | `GET /transactions`; bounded pages, opaque cursor, safe memory-only DTO                                        | C, I, UI, P, A, S    |
| 7   | [Search](../../docs/ios-mockups/rendered/screens/search.png)                                | US-P2-03/08; US-P2-07 deferred         | P2-API-03, P2-IOS-05, P2-QA-02               | `GET /transactions?q=…`; exactly 300 ms debounce, cancellable, query excluded from diagnostics and persistence | C, U, UI, S, A       |
| 8   | [Transaction detail](../../docs/ios-mockups/rendered/screens/transaction.png)               | US-P2-04/08; US-P4-03 when writes ship | P2-API-04, P2-IOS-06; P4-API-03/P4-IOS-03    | `GET /transactions/:id` with opaque ID; all note/recurring/options/category/owner/review edit controls hidden  | C, I, UI, S, A       |
| 9   | [Filters sheet](../../docs/ios-mockups/rendered/screens/filters.png)                        | US-P2-03/08                            | P2-IOS-04, P2-DES-01/02                      | Draft vs applied direction/status/date/account/review/excluded state; transfer/category/owner filters deferred | C, U, UI, A, S       |
| 10  | [Review queue](../../docs/ios-mockups/rendered/screens/review.png)                          | US-P4-01/03/05/07/08                   | P4-API-02, P4-IOS-02, P4-QA-01/02/04         | `mobile.review.write`; confirmed, idempotent online command only                                               | C, I, UI, P, S, A    |
| 11  | [Plan](../../docs/ios-mockups/rendered/screens/plan.png)                                    | US-P3-01/02/06/08                      | P3-API-01/02/07, P3-IOS-01                   | Bootstrap planning summary plus safe detail contracts                                                          | C, I, UI, P, A       |
| 12  | [Budget detail](../../docs/ios-mockups/rendered/screens/budget-detail.png)                  | US-P3-01/06/07/08                      | P3-API-01, P3-IOS-02, P3-QA-01               | `GET /budgets/progress`; read-only in MVP                                                                      | C, U, UI, A          |
| 13  | [Edit budget](../../docs/ios-mockups/rendered/screens/budget-edit.png)                      | US-P4-02/03/05/07/08                   | P4-API-04, P4-IOS-04, P4-QA-02/04            | `mobile.budget.write`; validation/version/idempotency/delete confirmation                                      | C, I, UI, P, S, A    |
| 14  | [Net Worth](../../docs/ios-mockups/rendered/screens/net-worth.png)                          | US-P3-02/06/07/08                      | P3-API-02, P3-IOS-03, P3-QA-01/03            | `GET /net-worth`, `/net-worth/history`; range/currency/rate context                                            | C, U, UI, P, A       |
| 15  | [Asset detail](../../docs/ios-mockups/rendered/screens/asset-detail.png)                    | US-P3-03/06/08                         | P3-API-03, P3-IOS-04                         | `GET /assets/:id`; Edit action hidden—mobile asset mutation is deferred                                        | C, U, UI, S, A       |
| 16  | [Advisor](../../docs/ios-mockups/rendered/screens/advisor.png)                              | US-P5-01/05/06/07                      | P5-AI-01/02, P5-API-01, P5-IOS-01            | Mobile sessions plus deny-by-default read-only tool registry                                                   | C, I, UI, S, A       |
| 17  | [Advisor conversation](../../docs/ios-mockups/rendered/screens/advisor-chat.png)            | US-P5-02/03/04/05/06/07                | P5-API-02/03/04/05, P5-IOS-02/03/04/05       | Typed SSE with IDs, cancel, idempotency, freshness; no direct write tool                                       | C, U, I, UI, P, S, A |
| 18  | [Accounts](../../docs/ios-mockups/rendered/screens/accounts.png)                            | US-P3-04/06                            | P3-API-04/07, P3-IOS-05, P3-QA-02            | `GET /accounts`; server-masked safe DTO, never raw account config                                              | C, I, UI, S, A       |
| 19  | [Account detail](../../docs/ios-mockups/rendered/screens/account-detail.png)                | US-P3-04/06; US-P4-04 for sync         | P3-API-04, P3-IOS-05; P4-API-07/P4-IOS-07    | Safe detail/read activity; sync requires `mobile.sync.start`                                                   | C, I, UI, P, S, A    |
| 20  | [Sync history](../../docs/ios-mockups/rendered/screens/sync-history.png)                    | US-P3-05/06; US-P4-04                  | P3-API-05/06, P3-IOS-06; P4-API-07/P4-IOS-07 | `GET /sync-history`; translated safe states; no OTP/raw scraper routes                                         | C, I, UI, S, A       |
| 21  | [Categories](../../docs/ios-mockups/rendered/screens/categories.png)                        | US-P4-06/07/08                         | P4-PRD-02, P4-API-05, P4-IOS-05              | Blocked pending stable label/name/order/delete semantics and capability                                        | C, I, UI, S, A       |
| 22  | [Alerts](../../docs/ios-mockups/rendered/screens/alerts.png)                                | US-P4-03/05/07/08                      | P4-PRD-02, P4-API-06, P4-IOS-06              | Blocked pending delivery ownership; current Telegram settings do not imply iOS notifications                   | C, I, UI, S, A       |
| 23  | [Settings](../../docs/ios-mockups/rendered/screens/settings.png)                            | US-P0-03, US-P1-03/04, US-P4-05/07     | P1-IOS-05, P4-API-08, P4-IOS-06              | Local privacy/cache preferences separated from scoped Mac/device settings; Household hidden/deferred           | I, UI, P, S, A       |
| 24  | [Mac unavailable](../../docs/ios-mockups/rendered/screens/offline.png)                      | US-P1-05/06/07/09                      | P1-IOS-03/04, P1-DAT-02, P1-QA-01            | Root state uses last verified snapshot and distinct recovery by cause                                          | U, I, UI, P, A       |
| 25  | [Home, Dark Mode](../../docs/ios-mockups/rendered/screens/home-dark.png)                    | US-P2-01/08, US-P6-01/02/05            | P2-IOS-02, P6-DES-01, P6-IOS-01/02           | Same Home implementation and semantic tokens; privacy cover also verified                                      | UI, P, A, S          |
| 26  | [Advisor conversation, Dark Mode](../../docs/ios-mockups/rendered/screens/advisor-dark.png) | US-P5-02/07, US-P6-01/02/05            | P5-IOS-02/05, P6-DES-01, P6-IOS-01/02        | Same transcript implementation; streaming states cannot rely on color alone                                    | UI, P, A, S          |

## Critical journey coverage

| Journey                                                               | Stories                                     | Phase gate                                         | Minimum evidence     |
| --------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | -------------------- |
| Enable Mac access → pair → approve → authenticate → ready             | US-P0-01–06, US-P1-01–04/07–09              | Phase 0 physical private path plus Phase 1 dogfood | C, I, UI, P, S, A    |
| Open cached Home while Mac is asleep → reconnect → refresh            | US-P1-05/06, US-P2-01/05/06                 | Phase 2 daily-use slice                            | U, I, UI, P, A       |
| Activity → filter/search → transaction detail → restore state         | US-P2-02/03/04/08; US-P2-07 in full Phase 2 | Phase 2B technical lane, then full Phase 2         | C, U, I, UI, P, A, S |
| Plan → budget/net-worth/asset → accessible chart interpretation       | US-P3-01/02/03/06/07/08                     | Phase 3 read-only MVP                              | C, U, UI, P, A       |
| Accounts → detail → sync history                                      | US-P3-04/05/06                              | Phase 3 read-only MVP                              | C, I, UI, P, S, A    |
| Review or budget edit → confirm → conflict/unknown recovery           | US-P4-01/02/03/05/07/08                     | Phase 4 trusted commands                           | C, I, UI, P, S, A    |
| Start Advisor → stream → interrupt/reconnect/cancel → offline history | US-P5-01–07                                 | Phase 5 Advisor                                    | C, U, I, UI, P, S, A |
| Install/update → pair → use → revoke → recover/rollback               | US-P6-04/05/06/07                           | Phase 6 release candidate                          | P, S, R              |

## Delivery checkpoint gates

D-018 adds a non-cumulative technical-owner execution lane for live Home, and D-019 extends it only into live, memory-only, read-only transaction browsing. These decisions advance feature implementation but are not substitutes for any existing phase or release gate.

| Checkpoint                        | Included work                                 | Required approval/evidence                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal connectivity prototype   | Phase 0                                       | Real private route, explicit approval, scoped Keychain credential, mobile-safe bootstrap contract                                                                                                                                                 |
| Technical-owner live Home         | Phase 0 + Phase 2A subset                     | Trusted sole-owner device, app-switcher cover, live validated bootstrap, memory-only financial DTOs, read-only/privacy-negative tests                                                                                                             |
| Technical-owner live transactions | Phase 0 + accepted Phase 2A + Phase 2B subset | `mobile.read` list/opaque detail, bounded keyset cursor, 300 ms Search, supported direction/status/date/account/review/excluded filters, memory-only state, no recents/mutations, automated abuse/privacy tests, consolidated physical validation |
| Private dogfood                   | Phases 0–1                                    | App lock/privacy cover, encrypted atomic snapshot, truthful recovery states, physical fault matrix                                                                                                                                                |
| Daily-use read-only slice         | Phases 0–2                                    | Home/Activity/Search/Detail, coherent calculations, paging/state restoration, cached daily journey                                                                                                                                                |
| Recommended read-only MVP         | Phases 0–3                                    | Planning/accounts/safe sync read models, reconciled financial fixtures, accessible charts, no credential/config leakage                                                                                                                           |
| Trusted command release           | Add Phase 4                                   | Approved per-command matrix, capabilities, idempotency/conflict/audit proof, no offline queue                                                                                                                                                     |
| Advisor release                   | Add Phase 5                                   | Read-only tool registry, mutation-negative proof, typed resilient stream, encrypted offline transcripts                                                                                                                                           |
| Release candidate                 | Included feature phases plus Phase 6          | Full global gates, localization/accessibility matrix, threat/privacy review, signed artifact and rollback rehearsal                                                                                                                               |

## Coverage maintenance rules

- Adding a screen requires a row with a user story, owning task, contract/capability boundary, and evidence.
- Adding a global requirement requires an owner and a negative or positive proof; prose alone is not coverage.
- A task may move to `Done` only when its phase acceptance criteria and listed evidence exist.
- A blocked screen remains in the visual inventory, but its affordance must be hidden or clearly unavailable in builds before the blocker is resolved.
- Contract changes update the API document, schema/fixtures, Swift decoder tests, and the affected rows here in the same change.
- Release review must link actual test runs, screenshots, threat decisions, and archive metadata rather than marking evidence codes by assertion.
