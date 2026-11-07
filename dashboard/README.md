# Desktop dashboard

Vue 3 SPA hosted by Fastify or Electron. The root npm workspace installs its dependencies. Run `npm run dashboard:dev` from the repository root; run `npm run dashboard:build` to typecheck and bundle it.

- Routes: `src/main.ts`; page and shared UI components: `src/components/`.
- HTTP and streaming API client: `src/api/client.ts`.
- Chart rendering: ECharts / vue-echarts; shared theme: `src/composables/useChartTheme.ts`.
- Colors and layout tokens: `src/style.css`; language and RTL: `src/lib/language.ts`.
- Interaction helpers: `src/lib/cardMotion.ts`, `src/composables/useMonthSwipe.ts`.

Home, Activity, Explore, and Advisor are the primary money views. Administration and scraping stay on the desktop. Preserve the backend's financial/date/currency semantics when changing a page.

For cross-client ownership, native dependency setup, checks, and synthetic browser QA, read [the development guide](../docs/development.md). For domain terms, read [CONTEXT.md](../CONTEXT.md).

## Desktop UI conventions

Use the shared Button, Input, Select and dialog components. Standard actions and fields are 36px high, icon actions are 36px square, and control labels are 13px. Use compact 36px navigation rows and roughly 38px single-line ledger rows, allowing longer content to reflow. Typography uses the platform UI font, 14px body copy, 16px section headings, and 24px page headings. Tables and inspectors share a fine perimeter and a subtle surface tone; shadows are reserved for overlays. Use theme tokens for color and the shared content gutter for page alignment.

Activity, Review, Accounts and Categories each have one workspace. Their former `/advanced` URLs redirect while preserving query parameters. Account creation and sign-in dialogs belong to Accounts; transaction filters and effective dates belong to Activity; recategorization belongs to Categories. Net Worth links to the asset detail pages for holdings and value changes.

In Activity, category, owner and inclusion save as soon as they change; an effective date moves a transaction between months, so it waits for Save and is kept when leaving the row. Search covers all dates. When data fails to load, pages show an error with Retry and never a zero or an empty state.

Home, Activity, and Review implement the [approved design language](../docs/design-language.md) in light and dark mode. Shared surface and selection tokens live in `src/style.css`; shell, merchant marks, and inline category controls use `src/design-language.css`. Home links preserve the selected owner, Reporting Date range, and reporting inclusion rules. Recent activity opens the selected record directly.

Activity shows reporting totals for the entire active filter, grouped by charged currency. Pending and excluded amounts do not contribute. The API returns these totals separately from the paginated rows; the UI never sums only the loaded page.

Review stages category, owner, inclusion, and Effective Date until confirmation. The decision saves atomically through `PATCH /api/transactions/:id/review`, rejects stale review fields, and offers Undo using `PATCH /api/transactions/:id/review/undo`. Undo restores the accepted decision's previous fields only if the transaction still matches its post-review state. Skip applies to the current browser session and keeps the transaction unresolved; reviewed, skipped, and remaining counts are distinct. Failed decisions retain the draft; explicit Reload discards drafts and starts from current server values.

The screen smoke verifies all routes in English/light and Hebrew/dark at 1024, 1280 and 1440px, shared control dimensions, accessible icon names, legacy redirects, menus, account sign-in/import, and setup. Keep these checks in sync when changing navigation.

First launch introduces the app and routes users to Accounts, with an option to explore first. Encryption is prepared automatically without replacing an existing key. Settings separates General (preferences, household, refresh presets, updates), Connections (Advisor and iPhone), and Advanced (AI tuning, custom refresh schedules, encryption, Telegram, and diagnostic data).

Desktop onboarding completion is tracked separately from security initialization (`ONBOARDING_COMPLETED`). New profiles resume setup until they finish or skip it; existing profiles without this flag keep their current entry point. General settings show household members; expense ownership rules are under Advanced.
