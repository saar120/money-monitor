---
name: test-audit
description: >
  Writing, changing, reviewing, or pruning tests in money-monitor: gate new
  tests on observable contracts, audit duplicate or implementation-coupled
  proof, remove test-only production seams, or run a subsystem cleanup campaign.
---

# Test Audit

Adapted from OpenClaw's `test-audit` workflow for `money-monitor`.

- **Authoring** gates every new or changed test before it lands.
- **Audits** remove low-value proof in coherent owner batches; optimize for
  signal and maintainability, never raw deletion counts. Read
  [references/audit.md](references/audit.md) before editing.
- **Whole-subsystem campaigns** prune an entire owner area end to end. Read
  [CAMPAIGN.md](CAMPAIGN.md) first.

## Authoring gate

Before adding or expanding a test, answer all four:

1. **Contract:** What observable behavior, financial/security invariant, or
   independent contract does it protect?
2. **Regression:** What credible bug makes it fail?
3. **Owner:** Why does existing proof miss it? Each contract gets one primary
   owner at its strongest real boundary:
   - Financial math, reporting dates, schema, migrations, receipts, provenance:
     `src/services/` and `src/db/` (see [CONTEXT.md](../../../CONTEXT.md)).
   - Desktop HTTP transport, validation, status codes, SSE streaming: `src/api/`
     (do not replay service math already owned by `src/services/`).
   - Authenticated mobile API, bootstrap schema, pairing, cursors, mobile
     Advisor: `src/mobile/` (prefer real route/contract boundaries over stacked
     mock layers).
   - Electron security boundaries, bind policy, Tailscale coordinator/runtime:
     `electron/`.
   - iPhone state, cancellation (`mobile/src/abort.ts`), Saved View,
     localization, dependency patches: `mobile/src/`.
   - Scraping, AI/Advisor, Telegram delivery, backups/secrets/MCP: their owning
     module (`src/scraper/`, `src/ai/`, `src/telegram/`, `src/`, `scripts/`).
     Another layer earns a test only for a distinct transport, auth, serialization,
     or lifecycle risk. Extend existing tables and shared fixtures before adding
     new files or setup.
4. **Seam check:** Does the test require an export, flag, wrapper, or injection
   hook with no production caller? Move the proof to a real boundary instead.

- Regressions must fail pre-fix for the intended reason and pass after repair;
  report if baseline proof is unavailable.
- One owner regression covers a bug; never replay the same bug at every crossed
  layer.
- Behavior-preserving refactors should not break the test.

## Junk patterns

Reject matches unless the retention bar identifies an independent contract:

- Assertion-free probes, self-comparisons, identity copiers, subject-generated
  expected values, or mocks supplying the asserted behavior.
- Copied inventories/manifests/export lists and brittle source/import/string
  greps (including reading `.tsx`/`.ts` source via `readFileSync` to assert
  internal structure).
- Private predicate or call-shape assertions duplicating boundary proof, or
  repeated replays of shared helpers across callers.
- Test-only exports, reset hooks, wrappers, or production branches called only
  by tests.
- Fixtures fabricating owner receipts, admission, or callback ordering, or
  asserting persistence against a store the path never writes.
- Negative controls that pass on an unrelated guard, or test names promising
  behavior the inputs and assertions never exercise.

When auditing existing suites, use the full checklist in
[references/audit.md](references/audit.md#junk-patterns).

## Retention bar

- Keep independent contracts: public/mobile/MCP API shapes, generated bootstrap
  JSON schema (`npm run mobile:bootstrap-schema:check`), financial date and
  calculation rules, migrations and backfills, mutation receipt/version
  recovery, OS safe storage / AES-GCM / backup crypto, Electron CSP and bind
  policy, vendor/dependency security patches (`patches/`, `mobile/patches/`),
  mobile React Native runtime quirks (`AbortSignal.throwIfAborted`), Advisor
  streaming/chart persistence, and durable Telegram delivery/quarantine rules.
- Static or slow does not mean disposable.
- Source inspection is valid only when it is the cheapest independent guard of a
  user-facing key, byte, path, or invariant and survives identifier-only
  refactors.
- Baseline failures may be real product bugs to reproduce and repair, not tests
  to delete.

## Audit and validation

- Follow [references/audit.md](references/audit.md#candidate-evidence): keep
  discovery read-only, inspect full owners/callers/history, and report
  candidates and remaining proof before deleting anything.
- Delete obsolete test-only production seams alongside the tests that used them.
- Verify against the repo's real runners (see
  [docs/development.md](../../../docs/development.md)):
  - Never edit the checkout while Vitest or `node --test` is running.
  - If Node tests fail with a `better-sqlite3` `NODE_MODULE_VERSION` mismatch
    after an Electron build, run `npm rebuild better-sqlite3` first.
  - Run owner and sibling tests while iterating, then finish with the full
    changed gates (`npm run check`, `npm run build`,
    `npm --prefix mobile run typecheck`, `npm --prefix mobile test`).
- Report root causes, retained contracts, verification run, production vs.
  test/support LOC delta, and follow-ups. Commit or push only when asked.
