# Migrated desktop UI layout audit

Completed 2026-10-12 on `codex/fix-migrated-layouts`, based on the migrated UI in `codex/pr-130-motion` (`2388111`). The original task checkout contained the older interface; the installed app and supplied screenshot were checked before switching to the migrated source.

Three subagents audited separate screen groups; the parent handled shared components, Explore screens, integration, and browser verification. Changes preserve the migrated visual design and existing data flows.

## Findings and changes

| Screen / component                       | Finding                                                                              | Change                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Navigation                               | Planning and management routes start collapsed                                       | Navigation remains always visible, preserving the newer `mm_revamped` navigation simplification                                                              |
| Review                                   | Missing table gutters; Hebrew cell direction pushes text against adjacent categories | Explicit column sizing, cell padding, content-only bidi isolation, visible row-open control, keyboard support                   |
| Activity                                 | Crowded toolbar and review markers; advanced table hidden at narrow widths           | Wrapping toolbar, separated indicators, visible advanced link, clear focus styles                                               |
| Advanced transactions                    | Date/statistics actions require right-click; menu can escape viewport                | Persistent actions button, clamped menu position, initial focus, arrow keys, Escape with focus return; readable scrolling table |
| Advanced review                          | Crowded descriptions/reasons and icon-only confirmation                              | Readable cells, labeled confirmation, wrapping pagination                                                                       |
| Categories                               | Row editing has weak affordance; narrow column pressure                              | Visible edit control, bidi isolation, responsive grid and inspector                                                             |
| Advanced categories                      | Rules truncate and icon controls lack names                                          | Readable rules, accessible controls, scrolling table with minimum useful height                                                 |
| Home                                     | Mobile rail and stats remain in cramped columns                                      | Single-column narrow layout and isolated financial totals                                                                       |
| Explore / category / merchant            | Category title and month selector overflow narrow windows                            | Wrapping headings, constrained month controls, responsive summary actions and list values                                       |
| Monthly comparison / cash flow           | Narrow controls and list values need room                                            | Shared wrapping headings, range controls, row values and compact chart labels                                                   |
| Net worth                                | Asset, holding and liability actions are hover-only; expanded holdings clipped       | Persistent named actions, keyboard expansion/navigation, uncapped content, local scrolling, wrapping rows                       |
| Asset detail: brokerage / crypto         | Mobile quick-update lacks inputs; mobile holding actions missing                     | Existing editable table available on phones, visible mobile actions, readable dialogs and history controls                      |
| Asset detail: real estate / simple value | Fixed action/header layouts                                                          | Wrapping controls and bounded scrolling dialogs                                                                                 |
| Budgets / budget transactions            | Hover-only edit/delete, toolbar clipping, fixed summaries                            | Persistent named actions, wrapped toolbar, responsive summaries/forms, isolated money/date text                                 |
| Subscriptions                            | Dense ledger becomes unreadable at small widths                                      | Readable minimum table width with local scrolling, logical RTL alignment and wrapping details                                   |
| Accounts / advanced accounts             | Hover-only rename; crowded forms/actions; errors outside inspector                   | Visible named actions, responsive forms, inspector errors, Escape dismissal and long-text wrapping                              |
| Settings / household / mobile access     | Label/control rows overflow; fixed grids and device rows                             | Shared responsive settings rows, wrapping rules/device controls, bounded QR image and readable paths                            |
| Alerts                                   | Nested scrolling complicates short windows                                           | Single page scrolling and wrapping toolbar                                                                                      |
| Account sync / import                    | Compact history loses result context; long logs and import content overflow          | Visible result summaries, wrapping logs, bounded import body with stable header/footer and keyboard file focus                  |
| Advisor / history                        | Hover-only delete; inaccessible compact history                                      | Native sibling buttons, visible delete actions and compact history overlay with close/backdrop                                  |
| Setup / period picker                    | Fixed padding/provider rows; small unlabeled arrows                                  | Responsive padding and buttons; named larger period controls                                                                    |
| Shared dialogs / selects                 | Long dialogs exceed viewport; obsolete CSS variable utility syntax                   | Viewport-bounded dialog scrolling, corrected select sizing and available-height limits                                          |
| Markdown / RTL                           | Scoped global selector can style the root instead of the intended element            | Complete target included in global selector; verified the HTML root has no transform                                            |

