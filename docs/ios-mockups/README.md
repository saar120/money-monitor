# Money Monitor iOS Mockups

This package contains a complete high-fidelity mockup set for a native iPhone version of Money Monitor. The Mac remains the source of truth and the only device that stores bank credentials or scrapes institutions. The iPhone connects privately to the Mac, presents a mobile read model, and keeps a clearly timestamped cached snapshot for offline use.

## Research direction

- [Apple: Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios) — focus the interface on primary tasks, reachable controls, Dynamic Type, and platform behavior.
- [Apple: Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) — use a stable tab bar for a maximum of five top-level destinations and the current floating Liquid Glass treatment.
- [Apple: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) — reserve Liquid Glass for controls and navigation, not the content layer.
- [Apple WWDC26: Design intuitive search experiences](https://developer.apple.com/videos/play/wwdc2026/292/) — match Search material to its placement and use the trailing Search tab for immediate global lookup.
- [Apple WWDC26: Communicate your brand identity on iOS](https://developer.apple.com/videos/play/wwdc2026/251/) — separate the native UI layer from the branded content layer and preserve familiar platform controls.
- [Apple: Charts](https://developer.apple.com/design/human-interface-guidelines/charts) — prioritize data, maximize compact plot width, and provide accessible summaries and Audio Graphs.
- [2026 Apple Design Awards](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/) — use current award-winning work as a quality bar for interaction, accessibility, and visual craft.
- [Moonlitt](https://apps.apple.com/us/app/moonlitt-moon-phase-tracker/id6444718902) — borrow the separation between immersive content and a small set of easy-reach glass controls.
- [Tide Guide](https://apps.apple.com/us/app/tide-guide-charts-tables/id1406371071) — borrow crisp data presentation, restrained chart color, and navigation that does not compete with content.
- [Structured](https://apps.apple.com/us/app/structured-daily-planner-todo/id1499198946) — borrow a strong single-column hierarchy with minimal surface nesting.
- [The Outsiders](https://apps.apple.com/us/app/the-outsiders-athlete-tracker/id6751584800) — borrow the discipline of showing a few selected metrics and simple trends rather than giving every data point equal weight.

The resulting visual rule is simple: flat financial content, one restrained semantic tint system, and Liquid Glass only where the interface navigates or acts.

## Information architecture

| Existing desktop area | Native iOS destination |
| --- | --- |
| Overview | Home tab |
| Transactions | Activity tab, Search, transaction detail, filters |
| Budgets | Plan tab and budget detail/edit sheets |
| Net Worth | Plan tab and Net Worth detail |
| Insights | Review queue surfaced on Home and Activity |
| AI Chat | Advisor tab |
| Accounts | Profile hub, Accounts, and Account detail |
| Scraping | Accounts freshness state and Sync History |
| Categories | Profile hub → Categories |
| Alerts | Profile hub → Alerts |
| Settings | Profile hub → Settings |

## Screen inventory

### Setup and trust

1. Welcome and privacy promise
2. Connect to the Mac
3. Protect with Face ID
4. Connected and ready

### Everyday money

5. Home
6. Activity
7. Search
8. Transaction detail
9. Filters sheet
10. Review queue

### Planning and wealth

11. Plan
12. Budget detail
13. Edit budget sheet
14. Net Worth
15. Asset detail

### Advisor and control

16. Advisor home
17. Advisor conversation
18. Accounts
19. Account detail
20. Sync history
21. Categories
22. Alerts
23. Settings
24. Mac unavailable / cached-data state

### Appearance coverage

25. Home in Dark Mode
26. Advisor conversation in Dark Mode

## Files

- `index.html`, `styles.css`, and `mockups.js` are the editable mockup source.
- `rendered/boards/` contains five overview boards.
- `rendered/screens/` contains every screen as an individual PNG.
- `PRODUCT.md` captures the product and trust boundary.
- `DESIGN.md` captures the native iOS visual system.

Open `index.html` directly in a browser to view the full deck. Query parameters such as `?screen=home` or `?board=everyday` isolate a single screen or board.
