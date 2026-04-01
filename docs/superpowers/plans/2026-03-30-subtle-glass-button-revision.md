# Subtle Glass Button Revision — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every interactive control in the dashboard to use a cohesive Subtle Glass design system, extending the existing Liquid Glass tokens into buttons, selects, and nav controls.

**Architecture:** The CVA button variant definitions in `ui/button/index.ts` are the single source of truth. We update them first, then migrate every consumer. Raw `<button>` elements get inline Tailwind updates. `SelectTrigger` and `AlertDialog` components get updated to match.

**Tech Stack:** Vue 3, Tailwind CSS 4, class-variance-authority, reka-ui

---

## Chunk 1: Core Button System + UI Primitives

### Task 1: Update CVA variant definitions

**Files:**

- Modify: `dashboard/src/components/ui/button/index.ts`

- [ ] **Step 1: Replace the entire CVA definition with the new Subtle Glass variants**

Replace the contents of `index.ts` with:

```ts
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary/8 text-primary border border-primary/20 backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-primary/12 active:bg-primary/16',
        filled:
          'bg-[linear-gradient(180deg,var(--primary),color-mix(in_srgb,var(--primary)_90%,black))] text-primary-foreground shadow-[0_1px_4px_rgba(0,122,255,0.2)] hover:brightness-110 active:brightness-90',
        destructive:
          'bg-destructive/8 text-destructive border border-destructive/15 backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-destructive/12 active:bg-destructive/16',
        'destructive-filled':
          'bg-destructive text-white hover:brightness-110 active:brightness-90 shadow-[var(--shadow-sm)]',
        secondary:
          'bg-[var(--glass-bg)] text-text-primary border border-[var(--glass-border)] backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:bg-[var(--glass-bg-heavy)] active:brightness-95',
        ghost: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[30px] px-3.5',
        sm: 'h-[26px] px-2.5 text-[12px]',
        lg: 'h-[34px] px-4',
        icon: 'size-[30px]',
        'icon-sm': 'size-[26px]',
        'icon-lg': 'size-[34px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/saaramrani/projects/money-monitor/dashboard && npx vue-tsc --noEmit 2>&1 | head -30`

Expected: Type errors from consumers using removed `outline` and `tinted` variants. These will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ui/button/index.ts
git commit -m "feat: update button CVA to Subtle Glass variants

Replace outline/tinted with glass-based default/filled/destructive-filled/secondary.
Tighter sizes (30px/26px). Consumers will be migrated in follow-up commits."
```

---

### Task 2: Update AlertDialog components

**Files:**

- Modify: `dashboard/src/components/ui/alert-dialog/AlertDialogAction.vue`
- Modify: `dashboard/src/components/ui/alert-dialog/AlertDialogCancel.vue`

- [ ] **Step 1: Update AlertDialogAction to use `destructive-filled`**

In `AlertDialogAction.vue`, line 15, change:

```vue
<AlertDialogAction v-bind="delegatedProps" :class="cn(buttonVariants(), props.class)">
```

to:

```vue
<AlertDialogAction v-bind="delegatedProps" :class="cn(buttonVariants({ variant: 'destructive-filled' }), props.class)">
```

- [ ] **Step 2: Update AlertDialogCancel to use `secondary`**

In `AlertDialogCancel.vue`, line 18, change:

```vue
buttonVariants({ variant: 'outline' }),
```

to:

```vue
buttonVariants({ variant: 'secondary' }),
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ui/alert-dialog/AlertDialogAction.vue dashboard/src/components/ui/alert-dialog/AlertDialogCancel.vue
git commit -m "feat: update AlertDialog components to Subtle Glass variants

AlertDialogAction → destructive-filled, AlertDialogCancel → secondary."
```

---

### Task 3: Update SelectTrigger to glass styling

**Files:**

- Modify: `dashboard/src/components/ui/select/SelectTrigger.vue`

- [ ] **Step 1: Replace the SelectTrigger class string**

In `SelectTrigger.vue`, line 20, change the class string from:

```
'flex h-8 w-full items-center justify-between rounded-lg border border-separator/70 bg-bg-primary px-2.5 py-1.5 text-[13px] data-[placeholder]:text-text-tertiary focus:outline-none focus:ring-[3px] focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate text-start transition-shadow duration-150'
```

to:

```
'flex h-[30px] w-full items-center justify-between rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] px-2.5 text-[13px] text-text-primary data-[placeholder]:text-text-tertiary focus:outline-none focus:ring-[3px] focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate text-start transition-all duration-150 hover:bg-[var(--glass-bg-heavy)]'
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/ui/select/SelectTrigger.vue
git commit -m "feat: update SelectTrigger to Subtle Glass styling

