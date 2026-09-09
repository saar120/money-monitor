# Architecture

Money Monitor iPhone is a thin Expo/React Native client. Expo Router supplies one root stack and three stable destinations: Home, Activity, and Explore. Review is a focused stack workflow launched from Home or Activity. There is no app-wide state framework, repository layer, generated client, or generic feature framework.

`MoneyDataProvider` owns the shared client concerns: reading the paired-Mac credential, loading bootstrap and overview projections, remembering the last successful visit, and invalidating data after a review action. Activity's hooks call the authenticated transaction list/detail routes, including server-side search and filters. Normal launches use live mode; fixture-driven E2E sets `MM_FIXTURE_SCENARIO` as an iOS launch argument and drives the same screens without a Mac.

The Mac mobile API stays intentionally small: bootstrap for identity/freshness, overview for Mac-calculated cashflow, pace, categories, merchants, budgets, visit changes, and net worth, plus transaction reads and narrowly scoped review writes. Home renders the overview as a calm status statement. Explore uses Victory Native with Skia for an interactive spending-pace chart and deterministic category → merchant → transaction drill-down. Activity uses an iOS native navigation search bar and `SectionList`; Review uses a native page sheet, haptics, and one-at-a-time progress.

Native feasibility remains Expo-managed:

- `expo-secure-store` stores the pairing credential with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and exposes explicit store/read/delete functions.
- `expo-local-authentication` gates the root financial UI and relocks after backgrounding, with device-passcode fallback.
- `expo-screen-capture` enables iOS app-switcher snapshot protection at the root.
- `expo-haptics` supplies restrained selection and completion feedback in Review and chart scrubbing.
- `expo-camera` scans QR codes. The scanner validates the Mac's version-1 payload, checks health, requests approval, polls, exchanges, stores the credential, and reloads live data. Each network request has a bounded timeout and verifies the authenticated server identity.

Maestro drives the installed Release app without instrumentation. It controls only fixture selection; navigation and UI are the same code production uses. QR/Tailscale remains a separate physical integration check by design.
