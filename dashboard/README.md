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

Use the shared Button, Input, Select and dialog components. Standard actions and fields are 36px high, icon actions are 36px square, and control labels are 13px. Keep navigation rows and content rows spacious enough for their content. Typography uses the platform UI font, 14px body copy, 18px section headings, and 28px page headings. Use theme tokens for color and the shared content gutter for page alignment.

Activity, Review, Accounts and Categories each have one workspace. Their former `/advanced` URLs redirect while preserving query parameters. Account creation and sign-in dialogs belong to Accounts; transaction filters and effective dates belong to Activity; recategorization belongs to Categories. Net Worth links to the asset detail pages for holdings and value changes.

The screen smoke verifies all routes in English/light and Hebrew/dark at 1024, 1280 and 1440px, shared control dimensions, accessible icon names, legacy redirects, menus, account sign-in/import, and setup. Keep these checks in sync when changing navigation.
