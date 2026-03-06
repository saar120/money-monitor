# F10: Asset Detail Page - Frontend Design

## Design Direction

**Concept: "Portfolio Deep Dive"** - A dedicated page for a single asset showing everything: performance metrics, all holdings with P&L, value history chart, and movement log. This is where the user goes to understand how a specific investment is performing.

**Tone:** Data-rich, analytical, precise. More table-heavy than the Net Worth page. Numbers should be scannable with clear positive/negative color coding.

**Navigation:** Accessed by clicking an asset row on the Net Worth page (F7). Back button returns to `/net-worth`.

---

## Page Layout

```
                         animate-fade-in-up
+---------------------------------------------------------+
|  <- Back to Net Worth                                    |
|                                                          |
|  OneZero Portfolio                                       |
|  [brokerage badge] · oneZero · [liquid badge]            |
|                                                          |
|  +--Value Card-----+ +--Invested Card--+ +--Return Card-+|
|  | Current Value   | | Total Invested  | | Total Return ||
|  | ₪223,477        | | ₪180,000        | | +₪43,477     ||
|  |                 | |                 | | +24.2%       ||
|  +-----------------+ +-----------------+ +---------------+|
|                                                          |
|  Holdings                               [+ Add Holding]  |
|  +--Table--------------------------------------------+   |
|  | Name   | Type  | Qty | Price  | Value  | P&L     |   |
|  |--------|-------|-----|--------|--------|---------|   |
|  | TSLA   | stock | 15  | $350   | ₪19.1k | +87.5% |   |
|  | NFLX   | stock |  8  | $950   | ₪27.7k | +12.3% |   |
|  | kaspit | fund  |     | -      | ₪120k  | +0.4%  |   |
|  | USD $  | cash  |     | -      | ₪43.8k | -      |   |
|  +---------------------------------------------------+   |
|                                                          |
|  Value Over Time                                         |
|  +---------------------------------------------------+   |
|  |              (line chart from snapshots)           |   |
|  +---------------------------------------------------+   |
|                                                          |
|  Movement History                    [+ Add Movement]    |
|  +---------------------------------------------------+   |
|  | Date    | Type  | Holding | Qty   | Cost    |     |   |
|  |---------|-------|---------|-------|---------|     |   |
|  | Feb 24  | sell  | kaspit  | +50k  | -       |     |   |
|  | Feb 17  | buy   | kaspit  | -50k  | ₪50k    |     |   |
|  | Jan 28  | buy   | NFLX   | +8    | ₪20k    |     |   |
|  | ...     |       |         |       |         |     |   |
|  |              [Load More]                     |     |   |
|  +---------------------------------------------------+   |
+---------------------------------------------------------+
```

---

## Component Specifications

### Back Navigation

```vue
<button
  class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
  @click="router.push('/net-worth')"
>
  <ArrowLeft class="h-4 w-4" />
  Back to Net Worth
</button>
```

Simple text button, not a full `Button` component. Lightweight, doesn't compete with page content.

### Asset Header

```vue
<div class="mb-6">
  <h1 class="text-2xl font-semibold tracking-tight heading-font">
    {{ asset.name }}
  </h1>
  <div class="flex items-center gap-2 mt-1">
    <Badge :style="typeBadgeStyle">{{ typeLabel }}</Badge>
    <span class="text-sm text-muted-foreground">{{ asset.institution }}</span>
    <Badge :class="liquidityBadgeClass">{{ asset.liquidity }}</Badge>
  </div>
</div>
```

- Type badge: uses asset-type color from F7 palette as background (10% opacity) + text color
- Liquidity badge: uses the liquidity badge styles from F7 (green/amber/red)
- Institution shown as plain text between badges

---

### Performance Summary Cards

Three stat cards in a `grid grid-cols-3 gap-4` row (same pattern as Overview page spending cards).

**Card 1: Current Value**
```
+-------------------+
| Current Value     |
| ₪223,477          |
+-------------------+
```
- Header: `text-sm font-medium text-muted-foreground`
- Value: `text-2xl font-bold tabular-nums`
- Source: Sum of all holdings' `currentValueIls`

