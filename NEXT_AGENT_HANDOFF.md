# Next-agent handoff — lock the iOS product policy

Date: 2026-07-16
Repository: `/Users/saaramrani/.codex/worktrees/76e9fcef-92cd-4b03-813c-c1f2e276ef9b/money-monitor`
Branch: `codex/ios-phase-0`
Last commit: `9a79928 docs(ios): record phase two transaction evidence`

This is a transient worktree handoff. Read it first, finish the documentation pass, then delete this file before committing unless the user explicitly asks to retain it in project history.

## User direction

The user delegated every remaining product decision and asked that the result be locked in. The intended audience is the maintainer plus a small trusted circle of family and friends. Optimize for private self-use; do not add public-product complexity for roles, cloud identity, backward-compatibility matrices, phone-to-phone migration, App Store publication, iPad, full localization, push infrastructure, or telemetry.

The user prefers autonomous work, strong automated checks, and one consolidated validation request only when physical validation is genuinely necessary. They explicitly asked that subagents receive narrow instructions and not make product decisions or edits themselves.

The immediate task is **not Phase 1 implementation**. Finish the product-policy consistency pass, validate it, and commit only the intended documentation. Phase 1 becomes the next implementation milestone after this commit.

## Canonical locked decisions

The new canonical file is `ios/Documentation/LOCKED_PRODUCT_POLICY.md`; D-020 through D-026 in `ios/Documentation/DECISIONS.md` adopt it.

1. **Trusted circle:** one authoritative Mac may approve many individually named/revocable phones; one Mac per iPhone installation; every approved device gets the same surface; no users, roles, invitations, cloud identity, per-person permissions, or simultaneous multi-Mac profiles.
2. **Protection/replacement:** system Face ID/Touch ID with passcode fallback is mandatory once financial snapshots exist; two-minute background grace; immediate app-switcher cover; one encrypted, backup-excluded snapshot, stale after 24 hours and retained at most 30 days; replacement phone pairs fresh and the old phone is revoked separately.
3. **Everyday money:** `Available money` reuses Mac `liquidTotal`; Jerusalem month-to-date versus matching elapsed prior-month days; ILS base currency with Mac-owned conversion; explicit `Transfer` category only, no inferred pairing; transfers stay as separate rows but are excluded from cash flow and budgets; category/owner/transfer filters ship; newest-first only; no search recents.
4. **Planning:** monthly/yearly budgets only; credits do not reduce budget spending in v1; overlapping budgets stay independent; wealth ranges 3M/6M/1Y/All with 1Y default; missing rates/values are partial, never zero; bank balances may display, credit cards remain identity/freshness only; safe public sync taxonomy.
5. **Commands:** later and live-only; allow review resolve/skip, transaction category/owner/exclusion, budget CRUD, schema-safe category CRUD/order/replacement, Telegram alert preferences, and Mac sync start. Narrow capabilities, idempotency, conflicts, redacted audit. Budget/category deletion gets destructive confirmation; reversible edits use Save. Sync cancellation, OTP, credentials, accounts, assets, provider/admin settings, and offline queues are out.
6. **Advisor:** later, strictly read-only, deny-by-default read tools, no direct commands or AI-memory writes, per-device private conversations, encrypted 30-day transcript cache, explicit provider disclosure and freshness, offline transcript reading only.
7. **Release:** direct Xcode development, then email-invite TestFlight for family/friends; no App Store. Team `CVP2NVLKL4`, organization `com.saaramrani`, production bundle `com.saaramrani.moneymonitor`; iOS 18+, iPhone-only, English UI with mixed Hebrew/English content correctness; current Mac/iPhone contract pair only; update both apps on mismatch; no N-1 promise, cloud, APNs, third-party telemetry, iPad, or full Hebrew UI.

Phase 2A and Phase 2B are accepted historical live-only slices. D-020 supersedes their sole-owner audience limit. Phase 1 implementation is next before saved/offline data or family/friend distribution.

## Work already completed in the working tree

The following intended documentation has been edited but is not staged or committed:

- `docs/ios-mockups/PRODUCT.md`
- `ios/Documentation/ACCESSIBILITY.md`
- `ios/Documentation/API_CONTRACT.md`
- `ios/Documentation/ARCHITECTURE.md`
- `ios/Documentation/DECISIONS.md`
- `ios/Documentation/DESIGN_SYSTEM.md`
- `ios/Documentation/IMPLEMENTATION_PLAN.md`
- `ios/Documentation/INTERACTIONS_AND_STATES.md`
- `ios/Documentation/LOCKED_PRODUCT_POLICY.md` (new)
- `ios/Documentation/PRODUCT_SCOPE.md`
- `ios/Documentation/XCODE_SETUP.md`
- `ios/IMPLEMENTATION_LEDGER.md`
- `ios/Specification/PHASE_0_FOUNDATION.md`
- `ios/Specification/PHASE_1_TRUST_AND_RESILIENCE.md`
- `ios/Specification/PHASE_2_EVERYDAY_MONEY.md`
- `ios/Specification/PHASE_3_PLANNING_AND_ACCOUNTS.md`
- `ios/Specification/PHASE_4_MOBILE_COMMANDS.md`
- `ios/Specification/PHASE_5_ADVISOR.md`
- `ios/Specification/PHASE_6_RELEASE_READINESS.md`
- `ios/Specification/PRODUCT_SPEC.md`
- `ios/Specification/QUALITY_GATES.md`
- `ios/Specification/README.md`
- `ios/Specification/TRACEABILITY.md`

Already corrected during the pass:

