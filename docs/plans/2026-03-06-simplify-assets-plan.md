# Simplify Asset System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each asset type (pension/KH/fund, real estate, crypto, brokerage) show a tailored UI with only the relevant fields and actions, instead of forcing everything through the same complex holdings/movements pipeline.

**Architecture:** Type-aware behavior on existing tables. Add a helper `getAssetCategory(type)` that maps asset types to 4 categories (`simple_value`, `real_estate`, `crypto`, `brokerage`). Backend auto-creates holdings for simple types, adds a simplified value-update endpoint, and gates movement types per category. Frontend renders different detail page layouts per category.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, SQLite, Vue 3 (Composition API), Tailwind CSS, reka-ui components

**Design doc:** `docs/plans/2026-03-06-simplify-assets-design.md`

---

## Task 1: Add asset category helper and new movement types

**Files:**
- Modify: `src/shared/types.ts:47-51`
- Modify: `dashboard/src/lib/net-worth-constants.ts:22-29`

**Step 1: Add category helper and new movement types to shared types**

In `src/shared/types.ts`, update the `MOVEMENT_TYPES` tuple and add the category helper:

```typescript
// Line 50 — replace MOVEMENT_TYPES:
export const MOVEMENT_TYPES = ['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'adjustment', 'contribution', 'rent_income'] as const;

// Add after line 51:
export type AssetCategory = 'simple_value' | 'real_estate' | 'crypto' | 'brokerage';

const ASSET_CATEGORY_MAP: Record<string, AssetCategory> = {
  pension: 'simple_value',
  keren_hishtalmut: 'simple_value',
  fund: 'simple_value',
  real_estate: 'real_estate',
  crypto: 'crypto',
  brokerage: 'brokerage',
};

export function getAssetCategory(assetType: string): AssetCategory {
  return ASSET_CATEGORY_MAP[assetType] ?? 'simple_value';
}

// Movement types allowed per category
export const CATEGORY_MOVEMENT_TYPES: Record<AssetCategory, readonly string[]> = {
  simple_value: ['contribution'],
  real_estate: ['rent_income'],
  crypto: ['buy', 'sell'],
  brokerage: ['deposit', 'withdrawal', 'buy', 'sell', 'dividend'],
};
```

Note: We keep `fee` and `adjustment` in `MOVEMENT_TYPES` for backward compat with existing data, but `CATEGORY_MOVEMENT_TYPES` ensures new movements are gated.

**Step 2: Add labels for new types in frontend constants**

In `dashboard/src/lib/net-worth-constants.ts`, add to `HOLDING_TYPE_LABELS` if needed (balance already exists) and add a new export:

```typescript
// Add after LIQUIDITY_STYLES:
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  fee: 'Fee',
  adjustment: 'Adjustment',
  contribution: 'Contribution',
  rent_income: 'Rent Income',
};
```

**Step 3: Commit**

```bash
git add src/shared/types.ts dashboard/src/lib/net-worth-constants.ts
git commit -m "feat: add asset category helper and new movement types (contribution, rent_income)"
```

---

## Task 2: Auto-create balance holding for simple asset types

**Files:**
- Modify: `src/api/assets.routes.ts:358-388` (POST /api/assets handler)

**Step 1: Update POST /api/assets to auto-create a holding for non-brokerage types**

In the `POST /api/assets` handler (line 358), after the asset is inserted into the DB, add logic to auto-create a balance holding:

```typescript
// After the asset insert (around line 380), before buildAssetResponse:
const category = getAssetCategory(data.type);
if (category !== 'brokerage') {
  // Auto-create a single balance holding
  const holdingName = category === 'crypto' ? '' : data.name; // crypto: no auto holding
  if (category !== 'crypto') {
    db.insert(holdings).values({
      assetId: newAsset.id,
      name: data.name,
      type: 'balance',
      currency: data.currency,
      quantity: 0,
      costBasis: 0,
    }).run();
  }
}
```

Add the import at the top of the file:
```typescript
import { getAssetCategory } from '../shared/types.js';
```

**Step 2: Verify existing asset creation still works**

Run the dev server and create a brokerage asset — should work as before (no auto-holding).
Create a pension asset — should auto-create a balance holding.

```bash
npm run dev
# Test via curl or frontend
```

**Step 3: Commit**

```bash
git add src/api/assets.routes.ts
git commit -m "feat: auto-create balance holding for simple asset types on creation"
```

---

## Task 3: Add simplified value-update endpoint