**Card 2: Total Invested**
```
+-------------------+
| Total Invested    |
| ₪180,000          |
+-------------------+
```
- Value: Sum of `deposit`/`buy` movements' `sourceAmount` where `sourceCurrency = 'ILS'`, plus non-ILS amounts converted at current rates
- If no movements recorded yet: show "No data" in `text-muted-foreground`

**Card 3: Total Return**
```
+-------------------+
| Total Return      |
| +₪43,477          |
| +24.2%            |
+-------------------+
```
- Return amount: `text-2xl font-bold` in `text-success` (green) or `text-destructive` (red)
- Return percentage: `text-sm` in same color, below the amount
- Calculated: `currentValue - totalInvested` and `(return / invested) * 100`
- If no invested data: show only current value, no percentage
- Badge below: `TrendingUp` or `TrendingDown` icon

---

### Holdings Table

Uses the shadcn `Table` component (matching the pattern from `TransactionTable.vue`).

```vue
<Card>
  <CardHeader>
    <div class="flex items-center justify-between">
      <CardTitle class="text-base">Holdings</CardTitle>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="startQuickUpdate">
          <RefreshCw class="h-3.5 w-3.5 mr-1" />
          Update Values
        </Button>
        <Button size="sm" @click="openAddHolding">
          <Plus class="h-4 w-4 mr-1" />
          Add Holding
        </Button>
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead class="text-right">Quantity</TableHead>
          <TableHead class="text-right">Price</TableHead>
          <TableHead class="text-right">Value (ILS)</TableHead>
          <TableHead class="text-right">Cost Basis</TableHead>
          <TableHead class="text-right">P&L</TableHead>
          <TableHead class="w-[60px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="h in holdings" :key="h.id" class="group">
          <!-- ... cells ... -->
        </TableRow>
      </TableBody>
    </Table>
  </CardContent>
</Card>
```

**Column specifications:**

| Column | Alignment | Content | Styling |
|---|---|---|---|
| Name | Left | Holding name | `font-medium text-sm` |
| Type | Left | Badge with type | `Badge variant="outline" class="text-xs"` |
| Quantity | Right | Formatted number | `tabular-nums text-sm` |
| Price | Right | Currency + amount | `tabular-nums text-sm text-muted-foreground`. Shows `"-"` for cash/balance types |
| Value (ILS) | Right | `formatCurrency(valueIls)` | `tabular-nums text-sm font-medium` |
| Cost Basis | Right | `formatCurrency(costBasis)` | `tabular-nums text-sm text-muted-foreground` |
| P&L | Right | Amount + percentage | See below |
| Actions | Right | Edit/Delete icons | `opacity-0 group-hover:opacity-100` |

**P&L cell styling:**
```vue
<TableCell class="text-right">
  <div v-if="h.gainLoss != null">
    <span :class="h.gainLoss >= 0 ? 'text-success' : 'text-destructive'" class="text-sm tabular-nums font-medium">
      {{ h.gainLoss >= 0 ? '+' : '' }}{{ formatCurrency(h.gainLoss) }}
    </span>
    <span :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'" class="text-xs block">
      {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
    </span>
  </div>
  <span v-else class="text-muted-foreground text-sm">-</span>
</TableCell>
```

**Stale holding indicator:** When a stock/crypto holding has no `lastPrice`:
```vue
<div class="flex items-center gap-1 text-muted-foreground">
  <AlertCircle class="h-3.5 w-3.5 text-amber-500" />
  <span class="text-xs">No price data</span>
</div>
```

**Empty state:** If no holdings exist:
```vue
<div class="text-center py-8">
  <p class="text-muted-foreground text-sm">No holdings yet</p>
  <Button size="sm" class="mt-2" @click="openAddHolding">
    <Plus class="h-4 w-4 mr-1" />
    Add First Holding
  </Button>
</div>
```

---

### Value Over Time Chart

Line chart from `GET /api/assets/:id/snapshots` (last 12 months by default).

**Chart.js configuration:**
```ts
{
  type: 'line',
  data: {
    labels: snapshots.map(s => formatMonthLabel(s.date)),
    datasets: [{
      label: 'Value (ILS)',
      data: snapshots.map(s => s.totalValueIls),
      borderColor: assetTypeColor,        // Color based on asset type
      backgroundColor: assetTypeColor + '20',  // 12% opacity fill
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
    }],
  },
  options: {
    // Same chartOptions base as OverviewDashboard
    // Y axis: ILS with K/M suffixes
    // X axis: "Mar 25" format
  },
}
```

