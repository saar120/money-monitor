---
name: Money Monitor for iPhone
description: A calm, native financial pulse with depth on demand.
colors:
  ledger-green: '#216849'
  ledger-green-soft: '#DCEAE2'
  warm-paper: '#F5F3EE'
  raised-paper: '#FCFBF8'
  ink: '#171914'
  secondary-ink: '#656A61'
  tertiary-ink: '#6B7167'
  hairline: '#D8D7CF'
  warning: '#83500D'
  warning-soft: '#F3E7D1'
  danger: '#A63D35'
  danger-soft: '#F3DEDA'
  night: '#11130F'
  night-raised: '#191C17'
  night-ink: '#F3F3EC'
  night-secondary: '#ADB1A8'
  night-hairline: '#32362F'
  night-green: '#68C697'
typography:
  display:
    fontFamily: 'San Francisco, system-ui, sans-serif'
    fontSize: '48px'
    fontWeight: 700
    lineHeight: 1.1
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
  sm: '6px'
  md: '12px'
  lg: '16px'
  pill: '22px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '20px'
  xl: '28px'
  section: '36px'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.warm-paper}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    height: '54px'
  attention-group:
    backgroundColor: '{colors.raised-paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '0 14px'
  filter-chip:
    backgroundColor: '{colors.raised-paper}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    height: '44px'
---

# Design System: Money Monitor for iPhone

## Overview

**Creative North Star: "The Quiet Ledger"**

Money Monitor feels like a private financial instrument: calm enough for daily use, precise enough to trust, and immediately useful without decoration. Hierarchy comes from the financial comparison itself, generous spacing, and a small number of native surfaces—not from a grid of interchangeable dashboard cards.

The first screen is intentionally quiet. It states current spending, explains whether its pace is better or worse, relates it to income and time elapsed, then surfaces only actionable changes. Depth appears through native navigation and progressive drill-down when the user asks why.

**Key Characteristics:**

- Warm neutral light mode and near-black olive dark mode.
- One deep-green interaction voice, with amber and red reserved for financial meaning.
- Large tabular financial numerals paired with plain-language comparisons.
- Native iOS navigation, sheets, controls, SF Symbols, haptics, and system transitions.
- Flat, hairline-separated structure with no decorative shadows or gradients.

## Colors

The palette is warm, muted, and semantic. Light and dark values live together in `src/theme.ts`; use those roles rather than introducing screen-local neutrals.

### Primary

- **Ledger Green:** Interaction tint, positive movement, successful review progress, and current-period chart lines.
- **Soft Ledger Green:** Quiet selected or positive-state backgrounds.

### Secondary

- **Warning Amber:** Spending moving unfavorably, budgets requiring attention, and positive expense deltas.
- **Danger Red:** Crossed budgets, broken sync, stale accounts, and destructive financial state.

### Neutral

- **Warm Paper / Night:** Root screen fields for light and dark appearance.
- **Raised Paper / Night Raised:** Grouped transaction fields and contextual attention containers.
- **Ink / Night Ink:** Primary content and high-emphasis financial values.
- **Secondary and Tertiary Ink:** Supporting comparisons, metadata, and disclosure marks.
- **Hairline / Night Hairline:** Dividers, tracks, and structural boundaries.

**The Meaningful Color Rule.** Green, amber, and red describe interaction or financial state; they never decorate empty space.

## Typography

**Display Font:** San Francisco
**Body Font:** San Francisco
**Label Font:** San Francisco

**Character:** Native, compact, and numerical. Weight and scale establish hierarchy; tabular numerals keep changing values stable and easy to compare.

### Hierarchy

- **Display** (700, 48px, 1.1): The single leading financial amount on a screen. Display amounts do not grow with Dynamic Type because they are already oversized; adjacent explanatory copy does.
- **Headline** (700, 30px, 1.2): Review merchants and caught-up states.
- **Title** (700, 21px, 1.29): Section questions such as “What changed?” and “Where it went.”
- **Body** (400–600, 16px, 1.31): Merchant names, primary labels, and readable explanations.
- **Label** (500–700, 13px, 1.38): Dates, account metadata, comparison details, and progress counts.

**The One Statement Rule.** Only one financial value receives display scale in a viewport; comparisons explain it instead of competing with it.

## Layout

Screens use the iPhone safe area, native navigation bars, a 20-point horizontal content inset, and an approximately 8/12/20/28/36-point vertical rhythm. Related labels stay tight; sections receive visibly more space above than below. Top-level screens scroll vertically and never depend on horizontal scrolling.

Compact rows constrain oversized numerals and labels so explanatory text can still respond to Dynamic Type. The shipped Home surface is verified at XXL text size. The app targets iPhone only; do not infer an iPad grid.

## Elevation & Depth

The system is flat by default. Depth comes from tonal grouping, native sheets, navigation transitions, and the tab bar—not shadows. A raised neutral surface may group an actionable cluster, but it should remain visually quieter than the financial statement above it.

**The Flat Ledger Rule.** Do not add card shadows, floating glass, or elevation to make ordinary content feel important.

## Shapes

Small status flags use 6-point corners, grouped rows use 12–16 points, and compact filters use a 22-point capsule. Progress tracks are thin and fully rounded. Shapes group actions; they are not repeated around every statistic.

## Components

### Buttons

- Primary review actions are full-width, 54 points tall, high contrast, and 16–17 points rounded.
- Disabled and saving states reduce opacity and replace the verb with explicit progress copy.
- Press feedback is restrained opacity plus a native haptic where completion matters.

### Chips

- Activity filters are 44-point tap targets with a soft surface at rest and solid ink when selected.
- Chips name a filter directly; icons are unnecessary.

### Cards / Containers

- The attention group and review field group use the raised surface and 16-point corners.
- Containers hold related actions or fields. Standalone metrics remain on the page field.

### Navigation

- Home, Activity, and Explore are the only root tabs.
- Review is a focused stack workflow launched contextually.
- Category, merchant, transaction, and net-worth explanations use native push navigation.
- Category and owner selection use a dismissible page sheet with Cancel.

### Spending Pace

Current spending is a solid green line with a restrained area fill; the previous period is a neutral line. Scrubbing updates day, current value, and reference value together and supplies subtle selection haptics.

## Do's and Don'ts

### Do:

- **Do** lead with a comparison that answers whether the current number is normal, improving, or worsening.
- **Do** let Home say very little when accounts, budgets, and review state are healthy.
- **Do** use SF Symbols and native iOS controls for familiar interaction.
- **Do** use tabular numerals for money, percentages, and progress.

### Don't:

- **Don't** recreate the desktop dashboard or introduce permanent cards for operationally healthy state.
- **Don't** use green, amber, or red without a financial or interaction meaning.
- **Don't** add decorative charts, gradients, glass, shadows, achievement mechanics, or placeholder tabs.
- **Don't** duplicate financial calculations on the phone; render the Mac's mobile projection.