**Files:**
- Modify: `src/api/assets.routes.ts` (add new route)
- Modify: `src/api/validation.ts` (add new schema)

**Step 1: Add Zod schema for value update**

In `src/api/validation.ts`, add after the existing schemas:

```typescript
export const updateAssetValueSchema = z.object({
  currentValue: z.number().min(0),
  contribution: z.number().min(0).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
});
```

**Step 2: Add PUT /api/assets/:id/value route**

In `src/api/assets.routes.ts`, add a new route inside `assetsRoutes()` (before the holdings routes, around line 447):

```typescript
// Simplified value update for non-brokerage assets
app.put('/api/assets/:id/value', async (req, reply) => {
  const assetId = parseIntParam(req, 'id');
  const data = validateBody(req, updateAssetValueSchema);

  const assetRow = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!assetRow) return reply.code(404).send({ error: 'Asset not found' });

  const category = getAssetCategory(assetRow.type);
  if (category === 'brokerage') {
    return reply.code(400).send({ error: 'Use movements for brokerage assets' });
  }

  // Find the auto-created balance holding
  const holding = db.select().from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.type, 'balance')))
    .get();

  if (!holding) {
    return reply.code(400).send({ error: 'No balance holding found. Re-create the asset.' });
  }

  const today = data.date ?? todayInIsrael();
  const now = new Date().toISOString();

  sqlite.transaction(() => {
    // Update holding value
    const updateSet: Record<string, unknown> = {
      quantity: data.currentValue,
      updatedAt: now,
    };

    // For contribution: add to costBasis
    if (data.contribution && data.contribution > 0) {
      updateSet.costBasis = holding.costBasis + data.contribution;

      // Record contribution movement
      const movementType = category === 'real_estate' ? 'rent_income' : 'contribution';
      db.insert(assetMovements).values({
        assetId,
        holdingId: holding.id,
        date: today,
        type: movementType,
        quantity: data.contribution,
        currency: holding.currency,
        createdAt: now,
      }).run();
    }

    db.update(holdings).set(updateSet).where(eq(holdings.id, holding.id)).run();
  })();

  // Snapshot the new value
  await generateAssetSnapshot(assetId);

  const rates = await getExchangeRates();
  return buildAssetResponse(assetRow, rates.rates);
});
```

**Step 3: Add a separate endpoint for recording rent income (real estate)**

```typescript
app.post('/api/assets/:id/rent', async (req, reply) => {
  const assetId = parseIntParam(req, 'id');
  const data = validateBody(req, z.object({
    amount: z.number().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(500).optional(),
  }));

  const assetRow = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!assetRow) return reply.code(404).send({ error: 'Asset not found' });

  if (getAssetCategory(assetRow.type) !== 'real_estate') {
    return reply.code(400).send({ error: 'Rent income only applies to real estate assets' });
  }

  const holding = db.select().from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.type, 'balance')))
    .get();

  const today = data.date ?? todayInIsrael();
  const now = new Date().toISOString();

  db.insert(assetMovements).values({
    assetId,
    holdingId: holding?.id ?? null,
    date: today,
    type: 'rent_income',
    quantity: data.amount,
    currency: assetRow.currency,
    notes: data.notes,
    createdAt: now,
  }).run();

  return { success: true };
});
```

**Step 4: Commit**

```bash
git add src/api/assets.routes.ts src/api/validation.ts
git commit -m "feat: add PUT /api/assets/:id/value and POST /api/assets/:id/rent endpoints"
```

---

## Task 4: Gate movement types by asset category

**Files:**
- Modify: `src/api/assets.routes.ts:622-730` (POST /api/assets/:id/movements)

**Step 1: Add category validation to the POST movements handler**

At the start of the POST `/api/assets/:id/movements` handler (around line 628), after fetching the asset, add:

```typescript
import { CATEGORY_MOVEMENT_TYPES } from '../shared/types.js';

// Inside the handler, after fetching assetRow:
const category = getAssetCategory(assetRow.type);
const allowedTypes = CATEGORY_MOVEMENT_TYPES[category];
if (!allowedTypes.includes(data.type)) {
  return reply.code(400).send({
    error: `Movement type "${data.type}" is not allowed for ${assetRow.type} assets. Allowed: ${allowedTypes.join(', ')}`,
  });
}
```

**Step 2: Update holding mutation for new movement types**

In the holding state mutation switch (lines 688-717), add cases for new types:

