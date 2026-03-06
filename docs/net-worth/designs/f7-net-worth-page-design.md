# F7: Net Worth Page - Frontend Design

## Design Direction

**Concept: "Financial Observatory"** - A premium command-center view of total wealth. The page should feel like the most important page in the app - the one users open first to see their financial health at a glance.

**Tone:** Refined, data-dense, confidence-inspiring. The hero number should feel weighty and important. Supporting data is scannable without being cluttered.

**Differentiation from Overview page:** The Overview page is spending-focused (credit cards, cashflow). The Net Worth page is wealth-focused (assets, growth, allocation). It uses the same design system but introduces **asset-type color coding** as a new visual language unique to this section.

---

## Asset Type Color Palette

Consistent across all net worth pages. Each asset type gets a dedicated color from the existing chart palette:

| Asset Type | Color | Hex | Usage |
|---|---|---|---|
| Brokerage | Purple | `#8b5cf6` | Matches primary - most common type |
| Pension | Cyan | `#06b6d4` | Cool, long-term feel |
| Keren Hishtalmut | Teal | `#14b8a6` | Close to pension but distinct |
| Crypto | Amber | `#f59e0b` | Volatile, attention-grabbing |
| Fund | Indigo | `#6366f1` | Stable, institutional |
| Real Estate | Pink | `#ec4899` | Distinctive, high-value |
| Banks | Emerald | `#34d399` | Matches existing success color |

Export as a constant map in a shared file (`dashboard/src/lib/net-worth-colors.ts`) for reuse across F7, F8, F10.

### Liquidity Badge Variants

| Liquidity | Badge Style |
|---|---|
| `liquid` | `bg-success/10 text-success` (green outline) |
| `restricted` | `bg-amber-500/10 text-amber-500` (amber outline) |
| `locked` | `bg-destructive/10 text-destructive` (red outline) |

---

## Page Layout

```
                         animate-fade-in-up
+---------------------------------------------------------+
|  Net Worth                                               |
|                                                          |
|  +--Hero Card (full width, special treatment)----------+ |
|  |                                                     | |
|  |  TOTAL NET WORTH                                    | |
|  |  ₪664,253           Liquid: ₪420,000               | |
|  |                      vs last month: +₪28,000 (+4.4%)| |
|  +-----------------------------------------------------+ |
|                                                          |
|  +--Doughnut-----------+  +--Line Chart----------------+ |
|  |  Allocation by Type |  |  Net Worth Trend           | |
|  |                     |  |  (12mo, monthly)           | |
|  |  [doughnut chart]   |  |  [line chart]              | |
|  |                     |  |                            | |
|  +---------------------+  +----------------------------+ |
|                                                          |
|  Assets                              [+ Add Asset] btn  |
|  +--Asset Row------------------------------------------+ |
|  | [color dot] OneZero Portfolio  brokerage  liquid     | |
|  |             ₪223,477  (33.6% of NW)       [expand]  | |
|  +-----------------------------------------------------+ |
|  | [color dot] Pension           pension     locked     | |
|  |             ₪85,000   (12.8% of NW)       [expand]  | |
|  +-----------------------------------------------------+ |
|  | ...                                                  | |
|                                                          |
|  Bank Balances                                           |
|  +--------+  +--------+  +--------+                     |
|  | Poalim |  | OneZero|  | ...    |                     |
|  | ₪25.4k |  | ₪60.7k |  |        |                     |
|  +--------+  +--------+  +--------+                     |
|                                                          |
|  Liabilities                      [+ Add Liability] btn |
|  +--Liability Row--------------------------------------+ |
|  | Poalim Loan   ₪32,000 remaining                     | |
|  | [=======>          ] 20% paid off                    | |
|  | ₪40,000 original                                    | |
|  +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

---

## Component Specifications

### Hero Card

The hero card is the visual anchor of the page. It breaks from the standard `Card` pattern slightly to feel elevated.

```
+-------------------------------------------------------+
|  TOTAL NET WORTH           Liquid Net Worth            |
|                            ₪420,000                    |
|  ₪664,253                                              |
|                            vs Last Month               |
|                            +₪28,000 (+4.4%)            |
|                            [green badge: arrow up]     |
+-------------------------------------------------------+
```

**Styling:**
- `Card` with `border-border-accent` (purple-tinted border) instead of default border
- Subtle `glow-primary` box-shadow for emphasis
- Total net worth: `text-4xl font-bold tabular-nums heading-font` - largest number on the page
- "TOTAL NET WORTH" label: `text-xs font-medium text-muted-foreground uppercase tracking-widest`
- Right side metrics use standard `text-lg` / `text-sm` sizing
- Change badge: `Badge` component with green (`bg-success/10 text-success`) or red (`bg-destructive/10 text-destructive`) based on positive/negative
- Change arrow: `TrendingUp` or `TrendingDown` icon from lucide at 14px

**Layout:** CSS Grid `grid-cols-[1fr_auto]` with the left side being the big number and the right side being the two supporting metrics stacked vertically.

**Loading state:** `Skeleton` elements matching the text sizes. Three skeletons: one large for the main number, two small for the right metrics.

**Empty state:** If no assets configured yet, the hero card shows:
- `text-2xl text-muted-foreground` "₪0.00"
- Below: "Add your first asset to start tracking net worth" with a `Button` linking to the Add Asset dialog

---

### Allocation Doughnut Chart

Left column of the charts row (`grid grid-cols-2 gap-4`).

**Data:** One slice per asset type that has value > 0, plus a "Banks" slice. Colors from the asset type palette above.

**Chart.js configuration:**
- Use existing `doughnutOptions` pattern from `OverviewDashboard.vue`
- `cutout: '65%'` for a thick doughnut (not too thin, not too thick)
- Legend position: `'bottom'`, with the color dot and type name
- Tooltip: show `₪{value} ({percentage}%)` using the existing tooltip theme
- Center text (via Chart.js plugin or absolute-positioned div): total net worth in compact format (e.g., "₪664K")

**Card wrapper:**
```vue
<Card>
  <CardHeader>
    <CardTitle class="text-base">Allocation by Type</CardTitle>
  </CardHeader>
  <CardContent>
    <Doughnut :data="allocationData" :options="doughnutOptions" />
  </CardContent>
