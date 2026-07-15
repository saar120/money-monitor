# Money Monitor iOS Design System

## Direction

The visual lane is flat, restrained, system-native, and content-led. The reference synthesis is Tide Guide's crisp data layer, Moonlitt's disciplined Liquid Glass control layer, Structured's clear single-column hierarchy, and Apple Stocks' familiar financial scanning patterns. These are principles rather than a copied visual identity.

Scene sentence: a Money Monitor owner checks the app one-handed in mixed daylight between daily tasks, wanting a calm, private answer in under a minute.

## Navigation

- Four persistent top-level sections: Home, Activity, Plan, and Advisor.
- A distinct trailing Search control uses the contemporary iOS search-tab treatment for quick transaction lookup.
- Accounts, sync history, categories, alerts, and settings live behind contextual links and the profile control.
- Top-level screens use large navigation titles; detail screens use inline titles and the system back gesture.
- Self-contained edits use medium or large sheets with Cancel and Done.

## Color

- Content canvas: `#FFFFFF` light / `#080809` dark.
- Quiet control fill: `#F0F0F2` light / `#222225` dark.
- `label`: `#101114` light / `#F7F7F8` dark.
- `secondaryLabel`: `#68686F` light / `#A7A7AF` dark.
- Money Monitor tint: `#006BD6` light / `#409CFF` dark.
- Positive: `#167A32` light / `#30D158` dark.
- Negative: `#D70015` light / `#FF5A52` dark.
- Warning: `#963B00` light / `#FF9F0A` dark.
- Chart indigo: `#5E5CE6` light / `#7D7AFF` dark, reserved for distinguishing data series from interactive blue.

Color is semantic and occupies a small minority of the interface. Blue means interaction or current selection, green means positive financial movement or successful sync, red means expense/error, and orange means attention. Category color belongs on a glyph, dot, or chart mark rather than an entire tile. Status meaning never relies on color alone.

## Materials

The interface has two explicit layers:

- **Content layer:** financial summaries, charts, transactions, forms, prompts, and status rows stay flat on system backgrounds. Whitespace and hairline separators establish hierarchy. Content containers have no cast shadows and use restrained corner radii only when grouping is semantically useful.
- **Control layer:** Liquid Glass appears only in the floating tab bar, navigation and toolbar actions, global Search control, compact floating actions, and transient composer controls. It uses one subtle rim and a soft scroll-edge fade rather than a bright outline or heavy shadow.

Do not stack glass on glass or use it as a decorative card material. Sheets use an opaque or standard-material task surface with glass limited to compact controls. Reduce Transparency replaces glass with an opaque system material while Increase Contrast strengthens its separator.

## Typography

Use San Francisco through SwiftUI text styles rather than fixed sizes:

- Large titles: `.largeTitle`, bold.
- Financial values: `.title` or `.title2`, semibold, monospaced digits.
- Section headings: `.headline`.
- Rows and controls: `.body` and `.callout`.
- Metadata: `.subheadline`, `.footnote`, and `.caption`.

Amounts use monospaced digits and locale-aware ILS formatting. Avoid uppercase utility labels except where the system itself uses them.

## Components

- Native `TabView`, `NavigationStack`, `List`, `Form`, `Sheet`, `Menu`, `Toggle`, `Picker`, `Searchable`, `ContentUnavailableView`, and `Refreshable` patterns.
- SF Symbols in implementation; the HTML mockups use matching line-icon stand-ins.
- Transaction rows use a leading merchant/category glyph, two lines of context, and a trailing amount.
- Financial charts use Swift Charts, maximize plot width, and expose Audio Graphs plus a text summary.
- Connection state is a compact, tappable freshness label. It expands only when attention is required.
- Lists, summaries, and charts avoid repeated card nesting. A page should normally expose one primary financial value, one supporting trend, and flat rows beneath it.
- Decorative icon tiles use neutral fills; semantic color stays on symbols and state marks.

## Motion

Use system pushes and sheets. Small state changes use 150–250 ms ease-out motion. Sync completion can use a brief symbol replacement and haptic. Reduce Motion uses crossfades and removes chart interpolation.

## Screen Size

Mockups target a 393 by 852 point iPhone canvas. The implementation must adapt to smaller devices, landscape, iPad, Dynamic Type, and safe-area changes.