```typescript
} else if (type === 'contribution') {
  newQty += data.quantity;  // contribution increases the value? No — contribution only affects costBasis
  newCostBasis += data.quantity;
} else if (type === 'rent_income') {
  // Rent income doesn't change holding value or costBasis — it's just logged
}
```

Wait — for simple_value assets, the `PUT /api/assets/:id/value` endpoint handles value updates directly. The movement endpoint with `contribution` type should only be used if someone calls the raw endpoint. The `PUT /value` endpoint already handles costBasis updates. So `contribution` in the movement handler should just update costBasis:

```typescript
} else if (type === 'contribution') {
  newCostBasis += Math.abs(data.quantity);
} else if (type === 'rent_income') {
  // No holding changes — rent is logged only
}
```

**Step 3: Commit**

```bash
git add src/api/assets.routes.ts
git commit -m "feat: gate movement types by asset category"
```

---

## Task 5: Fix brokerage P&L — native-only per stock, ILS at account level

**Files:**
- Modify: `src/api/assets.routes.ts:17-66` (computeHoldingValues)
- Modify: `src/api/assets.routes.ts:68-90` (buildAssetResponse)

**Step 1: Fix computeHoldingValues — P&L stays in native currency**

The current `gainLoss = currentValue - h.costBasis` at line 46 is actually correct for native currency. The bug was only on the frontend displaying it as ILS. Since the design says per-stock P&L is native only, just keep this as-is.

No backend change needed for per-stock P&L.

**Step 2: Add account-level ILS P&L to buildAssetResponse**

In `buildAssetResponse` (line 68), add total ILS invested computation:

```typescript
function buildAssetResponse(assetRow: typeof assets.$inferSelect, rates: Record<string, number>) {
  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetRow.id)).all();
  const computedHoldings = holdingRows.map(h => computeHoldingValues(h, rates));
  const totalValueIls = computedHoldings.reduce((sum, h) => sum + h.currentValueIls, 0);

  // Compute total ILS deposited for brokerage assets (for account-level P&L)
  let totalInvestedIls: number | null = null;
  const category = getAssetCategory(assetRow.type);
  if (category === 'brokerage') {
    const deposits = db.select().from(assetMovements)
      .where(and(
        eq(assetMovements.assetId, assetRow.id),
        eq(assetMovements.type, 'deposit'),
      )).all();
    const withdrawals = db.select().from(assetMovements)
      .where(and(
        eq(assetMovements.assetId, assetRow.id),
        eq(assetMovements.type, 'withdrawal'),
      )).all();

    const depositIls = deposits.reduce((sum, m) => sum + (m.sourceAmount ?? 0), 0);
    const withdrawIls = withdrawals.reduce((sum, m) => sum + Math.abs(m.sourceAmount ?? 0), 0);
    totalInvestedIls = deposits.length > 0 ? depositIls - withdrawIls : null;
  } else if (category === 'simple_value' || category === 'real_estate') {
    // costBasis on the balance holding IS the total invested/purchase price (already ILS)
    const balanceHolding = computedHoldings.find(h => h.type === 'balance');
    totalInvestedIls = balanceHolding?.costBasis ?? null;
  } else if (category === 'crypto') {
    // Sum of all coin costBases (already ILS)
    totalInvestedIls = computedHoldings.reduce((sum, h) => sum + h.costBasis, 0);
  }

  // ... rest of existing code (linkedAccountName lookup, return object)
  // Add to the return object:
  // totalInvestedIls,
  // totalReturnIls: totalInvestedIls != null ? totalValueIls - totalInvestedIls : null,
}
```

**Step 3: Add totalRentEarned for real estate**

For real estate, also compute total rent:

```typescript
let totalRentEarned: number | null = null;
if (category === 'real_estate') {
  const rentMovements = db.select().from(assetMovements)
    .where(and(
      eq(assetMovements.assetId, assetRow.id),
      eq(assetMovements.type, 'rent_income'),
    )).all();
  totalRentEarned = rentMovements.reduce((sum, m) => sum + m.quantity, 0);
}

// Return object includes: totalRentEarned
// Real estate P&L = (currentValue + totalRentEarned) - purchasePrice
```

**Step 4: Update Asset type in client.ts**

In `dashboard/src/api/client.ts`, add to the `Asset` interface:

```typescript
totalInvestedIls: number | null;
totalReturnIls: number | null;
totalRentEarned: number | null;
```

**Step 5: Commit**

```bash
git add src/api/assets.routes.ts dashboard/src/api/client.ts
git commit -m "feat: add account-level ILS P&L and rent tracking to asset response"
```

