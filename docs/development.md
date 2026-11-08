# Development

For the approved app-wide visual and interaction direction, see [the design language](design-language.md) and its [finance UI references](research/finance-ui-references.md).

## Find the implementation

| Change                                     | Entry points                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Desktop pages and routing                  | `dashboard/src/main.ts`, `dashboard/src/components/`, `dashboard/README.md`                                                   |
| iPhone screens and navigation              | `mobile/app/`, `mobile/src/navigation-state.ts`, `mobile/README.md`                                                           |
| Financial calculations and reporting dates | `src/services/`, `src/db/schema.ts`, `src/shared/dates.ts`, `CONTEXT.md`                                                      |
| Desktop API and validation                 | `src/server.ts`, `src/api/`, `src/api/validation.ts`                                                                          |
| Authenticated mobile API and projections   | `src/mobile/mobile-server.ts`, `src/mobile/production-mobile-access.ts`, `src/mobile/*-contract.ts`, `src/mobile/*-routes.ts` |
| iPhone connection and data                 | `mobile/src/mobile-api.ts`, `mobile/src/MoneyData.tsx`, `mobile/src/security/`                                                |
| Pairing and Tailscale on the Mac           | `electron/main.ts`, `electron/mobile-access/`, `src/mobile/pairing-routes.ts`                                                 |
| Scraping and schedules                     | `src/scraper/`, `src/api/scrape.routes.ts`, `patches/`                                                                        |
| AI providers and categorization            | `src/ai/agent.ts`, `src/ai/auth.ts`, `src/ai/categorization/`                                                                 |
| Paths and encrypted configuration          | `src/paths.ts`, `src/config.ts`, `src/safe-storage.ts`, `electron/main.ts`                                                    |

Desktop review decisions and their conditional Undo are implemented in `src/services/transaction-review.ts`; their shared field snapshot is `src/shared/transaction-review.ts`.

The Mac owns financial calculations, credentials, scraping, and administration. Trace a shared feature through its service and both API/client paths; the mobile API is separate from the desktop API.

### Advisor

`src/ai/agent.ts` emits text and chart events. `src/ai/chart-data.ts` calculates points; `src/ai/advisor-chart.ts` validates the chart contract; `src/ai/sessions.ts` stores replies and charts.

- Desktop: `src/api/ai.routes.ts` → `dashboard/src/api/client.ts` → `dashboard/src/components/AiChat.vue` and `AdvisorChartView.vue`.
- iPhone: `src/mobile/advisor-routes.ts` → `mobile/src/mobile-api.ts` → `mobile/app/(tabs)/advisor.tsx`. `electron/main.ts` supplies the mobile read-only agent.
- API regressions: `src/api/ai.routes.test.ts` and `src/mobile/advisor-routes.test.ts` cover streaming and reopening saved charts. Run both when changing Advisor events or persistence.

## Install and run

Use the Node version required by `package.json`. The root npm workspace includes the dashboard; mobile has a separate lockfile and install.

```bash
npm ci
npm --prefix mobile ci
```

Keep dependencies local to each checkout. Normal installs run patch-package and native package setup. An install with `--ignore-scripts` is incomplete for native QA: Skia binaries and SQLite bindings may be absent. Rerun the normal install before a native build. Scraper upgrades also need the matching patch in `patches/`.

Run `npm run dev:all` for backend and dashboard; standalone configuration comes from `.env.example`. `npm run dashboard:dev` is sufficient for the synthetic browser smoke test below. Run `npm run electron:dev` for Electron; its prebuild compiles the backend/dashboard and rebuilds SQLite for Electron.

### SQLite runtime

Electron and standalone Node use different native ABIs. `npm run electron:rebuild` targets Electron. After an Electron build, run `npm rebuild better-sqlite3` before Node tests or the standalone server. Switching back to Electron requires its rebuild again. Keep this sequence within the same checkout.

### Native iPhone builds

Follow `mobile/README.md` for Expo, Xcode, CocoaPods, localization, and fixtures. Generated `mobile/ios/` is ignored; keep lasting configuration in `mobile/app.json` or `mobile/app.config.js` and regenerate with `npm --prefix mobile run prebuild:ios`.

