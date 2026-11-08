# Money Monitor design language

Current visual and interaction conventions for the desktop app. Use the [desktop guide](../dashboard/README.md) and [iPhone guide](../mobile/README.md) for platform behavior and implementation.

## Visual foundations

Use warm off-white in light mode, soft neutral charcoal in dark mode, and blue for interaction. Keep most surfaces neutral; reserve a quiet blue tint for selection and use blue prominently for primary actions and chart series. Keep dark mode comfortably above near-black, with subdued surface steps rather than luminous borders. Use small pastel merchant or category marks consistently, neutral navigation icons, and softer regular/medium typography. Reduce persistent control outlines and repeated chevrons while keeping actionable cells discoverable on hover and keyboard focus. Warmth comes from these choices, not extra helper text, illustrations, or larger components.

The following palette defines Money Monitor roles; these values are not sampled competitor tokens. Blue replaces the exploratory sage action color in both themes. Keep structure, density, financial semantics, and interaction behavior consistent when switching themes:

| Role                    | Light     | Dark      |
| ----------------------- | --------- | --------- |
| Canvas                  | `#F6F4EF` | `#202124` |
| Main surface            | `#FFFFFF` | `#282A2F` |
| Header/control surface  | `#F7F7F5` | `#2D3036` |
| Overlay surface         | `#FFFFFF` | `#33363D` |
| Primary text            | `#272B28` | `#F3F3F0` |
| Secondary text          | `#62675F` | `#B0B3BC` |
| Action and focus accent | `#2457D6` | `#91B9FF` |
| Text on accent          | `#FFFFFF` | `#172338` |
| Selection fill          | `#E8EFFB` | `#303C50` |

Canvas and surface tones express hierarchy. Give each working surface one fine perimeter and modest corner radius, without a resting shadow. Reserve elevation shadows for overlays. Use subtle separators only where grouping needs them. A selected row uses a quiet blue fill without a persistent outline; the keyboard-focused control receives the distinct focus outline. Avoid luminous leading stripes. Hover, selection, and keyboard focus must remain distinguishable, with programmatic selection state. Define border and focus tokens with the actual adjacent surface during component validation. The softer palette must not weaken text contrast or hide essential actions. Use white text on the deep-blue light-theme action and dark navy text on the pale-blue dark-theme action; do not reuse the same foreground blindly across themes.

Green expresses an explicitly positive state, amber an attention condition, and red an error, destructive action, or breached limit. Ordinary spending is neutral. A larger income or expense is not automatically good or bad; accompany comparisons with precise labels. Category colors are a separate mapping from status colors.

Use platform sans typography and tabular numerals for money, with appropriate Hebrew fallbacks. The desktop scale is 12px captions, 13px controls, 14px body, 16px section titles, and 24px page titles. Keep summary values at 24–30px and leading monetary values around 30–36px. Metadata is quieter than values, but essential information never depends on tiny or low-contrast text. Preserve platform typography on iPhone and scale it through native accessibility settings.

Use spacing steps of 4, 8, 12, 16, 24, 32, and 48px. Default desktop content gutters to 24px, panel padding to 20px, and gaps between related groups to 16–24px. Use 8px control corners, 12px grouped surfaces, and 16px overlays. Keep desktop controls at the existing 36px baseline and iPhone touch targets at least 44pt. Single-line desktop ledger rows begin around 36–40px; rows with a second meaningful line begin around 44–48px. These measurements are baselines, not fixed heights that can clip translated text. Let short queues leave quiet space instead of enlarging their rows or adding filler.

## Depth and component states

Keep tables contained through a subtle perimeter and surface tone. Reserve shadows for floating overlays. The shared desktop primitives apply the same states in light and dark themes.