---

## Task 6: Add frontend API functions for new endpoints

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add API client functions**

Add after the existing asset API functions:

```typescript
export async function updateAssetValue(
  assetId: number,
  data: { currentValue: number; contribution?: number; date?: string; notes?: string },
): Promise<Asset> {
  return apiFetch(`/api/assets/${assetId}/value`, { method: 'PUT', body: data });
}

export async function recordRentIncome(
  assetId: number,
  data: { amount: number; date?: string; notes?: string },
): Promise<{ success: boolean }> {
  return apiFetch(`/api/assets/${assetId}/rent`, { method: 'POST', body: data });
}
```

**Step 2: Export getAssetCategory in a shared frontend helper**

Create `dashboard/src/lib/asset-categories.ts`:

```typescript
export type AssetCategory = 'simple_value' | 'real_estate' | 'crypto' | 'brokerage';

const ASSET_CATEGORY_MAP: Record<string, AssetCategory> = {
  pension: 'simple_value',
  keren_hishtalmut: 'simple_value',
  fund: 'simple_value',
  real_estate: 'real_estate',
  crypto: 'crypto',
  brokerage: 'brokerage',
};

export function getAssetCategory(assetType: string): AssetCategory {
  return ASSET_CATEGORY_MAP[assetType] ?? 'simple_value';
}

// Movement types the UI should show per category
export const CATEGORY_MOVEMENT_TYPES: Record<AssetCategory, string[]> = {
  simple_value: ['contribution'],
  real_estate: ['rent_income'],
  crypto: ['buy', 'sell'],
  brokerage: ['deposit', 'withdrawal', 'buy', 'sell', 'dividend'],
};
```

**Step 3: Commit**

```bash
git add dashboard/src/api/client.ts dashboard/src/lib/asset-categories.ts
git commit -m "feat: add frontend API functions and asset category helper"
```

---

## Task 7: Refactor AssetDetailPage — split into category-specific views

This is the largest task. The current `AssetDetailPage.vue` (995 lines) handles everything. We'll split it into a thin router component that delegates to category-specific components.

**Files:**
- Modify: `dashboard/src/components/AssetDetailPage.vue` (slim down to router)
- Create: `dashboard/src/components/assets/SimpleValueDetail.vue`
- Create: `dashboard/src/components/assets/RealEstateDetail.vue`
- Create: `dashboard/src/components/assets/CryptoDetail.vue`
- Create: `dashboard/src/components/assets/BrokerageDetail.vue`

**Step 1: Create the SimpleValueDetail component**

`dashboard/src/components/assets/SimpleValueDetail.vue` — shows:
- Current value card
- Total contributed card
- P&L card (value - contributed)
- "Update Value" button -> dialog with: new value field, optional contribution field
- Contribution history (list of contribution movements)
- Simple value-over-time chart from snapshots

Key details:
- Calls `updateAssetValue()` instead of the complex movement system
- Shows movements filtered to `contribution` type only
- No holdings table (the single balance holding is hidden)
- Chart uses `snapshots.map(s => s.totalValueIls)` — no currency toggle needed (always ILS)

Approximate structure (~200 lines):
```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getAsset, getMovements, getAssetSnapshots, updateAssetValue, type Asset, type Movement } from '@/api/client';
// ... UI imports

const props = defineProps<{ assetId: number }>();

const asset = ref<Asset | null>(null);
const movements = ref<Movement[]>([]);
const snapshots = ref([]);

// Fetch data
onMounted(async () => { /* fetch asset, movements, snapshots */ });

// Update value dialog
const showUpdateDialog = ref(false);
const updateForm = ref({ currentValue: 0, contribution: 0 });

async function handleUpdate() {
  await updateAssetValue(props.assetId, {
    currentValue: updateForm.value.currentValue,
    contribution: updateForm.value.contribution > 0 ? updateForm.value.contribution : undefined,
  });
  // refresh
}

const totalContributed = computed(() => asset.value?.totalInvestedIls ?? 0);
const currentValue = computed(() => asset.value?.holdings?.[0]?.currentValueIls ?? 0);
const pnl = computed(() => currentValue.value - totalContributed.value);
</script>

<template>
  <!-- Value card, Contributed card, P&L card -->
  <!-- Update Value button + dialog -->
  <!-- Contribution history list -->
  <!-- Simple chart -->
</template>
```

**Step 2: Create the RealEstateDetail component**