`MM_DEMO_BUILD=1` selects a separate demo identity in `mobile/app.config.js`. For a normal device update, regenerate without that variable and verify the generated bundle ID and signing identity against the installed app. Use the available Xcode signing team as a build setting; a generated demo project can otherwise survive into the next build.

## Validate

The authoritative commands are the scripts in each package.json:

```bash
npm run check
npm run build
npm --prefix mobile run typecheck
npm --prefix mobile test
```

Root `check` runs lint, documentation link/script checks, backend/Electron/dashboard typechecks, the bootstrap schema drift check, backend tests, and Electron tests. The desktop/backend typecheck emits backend declarations because Electron imports `dist/` modules. Mobile checks use its separate package. CI runs these on pushes and PRs targeting `main` or `mm_revamped`. Native UI E2E remains a macOS check.

Commit hooks run the desktop/backend typecheck, staged lint/format, and gitleaks. Fix failing checks before retrying the commit.

After changing the bootstrap contract, use `npm run mobile:bootstrap-schema:generate` and include the generated schema; `check` verifies it is current.

## Synthetic UI QA

### Desktop

Start `npm run dashboard:dev`, then in another terminal:

```bash
node scripts/smoke-dashboard-motion.mjs
node scripts/smoke-dashboard-screens.mjs
```

The script intercepts API requests with synthetic responses, so it needs no backend or personal database. It exercises desktop/narrow layouts, Hebrew, reduced motion, filters, and detail panels. The screen smoke starts a disposable demo API and checks every production route, asset editor, settings labels, setup, and sign-in dialogs in English/light and Hebrew/dark. It simulates Electron mobile access and updates and blocks external services. Both scripts use Chrome; set `CHROME_PATH` for another installation and `MM_DASHBOARD_URL` for another Vite URL.

### iPhone

Run `npm --prefix mobile run e2e:ios` for a Release simulator build and the sequential Maestro flows. Fixture launch arguments and the separate real pairing check are documented in `mobile/README.md`.

Write exploratory screenshots and build logs outside the tracked repository, for example under `/tmp`. Capture build output to a log and inspect the failure diagnostics instead of loading thousands of native warnings. For manual QA, select demo/fixture data before capturing a screen.

## Data and backups

Standalone mode defaults to repository `data/`. Electron sets `MONEY_MONITOR_DATA_DIR` to its OS user-data directory before importing the backend; on macOS this is `~/Library/Application Support/Money Monitor`. `src/paths.ts` defines the files, including database, credentials, configuration, and chat sessions.

The existing `npm run backup` and `npm run restore` scripts are for standalone repository data and `.env` only. They do not back up Electron's user-data directory, `config.json`, or chat sessions. For a desktop replacement, retain the old app, take a consistent SQLite snapshot, and preserve the entire user-data directory. Electron config secrets are encrypted through OS safe storage; copying encrypted files to another machine does not transfer the ability to decrypt them.

## Security maintenance

Run `npm run security:audit` after installing both dependency trees. It fails on unknown
advisories or an unavailable audit service. The only exception is deepmerge
GHSA-gcqx-w48m-w2h4 in Expo's configuration tooling: upstream has no fixed release,
so `mobile/patches/deepmerge+4.3.1.patch` rejects prototype keys from both inputs.
The gate verifies that mitigation before accepting the exception. Remove the patch
and exception when upstream ships a compatible fix. The query-string patch adapts
its CommonJS import to the patched ESM decoder; keep its regression test when upgrading.
The Expo CLI uses the patched Zod 4 override; validate an iOS export after upgrades.

Electron uses a sandboxed CommonJS preload (`electron/preload.cts`). Its initial
configuration comes from main-frame-validated IPC, never renderer environment
variables. Keep permission checks denied unless a feature explicitly needs one.
The CSP permits inline styles for Vue/ECharts, but does not permit inline scripts,
external images, frames from other origins, or external connections.

