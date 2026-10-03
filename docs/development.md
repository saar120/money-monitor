# Development

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
```

The script intercepts API requests with synthetic responses, so it needs no backend or personal database. It exercises desktop/narrow layouts, Hebrew, reduced motion, filters, and detail panels. It uses Chrome; set `CHROME_PATH` for another installation and `MM_DASHBOARD_URL` for another Vite URL.

### iPhone

Run `npm --prefix mobile run e2e:ios` for a Release simulator build and the sequential Maestro flows. Fixture launch arguments and the separate real pairing check are documented in `mobile/README.md`.

Write exploratory screenshots and build logs outside the tracked repository, for example under `/tmp`. Capture build output to a log and inspect the failure diagnostics instead of loading thousands of native warnings. For manual QA, select demo/fixture data before capturing a screen.

## Data and backups

Standalone mode defaults to repository `data/`. Electron sets `MONEY_MONITOR_DATA_DIR` to its OS user-data directory before importing the backend; on macOS this is `~/Library/Application Support/Money Monitor`. `src/paths.ts` defines the files, including database, credentials, configuration, and chat sessions.

The existing `npm run backup` and `npm run restore` scripts are for standalone repository data and `.env` only. They do not back up Electron's user-data directory, `config.json`, or chat sessions. For a desktop replacement, retain the old app, take a consistent SQLite snapshot, and preserve the entire user-data directory. Electron config secrets are encrypted through OS safe storage; copying encrypted files to another machine does not transfer the ability to decrypt them.