Glass bg, glass border, backdrop blur, tighter height (30px)."
```

---

### Task 4: Update PeriodSelector nav arrows

**Files:**

- Modify: `dashboard/src/components/PeriodSelector.vue`

- [ ] **Step 1: Update both nav arrow buttons to glass pills**

In `PeriodSelector.vue`, replace both instances (lines 83 and 92) of:

```
class="p-0.5 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
```

with:

```
class="p-0.5 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-[10px] text-text-secondary hover:bg-[var(--glass-bg-heavy)] hover:text-text-primary transition-all duration-150"
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/PeriodSelector.vue
git commit -m "feat: update PeriodSelector nav arrows to glass pills"
```

---

## Chunk 2: Migrate All Page Components — `outline` → `secondary`

Every `variant="outline"` on a `<Button>` becomes `variant="secondary"`. This is a mechanical find-and-replace scoped to `<Button` elements only (not `<Badge`).

### Task 5: Migrate BudgetsPage

**Files:**

- Modify: `dashboard/src/components/BudgetsPage.vue`

- [ ] **Step 1: Update variant usages**

Line 280: Change `variant="outline"` to `variant="secondary"`.
Line 566: Change `variant="outline"` to `variant="secondary"` (Cancel button).

- [ ] **Step 2: Update dialog confirm button to `filled`**

Lines 567-572: The `<Button>` with no variant inside `DialogFooter` (the "Save Changes" / "Create Budget" button). Add `variant="filled"`:

```vue
<Button
  variant="filled"
  :disabled="saving || !formName || !Number(formAmount) || formCategoryNames.length === 0"
  @click="saveBudget"
>
```

- [ ] **Step 3: Update icon action buttons to glass ghost hover**

Lines 385-391 (edit button): Change class from:

```
class="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors duration-150"
```

to:

```
class="p-1 rounded-md text-text-tertiary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-text-primary transition-all duration-150"
```

Lines 392-398 (delete button): Change class from:

```
class="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-destructive transition-colors duration-150"
```

to:

```
class="p-1 rounded-md text-text-tertiary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-destructive transition-all duration-150"
```

- [ ] **Step 4: Update category selection buttons to glass selected state**

Lines 534-554: Change the `:class` binding from:

```
formCategoryNames.includes(cat.name)
  ? 'bg-fill-primary'
  : 'hover:bg-fill-secondary'
```

to:

```
formCategoryNames.includes(cat.name)
  ? 'bg-[var(--glass-bg-heavy)] border border-[var(--glass-border)]'
  : 'hover:bg-[var(--glass-bg)] border border-transparent'
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/BudgetsPage.vue
git commit -m "feat: migrate BudgetsPage buttons to Subtle Glass"
```

---

### Task 6: Migrate AccountManager

**Files:**

- Modify: `dashboard/src/components/AccountManager.vue`

- [ ] **Step 1: Replace all `variant="outline"` with `variant="secondary"`**

Lines 350, 364, 483, 494, 530, 561: Change every `variant="outline"` to `variant="secondary"`.

- [ ] **Step 2: Update dialog confirm buttons to `filled`**

Lines 496-498, 531-534, 562-565: Add `variant="filled"` to each `<Button>` that has no variant inside a `DialogFooter`.

- [ ] **Step 3: Update inline destructive AlertDialogAction**

Lines 392-395: Remove `class="bg-destructive text-destructive-foreground hover:bg-destructive/90"` — the `AlertDialogAction` component now defaults to `destructive-filled` variant which provides this styling.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: migrate AccountManager buttons to Subtle Glass"
```

---

### Task 7: Migrate TransactionTable

**Files:**

- Modify: `dashboard/src/components/TransactionTable.vue`

- [ ] **Step 1: Replace all `variant="outline"` with `variant="secondary"`**