Desktop startup requires OS-backed secure storage (Linux `basic_text` is rejected).
OAuth files migrate from legacy JSON to OS encryption on desktop and authenticated
AES-GCM using `CREDENTIALS_MASTER_KEY` in standalone mode. Standalone OAuth requires
a master key of at least 32 characters. Failed decryption preserves the existing
file and stops startup rather than replacing the key. Keep the original keychain
when restoring desktop data. Database and chat files are not application-encrypted;
use OS disk encryption and encrypted backups for data at rest.

The legacy mobile capability name `mobile.read` grants the existing paired-client
scope: financial reads, transaction review edits, recurring-payment decisions, and
Advisor conversations. It does not grant bank credentials, scraping, configuration,
or device administration. Mobile Advisor tools remain read-only. Pair only devices
trusted with that full financial scope. Advisor is limited to two simultaneous
replies across the Mac and ten mobile session/message submissions per device per
minute. Restrict Tailscale ACLs to trusted devices; never expose the desktop API.

Standalone backups now require `MM_BACKUP_PASSPHRASE` (at least 16 characters),
independent of the credentials master key. Supply it through your secret manager or
a hidden shell prompt, keep it separately, then use `npm run backup`. The output is
an authenticated `.tar.gz.enc` archive. Stop the app before `npm run restore -- path/to/backup.tar.gz.enc`,
using the same passphrase. Restore rejects unknown paths, symlinks and active SQLite
journal files. Legacy `.tar.gz` archives require explicit `--allow-plaintext`.
Existing unencrypted backups are not rewritten or deleted automatically. These
scripts still cover standalone data, not the Electron user-data directory.

### Signed releases

Release builds fail closed without signing credentials. Configure these repository
Actions secrets through GitHub's encrypted secret settings (never commit them):

- Mac: `MAC_CSC_LINK` (base64 signing certificate), `MAC_CSC_KEY_PASSWORD`,
  `APPLE_API_KEY_P8` (App Store Connect API private-key contents),
  `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`.
- Windows: `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for the signing certificate.

The workflow writes Apple's key into a private temporary file, notarizes the Mac
build, and deletes the key afterward. Local unsigned development builds remain
possible, but cannot be published by this release workflow. Validate a signed update
from an existing installation before distributing it; unsigned historical releases
may require a one-time manual installation. No quarantine-removal workaround remains.

## Versioned edits and recovery

Transaction commands, recurring decisions, and bulk holding prices persist a mutation receipt in the same transaction as their financial effects. Clients keep the command ID after transport uncertainty and require the accepted resource version. Desktop Review and Undo use the same receipt boundary; a conflicted draft must reconcile before re-confirming, and Undo reads the accepted resource version after the database trigger runs. Existing transaction inclusion choices migrate as legacy provenance; subsequent manual choices remain protected from category defaults and delayed categorization. Compatible reads remain available when protected writes require an update.

Advisor question acceptance and the final assistant exchange are atomic session-file replacements. Desktop, mobile, and Telegram share reply admission and terminal outcomes. Desktop/mobile reconcile by reply ID; Telegram derives its reply ID from the chat and update and preserves the original session. Scrape authentication challenges carry challenge/session IDs; cancellation keeps admission occupied until resource cleanup. Post-import enrichment phases survive restart, and interrupted Telegram sends remain unknown instead of being automatically replayed. Alert evaluations are keyed by import job or monthly period; durable recipient/chunk delivery intent precedes the analysis baseline. Confirmed alert context is appended idempotently to the captured conversation after an active reply settles. `/retry` sends only known incomplete chunks and never repeats an unknown send. Telegram image buffers belong to one reply/recipient/session and expire after 10 minutes, with limits of 10 images per reply, 10 MB per image, 20 retained replies and 64 MB total. Desktop and mobile do not expose the Telegram image tool.

The iPhone stores complete Saved Views in an encrypted file with a device-only Keychain key. Snapshot calculation time governs the 24-hour stale and 7-day deletion boundaries. Partial snapshots cannot replace complete saved data, Saved View cannot mutate, and verified credential invalidation clears feature scopes and local display rights. Keep the small shared SSE parser visible to Metro through `mobile/metro.config.cjs`.