`dashboard/src/components/assets/RealEstateDetail.vue` — similar to SimpleValue but adds:
- Purchase price display (from costBasis)
- "Record Rent" button -> dialog with amount + date
- Rent income history list
- P&L = (value + total rent) - purchase price
- Calls `recordRentIncome()` for rent entries

Approximate structure (~250 lines).

**Step 3: Create the CryptoDetail component**

`dashboard/src/components/assets/CryptoDetail.vue` — shows:
- Coin holdings table: name, quantity, current price (ILS), value (ILS), costBasis (ILS), P&L
- "Add Coin" button (creates a holding with type `crypto`)
- Per-coin "Buy" / "Sell" actions
- Quick update prices
- Simple chart from snapshots

Key differences from brokerage:
- costBasis is always ILS — no currency confusion
- P&L per coin = `currentValueIls - costBasis`
- Movement types limited to `buy`, `sell`
- No cash balance concept

Approximate structure (~300 lines).

**Step 4: Create the BrokerageDetail component**

`dashboard/src/components/assets/BrokerageDetail.vue` — this is essentially the current `AssetDetailPage.vue` but:
- Per-stock P&L only shown in native currency (remove the ILS formatting for `gainLoss`)
- Account-level P&L from `asset.totalReturnIls` (new field)
- Currency toggle only affects the value display, not the P&L column
- Movement types limited to `deposit`, `withdrawal`, `buy`, `sell`, `dividend`

This component can start as a copy of the current `AssetDetailPage.vue` with the simplifications applied.

Approximate structure (~500 lines — still the most complex, but cleaner).

**Step 5: Refactor AssetDetailPage.vue to a thin router**

Replace the 995-line file with a ~50-line component:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAsset, type Asset } from '@/api/client';
import { getAssetCategory } from '@/lib/asset-categories';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-vue-next';
import SimpleValueDetail from './assets/SimpleValueDetail.vue';
import RealEstateDetail from './assets/RealEstateDetail.vue';
import CryptoDetail from './assets/CryptoDetail.vue';
import BrokerageDetail from './assets/BrokerageDetail.vue';

const route = useRoute();
const router = useRouter();
const assetId = computed(() => Number(route.params.id));

const asset = ref<Asset | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    asset.value = await getAsset(assetId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
});

const category = computed(() => asset.value ? getAssetCategory(asset.value.type) : null);
</script>

<template>
  <div class="animate-fade-in-up space-y-6">
    <button class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors" @click="router.push('/net-worth')">
      <ArrowLeft class="h-4 w-4" /> Back to Net Worth
    </button>

    <Skeleton v-if="loading" class="h-8 w-64" />
    <p v-else-if="error" class="text-destructive text-sm">{{ error }}</p>

    <template v-else-if="asset">
      <SimpleValueDetail v-if="category === 'simple_value'" :asset-id="assetId" />
      <RealEstateDetail v-else-if="category === 'real_estate'" :asset-id="assetId" />
      <CryptoDetail v-else-if="category === 'crypto'" :asset-id="assetId" />
      <BrokerageDetail v-else :asset-id="assetId" />
    </template>
  </div>
</template>
```

**Step 6: Commit**

```bash
git add dashboard/src/components/AssetDetailPage.vue dashboard/src/components/assets/
git commit -m "feat: split AssetDetailPage into category-specific components"
```

---

## Task 8: Update NetWorthPage asset creation dialog

**Files:**
- Modify: `dashboard/src/components/NetWorthPage.vue:338-395` (asset dialog)
- Modify: `dashboard/src/components/NetWorthPage.vue:956-976` (asset dialog template)

**Step 1: Make initial fields type-aware**

When creating a non-brokerage asset, hide irrelevant fields:
- Pension/KH/Fund: show name, type, institution. Hide currency selector (always ILS), hide liquidity, hide linkedAccount
- Real estate: show name, type, purchase price (new field). Hide currency, liquidity, linkedAccount
- Crypto: show name, type. Hide currency (per-coin), liquidity, linkedAccount
- Brokerage: show all current fields

Add a computed property:

```typescript
const assetCategory = computed(() => getAssetCategory(assetForm.value.type));
```

Use `v-if` directives on form fields:
```html
<!-- Currency: only brokerage -->
<div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
  <label class="text-sm font-medium">Currency</label>
  <Input v-model="assetForm.currency" />
</div>

<!-- Liquidity: only brokerage -->
<div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
  <!-- ... liquidity select ... -->
</div>