</Card>
```

---

### Net Worth Trend Line Chart

Right column of the charts row.

**Data:** Monthly data points from `GET /api/net-worth/history` (default: 12 months, monthly).

**Chart.js configuration:**
- Single line for total net worth (primary purple `#8b5cf6`)
- Fill under the line with a gradient: `rgba(139, 92, 246, 0.15)` → `transparent`
- `tension: 0.3` for smooth curves
- Point style: small dots (radius 3), larger on hover (radius 5)
- X axis labels: `"Mar 25"`, `"Apr 25"` format (short month + 2-digit year)
- Y axis: formatted with K/M suffixes (e.g., "₪400K", "₪1.2M")
- Grid lines: existing `rgba(255, 255, 255, 0.03)` (nearly invisible)
- Register `LineElement`, `PointElement`, `Filler` from chart.js

**Graceful handling:**
- No data: Show text "Start tracking your assets to see net worth history" in `text-sm text-muted-foreground text-center py-12`
- Single data point: Render as a single dot with a label tooltip
- Gaps in data: `spanGaps: true` to connect lines across missing months

**Card wrapper:** Same `Card` pattern as the doughnut.

---

### Asset List

Section below the charts. Each asset is a row inside a shared `Card` container (not individual cards per asset — too much visual weight).

**Section header:**
```vue
<div class="flex items-center justify-between">
  <h2 class="text-lg font-semibold heading-font">Assets</h2>
  <Button size="sm" @click="showAddAssetDialog = true">
    <Plus class="h-4 w-4 mr-1" />
    Add Asset
  </Button>
</div>
```

**Asset row (collapsed):**
```
+-------------------------------------------------------+
| [color dot]  OneZero Portfolio                         |
|              brokerage · oneZero · [liquid badge]      |
|                                                        |
|              ₪223,477    33.6% of total    [ChevronDown]|
+-------------------------------------------------------+
```

- Color dot: `w-2.5 h-2.5 rounded-full` with the asset type color
- Name: `text-sm font-medium`
- Metadata line: `text-xs text-muted-foreground` with type, institution, liquidity badge
- Value: `text-lg font-semibold tabular-nums` aligned right
- Percentage: `text-xs text-muted-foreground` — percentage of total net worth
- Expand icon: `ChevronDown` from lucide, rotates 180deg on expand (CSS transition)
- Row border: `border-b border-border last:border-b-0` for visual separation within the card
- Row hover: `hover:bg-surface-3/50 transition-colors duration-150`
- Row click navigates to `/net-worth/assets/:id` (F10)

**Asset row (expanded) — Phase 1 inline holdings:**

When expanded, show a mini-table of holdings below the asset row:

```
| [color dot]  OneZero Portfolio                         |
|              brokerage · oneZero · [liquid badge]      |
|              ₪223,477    33.6%                [ChevronUp]|
|                                                        |
|   Holdings:                                            |
|   TSLA          15 shares   $350    ₪19,162   +87.5%  |
|   NFLX           8 shares   $950    ₪27,740   +12.3%  |
|   kaspit shkalit            -       ₪120,000   +0.4%  |
|   USD Cash                  -       ₪43,800           |
+-------------------------------------------------------+
```

