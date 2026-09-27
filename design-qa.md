# Split-view prototype design QA

**Final result: passed** for the isolated Activity prototype.

## Visual comparison

- Selected concept: `docs/prototypes/desktop-redesign/01-native-split-view.png` (1487 × 1058).
- Browser capture: `docs/prototypes/desktop-redesign/working-rtl-1440.png` (1440 × 1024).
- Side-by-side review: `docs/prototypes/desktop-redesign/source-vs-working-rtl.png`.
- Additional captures: `working-en-1440.png`, `working-rtl-900.png`, and `working-rtl-900-inspector.png` in the same directory.

The implementation follows the selected three-pane composition: navigation, centered Activity table, and transaction inspector. The RTL order puts navigation on the right and the inspector on the left; English mirrors it. Table headers and data cells use the same column widths. At 1440 px, the table has equal 25 px margins within its 910 px workspace. At 900 px, the 797 px table has equal 17 px margins within its 831 px workspace. Document width never exceeds the viewport in these captures.

The concept image includes decorative Mac window controls, a calendar shortcut, and a review badge on its selected sample transaction. The browser prototype relies on the host window controls and actual transaction data, so these elements differ. The chosen structure, hierarchy, color, table density, row grouping, and inspector placement are preserved.

## Interaction check

- Hebrew and English captures render with the intended mirrored layout.
- At 900 px, the full table is visible before selection. Selecting a row opens a dismissible inspector sheet.
- Category filter returns the expected five September subscription transactions.
- Previous-month control changes September to August 2026.
- Inspector note save updates only the prototype view; reload resets it.
- Reduced-motion preference removes the inspector entrance animation.

The route is development-only (`/prototype/split-view`). Inspector edits remain in memory so visual review cannot alter financial records.

## App-wide implementation

The selected split-view direction is now the production desktop layout. The shared shell uses a pale navigation sidebar and a centered white workspace. Activity and Categories use a trailing inspector; Review uses the same list-and-inspector pattern for pending transactions. Home, Explore, Cash Flow, Monthly Spending, Budgets, Subscriptions, Net Worth, Accounts, Alerts, Account Sync, Advisor, and Settings use the same typography, spacing, separators, and toolbar patterns. The former dense tables and category tools remain available on advanced routes.

### Screenshots

`docs/screenshots/desktop-redesign/app-wide-v2/` contains 16 Hebrew desktop captures, five English desktop captures, and five Hebrew narrow-window captures. Key views: `he-home.png`, `he-activity.png`, `he-categories.png`, `he-net-worth.png`, `he-settings.png`, `en-activity.png`, and `he-900-activity.png`. Captures use isolated sample data, never live financial data.

The same directory also contains Category, Merchant, and Asset detail captures, advanced Review, Categories, and Accounts captures, the first-run Setup screen, and narrow-window Categories and Accounts inspector captures.

### Checks

- All 16 primary routes and seven additional drill-down, advanced, or setup routes loaded at 1440 × 900 with no browser JavaScript errors or document-level horizontal overflow. The five selected routes and Categories and Accounts inspectors at 900 × 700 also had no document-level horizontal overflow.
- RTL puts the navigation on the right and detail inspectors on the left. LTR reverses the arrangement. The Activity table stays centered in its workspace at both checked widths.
- Activity inclusion, Category label, and Account name edits were saved through the API, read back, and restored in the isolated demo. The Account add action opened the full management dialog. A Category transaction link selected the referenced Activity row.
- The net worth sample property valuation was corrected so the current headline and asset list use the stored property price. The legacy property case has a regression test.
- Production build and the full test suite pass (62 files, 640 tests). The browser smoke test also passed Activity, Categories, and Accounts save and restore flows.

The demo currently has no Review queue items, so the Review empty state was visually checked; its confirm action was not exercised in this browser pass. Some advanced dialogs retain English text and the sample financial labels are mixed Hebrew and English.

## Alignment follow-up — 27 September 2026

Fresh proof is in [the QA screenshot gallery](docs/screenshots/desktop-redesign/qa-20260927/README.md). The pass covered Hebrew Activity at 1440 and 600 pixels, Hebrew Explore, merchant detail and Alerts at 1440 pixels, and English Home at 1440 pixels.

- Centered the capped-width Explore list, monthly category breakdown, and merchant transaction heading and list within the available workspace.
- Corrected the toolbar's physical/logical margin conflict so actions sit on the outside edge in both Hebrew and English.
- Gave Alerts a full-width flex basis up to its 672-pixel cap and changed SettingsRow's trailing control margin to a logical margin. This keeps form labels and controls aligned in RTL.
- Fixed Activity at 600 pixels: the hidden date cell had left its `<col>` in the table, causing the merchant column to collapse to zero width. The compact view now shows merchant, category and amount.
- Astra's independent screenshot review found three further RTL row alignments: Explore labels detached from their color markers, merchant names at the opposite edge from their heading, and Alerts section headings at the opposite edge from field labels. All three were corrected and Astra confirmed the refreshed captures show them resolved.

The dashboard production build passes. The six fresh screenshots show no document-level horizontal overflow or page JavaScript errors. They do not establish keyboard or screen-reader accessibility compliance; those need separate interaction checks.
