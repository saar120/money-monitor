# Architecture

Money Monitor iPhone is a thin Expo/React Native client. Expo Router supplies one root stack and a stable four-tab navigator. Each tab owns its local screens: Home renders the financial overview, Activity owns search/filter/list/detail, and Plan/Advisor are honest placeholders. There is no app-wide state framework, repository layer, dependency injection, generated client, or generic feature framework.

`MoneyDataProvider` owns the one shared live concern: reading the paired-Mac credential and loading the bootstrap snapshot. Home renders that Mac-calculated projection directly. Activity's hooks call the authenticated transaction list/detail routes, including server-side search and filters. Normal launches use live mode; fixture-driven E2E sets `MM_FIXTURE_SCENARIO` as an iOS launch argument and drives the same screens without a Mac.

Home uses ordinary React Native layout for hierarchy, category bars, and freshness rows. The one chart uses Victory Native with Skia, a production-capable stack that supports light/dark rendering. Activity uses an iOS native navigation search bar, a `SectionList`, local component state, and route-based detail navigation.

Native feasibility remains Expo-managed:

- `expo-secure-store` stores the pairing credential with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and exposes explicit store/read/delete functions.
- `expo-local-authentication` gates the root financial UI and relocks after backgrounding, with device-passcode fallback.
- `expo-screen-capture` enables iOS app-switcher snapshot protection at the root.
- `expo-camera` scans QR codes. The scanner validates the Mac's version-1 payload, checks health, requests approval, polls, exchanges, stores the credential, and reloads live data. Each network request has a bounded timeout and verifies the authenticated server identity.

Maestro drives the installed Release app without instrumentation. It controls only fixture selection; navigation and UI are the same code production uses. QR/Tailscale remains a separate physical integration check by design.
