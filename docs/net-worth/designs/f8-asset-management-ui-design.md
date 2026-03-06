# F8: Asset Management UI - Frontend Design

## Design Direction

**Concept: "Inline Management"** - All CRUD operations happen via dialogs overlaying the Net Worth page (F7). No separate management page. This keeps the user in context - they see their net worth update immediately after making changes.

**Tone:** Functional, form-focused, fast. Dialogs should be clean and efficient - no wasted space. The user is entering financial data; accuracy matters more than flair.

**Pattern source:** Follows the `AccountManager.vue` dialog patterns exactly (same Dialog, AlertDialog, form field patterns).

---

## Dialog Catalog

### 1. Asset Dialog (Create / Edit)

Used for both creating and editing assets. Title changes based on mode.

```
+-------------------------------------------+
|  Add Asset                           [x]  |
|                                           |
|  Name                                     |
|  [OneZero Portfolio___________________]   |
|                                           |
|  Type                                     |
|  [v brokerage                         ]   |
|                                           |
|  Institution                              |
|  [oneZero_____________________________]   |
|                                           |
|  Liquidity                                |
|  [v liquid                            ]   |
|                                           |
|  Linked Bank Account                      |
|  [v None (no linked account)          ]   |
|                                           |
|  Notes                                    |
|  [__________________________________ ]    |
|  [__________________________________ ]    |
|                                           |
|                    [Cancel]  [Save Asset]  |
+-------------------------------------------+
```

**Specifications:**

- Container: `DialogContent class="sm:max-w-md"`
- Title: `DialogTitle` — "Add Asset" or "Edit Asset"
- Field layout: `space-y-4 py-2`

**Form fields:**

| Field | Component | Validation | Details |
|---|---|---|---|
| Name | `Input` | Required, 1-100 chars | `placeholder="e.g. OneZero Portfolio"` |
| Type | `Select` | Required | Options: `ASSET_TYPES` array. Display labels: `Brokerage`, `Pension`, `Keren Hishtalmut`, `Crypto`, `Fund`, `Real Estate` |
| Institution | `Input` | Optional, max 100 | `placeholder="e.g. oneZero, excelence"` |
| Liquidity | `Select` | Required, default `liquid` | Options: `liquid`, `restricted`, `locked`. Default pre-selected to `liquid` |
| Linked Account | `Select` | Optional | Fetches bank accounts via `getAccounts()`. Shows `"none"` as default (sentinel value, NOT empty string). Only bank accounts shown. Label format: `"Poalim (₪25,472)"` |
| Notes | `Textarea` | Optional, max 500 | 2-row textarea, `placeholder="Optional notes..."` |

**Select sentinel values** (per MEMORY.md reka-ui gotcha):
- Type: no default, use `placeholder="Select type..."`. Items use actual values (`"brokerage"`, `"pension"`, etc.)
- Liquidity: default `"liquid"`. Items use actual values.
- Linked Account: default `"none"`. Map back to `null` before sending to API.

**Footer:**
```vue
<DialogFooter>
  <DialogClose as-child>
    <Button variant="outline">Cancel</Button>
  </DialogClose>
  <Button :disabled="!isValid" @click="handleSave">
    {{ isEditing ? 'Save Changes' : 'Add Asset' }}
  </Button>
</DialogFooter>
```

**Edit mode:** Pre-fill all fields from the existing asset. The `name` field shows the current name. Linked account select shows the current linked account if any.

---

### 2. Holding Dialog (Create / Edit)

Shown when adding or editing a holding within an asset.

```
+-------------------------------------------+
|  Add Holding to OneZero Portfolio    [x]  |
|                                           |
|  Name                                     |
|  [TSLA________________________________]   |
|                                           |
|  Type                                     |
|  [v stock                             ]   |
|                                           |
|  Currency                                 |
|  [USD_________________________________]   |
|                                           |
|  Quantity                                 |
|  [15__________________________________]   |
|                                           |
|  Cost Basis                               |
|  [2800________________________________]   |
|                                           |
|  Last Price (per unit)                    |
|  [350_________________________________]   |
|                                           |
|  Notes                                    |
|  [__________________________________ ]    |
|                                           |
|                   [Cancel]  [Add Holding]  |
+-------------------------------------------+
```

**Specifications:**

- Container: `DialogContent class="sm:max-w-md"`
- Title: `DialogTitle` — "Add Holding to {assetName}" or "Edit Holding"

**Form fields:**