Lines 253, 456, 464: Change `variant="outline"` to `variant="secondary"`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/TransactionTable.vue
git commit -m "feat: migrate TransactionTable buttons to Subtle Glass"
```

---

### Task 8: Migrate NetWorthPage

**Files:**

- Modify: `dashboard/src/components/NetWorthPage.vue`

- [ ] **Step 1: Replace all `variant="outline"` with `variant="secondary"`**

Lines 688, 912, 994, 1077, 1085, 1328, 1397, 1466: Change every `variant="outline"` to `variant="secondary"`.

- [ ] **Step 2: Update dialog confirm buttons to `filled`**

Lines 1330-1333, 1399-1405, 1468-1471: Add `variant="filled"` to each `<Button>` with no variant inside `DialogFooter`.

- [ ] **Step 3: Replace inline destructive classes with `variant="destructive-filled"`**

Lines 1496-1501, 1525-1530, 1553-1558: Replace `class="bg-destructive text-destructive-foreground hover:bg-destructive/90"` with `variant="destructive-filled"` and remove the class attribute.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/NetWorthPage.vue
git commit -m "feat: migrate NetWorthPage buttons to Subtle Glass"
```

---

### Task 9: Migrate SettingsPage

**Files:**

- Modify: `dashboard/src/components/SettingsPage.vue`

- [ ] **Step 1: Replace `variant="outline"` with `variant="secondary"`**

Line 303: Change `variant="outline"` to `variant="secondary"`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/SettingsPage.vue
git commit -m "feat: migrate SettingsPage buttons to Subtle Glass"
```

---

### Task 10: Migrate remaining pages with `outline` → `secondary`

**Files:**

- Modify: `dashboard/src/components/ChatSidebar.vue` (line 65)
- Modify: `dashboard/src/components/CategoryManager.vue` (line 196)
- Modify: `dashboard/src/components/AlertsPage.vue` (lines 118, 122)
- Modify: `dashboard/src/components/AssetDetailPage.vue` (line 52)
- Modify: `dashboard/src/components/InsightsPage.vue` (lines 246, 249)
- Modify: `dashboard/src/components/ScrapingDashboard.vue` (dialog confirm buttons only)
- Modify: `dashboard/src/components/SetupWizard.vue` (line 188)
- Modify: `dashboard/src/components/AiChat.vue` (line 178)

- [ ] **Step 1: Replace `variant="outline"` with `variant="secondary"` in all files that have it**

ChatSidebar.vue line 65, CategoryManager.vue line 196, AlertsPage.vue lines 118 and 122, AssetDetailPage.vue line 52, InsightsPage.vue lines 246 and 249, SetupWizard.vue line 188, AiChat.vue line 178.

- [ ] **Step 2: Update ScrapingDashboard dialog confirm buttons to `filled`**

ScrapingDashboard.vue lines 514, 535: Add `variant="filled"` to each `<Button>` with no variant inside `DialogFooter`. (ScrapingDashboard has no `variant="outline"` on `<Button>` elements — only on `<Badge>`, which is out of scope.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ChatSidebar.vue dashboard/src/components/CategoryManager.vue dashboard/src/components/AlertsPage.vue dashboard/src/components/AssetDetailPage.vue dashboard/src/components/InsightsPage.vue dashboard/src/components/ScrapingDashboard.vue dashboard/src/components/SetupWizard.vue dashboard/src/components/AiChat.vue
git commit -m "feat: migrate remaining page buttons to Subtle Glass"
```

---

### Task 11: Migrate asset detail pages

**Files:**

- Modify: `dashboard/src/components/assets/SimpleValueDetail.vue`
- Modify: `dashboard/src/components/assets/RealEstateDetail.vue`
- Modify: `dashboard/src/components/assets/CryptoDetail.vue`
- Modify: `dashboard/src/components/assets/BrokerageDetail.vue`

- [ ] **Step 1: Replace all `variant="outline"` with `variant="secondary"` in all four files**

SimpleValueDetail.vue: lines 113, 238.
RealEstateDetail.vue: lines 140, 213, 282, 314.
CryptoDetail.vue: lines 276, 338, 345, 566, 646.
BrokerageDetail.vue: lines 417, 431, 485, 492, 713, 765, 867.

- [ ] **Step 2: Update dialog confirm buttons to `filled`**