The line color matches the asset's type color (from the F7 palette) — so a crypto asset's chart is amber, a brokerage is purple, etc. This creates visual consistency with the doughnut chart on F7.

**Empty state:** "Update holdings to start building value history" in `text-sm text-muted-foreground text-center py-12`.

**Card wrapper:** Standard `Card` with `CardTitle "Value Over Time"`.

---

### Movement History

Chronological list (newest first) with pagination.

**Section header:**
```vue
<div class="flex items-center justify-between">
  <h2 class="text-lg font-semibold heading-font">Movement History</h2>
  <Button size="sm" @click="openAddMovement">
    <Plus class="h-4 w-4 mr-1" />
    Add Movement
  </Button>
</div>
```

**Movement rows:**

Not a Table component — use a card-based list for more visual flexibility.

```
+-------------------------------------------------------+
| Feb 24, 2026                                    [trash]|
| [sell badge]  kaspit shkalit                           |
| +50,000 ILS                                            |
| Source: -                                              |
+-------------------------------------------------------+
| Feb 17, 2026                                    [trash]|
| [buy badge]   kaspit shkalit                           |
| -50,000 ILS                                            |
| Source: ₪50,000 ILS                                    |
+-------------------------------------------------------+
```

**Movement type badges:**

| Type | Badge Color | Style |
|---|---|---|
| `deposit` | Green | `bg-success/10 text-success` |
| `withdrawal` | Red | `bg-destructive/10 text-destructive` |
| `buy` | Purple | `bg-primary/10 text-primary` |
| `sell` | Amber | `bg-amber-500/10 text-amber-500` |
| `dividend` | Cyan | `bg-cyan-500/10 text-cyan-500` |
| `fee` | Gray | `bg-muted text-muted-foreground` |
| `adjustment` | Indigo | `bg-indigo-500/10 text-indigo-500` |

**Row layout:**
```vue
<div class="py-3 border-b border-border last:border-b-0 group">
  <div class="flex items-start justify-between">
    <div>
      <div class="flex items-center gap-2">
        <Badge :class="movementBadgeClass(m.type)">{{ m.type }}</Badge>
        <span class="text-sm text-muted-foreground">{{ m.holdingName ?? 'General' }}</span>
      </div>
      <div class="text-sm font-medium mt-1 tabular-nums">
        {{ m.quantity > 0 ? '+' : '' }}{{ m.quantity.toLocaleString() }} {{ m.currency }}
        <span v-if="m.pricePerUnit" class="text-muted-foreground">
          @ {{ m.pricePerUnit.toLocaleString() }}/unit
        </span>
      </div>
      <div v-if="m.sourceAmount" class="text-xs text-muted-foreground mt-0.5">
        Source: {{ formatCurrency(m.sourceAmount) }} {{ m.sourceCurrency }}
      </div>
      <p v-if="m.notes" class="text-xs text-muted-foreground mt-0.5 italic">{{ m.notes }}</p>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground">{{ formatDate(m.date) }}</span>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        @click="confirmDeleteMovement(m)"
      >
        <Trash2 class="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  </div>
</div>
```

**Pagination:** "Load More" button at the bottom:
```vue
<Button
  v-if="hasMoreMovements"
  variant="outline"
  class="w-full mt-2"
  @click="loadMoreMovements"
>
  Load More
</Button>
```

Fetches next page via `offset` parameter. Default limit: 50.

**Empty state:** "No movements recorded yet. Add a movement to track your investment history." with "Add Movement" button.

---

### Movement Dialog (Add Movement)

```
+-------------------------------------------+
|  Record Movement                     [x]  |
|                                           |
|  Date                                     |
|  [2026-03-05__________________________]   |
|                                           |
|  Type                                     |
|  [v buy                               ]   |
|                                           |
|  Holding (optional)                       |
|  [v TSLA                              ]   |
|                                           |
|  Quantity                                 |
|  [20__________________________________]   |
|                                           |
|  Currency                                 |
|  [USD_________________________________]   |
|                                           |
|  Price per Unit                           |
|  [180_________________________________]   |
|                                           |
|  Source Amount (what you paid)            |
|  [13100_______________________________]   |
|                                           |
|  Source Currency                           |
|  [ILS_________________________________]   |
|                                           |
|  Notes                                    |
|  [first purchase____________________  ]   |
|                                           |
|               [Cancel]  [Record Movement]  |
+-------------------------------------------+
```