## Verification

- Production dashboard build (Vue TypeScript + Vite): passed.
- ESLint on changed Vue files: zero errors; six existing warnings remain (three `any` types, two template shadowing warnings and one optional prop default).
- `git diff --check`: passed.
- Rendered all 19 primary/advanced screens at 1440×1000 and 390×844 using synthetic data. Also checked setup, category/merchant details, and all four asset detail presentations at narrow width.
- No root page overflow was found. Fixed the additional Budget toolbar and category-heading overflow exposed by the narrow pass. Dense tables intentionally scroll inside their own containers.
- Checked English and Hebrew, dark and light themes. Review now has a 320px details column with 24px interior insets, lighter row selection, inline fields, and content-sized desktop height. Every table cell has 16px padding, including the first and last columns.
- End-to-end smoke: selected and confirmed a demo transaction category; Review reached its empty state.
- Transaction actions menu: opened from its visible button at phone width, remained inside the viewport, focused its first action and returned focus to its trigger on Escape.
- Budget editor and its select menu remained visible at phone width.
- Brokerage and crypto quick-update showed editable quantity/price inputs on phones. Net worth holdings expansion and Add menu worked.
- Desktop-mode settings sections were rendered from a separate disposable temporary data directory; all nine sections fit the narrow content column.

## App-wide visual refinement

The user's annotated screenshots exposed a design regression beyond overflow: migration styles deliberately removed outer row padding, and the first refinement repeated that mistake in Review. Removed those flush-edge rules across ledgers, accounts, charts, alerts, and asset sections. Shared table cells now have 16px gutters; standard inputs, selects, and buttons have readable 14px text and comfortable heights. Settings groups use open sections and separators instead of stacked rounded cards.

Three agents refined finance, management, and transaction screens with separate file ownership. Replaced decorative nested cards with semantic sections while preserving interior padding, aligned headings/actions, improved small labels and form spacing, removed doubled separators, and kept visible menus and keyboard behavior. Two malformed Net Worth conditions left by an interrupted template conversion were repaired before the production build.

Rechecked 15 primary routes and nine advanced/detail/setup routes at desktop and phone sizes. All checked routes had zero page overflow. Also checked crypto and pension details on phones. Rechecked all 15 primary routes in Hebrew/light at both sizes with zero page overflow. Captured synthetic screenshot galleries outside the repository for visual inspection. Dense ledgers retain deliberate local horizontal scrolling.

Additional interaction checks: phone Budget dialog and Period dropdown stayed inside the viewport; Brokerage quick-update exposed all six editable quantity/price inputs in a local scroll region; Activity and Category inspectors retained their padded controls and visible footer actions; the visible transaction actions menu stayed inside the phone viewport and Escape restored focus to its trigger.

The theme/language pass also exposed cached dropdown labels after a live language change. Select items now remount their registration when the app language changes, preserving the selected value and refreshing the label/typeahead text. Verified Hebrew → English refresh. Menu item insets now follow RTL direction and have larger hit areas.

## Limits

The installed app was inspected as the reference; these changes have not been packaged or installed over it. OS integrations (bank login, OAuth, Tailscale pairing, updater and file import execution) were reviewed in source but not exercised against real accounts or devices. Financial data and credentials were not used for QA; sample data and temporary configuration stayed outside the tracked changes. No new dependencies were added.

## Branch integration

Applied to `mm_revamped` on 2026-10-13, preserving its newer always-visible navigation and compact Activity header while retaining wrapping and padded content. The target worktree lacked the QR-code dependency locally; the combined dashboard was validated in an isolated temporary copy using the already installed project dependencies.