SimpleValueDetail.vue: line 240-243.
RealEstateDetail.vue: lines 284-287, 316-319.
CryptoDetail.vue: lines 568-571, 648-651.
BrokerageDetail.vue: lines 767-770, 869-872.

- [ ] **Step 3: Replace inline destructive classes with `variant="destructive-filled"`**

CryptoDetail.vue: lines 588-594, 667-674 — replace `class="bg-destructive text-destructive-foreground hover:bg-destructive/90"` with `variant="destructive-filled"`.
BrokerageDetail.vue: lines 787-794, 889-896 — same replacement.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/assets/SimpleValueDetail.vue dashboard/src/components/assets/RealEstateDetail.vue dashboard/src/components/assets/CryptoDetail.vue dashboard/src/components/assets/BrokerageDetail.vue
git commit -m "feat: migrate asset detail page buttons to Subtle Glass"
```

---

## Chunk 3: Raw Button Elements + Verification

### Task 12: Update CashflowSankey raw buttons

**Files:**

- Modify: `dashboard/src/components/CashflowSankey.vue`

- [ ] **Step 1: Update the expand icon button (line 376)**

Change:

```
class="p-1 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary transition-colors"
```

to:

```
class="p-1 rounded-md text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-text-primary transition-all duration-150"
```

- [ ] **Step 2: Update the retry link button (line 405)**

Change:

```
class="text-[12px] text-text-secondary underline"
```

to:

```
class="text-[12px] text-primary underline underline-offset-4 hover:no-underline transition-all duration-150"
```

- [ ] **Step 3: Update the reset zoom button (line 460)**

Change:

```
class="absolute top-2 right-2 z-10 px-2 py-1 text-[11px] rounded bg-bg-secondary text-text-secondary hover:text-text-primary border border-separator"
```

to:

```
class="absolute top-2 right-2 z-10 px-2 py-1 text-[11px] rounded-md bg-[var(--glass-bg)] text-text-secondary hover:bg-[var(--glass-bg-heavy)] hover:text-text-primary border border-[var(--glass-border)] backdrop-blur-[10px] transition-all duration-150"
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/CashflowSankey.vue
git commit -m "feat: migrate CashflowSankey raw buttons to Subtle Glass"
```

---

### Task 13: Update AppLayout Exit Demo button

**Files:**

- Modify: `dashboard/src/components/AppLayout.vue`

- [ ] **Step 1: Update the Exit Demo link button (line 201)**

Change:

```
class="underline hover:no-underline font-medium ml-1 text-primary"
```

to:

```
class="underline underline-offset-4 hover:no-underline font-medium ml-1 text-primary transition-all duration-150"
```

This is a text link, so only minor refinement — add underline-offset and transition for consistency with the `link` variant.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/AppLayout.vue
git commit -m "feat: update AppLayout Exit Demo link to match Subtle Glass"
```

---

### Task 14: Full verification

- [ ] **Step 1: Run TypeScript type-check**

Run: `cd /Users/saaramrani/projects/money-monitor/dashboard && npx vue-tsc --noEmit`

Expected: No errors. If there are type errors from the new variant names, fix them.

- [ ] **Step 2: Run ESLint**

Run: `cd /Users/saaramrani/projects/money-monitor && npx eslint dashboard/src/`

Expected: No new errors. (Project uses ESLint 9+ flat config — no `--ext` flag needed.)

- [ ] **Step 3: Run the dev server and visually spot-check**

Run: `cd /Users/saaramrani/projects/money-monitor/dashboard && npm run dev`

Check these pages in the browser:

- Budgets page — toggle group still looks the same, "New Budget" button is glass-tinted, dialog Cancel/Save use secondary/filled
- Net Worth page — asset/holding/liability dialogs have glass buttons
- Transaction table — filter button is glass secondary
- Period selector — nav arrows are glass pills, select trigger is glass
- Cashflow Sankey — expand icon, retry link, and reset zoom button all updated
- Settings page — OAuth button is glass secondary
- Any AlertDialog (delete an account) — Cancel is glass secondary, Delete is solid destructive-filled

- [ ] **Step 4: Check dark mode**

Toggle system dark mode and verify all glass treatments adapt properly (glass tokens have dark mode overrides in style.css).

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add dashboard/src/
git commit -m "fix: address any issues found during Subtle Glass visual verification"
```
