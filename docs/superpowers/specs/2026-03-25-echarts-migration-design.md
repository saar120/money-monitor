# Chart.js → ECharts Migration

**Date:** 2026-03-25
**Status:** Approved

## Goal

Replace all Chart.js (`vue-chartjs`) charts with ECharts (`vue-echarts`) to unify on a single charting library. Remove `chart.js` and `vue-chartjs` dependencies.

## Current State

| Component               | Chart Type      | Library                    |
| ----------------------- | --------------- | -------------------------- |
| `CashflowSankey.vue`    | Sankey          | ECharts (already migrated) |
| `OverviewDashboard.vue` | Doughnut + Bar  | Chart.js                   |
| `NetWorthPage.vue`      | Doughnut + Line | Chart.js                   |
| `CryptoDetail.vue`      | Line            | Chart.js                   |
| `BrokerageDetail.vue`   | Line            | Chart.js                   |
| `RealEstateDetail.vue`  | Line            | Chart.js                   |
| `SimpleValueDetail.vue` | Line            | Chart.js                   |

All charts use `useChartTheme()` for dark/light mode support.

## Design

### 1. Shared `EChartsLineChart.vue` component

A reusable line chart component used by all 5 line chart consumers (4 asset details + NetWorthPage trend).

**Props:**

- `labels: string[]` — x-axis labels
- `datasets: Array<{ label: string; data: number[]; color: string; areaColor?: string }>` — one or more line series
- `yAxisFormatter?: (value: number) => string` — custom y-axis tick formatter (e.g. `₪50K`)
- `tooltipFormatter?: (value: number) => string` — custom tooltip value formatter

**Internals:**

- Tree-shaken ECharts imports: `LineChart`, `GridComponent`, `TooltipComponent`, `CanvasRenderer`
- Uses `useChartTheme()` raw CSS variable resolvers for colors
- `autoresize` enabled for responsive behavior

### 2. OverviewDashboard — Doughnut → ECharts Pie

Inline ECharts pie chart config within `OverviewDashboard.vue`.

- `type: 'pie'` with `radius: ['60%', '85%']` for doughnut cutout
- `itemStyle.borderRadius: 6` to match current rounded segments
- Category labels and colors from existing `chartColors` array
- Tooltip uses `useChartTheme()` resolved colors

### 3. OverviewDashboard — Bar → ECharts Bar

Inline ECharts bar chart config within `OverviewDashboard.vue`.

- `type: 'bar'` with `barBorderRadius: [6, 6, 0, 0]`
- Dashed grid lines via `splitLine.lineStyle.type: 'dashed'`
- Same color scheme (`#007AFF`)

### 4. NetWorthPage — Doughnut → ECharts Pie with Center Text

Inline ECharts pie chart config with `graphic` component for center text.

- Same doughnut approach as OverviewDashboard
- `graphic` text element positioned at chart center showing formatted net worth total
- Legend at bottom with `useChartTheme()` colors
- Tooltip shows value + percentage (matching current behavior)

### 5. NetWorthPage — Trend Line → Shared Component

Reuse `EChartsLineChart.vue` with:

- `yAxisFormatter` for `₪50K` / `₪1.2M` formatting
- `tooltipFormatter` wrapping `formatCurrency()`
- Toggle between total / liquid datasets already handled by existing `showLiquidOnly` ref

### 6. `useChartTheme` Update

After migration, remove Chart.js-specific computed properties (`tooltip`, `legendLabels`, `axisTicks`, `grid`) and keep only the raw CSS variable resolvers (`textPrimary`, `textSecondary`, `bgPrimary`, `separator`) which ECharts consumers use directly (as CashflowSankey already demonstrates).

### 7. Dependency Cleanup

Remove from `dashboard/package.json`:

- `chart.js`
- `vue-chartjs`

## ECharts Tree-Shaking Pattern

Following the pattern established in `CashflowSankey.vue`:

```ts
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import VChart from 'vue-echarts';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);
```

## Migration Order

1. Create `EChartsLineChart.vue`
2. Migrate 4 asset detail line charts to use it
3. Migrate OverviewDashboard (doughnut + bar)
4. Migrate NetWorthPage (doughnut with center text + trend line)
5. Update `useChartTheme` — remove Chart.js helpers
6. Remove `chart.js` / `vue-chartjs` from package.json
7. Verify build and type-check pass

## Files Changed

**New:**

- `dashboard/src/components/EChartsLineChart.vue`

**Modified:**

- `dashboard/src/components/OverviewDashboard.vue`
- `dashboard/src/components/NetWorthPage.vue`
- `dashboard/src/components/assets/CryptoDetail.vue`
- `dashboard/src/components/assets/BrokerageDetail.vue`
- `dashboard/src/components/assets/RealEstateDetail.vue`
- `dashboard/src/components/assets/SimpleValueDetail.vue`
- `dashboard/src/composables/useChartTheme.ts`
- `dashboard/package.json`