| Field | Component | Validation | Details |
|---|---|---|---|
| Name | `Input` | Required, 1-100 chars | `placeholder="e.g. TSLA, kaspit shkalit"` |
| Type | `Select` | Required | Options from `HOLDING_TYPES`: `stock`, `etf`, `cash`, `fund_units`, `crypto`, `balance` |
| Currency | `Input` | Required, 1-10 chars | `placeholder="USD"`. Not a select because currencies are open-ended. Common values: `USD`, `ILS`, `BTC`, `EUR` |
| Quantity | `Input type="number"` | Required | `step="any"` for decimals (crypto, fund units) |
| Cost Basis | `Input type="number"` | Optional, default 0 | `step="any"` |
| Last Price | `Input type="number"` | Conditional | Only shown when type is `stock`, `etf`, or `crypto`. Hidden for `cash`, `fund_units`, `balance`. Label changes to "Price per Unit" |
| Notes | `Textarea` | Optional, max 500 | 2-row textarea |

**Conditional visibility:** Use `v-if="['stock', 'etf', 'crypto'].includes(holdingType)"` to show/hide the Last Price field. When hidden, don't send the field to the API.

**Double-counting guard (frontend):** If the parent asset has a `linkedAccountId` AND the user selects `currency: "ILS"` AND `type: "cash"`, show an inline warning:

```vue
<div class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
  ILS cash for this institution is already tracked via the linked bank account.
</div>
```

Disable the Save button when this condition is true. The backend also validates this, but the frontend gives immediate feedback.

---

### 3. Liability Dialog (Create / Edit)

```
+-------------------------------------------+
|  Add Liability                       [x]  |
|                                           |
|  Name                                     |
|  [Poalim Loan________________________]   |
|                                           |
|  Type                                     |
|  [v loan                              ]   |
|                                           |
|  Currency                                 |
|  [ILS_________________________________]   |
|                                           |
|  Original Amount                          |
|  [40000_______________________________]   |
|                                           |
|  Current Balance                          |
|  [32000_______________________________]   |
|                                           |
|  Interest Rate (%)                        |
|  [5.5_________________________________]   |
|                                           |
|  Start Date                               |
|  [2025-07-04__________________________]   |
|                                           |
|  Notes                                    |
|  [1k/mo repayments___________________ ]   |
|                                           |
|                [Cancel]  [Add Liability]   |
+-------------------------------------------+
```

**Form fields:**

| Field | Component | Validation | Details |
|---|---|---|---|
| Name | `Input` | Required, 1-100 chars, unique | `placeholder="e.g. Poalim Loan"` |
| Type | `Select` | Required | Options from `LIABILITY_TYPES`: `loan`, `mortgage`, `credit_line`, `other` |
| Currency | `Input` | Optional, default `ILS` | Pre-filled with "ILS" |
| Original Amount | `Input type="number"` | Required, positive | `step="any"` |
| Current Balance | `Input type="number"` | Required, >= 0 | `step="any"` |
| Interest Rate | `Input type="number"` | Optional | `step="0.01"`, `placeholder="Annual rate"` |
| Start Date | `Input type="date"` | Optional | Native date picker, renders as `YYYY-MM-DD` |
| Notes | `Textarea` | Optional, max 500 | 2-row textarea |

---

### 4. Delete Confirmations

**Delete Asset:**
```vue
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Hide "{{ asset.name }}"?</AlertDialogTitle>
      <AlertDialogDescription>
        This will hide {{ asset.name }} from your net worth.
        Holdings and history will be preserved. You can re-activate it later.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        @click="handleDeleteAsset(asset.id)"
      >
        Hide Asset
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Note: Button says "Hide Asset" (not "Delete") because it's a soft delete. Less scary, more accurate.

**Delete Holding:**
```vue
<AlertDialogTitle>Delete "{{ holding.name }}"?</AlertDialogTitle>
<AlertDialogDescription>
  This will permanently remove this holding from {{ asset.name }}.
  Related movement records will be preserved.
