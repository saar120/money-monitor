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
- `yAxisFormatter?: (value: number) => string` — custom y-axis tick formatter (e.g. `₪50K`). Parents with reactive formatters (e.g. BrokerageDetail's ILS/native toggle) should pass a computed prop so the chart re-renders when the formatter changes.
- `tooltipFormatter?: (value: number) => string` — custom tooltip value formatter
- `showLegend?: boolean` — whether to show the legend (default: false)

**Internals:**

- Tree-shaken ECharts imports: `LineChart`, `GridComponent`, `TooltipComponent`, `LegendComponent`, `CanvasRenderer`
- Uses `useChartTheme()` raw CSS variable resolvers for colors
- `autoresize` enabled for responsive behavior
- `<VChart>` element must have `class="h-full w-full"` so it fills the parent container's dimensions

### 2. OverviewDashboard — Doughnut → ECharts Pie

Inline ECharts pie chart config within `OverviewDashboard.vue`.

- `type: 'pie'` with `radius: ['60%', '85%']` for doughnut cutout
- `itemStyle.borderRadius: 6` to match current rounded segments
- `padAngle: 2` to match the current `spacing: 3` gap between segments
- Category labels and colors from existing `chartColors` array
- Tooltip uses `useChartTheme()` resolved colors
- Tree-shaking: `PieChart`, `LegendComponent`, `TooltipComponent`, `CanvasRenderer`

### 3. OverviewDashboard — Bar → ECharts Bar

Inline ECharts bar chart config within `OverviewDashboard.vue`.

- `type: 'bar'` with `itemStyle.borderRadius: [6, 6, 0, 0]`
- Dashed grid lines via `splitLine.lineStyle.type: 'dashed'`
- Same color scheme (`#007AFF`)
- Tree-shaking: `BarChart`, `GridComponent`, `TooltipComponent`, `LegendComponent`, `CanvasRenderer`

### 4. NetWorthPage — Doughnut → ECharts Pie with Center Text

Inline ECharts pie chart config with `graphic` component for center text.

- Same doughnut approach as OverviewDashboard but without `padAngle` (no spacing in current NetWorthPage doughnut)
- `graphic` text element positioned at center (`left: 'center'`, `top: 'center'`) showing formatted net worth total
- Legend at bottom with `useChartTheme()` colors
- Tooltip shows value + percentage (matching current behavior)
- Tree-shaking: `PieChart`, `LegendComponent`, `TooltipComponent`, `GraphicComponent`, `CanvasRenderer`

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
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
} from 'echarts/components';
import VChart from 'vue-echarts';

// Register only what each component needs — example for line chart:
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);
// Pie charts also need: PieChart, LegendComponent, GraphicComponent (for center text)
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
