# Desktop redesign QA

**Final result: passed** for the isolated Activity prototype.

## Visual proof

Three final captures use isolated sample data:

- [Hebrew Activity, desktop](docs/screenshots/desktop-redesign/qa-20260927/01-he-activity.png)
- [Hebrew Activity, compact window](docs/screenshots/desktop-redesign/qa-20260927/05-he-activity-compact.png)
- [English Home, desktop](docs/screenshots/desktop-redesign/qa-20260927/06-en-home.png)

The selected split-view layout puts navigation on the right and the inspector on the left in Hebrew; English mirrors it. The Activity table stays centered in its workspace, and compact windows keep the merchant, category, and amount columns readable.

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

### Visual coverage

The three retained captures above show the final RTL desktop and compact Activity layouts and the English shell. The broader route checks are recorded below without committing every intermediate capture.

### Checks

- All 16 primary routes and seven additional drill-down, advanced, or setup routes loaded at 1440 × 900 with no browser JavaScript errors or document-level horizontal overflow. The five selected routes and Categories and Accounts inspectors at 900 × 700 also had no document-level horizontal overflow.
- RTL puts the navigation on the right and detail inspectors on the left. LTR reverses the arrangement. The Activity table stays centered in its workspace at both checked widths.
- Activity inclusion, Category label, and Account name edits were saved through the API, read back, and restored in the isolated demo. The Account add action opened the full management dialog. A Category transaction link selected the referenced Activity row.
- The net worth sample property valuation was corrected so the current headline and asset list use the stored property price. The legacy property case has a regression test.
- Production build and the full test suite pass (62 files, 640 tests). The browser smoke test also passed Activity, Categories, and Accounts save and restore flows.

The demo currently has no Review queue items, so the Review empty state was visually checked; its confirm action was not exercised in this browser pass. Some advanced dialogs retain English text and the sample financial labels are mixed Hebrew and English.

## Alignment follow-up — 27 September 2026

The final visual pass covered Hebrew Activity at 1440 and 600 pixels, Hebrew Explore, merchant detail and Alerts at 1440 pixels, and English Home at 1440 pixels. Three representative captures are linked above.

- Centered the capped-width Explore list, monthly category breakdown, and merchant transaction heading and list within the available workspace.
- Corrected the toolbar's physical/logical margin conflict so actions sit on the outside edge in both Hebrew and English.
- Gave Alerts a full-width flex basis up to its 672-pixel cap and changed SettingsRow's trailing control margin to a logical margin. This keeps form labels and controls aligned in RTL.
- Fixed Activity at 600 pixels: the hidden date cell had left its `<col>` in the table, causing the merchant column to collapse to zero width. The compact view now shows merchant, category and amount.
- Astra's independent screenshot review found three further RTL row alignments: Explore labels detached from their color markers, merchant names at the opposite edge from their heading, and Alerts section headings at the opposite edge from field labels. All three were corrected and Astra confirmed the refreshed captures show them resolved.

The dashboard production build passes. The visual pass found no document-level horizontal overflow or page JavaScript errors. This does not establish keyboard or screen-reader accessibility compliance; those need separate interaction checks.
