# UI Redesign with shadcn-vue — Design Document

**Date:** 2026-02-24
**Status:** Approved
**Scope:** Full redesign of all 5 frontend components

---

## Problem

The current dashboard UI is built with vanilla CSS and looks visually inconsistent. Components use ad-hoc inline styles, emoji icons, and custom button/card styles with no shared design system. The result is a dashboard that feels rough and unpolished.

---

## Goals

- Install shadcn-vue + Tailwind CSS in the `dashboard/` package
- Rewrite all 5 components using shadcn primitives and Tailwind utility classes
- Support system (auto) dark/light theme
- Remove all scoped CSS from components (replaced by Tailwind)
- Keep the same Vue Router structure, composables, and API layer unchanged

---

## Architecture

### Stack Addition

- **shadcn-vue**: Vue 3 port of shadcn/ui, built on Radix Vue primitives
- **Tailwind CSS v4**: Utility-first CSS framework (required by shadcn-vue)
- **class-variance-authority (CVA)**: Variant management for shadcn components
- **clsx + tailwind-merge**: Class merging utilities

Installation target: `dashboard/` package only (not the root/backend).

### Theme

- Base color: `zinc`
- Mode: System (respects `prefers-color-scheme`)
- CSS variables for colors injected by shadcn-vue into `style.css`

### What Changes vs. What Stays

| Layer | Change |
|-------|--------|
| `dashboard/src/components/*.vue` | Full rewrite (template + script, remove scoped CSS) |
| `dashboard/src/style.css` | Replace with Tailwind directives + shadcn CSS vars |
| `dashboard/tailwind.config.ts` | New file — Tailwind config |
| `dashboard/components.json` | New file — shadcn-vue config |
| `dashboard/src/api/client.ts` | No change |
| `dashboard/src/composables/` | No change |
| `dashboard/src/router/` | No change |
| Backend (`src/`) | No change |

---

## Component Design

### 1. AppLayout.vue

**Current:** Hardcoded dark sidebar with emoji icons and inline flex styles.

**Redesign:**
- Sidebar nav using Tailwind layout classes
- Navigation items with Lucide icons (replaces emoji)
- Active route highlighted with `bg-accent` background
- `Separator` between nav sections
- Mobile: collapsible with hamburger toggle (using shadcn `Sheet` component)
- System theme applied at root `<html>` level via `class="dark"` toggle

### 2. OverviewDashboard.vue

**Current:** Unstyled stat divs, basic chart containers.

**Redesign:**
- 3 stat cards at top: This Month / Last Month / Difference
  - shadcn `Card` with `CardHeader`, `CardContent`
  - `Badge` to indicate positive/negative difference
- Charts section: Chart.js charts stay, wrapped in shadcn `Card`
- Per-account cards: `Card` grid with account name, total, category breakdown
- Loading states: shadcn `Skeleton` components

### 3. TransactionTable.vue

**Current:** Custom `<table>` with ad-hoc CSS, basic filter inputs.

**Redesign:**
- shadcn `Table` (thead/tbody/tr/td components)
- `Input` with search icon for text search
- `Select` dropdowns for account and category filters
- `DatePicker` (or two `Input type="date"`) for date range
- `Badge` variants for transaction status (completed = green, pending = yellow)
- `Badge` for category labels
- shadcn `Pagination` component at the bottom
- Amount column: positive amounts in `text-green-500`, negative in `text-destructive`

### 4. AccountManager.vue

**Current:** Inline form, basic account list, OTP modal with raw `<div>` overlay.

**Redesign:**
- "Add Account" opens a shadcn `Dialog` with a proper `Form`
  - `Select` for provider
  - `Input` fields for credentials
  - `Button` to submit
- Account list: `Card` per account with status `Badge` (Active/Inactive)
- Scrape button: `Button` with loading spinner state
- Delete: `Button` variant="destructive" with confirmation `AlertDialog`
- OTP modal: shadcn `Dialog` with `InputOTP` component for 2FA code entry

### 5. AiChat.vue

**Current:** Basic message list with minimal styling, plain input.

**Redesign:**
- Message area: scrollable container with proper chat bubble layout
  - User messages: right-aligned, `bg-primary text-primary-foreground` bubble
  - AI messages: left-aligned, `bg-muted` bubble with avatar/icon
- Suggestion chips: `Button` variant="outline" pill layout
- Input area: `Textarea` that grows with content + `Button` to send
- Loading: AI response shows animated `...` dots or `Skeleton`

---

## Data Flow

No changes to data flow. All API calls, composables, and reactive state remain identical. Only the template layer and styling change.

---

## Error Handling

No changes to error handling logic. Error messages will be displayed using shadcn `Alert` component (variant="destructive") instead of raw `<p>` elements.

---

## Testing

Manual visual testing:
- Verify dark/light mode switching works via OS preference
- Verify all 5 pages render without errors
- Verify OTP modal works end-to-end
- Verify charts render correctly inside shadcn Card containers
- Verify transaction table pagination and filters work

---

## Out of Scope

- Form validation library (not adding react-hook-form equivalent)
- Animations beyond what shadcn provides by default
- i18n / Hebrew full localization
- Mobile responsive overhaul (basic mobile support only)