**Form fields:**

| Field | Component | Validation | Details |
|---|---|---|---|
| Date | `Input type="date"` | Required, YYYY-MM-DD | Default: today |
| Type | `Select` | Required | Options from `MOVEMENT_TYPES` |
| Holding | `Select` | Optional | Options: asset's holdings + `"none"` sentinel for general movements |
| Quantity | `Input type="number"` | Required | Positive for deposit/buy/dividend. Label hint changes based on type. |
| Currency | `Input` | Required | Pre-filled from selected holding's currency if holding is selected |
| Price per Unit | `Input type="number"` | Conditional | Only shown for buy/sell on stock/etf/crypto. Required when shown. |
| Source Amount | `Input type="number"` | Optional | "What you paid in source currency" |
| Source Currency | `Input` | Optional | Pre-filled to "ILS" |
| Notes | `Textarea` | Optional, max 500 | |

**Conditional logic:**
- When `type` changes, update the Quantity label:
  - `buy`/`deposit`/`dividend`: "Quantity (positive)"
  - `sell`/`withdrawal`: "Quantity (how much to remove)"
  - `adjustment`: "Quantity (+/-)"
- When `type` is `buy`/`sell` and holding type is stock/etf/crypto: show Price per Unit
- When a holding is selected: auto-fill Currency from the holding's currency
- Sell validation: if holding is selected, max quantity = holding's current quantity. Show inline warning if exceeded.

---

## Data Flow

```ts
// Route param
const assetId = computed(() => Number(route.params.id))

// Parallel fetches on mount
const asset = useApi(() => getAsset(assetId.value))          // GET /api/assets/:id
const movements = useApi(() => getMovements(assetId.value))   // GET /api/assets/:id/movements
const snapshots = useApi(() => getSnapshots(assetId.value))   // GET /api/assets/:id/snapshots

onMounted(() => {
  asset.execute()
  movements.execute()
  snapshots.execute()
})

// Refresh after any mutation
async function refresh() {
  await Promise.all([asset.execute(), movements.execute(), snapshots.execute()])
}
```

---

## Responsive Behavior

| Breakpoint | Layout Change |
|---|---|
| `>= 1024px` | 3-column stat cards, full table columns |
| `< 1024px` | 3-column stat cards (narrower), hide Cost Basis column |
| `< 768px` | 2-column stat cards (Return below), hide Type + Cost Basis columns |
| `< 640px` | Stacked stat cards, table becomes card-based list view |

For small screens, the holdings table degrades to a card list:
```
+----------------------------+
| TSLA              stock    |
| 15 shares @ $350           |
| Value: ₪19,162             |
| P&L: +87.5%               |
+----------------------------+
```

This responsive transformation uses a `hidden md:table-cell` pattern for optional columns and a separate mobile-only card layout with `md:hidden`.

---

## Loading States

| Section | Loading Pattern |
|---|---|
| Page header | `Skeleton class="h-8 w-64"` for name, `Skeleton class="h-5 w-32"` for badges |
| Stat cards | `Skeleton class="h-8 w-32"` inside each card |
| Holdings table | 3 skeleton rows: `Skeleton class="h-10 w-full"` |
| Chart | `Skeleton class="h-48 w-full rounded-md"` |
| Movements | 3 skeleton rows matching movement row height |

---

## Error States

| Error | Handling |
|---|---|
| Asset not found (404) | Show "Asset not found" message with "Back to Net Worth" link |
| API error on fetch | Show error message in `text-destructive` with "Retry" button |
| Movement delete fails | Keep movement visible, show toast/inline error |
| Movement not most recent (400) | Show error: "Can only delete the most recent movement for this holding" |

---

## File Structure

```
dashboard/src/
  components/
    AssetDetailPage.vue       # Main page component
  api/
    client.ts                 # Add: getAsset(), getMovements(), getSnapshots(),
                              #       createMovement(), deleteMovement()
```

Registers route in `main.ts`: `{ path: '/net-worth/assets/:id', component: () => import('./components/AssetDetailPage.vue') }`