- Holdings sub-table: `pl-8` indented, `text-xs` font size
- P&L percentage: green (`text-success`) if positive, red (`text-destructive`) if negative
- Stale holdings (no `last_price`): show value as "₪0" with `text-muted-foreground` and a small `AlertCircle` icon
- Expand/collapse uses Vue `<Transition>` with `max-height` animation (smooth accordion)

---

### Bank Balances

Reuses the exact pattern from `OverviewDashboard.vue`:

```vue
<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
  <Card v-for="bank in banks" :key="bank.id">
    <CardHeader class="pb-1">
      <CardTitle class="text-sm font-medium truncate">{{ bank.name }}</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="text-xl font-bold tabular-nums">{{ formatCurrency(bank.balance) }}</div>
    </CardContent>
  </Card>
</div>
```

No changes needed from the existing pattern. Consistent with the Overview page.

---

### Liabilities Section

**Section header:** Same pattern as Assets, with "Add Liability" button.

**Liability row:**
```
+-------------------------------------------------------+
| Poalim Loan                                   [edit][x]|
| loan · ILS                                             |
|                                                        |
| ₪32,000 remaining of ₪40,000                          |
| [===========                    ] 20% paid off         |
|                                                        |
| 5.5% interest · Started Jul 2025                       |
+-------------------------------------------------------+
```

- Container: Single `Card` with rows separated by `border-b border-border`
- Name: `text-sm font-medium`
- Type + currency: `text-xs text-muted-foreground`
- Balance: `text-lg font-semibold tabular-nums`
- Progress bar: Custom div-based bar (not a library component)
  - Track: `h-1.5 rounded-full bg-surface-3`
  - Fill: `h-1.5 rounded-full bg-success` — width = `(original - current) / original * 100%`
  - Percentage label: `text-xs text-muted-foreground` to the right of the bar
- Interest rate + start date: `text-xs text-muted-foreground`
- Action icons: `Pencil` and `Trash2` at 14px, `opacity-0 group-hover:opacity-100` (appear on row hover)

---

## Animations & Transitions

| Element | Animation | Details |
|---|---|---|
| Page enter | `animate-fade-in-up` | Standard page transition (0.3s ease-out) |
| Hero card | `stagger-1` | Slightly delayed after page header |
| Charts row | `stagger-2` | Appears after hero |
| Asset list | `stagger-3` | Appears after charts |
| Asset expand | `max-height` transition | 200ms ease-out, from 0 to content height |
| Chevron rotate | `transform rotate-180` | 150ms transition on expand |
| Number count-up | None (Phase 1) | Future: animate hero number on data load |
| Row hover | `bg-surface-3/50` | 150ms transition-colors |

---

## Data Flow

```
onMounted() {
  // Parallel fetches
  netWorth.execute()      // GET /api/net-worth
  history.execute()       // GET /api/net-worth/history
}

// Computed from netWorth.data:
- heroTotal, heroLiquid
- banks[], assets[], liabilities[]
- banksTotal, assetsTotal, liabilitiesTotal
- allocationChartData (doughnut)
- exchangeRates

// Computed from history.data:
- trendChartData (line)
- lastMonthDelta (current total - previous month's total)
```

---

## Responsive Behavior

| Breakpoint | Layout Change |
|---|---|
| `>= 1024px` (default) | Charts side-by-side (`grid-cols-2`) |
| `< 1024px` | Charts stacked (`grid-cols-1`) |
| `< 768px` | Hero card stacks vertically (big number on top, secondary metrics below) |
| `< 640px` | Bank balance cards go to `minmax(140px, 1fr)` |

---

## Empty States

| Scenario | Display |
|---|---|
| No assets, no liabilities | Hero shows ₪0.00. Below: illustration-free prompt "Add your first asset to start tracking your net worth" with "Add Asset" button |
| Assets exist, no history yet | Trend chart area: "Start tracking your assets to see net worth history" |
| No bank accounts | Bank Balances section hidden entirely |
| No liabilities | Liabilities section shows "No liabilities tracked" with "Add Liability" button |

---

## File Structure

```
dashboard/src/
  components/
    NetWorthPage.vue          # Main page component
  lib/
    net-worth-colors.ts       # Asset type color map, liquidity badge styles
```

Registers route in `main.ts`: `{ path: '/net-worth', component: () => import('./components/NetWorthPage.vue') }`

Adds sidebar nav item in `AppLayout.vue`: `{ path: '/net-worth', label: 'Net Worth', icon: TrendingUp }`
