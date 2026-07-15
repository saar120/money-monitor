# Screen map

All images below are canonical files under `docs/ios-mockups`; the Xcode folder does not duplicate them.

Implementation ownership, related user stories, contract boundaries, and required evidence for every screen are tracked in [Specification traceability](../Specification/TRACEABILITY.md).

| # | Screen | Reference | SwiftUI ownership | Phase |
| --- | --- | --- | --- | --- |
| 1 | Welcome | [welcome.png](../../docs/ios-mockups/rendered/screens/welcome.png) | `Features/Onboarding` | 1 |
| 2 | Connect to Mac | [connect.png](../../docs/ios-mockups/rendered/screens/connect.png) | `Features/Onboarding` + `Core/Security` | 1 |
| 3 | Protect with Face ID | [faceid.png](../../docs/ios-mockups/rendered/screens/faceid.png) | `Features/Onboarding` + `Core/Security` | 1 |
| 4 | Connected and ready | [ready.png](../../docs/ios-mockups/rendered/screens/ready.png) | `Features/Onboarding` | 1 |
| 5 | Home | [home.png](../../docs/ios-mockups/rendered/screens/home.png) | `Features/Home` | 2 |
| 6 | Activity | [activity.png](../../docs/ios-mockups/rendered/screens/activity.png) | `Features/Activity` | 2 |
| 7 | Search | [search.png](../../docs/ios-mockups/rendered/screens/search.png) | `Features/Activity` | 2 |
| 8 | Transaction detail | [transaction.png](../../docs/ios-mockups/rendered/screens/transaction.png) | `Features/Activity` | 2 read / 4 edit |
| 9 | Filters sheet | [filters.png](../../docs/ios-mockups/rendered/screens/filters.png) | `Features/Activity` | 2 |
| 10 | Review queue | [review.png](../../docs/ios-mockups/rendered/screens/review.png) | `Features/Activity/Review` | 4 |
| 11 | Plan | [plan.png](../../docs/ios-mockups/rendered/screens/plan.png) | `Features/Plan` | 3 |
| 12 | Budget detail | [budget-detail.png](../../docs/ios-mockups/rendered/screens/budget-detail.png) | `Features/Plan/Budgets` | 3 |
| 13 | Edit budget | [budget-edit.png](../../docs/ios-mockups/rendered/screens/budget-edit.png) | `Features/Plan/Budgets` | 4 |
| 14 | Net Worth | [net-worth.png](../../docs/ios-mockups/rendered/screens/net-worth.png) | `Features/Plan/NetWorth` | 3 |
| 15 | Asset detail | [asset-detail.png](../../docs/ios-mockups/rendered/screens/asset-detail.png) | `Features/Plan/NetWorth` | 3 read / 4 edit |
| 16 | Advisor | [advisor.png](../../docs/ios-mockups/rendered/screens/advisor.png) | `Features/Advisor` | 5 |
| 17 | Advisor conversation | [advisor-chat.png](../../docs/ios-mockups/rendered/screens/advisor-chat.png) | `Features/Advisor` | 5 |
| 18 | Accounts | [accounts.png](../../docs/ios-mockups/rendered/screens/accounts.png) | `Features/Accounts` | 3 |
| 19 | Account detail | [account-detail.png](../../docs/ios-mockups/rendered/screens/account-detail.png) | `Features/Accounts` | 3 read / 4 commands |
| 20 | Sync history | [sync-history.png](../../docs/ios-mockups/rendered/screens/sync-history.png) | `Features/Accounts` | 3 read / 4 sync command |
| 21 | Categories | [categories.png](../../docs/ios-mockups/rendered/screens/categories.png) | `Features/Settings/Categories` | 4 |
| 22 | Alerts | [alerts.png](../../docs/ios-mockups/rendered/screens/alerts.png) | `Features/Settings/Alerts` | 4 |
| 23 | Settings | [settings.png](../../docs/ios-mockups/rendered/screens/settings.png) | `Features/Settings` | 4 |
| 24 | Mac unavailable | [offline.png](../../docs/ios-mockups/rendered/screens/offline.png) | `Features/Resilience` | 1 |
| 25 | Home, Dark Mode | [home-dark.png](../../docs/ios-mockups/rendered/screens/home-dark.png) | Same `Home` view and semantic tokens | 6 coverage |
| 26 | Advisor conversation, Dark Mode | [advisor-dark.png](../../docs/ios-mockups/rendered/screens/advisor-dark.png) | Same `Advisor` view and semantic tokens | 6 coverage |

## Navigation ownership

- Root tabs: Home, Activity, Plan, Advisor.
- Trailing system Search tab: transaction search.
- Profile toolbar: Accounts, Categories, Alerts, Settings.
- Account rows push Account detail; freshness links push Sync history.
- Plan pushes Budget detail, Net Worth, and Asset detail.
- Transaction and asset edits use task-focused sheets.
- Mac unavailable is a root application state, not a fifth tab or modal interruption.

Dark Mode references validate the token system; they are not separate screen implementations.

## Missing state references to design during implementation

- Initial loading and skeleton behavior.
- First-use empty data for accounts, transactions, budgets, assets, and Advisor sessions.
- Inline server, validation, and decode errors.
- Authentication revoked and incompatible Mac app.
- Partial bootstrap response.
- Destructive confirmations and mutation conflicts.
- Face ID denied, unavailable, and locked-out states.
- Sync running, waiting for OTP/manual attention, partially failed, cancelled, and queued states.

These should reuse system patterns and the rules in [Interactions and states](INTERACTIONS_AND_STATES.md), not introduce a new decorative visual language.