</AlertDialogDescription>
<!-- Action button says "Delete Holding" (hard delete, more serious) -->
```

**Delete Liability:**
Same pattern as Delete Asset. Button says "Hide Liability".

---

## Quick Update Flow (Inline Editing)

For the monthly portfolio update workflow — user needs to update multiple holding prices/quantities at once without opening individual dialogs.

### Entry Point

"Update Values" button on each asset row in the F7 asset list (visible on hover or always visible):

```
| [dot] OneZero Portfolio   brokerage   ₪223,477  [Update Values] [expand] |
```

Button: `Button variant="outline" size="sm"`.

### Inline Edit Mode

When activated, the expanded holdings area transforms into an editable table:

```
+-------------------------------------------------------+
| [dot] OneZero Portfolio   brokerage   ₪223,477         |
|                                                        |
|  Holdings (editing):                          [Save All]|
|                                                        |
|  Name     Qty          Price        Value    Status    |
|  TSLA     [15_____]    [$350____]   ₪19.1k   -        |
|  NFLX     [8______]    [$950____]   ₪27.7k   -        |
|  kaspit   [120000_]    -            ₪120k    -        |
|  USD Cash [12000__]    -            ₪43.8k   -        |
|                                                        |
|                               [Cancel]  [Save Changes] |
+-------------------------------------------------------+
```

**Behavior:**
- `Quantity` and `Last Price` fields become `Input type="number"` (inline, compact: `h-8 text-sm w-24`)
- Price field only shown for `stock`/`etf`/`crypto` types (same conditional as dialog)
- Value column updates reactively as user types (computed from qty * price * exchange rate)
- "Save Changes" sends `PUT /api/holdings/:id` for each changed holding **in parallel**
- Per-row status indicators:
  - Saving: `Loader2 animate-spin` (14px)
  - Success: `Check` icon in green, fades after 2s
  - Error: `X` icon in red, tooltip with error message
- Failed updates remain editable; successful updates lock back to view mode
- "Cancel" reverts all fields to original values and exits edit mode

**Implementation:**
- Track `editingAssetId` ref — only one asset can be in edit mode at a time
- Track `editedHoldings` as `Map<holdingId, { quantity, lastPrice }>` for dirty tracking
- Compute `isDirty` per holding by comparing to original values
- On save, only send requests for dirty holdings

---

## Action Button Placement

Actions on asset rows follow the `AccountManager.vue` pattern — icons appear on hover:

```vue
<div class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
  <Button variant="ghost" size="icon" class="h-7 w-7" @click="editAsset(asset)">
    <Pencil class="h-3.5 w-3.5" />
  </Button>
  <Button variant="ghost" size="icon" class="h-7 w-7" @click="confirmDeleteAsset(asset)">
    <Trash2 class="h-3.5 w-3.5 text-destructive" />
  </Button>
</div>
```

Holdings actions (inside expanded view):
- Each holding row has `Pencil` and `Trash2` icons on hover
- "Add Holding" button at the bottom of the holdings list: `Button variant="outline" size="sm"`

---

## Form Validation Display

Follow existing patterns — no third-party form library, just reactive validation.

**Inline errors:**
```vue
<div class="space-y-1.5">
  <label class="text-sm font-medium">Name</label>
  <Input v-model="name" :class="{ 'border-destructive': nameError }" />
  <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
</div>
```

**Error conditions:**
- Required field empty on blur: "This field is required"
- Name already exists (from API 409): "An asset with this name already exists"
- ILS cash double-counting: inline warning banner (not a field error)
- API error on save: `toast` or inline error message at the top of the dialog

**Validation timing:**
- Validate on blur for individual fields
- Re-validate all on submit attempt
- Clear field errors when user starts typing

---

## State Management

All dialog state lives in `NetWorthPage.vue` as refs:

```ts
// Asset dialog
const showAssetDialog = ref(false)
const editingAsset = ref<Asset | null>(null)  // null = create mode

// Holding dialog
const showHoldingDialog = ref(false)
const holdingParentAssetId = ref<number | null>(null)
const editingHolding = ref<Holding | null>(null)

// Liability dialog
const showLiabilityDialog = ref(false)
const editingLiability = ref<Liability | null>(null)

// Quick update
const editingAssetId = ref<number | null>(null)

// Delete confirmations
const deletingAsset = ref<Asset | null>(null)
const deletingHolding = ref<Holding | null>(null)
const deletingLiability = ref<Liability | null>(null)
```

After any successful create/update/delete, re-fetch `GET /api/net-worth` to refresh all values.

---

## File Structure

If dialogs remain under ~100 lines each, keep them inline in `NetWorthPage.vue`. If they grow complex, extract to:

```
dashboard/src/components/
  NetWorthPage.vue
  AssetDialog.vue         # Only if > 100 lines
  HoldingDialog.vue       # Only if > 100 lines
  LiabilityDialog.vue     # Only if > 100 lines
```

Decision: start inline, extract if needed during implementation.

---

## Select Dropdown Labels

Human-readable display labels for enum values:

**Asset Types:**
| Value | Label |
|---|---|
| `brokerage` | Brokerage |
| `pension` | Pension |
| `keren_hishtalmut` | Keren Hishtalmut |
| `crypto` | Crypto |
| `fund` | Fund |
| `real_estate` | Real Estate |

**Holding Types:**
| Value | Label |
|---|---|
| `stock` | Stock |
| `etf` | ETF |
| `cash` | Cash |
| `fund_units` | Fund Units |
| `crypto` | Crypto |
| `balance` | Balance |

**Liquidity:**
| Value | Label |
|---|---|
| `liquid` | Liquid |
| `restricted` | Restricted |
| `locked` | Locked |

**Liability Types:**
| Value | Label |
|---|---|
| `loan` | Loan |
| `mortgage` | Mortgage |
| `credit_line` | Credit Line |
| `other` | Other |

Store these in the shared `net-worth-colors.ts` (rename to `net-worth-constants.ts`) or co-locate with the component.
