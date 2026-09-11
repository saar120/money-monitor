---
name: Money Monitor — Blue Ledger
description: A calm, precise iPhone ledger with cobalt focus and dusk depth.
colors:
  porcelain: '#F8F7F3'
  paper: '#FFFFFF'
  paper-soft: '#EFEEE9'
  ink: '#09111F'
  muted-ink: '#687081'
  cobalt: '#0B5DDD'
  cobalt-soft: '#E5EEFC'
  positive: '#137556'
  warning: '#9C671B'
  danger: '#D55B45'
  dusk: '#17212E'
  dusk-surface: '#1E2B3A'
  dusk-raised: '#27374A'
  dusk-ink: '#F4F3EF'
  dusk-muted: '#AEB8C5'
  dusk-cobalt: '#68A4FF'
typography:
  display:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '56px'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '-2px'
  headline:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '30px'
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '21px'
    fontWeight: 700
    lineHeight: 1.29
    letterSpacing: '-0.35px'
  body:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.31
  label:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 600
    lineHeight: 1.38
rounded:
  compact: '10px'
  control: '14px'
  field: '16px'
  chip: '22px'
  nav-lens: '23px'
  nav: '28px'
  sheet: '32px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '20px'
  xl: '28px'
  section: '36px'
components:
  button-primary:
    backgroundColor: '{colors.cobalt}'
    textColor: '{colors.paper}'
    typography: '{typography.body}'
    rounded: '{rounded.field}'
    height: '54px'
  search-field:
    backgroundColor: '{colors.paper-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.field}'
    height: '48px'
  filter-chip:
    backgroundColor: '{colors.paper-soft}'
    textColor: '{colors.muted-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.chip}'
    height: '44px'
  glass-navigation:
    backgroundColor: '{colors.cobalt-soft}'
    textColor: '{colors.cobalt}'
    rounded: '{rounded.nav}'
    height: 'system-managed'
  category-option:
    backgroundColor: '{colors.paper-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    height: '52px'
---

# Design System: Money Monitor — Blue Ledger

## Overview

**Creative North Star: "Blue Ledger"**

Money Monitor is a private financial instrument: calm enough for daily use, exact enough to trust, and dense enough to get work done. A cobalt spending chart is the visual anchor. Everything around it behaves like an editorial ledger—aligned figures, clear section questions, quiet rules, and progressively disclosed detail.

The system is recognizably iOS without becoming a generic bank template. Native navigation, sheets, switches, SF Symbols, haptics, and system type do the familiar work. Glass is reserved for navigation and compact selection controls; financial content stays on stable, readable surfaces.

**Key Characteristics:**

- Warm porcelain light mode and tonal blue-graphite dusk mode.
- One cobalt interaction voice, with green, amber, and red reserved for financial meaning.
- Large tabular financial numerals supported by plain-language comparisons.
- A persistent moving lens for root navigation and range selection.
- Editorial lists with shared surfaces, restrained separators, and aligned amounts.
- Live Mac data and contract semantics remain more important than decorative parity.

## Colors

Light mode uses porcelain rather than stark white. Dark mode is dusk, not black: `#17212E` canvas, `#1E2B3A` primary surfaces, `#27374A` raised surfaces, `#F4F3EF` text, and `#AEB8C5` muted text. Semantic values live in `src/theme.ts`; screens should not introduce their own canvas or surface colors.

### Primary

- **Ledger Cobalt** (`#0B5DDD`, dusk `#68A4FF`): navigation, selected controls, links, chart focus, and primary actions.
- **Cobalt Wash** (`#E5EEFC`, dusk `#253F63`): selected lenses and quiet interaction backgrounds.

### Secondary

- **Positive Green** (`#137556`, dusk `#53D2A7`): income, favorable movement, and included/success states.
- **Warning Amber** (`#9C671B`, dusk `#EFB456`): pending items, budget risk, and unfavorable expense deltas.
- **Attention Red** (`#D55B45`, dusk `#FF8975`): stale accounts, crossed budgets, errors, and destructive state.

### Neutral

- **Porcelain / Dusk Canvas:** the root reading field.
- **Paper / Dusk Surface:** grouped rows and stable cards.
- **Soft Paper / Raised Dusk:** inputs, inactive controls, and nested surfaces.
- **Ink / Dusk Ink:** primary labels and amounts.
- **Muted Ink / Dusk Muted:** metadata and explanations.

**The Meaningful Color Rule.** Cobalt means interaction or chart focus. Green, amber, and red communicate financial or operational state; they do not decorate empty space.

