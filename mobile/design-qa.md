# Blue Ledger production design QA

Final result: passed

## Target and source

- Production baseline: PR #120 commit `ac44e08008c6f3b4dbaa485b6d8b99338b29bdcd`.
- Target: native Expo iPhone app on iPhone 17 Pro, iOS 26.5, 1206 × 2622 captures.
- Reference: `prototypes/blue-ledger/public/reference-blue-chart.png`, `Prototype.tsx`, `prototype.css`, and the prototype QA record.
- Data state: deterministic production fixtures. No prototype ledger fixtures or literal financial values ship in the app.

## Comparison passes

### Pass 1 — structure and native integration

The approved source and the first simulator build were compared at the same phone aspect ratio. The porcelain/dusk palettes, cobalt chart emphasis, tab material, number hierarchy, quiet rows, and concentric radii matched the selected direction. The first build exposed one production-only issue: iOS 26 placed the navigation-header search control at the bottom, where it collided with the floating tab bar. Activity search was moved into the scrolling content as a native text field, preserving filtering and keyboard behavior while matching the prototype's compact control language.

The chart-first Home hierarchy also moved existing production rows below the first viewport. The sequential Maestro flows were updated to scroll to those unchanged destinations instead of weakening the new hierarchy.

### Pass 2 — production screens, sheets, and motion

The reference and final Home light/dark captures were reviewed together. The final build preserves the source's focal hierarchy and glass treatment while using live production values and routes. Activity and Explore were then reviewed as full screens; review, account attention, category drill-down, category picker, and empty state were checked as focused production states.

No P0, P1, or P2 visual defects remain. Text and values do not clip at the tested iPhone dimensions, floating navigation clears the home indicator, sheets remain within their presentation bounds, and the 20-category grid stays scannable with the keyboard visible or dismissed.

The motion recording exercises Home → Activity → Explore → Home and All → 3M → 6M → All. The range control uses one persistent lens with the approved `300 / 28 / 0.82` spring and switches immediately under Reduce Motion.

### Pass 3 — requested navigation and control refinements

The first production pass was re-audited after Saar's device feedback. Explore still followed the earlier spending-pace composition, shared details were owned by tab-local stacks, the transaction date editor was a full page sheet, the category selector occupied nearly the full display, and the custom tab bar was larger than the current iOS material.

The final pass replaces Explore with the approved cash-flow composition, backed by six calls to the existing month-scoped overview contract. Shared category, merchant, transaction, and net-worth destinations now live on the root stack; Activity and Explore regression flows verify that two consecutive native back swipes restore the exact originating screen rather than changing tabs. The date editor is the compact system control, the searchable 20-category selector is a 55%-height draggable sheet, and Expo Router native tabs provide the iOS Liquid Glass bar and on-scroll minimization. Detail headers use a minimal chevron so no route-group implementation name is exposed.

## Evidence

| State                | Evidence                                                    |
| -------------------- | ----------------------------------------------------------- |
| Home, light          | `docs/screenshots/blue-ledger/home-light.png`               |
| Home, dusk           | `docs/screenshots/blue-ledger/home-dark.png`                |
| Activity, light      | `docs/screenshots/blue-ledger/activity-light.png`           |
| Activity, dusk       | `docs/screenshots/blue-ledger/activity-dark.png`            |
| Explore, light       | `docs/screenshots/blue-ledger/explore-light.png`            |
| Explore, dusk        | `docs/screenshots/blue-ledger/explore-dark.png`             |
| 20-category picker   | `docs/screenshots/blue-ledger/category-picker-light.png`    |
| Compact date picker  | `docs/screenshots/blue-ledger/date-picker-light.png`        |
| Review               | `docs/screenshots/blue-ledger/review-light.png`             |
| Account attention    | `docs/screenshots/blue-ledger/account-attention-light.png`  |
| Category drill-down  | `docs/screenshots/blue-ledger/category-drilldown-light.png` |
| Empty state          | `docs/screenshots/blue-ledger/activity-empty-light.png`     |
| Tab and range motion | `docs/screenshots/blue-ledger/tab-range-lens-motion.mp4`    |

## Intentional production divergences

- The prototype's sample financial claims, forecast copy, profile, and payment-reminder content were not copied because those values do not exist in the production contracts.
- Home uses the Mac overview's available budget when present and otherwise leads with posted spending. The chart uses the overview trend and pace fields.
- Explore's range uses repeated calls to the existing `overview?month=YYYY-MM` contract rather than a new aggregate endpoint. Each bar is a server-provided posted income or spending total; the phone only subtracts those two values for the labeled cash-flow amount.
- Recent categories are omitted because the production option contract does not provide recency. The picker shows the full real category source, searchable and adaptive, without inventing history.
- Net worth remains in production because its account/valuation-backed contract is authoritative even though the ledger-only prototype excluded it.
- The root tab transition and bar geometry use Apple's current native behavior instead of duplicating the prototype's exact custom spring. The Explore/net-worth segmented lenses retain the approved spring constants.
- Existing platform accessibility semantics were preserved for navigation and automation. Per Saar's follow-up, no separate accessibility-polish audit was performed.

## Verification record

- TypeScript: passed.
- Mobile-scoped ESLint (`npx eslint mobile`): passed. The repository-wide lint command still reports nine pre-existing errors outside `mobile/`.
- Node contract/fixture tests: 13/13 passed.
- Expo Doctor: 21/21 passed after aligning the three Expo SDK 57 patch versions.
- Native iOS Release build: passed with 0 errors.
- Sequential Maestro production flows: 10/10 passed.
- Dedicated native-tab/range motion flow: passed.
- Runtime scan: no React Native JS exception, unhandled error, invariant violation, or RedBox entries. Simulator-only XCTest, focus, and unavailable-haptics warnings were observed during automation.
- Signed physical-device Release build: passed for `arm64` with bundle identifier `com.saaramrani.moneymonitor.mobile` and team `CVP2NVLKL4`.
- Physical device: Release app installed and launched successfully on the paired iPhone 17 Pro running iOS 27.0; CoreDevice verified `Money Monitor` 1.0.0 (`com.saaramrani.moneymonitor.mobile`, build 1).