- Phase 2B is now recorded as physically accepted.
- All formerly open product questions resolve to D-020–D-026.
- Current task rows no longer have product-decision blockers.
- The API doc now recognizes implemented bootstrap and Phase 2B transaction routes.
- The architecture doc no longer claims the mobile gateway is missing.
- iPad/full-localization/rollback language was narrowed in most release documents.
- `git diff --check` currently passes.
- A read-only local-link validator passed for 26 Markdown files under the affected documentation trees.

## Known remaining consistency fixes

Finish these with `apply_patch`; do not broaden scope:

1. `ios/Documentation/API_CONTRACT.md`: the rows for `/categories`, `/alert-settings`, and `/sync-history` still lack the new Status column. Mark them Planned. Replace “until notification architecture is decided” with the accepted Mac-owned Telegram wording.
2. `ios/Documentation/INTERACTIONS_AND_STATES.md`: empty Search still says “suggestions/recent items” despite the no-recents decision. Use static guidance/filter shortcuts. Replace vague “destructive or consequential” confirmation with budget/category deletion confirmation and ordinary Save for reversible edits.
3. `ios/Specification/PHASE_1_TRUST_AND_RESILIENCE.md`: `P1-SEC-01` still has an acceptance item saying a “Not now” choice persists. Replace it with no permanent skip once cached financial data exists and safe unavailable/lockout recovery.
4. `ios/Documentation/PRODUCT_SCOPE.md`: replace “Face ID preference” in the iPhone-holds table; authentication is mandatory, not a preference. Use non-sensitive local UI/authentication state.
5. `ios/Specification/PHASE_4_MOBILE_COMMANDS.md`: remove “optional cancel” from P4-API-07/P4-IOS-07; sync cancellation is out. Remove unapproved account-preference mutations from P4-API-08. P4-IOS-06 must not imply optional Face ID/cache-policy settings. P4-IOS-03 should use explicit Save without an extra confirmation.
6. `ios/Specification/TRACEABILITY.md`: Settings still says “local privacy/cache preferences”; replace with connection status, Disconnect, redacted diagnostics, and accepted Telegram settings, with unsupported Household/settings hidden.
7. `ios/Documentation/IMPLEMENTATION_PLAN.md`: remove the stale technical-owner wording in the Deferred legend; replace vague consequential confirmations; state that future Advisor proposals go through ordinary Phase 4 UI; update the full-Phase-2 remaining list so it does not imply Activity/Search/detail are unimplemented.
8. Keep cache/version handling simple across `LOCKED_PRODUCT_POLICY.md`, `QUALITY_GATES.md`, `ARCHITECTURE.md`, `PHASE_3_PLANNING_AND_ACCOUNTS.md`, `PHASE_6_RELEASE_READINESS.md`, and the README task taxonomy: preserve compatible snapshots, discard an incompatible snapshot and live-refetch, and update both apps or fresh-pair when required. Do not promise a cache-migration chain, prior-contract support, or rollback matrix.
9. `ios/Specification/PRODUCT_SPEC.md`: future Advisor action wording and its risk mitigation should say the model only proposes a structured action that ordinary Phase 4 UI confirms; Advisor itself stays read-only.
10. Run targeted searches again for `recent items`, `optional cancel`, `Not now`, `account-preference`, `Face ID preference`, `rollback`, `migration from previous`, and current normative `blocked`/`open decision` language. Historical D-011/D-018/D-019 entries and historical ledger rows must remain unchanged.

## Files that belong to the user — do not touch or stage

- `ios/MoneyMonitor.xcodeproj/project.pbxproj` is modified independently by the user.
- `dashboard.html` is an unrelated untracked user file.

Also do not change `ios/project.yml` in this documentation commit. It still has temporary `com.example` identifiers and iPad targeting. The docs intentionally record the production identity as a **planned one-time migration** so the current installed app/signing/pairing is not disrupted while the Xcode project has user changes.

## Review and validation

Three read-only reviewers originally audited finance semantics, cross-document decisions, and self-use release constraints. Their initial findings informed D-020–D-026. A final review was started but interrupted when this handoff was requested, so rerun one narrow read-only consistency review after the fixes if useful.

Recommended checks:

```sh
git diff --check
rg -n 'recent items|optional cancel|Not now|account-preference|Face ID preference|rollback|migration from previous|open decisions|physical acceptance pending' ios/Documentation ios/Specification ios/IMPLEMENTATION_LEDGER.md
```

Re-run the existing read-only Markdown link validator or equivalent. A broad Prettier check is **not** a clean baseline: it reported warnings in both changed files and pre-existing unmodified files such as `ADR-001-MOBILE-ACCESS-BRIDGE.md` and `SCREEN_MAP.md`. Do not create a large unrelated formatting diff merely to make that check green.

No runtime code changed, so a full backend/iOS build is unnecessary for this documentation-only commit. Verify status and staged diff instead.

## Commit procedure

After cleanup:

1. Delete this transient handoff with `apply_patch`.
2. Stage only the intended documentation paths listed above, explicitly excluding the Xcode project and `dashboard.html`.
3. Run `git diff --cached --check` and inspect `git diff --cached --stat` plus `git status --short`.
4. Commit with: `docs(ios): lock trusted circle product policy`.
5. Git index writes may require sandbox escalation because this worktree's index lives outside the writable root.

The final report should say that all product choices are locked, no product blocker remains, Phase 1 is next, and runtime/Xcode settings were deliberately not changed. If a commit is created, include the commit hash and the app artifact directive expected by the environment.

Official Apple references already checked for the TestFlight language:

- https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information

Total Recall did not find a relevant indexed summary for this active iOS decision pass; the live worktree and this handoff are the authoritative continuation state.