| Layer            | Treatment                                                                                | Where it applies                                                       |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Canvas           | Quiet neutral ground; no shadow.                                                         | Page background, open summary figures, navigation surroundings.        |
| Working surface  | One rounded container, a faint perimeter, and a softly tinted header; no resting shadow. | Whole ledger or review queue; separate transaction inspector.          |
| Control          | Matte fill and a quiet boundary where needed; no bevel, gradient, or resting shadow.     | Filters and selectors. Inline categories use text and a small chevron. |
| Floating surface | Clear surface separation, fine edge, and a short soft shadow.                            | Category picker, menus, and chart tooltips.                            |

Keep table rows in a single aligned surface. Do not make every row a floating card, transform rows on hover, or move amounts when actions appear. Fit a short queue's container to its rows. A hovered row gets a neutral tint and an action in a reserved slot; the selected row keeps its blue fill independently of pointer position. Avoid outlining the whole selected row unless it is the keyboard focus target. Hover-only shortcuts must also appear on focus, and the row's primary action must remain available without hover.

Category cells use readable text and a small persistent dropdown affordance. The open or keyboard-focused category cell receives an outline; other cells remain visually quiet. Avoid repeating colored pills and icons in the category column when merchant marks already provide recognition. Keep review status separate from category identity, and preserve identical merchant marks for identical merchants. Neutral menu hover and blue row selection should communicate different states clearly.

Use one containment boundary per group. Do not combine a strong border, shadow, contrasting header, and bright edge around the same resting component. In dark mode, a modest increase in surface lightness separates the workspace from the canvas; avoid luminous perimeter lines. Keep the inspector's actions close to the decision, with a simple divider if needed. Home summary figures remain open on the canvas; only a related chart/list or attention group needs a container. Review reuses Activity's table and inspector treatments with a shorter queue and its own confirmation action.

Interaction supplies the remaining sense of responsiveness: a neutral hover fill, a visible active cell, accurate save feedback, and a clearly separated popup. Button presses can darken the fill for 100–150ms without movement. Keyboard navigation stays immediate, and reduced motion preserves state feedback. Static mockups only illustrate states; validate their behavior in a working component before adoption. Essential controls, focus indicators, and text must remain legible even when decorative boundaries are subtle.

## Navigation and page structure

Keep Home, Activity, Explore, and Advisor as the primary destinations. Make their selected state unmistakable. Keep Planning and Manage subordinate, with quieter section labels and typography. Begin with a desktop sidebar around 200–208px, 34–36px navigation rows, and 16px icons; allow longer translations and narrower windows to reflow appropriately.

Every page uses the same header alignment, content gutter, toolbar controls, and action order. Begin with a 56px desktop header and a 344–384px detail inspector shared by Activity and Review. Let the inspector fit its contents; keep its actions near the decision. Show the page name once. Put period and household filters next to the content they affect. A report's period must remain visible while drilling down. Avoid a global period control that appears to change pages or queues it does not actually affect.

Use three reusable page structures:

| Structure                  | Screens                                                | Composition                                                                                                                                   |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                   | Home, Explore, Net worth                               | One leading financial statement, a useful chart or breakdown, and routes into supporting records.                                             |
| Workspace                  | Activity, Review, Accounts, Categories                 | Toolbar, list or table, and a consistent detail surface. Review prioritizes the current decision; Activity prioritizes scanning many records. |
| Planning and configuration | Budgets, Subscriptions, Alerts, Settings, Account sync | Scannable groups, progress or status where relevant, and actions located with their object.                                                   |

Advisor uses the same typography, charts, category marks, and transaction details inside its conversation. A cited amount or transaction opens the same detail experience used elsewhere. Contextual Advisor entry points retain the selected account, category, or period.

## Shared interaction rules

Every actionable object has a clear resting affordance and visible hover, focus, pressed, loading, success, and failure behavior. Essential actions remain available without hover. Use one primary action per decision area.

Clicking an aggregate opens the records that explain it, preserving the displayed period, ownership, category, and inclusion rules. Returning restores the previous filters and position. A chart point exposes the exact value; a supported drill-down opens its corresponding records. Provide keyboard and touch alternatives to hovering.

