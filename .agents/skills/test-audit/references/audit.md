# Audit workflow

- Use after the authoring gate in [SKILL.md](../SKILL.md#authoring-gate).
- Whole-subsystem campaigns also require [CAMPAIGN.md](../CAMPAIGN.md).

## Junk patterns

Reject new matches unless the retention bar identifies an independent contract.
Audit existing matches across `src/`, `electron/`, `mobile/src/`, and
`scripts/`:

- Assertion-free probes, self-comparisons, identity copiers, and
  subject-generated expected values.
- Copied inventories, manifests, or export lists; exact source, import, or
  string greps (for example reading `.tsx`/`.ts` files with `readFileSync` to
  assert implementation syntax).
- Private predicate or call-shape tests duplicating boundary proof; repeated
  invocations or caller-local replays of shared helpers.
- Test-only exports, globals, reset hooks, or wrappers; production branches
  called only by tests.
- Mocks implementing the asserted behavior or pretending distinct APIs match
  (watch high-`vi.mock` suites where mocks replace the real boundary).
- Fixtures supplying receipts, admission, or callback ordering the owner should
  produce; persistence asserted against a store the path never writes.
- Capability flags asserted instead of promised delivery, rejection, or
  acknowledgement.
- Negative controls passing on an unrelated guard or an unreachable rejection.
- Names promising behavior the test inputs and assertions never exercise.

## Retention bar

- Keep independent public/mobile/MCP API, bootstrap schema, financial
  calculation, date-window, config, migration/backfill, mutation-receipt,
  storage, security, Electron sandbox/bind/CSP, dependency/vendor patch,
  platform (`AbortSignal.throwIfAborted`), Advisor streaming/persistence,
  durable Telegram delivery, and observable-ordering contracts.
- Source inspection is valid only when it is the cheapest independent guard of a
  user-facing key, byte, path, or rule and survives identifier-only refactoring.
- Static or slow is not a deletion reason. A baseline failure may be a product
  bug: reproduce and repair the owner; never delete the test to make the suite
  green.

## Candidate evidence

- Before editing: read the full test file, production owner, entry point,
  callers, callees, sibling suites, overlapping proof, and relevant `git log`
  history. For dependency- or patch-backed claims (such as `patches/` or
  `mobile/patches/`), inspect the patch or dependency source.
- Record each candidate's:
  - Exact test name, file/line location, and the failure it can actually detect.
  - Non-test callers of the covered production code or support seam.
  - Stronger remaining owner proof (exact file and test), or why no contract
    exists.
  - History/reason it exists and any production seam or helper deletion it
    unlocks.
  - Risk and focused validation command.
- Missing evidence means no deletion. Keep discovery read-only and report before
  editing. Prefer high-confidence batches over speculative trims. Parallel
  discovery may split independent owner boundaries.
- Delete obsolete test-only seams and dead helpers; move retained regressions
  to their primary owner; consolidate duplicate contract checks into shared
  tables or boundary suites.
- Prefer net-negative production LOC when seams can be removed. Never replace a
  deleted test with another implementation-coupled test, and never turn
  uncertainty into cleanup.

## Validation and handoff

- Never edit files while an active Vitest or `node --test` run is in progress.
- If `better-sqlite3` fails with `NODE_MODULE_VERSION` mismatch, run
  `npm rebuild better-sqlite3` before running Node tests.
- Run focused owner and sibling suites first:
  - Backend: `npx vitest run <paths>`
  - Electron: `npx vitest run --config electron/mobile-access/vitest.config.ts <paths>`
  - Mobile: `npm --prefix mobile test` (or `node --experimental-strip-types --test <paths>` inside `mobile/`)
  - Backup crypto: `node --test scripts/backup-crypto.test.mjs`
- When removing source-grep or synthetic checks, verify the real owning
  executable or smoke script where applicable (for example
  `scripts/smoke-dashboard-screens.mjs`, `scripts/smoke-dashboard-motion.mjs`,
  or `npm --prefix mobile run e2e:ios`).
- Check for orphaned test helpers, fixtures, exports, and dependencies left
  behind by deleted tests (`git grep` references, `npm run lint`, and
  `npm run typecheck`).
- Run `npm run format:check`, `git diff --check`, and the full repo gates:
  - `npm run check`
  - `npm run build`
  - `npm --prefix mobile run typecheck`
  - `npm --prefix mobile test`
- Inspect `git diff --numstat` and review the full diff before handoff.
- Report causes, removed categories/seams, retained false positives, validation
  run, production vs. test/support LOC delta, and follow-ups. Commit or push
  only when asked.