## Typography

**Display Font:** San Francisco system UI

**Body Font:** San Francisco system UI

**Numeric Treatment:** tabular figures

**Character:** Native, compact, and numerical. Scale establishes hierarchy while fixed-width figures keep changing amounts stable and comparable.

### Hierarchy

- **Display** (700, up to 56pt): the single leading financial amount in a viewport.
- **Headline** (700, 30pt): review merchants and completion states.
- **Title** (700, 21pt): section questions such as “What changed?” and “Where it went.”
- **Body** (400–600, 16pt): merchants, field labels, and explanations.
- **Label** (500–700, 13pt): dates, account metadata, status, and progress.

**The One Statement Rule.** Only one amount receives display scale per viewport; surrounding values support it instead of competing with it.

## Layout

Screens use iPhone safe areas, a 20-point horizontal inset for editorial content, and an approximately 8/12/20/28/36-point vertical rhythm. Related labels stay tight; sections receive visibly more space above than below. The native tab controller owns the bottom safe-area inset and minimizes while scrolling on supported iOS versions.

Home leads with the most decision-useful server value and cobalt chart. Activity preserves compact, high-density rows. Explore keeps its chart and ranked drivers on the same monthly inclusion semantics. Secondary screens retain native push navigation and use shared row language rather than isolated cards.

## Elevation & Depth

The page is flat by default. Stable financial sections use tonal separation and hairlines. Native Liquid Glass appears only on the floating tab bar, its active lens, and range-selection lenses. It uses translucent blue-gray tint, a fine light edge, a quiet inner highlight, and a restrained ambient shadow. On systems without the glass API, the same views fall back to the equivalent translucent surface.

**The Material Restraint Rule.** Glass clarifies controls moving above content; it is not a background for ordinary financial cards.

## Shapes

Corners are continuous and concentric: 10-point selected range lenses inside 14-point controls, 23-point active tab lenses inside the 28-point navigation shell, 16-point search and row groups, 22-point chips, and native page sheets with approximately 32-point top corners. Compact status flags use 6-point corners. Interactive targets remain at least 44 points tall.

## Components

### Buttons

- Primary actions are cobalt, full-width where the workflow needs certainty, at least 54 points tall, and 16-point rounded.
- Press feedback reaches approximately 0.94 scale and 0.76 opacity, then returns with the standard damped spring.
- Existing review haptics remain tied to confirmation, selection, and failure—not decoration.

### Chips

- Activity filters are 44-point capsules with a soft glass-tinted rest state and solid cobalt selection.
- Status flags remain smaller and use semantic state colors.

### Cards / Containers

- Cards exist only for a real group or material layer: the cobalt chart, review field group, attention group, and sheet options.
- Transaction and ranking lists share the page surface and use restrained separators.

### Inputs / Fields

- Search fields use the soft surface, a 16-point radius, 48-point height, native text input behavior, and visible system clear affordance.
- The category picker is a compact bottom sheet with search, current selection, a two-column scrolling list, and the complete Mac-provided category set. Transaction dates use the compact native iOS date control and calendar popover.

### Navigation

- Home, Activity, and Explore are the only root tabs.
- Expo Router's native tabs provide the system-sized iOS Liquid Glass bar, active lens, scroll minimization, and platform transition behavior.
- Explore cash flow and net-worth history share a compact persistent-lens control. Its spring uses stiffness `300`, damping `28`, and mass `0.82`.
- Reduced Motion switches the custom range lens to the selected position immediately; the native tab controller follows the system preference.

### Spending Chart

The chart is the Blue Ledger signature. Home places current and prior posted spending inside a cobalt shell. Explore requests the existing month-scoped overview endpoint for up to six months and plots the Mac-provided posted income and spending totals as grouped bars. Values and comparisons come from the overview contract; the phone does not extrapolate future points.

## Do's and Don'ts

### Do:

- **Do** use semantic theme roles from `src/theme.ts`.
- **Do** align money values and use tabular numerals.
- **Do** preserve data inclusion, date-range, owner, pending, excluded, transfer, and currency semantics.
- **Do** use native primitives and existing dependencies before adding code.
- **Do** omit unavailable values or category recency instead of inventing them.

### Don't:

- **Don't** turn every row or statistic into a card.
- **Don't** put glass behind ordinary financial content.
- **Don't** use an all-black dark mode.
- **Don't** hardcode prototype financial claims into production UI.
- **Don't** add client forecasts, trend definitions, or competing aggregates without a typed contract and reconciliation test.