Reuse the transaction identity row, amount formatting, category picker, owner picker, period selector, filter chips, detail surface, and feedback patterns throughout the app. Different workflows can have different save boundaries: Activity preserves its current immediate category/owner/inclusion edits and explicit Effective Date save; Review commits the decision through Confirm and next. Show unsaved, saving, saved, and failed states accurately.

In Review, keep the queue order stable, offer Skip for the current session, and show completed and remaining counts separately. Skipped items remain unresolved. Advance only after a successful complete decision. An Undo action must restore the committed fields and review state; use the versioned backend receipt and reject an Undo that would overwrite a newer edit. Failed or conflicting writes retain the draft and expose recovery.

Use 100–150ms for pointer feedback and 160–220ms for short detail transitions. Keyboard navigation updates immediately. Keep the detail surface stable as selection changes. Honor reduced motion and avoid replaying number animations for unchanged data.

## Financial data and charts

Use the shared formatters for currency, signs, decimals, and dates. Full amounts remain visible in ledgers and details; compact notation is limited to summaries with an accessible exact value. Align amount columns and isolate mixed-direction currency and Hebrew/English strings.

Use one chart grammar: primary series in the blue interaction accent, comparison in a quieter neutral with a distinct line style, and stable category colors for breakdowns. Use lines for change over time and bars for comparisons. Keep axes, tooltips, period controls, and selection behavior consistent across Home, Explore, Net worth, and Advisor. Use the existing chart stack and shared chart theme.

Totals, charts, and lists must describe the same filters and financial scope. Keep Bank Date, Effective Date, and Reporting Date distinct. Do not imply that unavailable values are zero, mix currencies without the established conversion rules, or present uncertain balances as current. Account Refresh Attention, Partial Snapshot, Saved View, and Mutation Conflict retain their meanings in [CONTEXT.md](../CONTEXT.md). Call reusable transaction searches **saved filters**; **Saved View** already names the iPhone snapshot experience.

## Applying the language across the app

| Surface                          | Visible result                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Home                             | A dominant monthly spending statement, linked pace chart, secondary income/net worth, and conditional Worth Your Attention items. |
| Activity                         | Readable full amounts, direct category editing, consistent filters, and details that preserve list context.                       |
| Review                           | Compact queue, prominent transaction and category decision, Confirm/Skip, honest progress, and recoverable changes.               |
| Explore                          | Consistent period comparison and a clear category → merchant → transaction path.                                                  |
| Budgets and Subscriptions        | Comparable progress rows, upcoming charges, clear exceptions, and direct editing.                                                 |
| Net worth and asset details      | Strong total and time series, aligned asset/liability rows, and traceable changes.                                                |
| Accounts and Account sync        | Recognizable institutions, balances and refresh timestamps, with account-specific recovery actions.                               |
| Advisor                          | Familiar charts and linked financial evidence, with separate pending and completed action states.                                 |
| Categories, Alerts, and Settings | Shared controls, grouped rows, and inline validation with consistent save feedback.                                               |

## Establishing the system in code

Extend the shared tokens in [desktop styles](../dashboard/src/style.css) and the semantic roles in the [iPhone theme](../mobile/src/theme.ts). Keep role names and intent aligned while using native navigation, sheets, focus, and gestures on each platform. Prefer extending the current shared components over a new UI framework or a second component family.

Validate shared components across Home, Activity, and Review together: overview, dense data, and repeated decisions. Cover light/dark and Hebrew/English states, including a narrow desktop window. Update the platform guides alongside behavior changes.

Acceptance covers selection and focus visibility, full monetary values, coherent chart/list filters, draft preservation, loading/error/empty/partial data states, keyboard paths, reduced motion, and mobile text scaling. Use the existing [synthetic QA](development.md#synthetic-ui-qa); keep personal data and exploratory screenshots outside the repository.
