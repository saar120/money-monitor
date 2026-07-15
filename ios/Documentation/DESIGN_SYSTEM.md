# Native iOS design system

The canonical visual rationale is [`docs/ios-mockups/DESIGN.md`](../../docs/ios-mockups/DESIGN.md). This file maps it to SwiftUI implementation rules.

## Visual sentence

Flat financial content, one restrained semantic tint system, and Liquid Glass only where the interface navigates or acts.

## Platform components first

Use `NavigationStack`, `TabView`, `Tab`, `.searchable`, `List`, `Form`, `Section`, `Sheet`, `Menu`, `Toggle`, `Picker`, `ContentUnavailableView`, `.refreshable`, and Swift Charts before introducing custom containers.

On iOS 26, the standard components receive the current Liquid Glass appearance. Do not draw a custom glass tab bar. Custom `glassEffect` views are optional iOS 26 enhancements and require a real control-layer need plus an iOS 18–25 fallback.

## Color tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FFFFFF` | `#080809` | Main content background |
| Quiet control fill | `#F0F0F2` | `#222225` | Neutral icons and non-glass controls |
| Label | `#101114` | `#F7F7F8` | Primary text |
| Secondary label | `#68686F` | `#A7A7AF` | Supporting text |
| Tint | `#006BD6` | `#409CFF` | Interaction and selection |
| Positive | `#167A32` | `#30D158` | Positive movement and success |
| Negative | `#D70015` | `#FF5A52` | Expense and error |
| Warning | `#963B00` | `#FF9F0A` | Attention and stale state |
| Chart indigo | `#5E5CE6` | `#7D7AFF` | Secondary chart series only |

Implement these as semantic asset-catalog colors before feature screens. Prefer Apple semantic colors where their behavior matches; custom hex values should still adapt to Increased Contrast.

Color never carries meaning alone. Pair status color with a symbol and plain-language label.

## Spacing and shape

Use a small token scale: 4, 8, 12, 16, 20, 24, and 32 points. Default page horizontal padding is 16–20 points, depending on the native container.

- Minimum control target: 44 by 44 points.
- Content grouping radius: 12–16 points only when grouping is semantically useful.
- Compact control radius: derive from the system control style.
- Separators: system hairlines or whitespace.
- Shadows: none on financial content.
- Do not place a card around every section or stack material on material.

## Typography

| Content | SwiftUI style |
| --- | --- |
| Top-level title | `.largeTitle.bold()` |
| Primary financial value | `.title` or `.title2`, semibold, monospaced digits |
| Section title | `.headline` |
| Row/control | `.body` or `.callout` |
| Supporting metadata | `.subheadline`, `.footnote`, or `.caption` |

Never hard-code a point size for production text. Financial values use locale-aware formatting and `.monospacedDigit()`. Avoid uppercase utility labels unless the system pattern supplies them.

## Materials

### Content layer

Summaries, charts, transaction rows, forms, prompts, and statuses stay on opaque/system backgrounds. Use hierarchy, whitespace, and restrained separators.

### Control layer

System tab bar, navigation actions, Search, compact floating actions, and transient composer controls may use Liquid Glass. Prefer regular system glass. Do not use glass as a decorative finance card.

Standard system components automatically adapt to Reduce Transparency and Increased Contrast. Any custom translucent fallback must explicitly provide an opaque alternative.

## Core components

- **Freshness label:** compact symbol + “Updated …” text; expands only for stale/offline/error explanations.
- **Transaction row:** merchant/category symbol, two lines of context, trailing signed amount.
- **Money summary:** one primary amount, period/context label, and one supporting comparison.
- **Budget progress:** value, limit, semantic progress, and textual percentage/remaining amount.
- **Chart:** maximum useful plot width, restrained series color, text summary, VoiceOver values, and Audio Graph where appropriate.
- **Offline banner/state:** saved timestamp, available content, disabled capabilities, and retry.
- **Primary action:** native prominent button; do not add bespoke gradients or glows.

## Motion and feedback

- Use system pushes, sheets, tab transitions, and keyboard behavior.
- Small custom state transitions: 150–250 ms ease-out.
- Sync completion may use a brief symbol replacement and light haptic.
- Reduce Motion uses crossfades and removes chart interpolation or glass morphing.
- Do not animate financial totals in a way that delays reading or implies market urgency.

## Layout and appearance coverage

The mockup canvas is 393 by 852 points, not a fixed implementation frame. Validate smaller iPhones, landscape, iPad, split view, safe-area changes, keyboard presentation, and accessibility text sizes.

Dark Mode is token-driven across the whole app. The two dark mockups are regression references, not permission to leave other screens unverified.

