# Subtle Glass Button Revision

**Date:** 2026-03-30
**Status:** Draft
**Scope:** All interactive controls across the dashboard

## Problem

The toggle group on the Budgets page feels refined and Apple-native. The rest of the buttons — the shared `<Button>` component, `<SelectTrigger>`, nav arrows, and icon buttons — feel heavy and inconsistent by comparison. The goal is to bring every interactive control in line with the toggle group's subtle, cohesive quality.

## Approach: Subtle Glass

Extend the existing Liquid Glass design tokens (`--glass-bg`, `--glass-border`, `--glass-shadow`) into a unified button system. Every variant uses soft tinted fills, subtle borders, and modest `backdrop-filter: blur(10px)` to create depth without weight. Dark mode adapts automatically through the existing CSS custom properties.

## Button Component Variants (CVA)

### Revised variant map

| Variant              | Purpose                                   | Treatment                                                                     |
| -------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `default`            | Primary actions (New Budget, Edit)        | `bg-primary/8` + `border border-primary/20` + `backdrop-blur` + subtle shadow |
| `filled`             | High-emphasis CTAs (Save Changes, Create) | Solid `bg-primary` with gradient + colored shadow                             |
| `destructive`        | Destructive actions (default)             | `bg-destructive/8` + `border border-destructive/15` + blur                    |
| `destructive-filled` | Confirm-delete in AlertDialogs            | Solid `bg-destructive` fill                                                   |
| `secondary`          | Cancel, neutral actions                   | `bg-glass-bg` + `border border-glass-border` + blur + subtle shadow           |
| `ghost`              | Low-emphasis, icon hover states           | Transparent, hover → `bg-black/[0.04]` (unchanged)                            |
| `link`               | Inline text links                         | `text-primary` + underline (unchanged)                                        |

### Removed variants

- **`outline`** — replaced by `secondary` with glass treatment
- **`tinted`** — merged into `default` (same concept now)

### Sizes (slightly tighter)

| Size      | Value                         |
| --------- | ----------------------------- |
| `default` | `h-[30px] px-3.5`             |
| `sm`      | `h-[26px] px-2.5 text-[12px]` |
| `lg`      | `h-[34px] px-4` (unchanged)   |
| `icon`    | `size-[30px]`                 |
| `icon-sm` | `size-[26px]`                 |
| `icon-lg` | `size-[34px]` (unchanged)     |

## Other Interactive Controls

### SelectTrigger

Matches `secondary` button styling: `bg-glass-bg` + `border border-glass-border` + `backdrop-blur` + subtle shadow. Replaces the current `border-separator/70 bg-bg-primary`.

### Nav arrows (PeriodSelector chevrons)

Small glass pills: `bg-glass-bg` + `border border-glass-border` + blur, `rounded-md`. Replaces bare `<button>` with `hover:bg-bg-secondary`.

### Icon action buttons (edit/delete in rows)

Keep transparent by default. Hover gets subtle glass bg — same behavior as `ghost` variant. No change to the interaction model.

### Color swatches (BudgetsPage)

No change — these are colored circles, not buttons in the UI sense.

### Category selection buttons (BudgetsPage dialog)

Light glass treatment on selected state. Keep the current interaction model.

## Migration: Variant Rename Map

Consumers of removed variants need updating:

| Old usage                                                           | New usage                      |
| ------------------------------------------------------------------- | ------------------------------ |
| `variant="outline"`                                                 | `variant="secondary"`          |
| `variant="tinted"`                                                  | `variant="default"`            |
| `variant="destructive"` (in AlertDialogAction)                      | `variant="destructive-filled"` |
| `variant="default"` (on dialog confirm buttons like "Save Changes") | `variant="filled"`             |

**Note on `default` → `filled` migration:** This applies to all `<Button>` instances (explicit `variant="default"` or no variant prop) that serve as the primary confirm action inside `<DialogFooter>` or `<AlertDialogFooter>`. The new `default` variant is tinted-glass, which is too subtle for "Save Changes" / "Create" confirms — those need the solid `filled` treatment.

**Note on inline destructive classes:** Some files use `<Button class="bg-destructive text-destructive-foreground hover:bg-destructive/90">` instead of `variant="destructive"` (e.g. in `AccountManager.vue`, `NetWorthPage.vue`, `CryptoDetail.vue`, `BrokerageDetail.vue`). These should migrate to `variant="destructive-filled"` and drop the inline classes.

**Scope:** This migration applies only to `<Button>` components. `<Badge variant="outline">` uses a separate CVA and is not affected.

## Dark Mode

The glass tokens (`--glass-bg`, `--glass-border`, `--glass-shadow`) already have dark mode overrides in `style.css`. The `primary/8` and `destructive/8` opacity values work in both modes via Tailwind's color opacity syntax. No additional dark mode work needed.

## Performance

- `backdrop-filter: blur(10px)` applied only to `default`, `destructive`, `secondary`, and `SelectTrigger`
- **Not** applied to `filled` or `destructive-filled` — these have opaque solid backgrounds where blur has no visual effect
- Not applied to `ghost`, `link`, or icon buttons
- Nav arrows use blur but are tiny — negligible cost
- If perf issues arise, blur can be reduced to `blur(6px)` or removed without breaking the visual hierarchy — tinted fills + borders carry the design independently

## Files to Modify

### Core (variant definitions)

1. `dashboard/src/components/ui/button/index.ts` — CVA variant definitions + sizes
2. `dashboard/src/components/ui/select/SelectTrigger.vue` — glass styling
3. `dashboard/src/components/ui/alert-dialog/AlertDialogAction.vue` — use `destructive-filled`
4. `dashboard/src/components/ui/alert-dialog/AlertDialogCancel.vue` — use `secondary`

### Pages using `<Button>` component (variant prop updates)

5. `dashboard/src/components/BudgetsPage.vue` — variant usages, icon buttons, category buttons
6. `dashboard/src/components/AccountManager.vue` — AlertDialog actions
7. `dashboard/src/components/TransactionTable.vue` — variant usages
8. `dashboard/src/components/NetWorthPage.vue` — variant usages
9. `dashboard/src/components/SettingsPage.vue` — variant usages
10. `dashboard/src/components/ChatSidebar.vue` — `outline` → `secondary`
11. `dashboard/src/components/CategoryManager.vue` — `outline` → `secondary`
12. `dashboard/src/components/AlertsPage.vue` — `outline` → `secondary`
13. `dashboard/src/components/AssetDetailPage.vue` — `outline` → `secondary`
14. `dashboard/src/components/InsightsPage.vue` — `outline` → `secondary`
15. `dashboard/src/components/ScrapingDashboard.vue` — `outline` → `secondary`
16. `dashboard/src/components/SetupWizard.vue` — `outline` → `secondary`
17. `dashboard/src/components/AiChat.vue` — `outline` → `secondary`
18. `dashboard/src/components/assets/SimpleValueDetail.vue` — `outline` → `secondary`
19. `dashboard/src/components/assets/RealEstateDetail.vue` — `outline` → `secondary`
20. `dashboard/src/components/assets/CryptoDetail.vue` — `outline` → `secondary`
21. `dashboard/src/components/assets/BrokerageDetail.vue` — `outline` → `secondary`

### Raw `<button>` elements (inline class changes, not variant props)

22. `dashboard/src/components/PeriodSelector.vue` — nav arrow glass pills
23. `dashboard/src/components/CashflowSankey.vue` — raw button styling
24. `dashboard/src/components/AppLayout.vue` — Exit Demo button
