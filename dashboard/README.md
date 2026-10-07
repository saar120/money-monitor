# Desktop dashboard

Vue 3 SPA hosted by Fastify or Electron. The root npm workspace installs its dependencies. Run `npm run dashboard:dev` from the repository root; run `npm run dashboard:build` to typecheck and bundle it.

- Routes: `src/main.ts`; page and shared UI components: `src/components/`.
- HTTP and streaming API client: `src/api/client.ts`.
- Chart rendering: ECharts / vue-echarts; shared theme: `src/composables/useChartTheme.ts`.
- Colors and layout tokens: `src/style.css`; language and RTL: `src/lib/language.ts`.
- Interaction helpers: `src/lib/cardMotion.ts`, `src/composables/useMonthSwipe.ts`.

Home, Activity, Explore, and Advisor are the primary money views. Administration and scraping stay on the desktop. Preserve the backend's financial/date/currency semantics when changing a page.

For cross-client ownership, native dependency setup, checks, and synthetic browser QA, read [the development guide](../docs/development.md). For domain terms, read [CONTEXT.md](../CONTEXT.md).
