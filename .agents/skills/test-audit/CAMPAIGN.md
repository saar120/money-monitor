# Test-pruning campaign

Campaign mode prunes an entire subsystem's test surface (for example
`src/mobile/`, `src/api/` + `src/services/`, `src/telegram/`, `src/scraper/`,
`src/ai/`, `electron/`, or `mobile/src/`) in one coherent pass. The value bar,
retention bar, candidate evidence, and validation in [SKILL.md](SKILL.md) and
[references/audit.md](references/audit.md) apply to every lane. Each step ends
on its completion criterion; do not start the next step early.

## 1. Baseline

Record the subsystem's test, helper, and production line counts and every test
file's pass/fail state at the current `HEAD` SHA. If `better-sqlite3` has an
Electron ABI mismatch, run `npm rebuild better-sqlite3` first. Keep baseline
failures in their own list: they may be real product bugs, not stale tests.

Done when every in-scope test file has a recorded baseline result.

## 2. Lanes and inventory

Split the surface into **lanes** along production owner boundaries, not file
prefixes. Examples in `money-monitor`:

- Mobile API: pairing & auth, bootstrap contract/route, overview/transactions
  routes & ports, recurring payments, mobile Advisor.
- Core backend: financial services & DB/migrations vs. desktop HTTP routes.
- Async/integrations: AI & categorization, scraper & scheduler, Telegram &
  alerts.
- Clients & host: Electron mobile-access/security, iPhone `mobile/src/` state &
  UI helpers.

Include shared helpers (`src/__tests__/helpers/`), fixtures, and smoke/E2E
coverage owned by the subsystem.

Done when every in-scope test file and QA scenario belongs to exactly one lane.

## 3. Read-only ledger per lane

Assign each lane to a read-only pass (one read-only subagent per lane when
fanning out). Read every assigned test in full, including parameter tables, plus
the production owners, entry points, callers, and `git log` history. Put every
test declaration into a written **ledger** with one mark (an `it.each` is one
declaration unless rows need different marks):

- `R`: retain, naming the contract and the bug it catches (a retained test that
  only moves to a better-named owner file stays `R` with the move noted).
- `F`: retain the contract but repair the assertion (for example a vacuous
  negative check or misleading test name).
- `C`: consolidate, naming the owner suite that absorbs the assertion first: a
  sibling table case, a stronger boundary suite, or a shared owner.
- `D`: delete, naming the remaining stronger proof or why no contract exists.

Judge every test by its actual assertions, not its name.

Done when every declaration in the lane has a mark and an evidence line.

## 4. Layer plan per lane

Treat the per-test ledger as input, not as the edit list. A second read-only
pass looks for the redundant **layer** (for example mocked adapter/port suites
replaying contracts already covered by real in-memory SQLite + Fastify route
suites, or source-grep tests duplicating runtime/typecheck proof). Name the
**keeper** suite for each contract. Prefer the real transport or persistence
boundary with fake external I/O over mocked internal collaborators. Correct any
ledger errors this pass finds.

Done when each lane plan names its retired files, its keeper per contract, the
assertions to carry into keepers, and the test-only production seams or helpers
unlocked.

## 5. Cutover

Edit lane by lane. Serialize edits to shared helpers (`src/__tests__/helpers/`,
fixtures, configs) through one owner. With each lane, remove the test-only
production seams and orphaned helpers it unlocks. Verify Vitest config,
`mobile/package.json` test globs, and `scripts/check-docs.mjs` references stay
current.

Done when every lane plan is applied and each lane's keepers pass.

## 6. Preservation review

Before claiming completion, review deleted coverage against the keepers
(independent reviewer per boundary group). Look for:

- Contracts that lost their only proof.
- Consolidated or repaired assertions that cannot fail (for example an
  unreachable rejection branch).

For each restored contract, introduce one deliberate **mutation** in the
production owner and confirm the keeper goes red, then restore the production
source byte for byte.

Done when every reported gap is restored or rejected with source evidence, and
every restored contract has a caught mutation.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it at its
owner separately, and prove it through the real flow with a **control** run that
reverts the fix and shows the old failure. Record unrelated product
discrepancies as follow-ups rather than mixing them into the test cleanup.

Done when each repaired defect has a failing control and a passing candidate on
the same harness.

## 8. Validate and hand off

Run the full repo validation gates:

```bash
npm run check
npm run build
npm --prefix mobile run typecheck
npm --prefix mobile test
```

Check `npm run format:check`, `git diff --check`, and `git diff --numstat`.

Hand off with the [SKILL.md](SKILL.md) report, plus:

- baseline and final test/support line counts, with production LOC counted
  separately;
- lanes, retired layers, and keepers;
- preservation gaps found and their caught mutations;
- product defects with control and candidate proof.