<!-- Linked account: only brokerage -->
<div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
  <!-- ... linked account select ... -->
</div>
```

**Step 2: Hide "Add Holding" button for simple types in the asset row**

In the expanded asset row (around line 805), only show "Add Holding" for crypto and brokerage:

```html
<Button v-if="assetCategory === 'crypto' || assetCategory === 'brokerage'" ...>
  Add Holding
</Button>
```

For simple_value and real_estate, show the auto-created balance holding's value directly instead.

**Step 3: Commit**

```bash
git add dashboard/src/components/NetWorthPage.vue
git commit -m "feat: make asset creation dialog type-aware, hide irrelevant fields"
```

---

## Task 9: Fix brokerage P&L display in BrokerageDetail

**Files:**
- Modify: `dashboard/src/components/assets/BrokerageDetail.vue`

**Step 1: Per-stock P&L — always native currency**

In the holdings table P&L column, always format in the holding's native currency (never ILS):

```html
<!-- Replace the conditional ILS/native formatting -->
<span :class="h.gainLoss >= 0 ? 'text-success' : 'text-destructive'" class="text-sm tabular-nums font-medium">
  {{ h.gainLoss >= 0 ? '+' : '' }}{{ formatAmount(h.gainLoss, h.currency) }}
</span>
```

Same for costBasis column:
```html
<TableCell class="text-right ...">{{ formatAmount(h.costBasis, h.currency) }}</TableCell>
```

**Step 2: Account-level P&L from totalReturnIls**

In the summary cards, use the new `asset.totalReturnIls` for the Total Return card instead of computing from movements:

```html
<Card>
  <CardHeader class="pb-2">
    <CardTitle class="text-sm font-medium text-muted-foreground">Total Return (ILS)</CardTitle>
  </CardHeader>
  <CardContent>
    <template v-if="asset.totalReturnIls != null">
      <div :class="asset.totalReturnIls >= 0 ? 'text-success' : 'text-destructive'" class="text-2xl font-bold tabular-nums">
        {{ asset.totalReturnIls >= 0 ? '+' : '' }}{{ formatCurrency(asset.totalReturnIls) }}
      </div>
    </template>
    <div v-else class="text-sm text-muted-foreground">No deposits recorded</div>
  </CardContent>
</Card>
```

**Step 3: Remove the complex `totalInvested` and `totalReturn` computed properties**

The old computed properties (lines 136-177 in current AssetDetailPage) that compute from movements with currency conversion logic can be removed. The backend now provides `totalInvestedIls` and `totalReturnIls` directly.

**Step 4: Commit**

```bash
git add dashboard/src/components/assets/BrokerageDetail.vue
git commit -m "fix: brokerage P&L — per-stock in native currency, account-level in ILS from backend"
```

---

## Task 10: End-to-end verification

**Step 1: Test each asset type creation**

```bash
npm run dev
```

1. Create a **Pension** asset -> verify auto-created balance holding, "Update Value" UI
2. Create a **Real Estate** asset -> verify "Update Value" + "Record Rent" UI
3. Create a **Crypto** wallet -> verify "Add Coin" flow with buy/sell
4. Create a **Brokerage** -> verify full holdings/movements UI, P&L in native currency per stock

**Step 2: Test P&L calculations**

1. Brokerage: add a deposit ($2700, paid 10K ILS), buy 10 shares of GOOG at $152.1, verify:
   - Per-stock P&L shows in USD
   - Account-level shows ILS P&L
2. Pension: set value to 500K, add 2K contribution, verify P&L = 498K
3. Real estate: set value 1.5M, purchase price 1.2M, record 50K rent, verify P&L = (1.5M + 50K) - 1.2M = 350K

**Step 3: Test net worth page**

Verify all asset types appear correctly in the net worth breakdown, doughnut chart, and history.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```

---

## Execution Order Summary

| Task | Description | Dependencies |
|---|---|---|
| 1 | Add category helper + movement types | None |
| 2 | Auto-create balance holding | Task 1 |
| 3 | Add value-update + rent endpoints | Tasks 1, 2 |
| 4 | Gate movement types by category | Task 1 |
| 5 | Fix brokerage P&L in backend | Task 1 |
| 6 | Frontend API functions + category helper | Tasks 3, 5 |
| 7 | Split AssetDetailPage into 4 components | Task 6 |
| 8 | Update NetWorthPage creation dialog | Task 6 |
| 9 | Fix brokerage P&L display | Task 7 |
| 10 | End-to-end verification | All |
