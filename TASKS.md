# Tasks

## Active

- [ ] **Validate Phase 2A — live Home technical dogfood** - The first paired-iPhone render passed with current Mac totals and exposed two follow-ups that are now fixed in code: legacy `₪` recent-activity projection and Search appearing on Home. Rebuild/restart the Mac harness and run the current iPhone build to confirm Recent activity renders and Home has no search field, then check pull-to-refresh, Tailscale-off retained values, app-switcher concealment, and relaunch refetch. Track evidence in [`ios/IMPLEMENTATION_LEDGER.md`](ios/IMPLEMENTATION_LEDGER.md).

## Waiting On

## Someday

- [ ] **Resume iOS Phase 1 before broader distribution or offline storage** - App lock, encrypted snapshot/cache policy, polished recovery, and the full accessibility/resilience matrix are deferred under D-018.

## Done

- [x] **Complete iOS Phase 0 — Foundation and private bridge** - Signed physical pairing, restart persistence, LAN isolation, token rotation/revocation/recovery, and final secret/privacy scans passed on 2026-07-16.
