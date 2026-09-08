# Expo feasibility result

## Concrete result

Home, Activity, transaction detail, native search, filters, dark mode, mixed Hebrew/English content, iOS tab navigation, secure storage, authentication gate, app-switcher protection, and QR scanning were implemented in the permanent `mobile/` app. The Release simulator build succeeds. TypeScript and QR parser tests pass. Expo Doctor passes 21/21 checks. The deterministic Maestro suite covers both primary features, every tab, a needs-attention scenario, and the real secure-storage lifecycle.

A physical iPhone exposed an upstream build-toolchain constraint: an Expo SDK 57 app linked with Xcode 27 beta traps before React starts because the generated native shell does not yet adopt the `UIScene` lifecycle required by the iOS 27 SDK. Building the unchanged app with Xcode 26.6/iOS 26.5 and installing it with Xcode-beta's device tools fixed the launch; the exact device process remained alive across repeated checks. No speculative `SceneDelegate` patch was added. Track Expo/React Native's scene-lifecycle support before Xcode 27 becomes mandatory.

`npm audit --omit=dev` currently reports moderate advisories in Expo Router's query-string dependency and Expo's build tooling. npm proposes incompatible SDK downgrades rather than a valid patch, so no forced audit rewrite was applied; track these with Expo SDK updates.

The current Mac's unmodified Mobile Access implementation was observed bound to `127.0.0.1`, with Tailscale Serve proxying `/money-monitor` over HTTPS. The live endpoint returned the expected `status: ok` envelope, and the iPhone client's actual `checkMobileHealth` function returned `reachable: true` against that URL. No desktop files or security settings were changed.

The final camera handoff could not be completed in this run: the available simulator has no camera input, the physical iPhone Tailnet peer was offline, and the Mac was locked before a Mac-generated QR could be scanned. A successful-connectivity screenshot has therefore not been fabricated.

## Size

- Handwritten application TS/TSX: approximately 1,730 lines (excluding tests).
- Direct runtime dependencies: 23. Most are Expo/React navigation and native-module peers; Victory Native accounts for Skia, Reanimated, Gesture Handler, and Worklets.
- Handwritten Swift/Objective-C: 0 lines.
- E2E: Maestro CLI; no in-app instrumentation and no npm E2E dependency.

## Foundation disposition

| Foundation | Disposition | Evidence / follow-up |
| --- | --- | --- |
| Expo + TypeScript | Keep with small follow-up | Release build, typecheck, and Expo Doctor pass; use Xcode 26.6 until the Expo shell supports Xcode 27's required `UIScene` lifecycle. |
| Expo Router tabs/stacks | Keep as-is | All routes are reachable through E2E. |
| Home/Activity feature-local code | Keep as-is | Direct, readable screens with no state framework. |
| Typed fixture scenarios | Keep as-is | Same UI supports normal and needs-attention launches. |
| Victory Native chart | Keep with small follow-up | Polished light/dark output; recheck binary/build cost before adding more charts. |
| Maestro E2E | Keep as-is | Deterministic product flows and Keychain lifecycle pass without external services. |
| SecureStore | Keep as-is | Store/read/delete succeed in the installed native app. |
| Face ID/device auth | Keep with small follow-up | Hardware testing found and fixed an `AppState` reauthentication loop; complete the background/relock observation. |
| App-switcher privacy | Keep with small follow-up | Expo protection enabled; inspect a real device snapshot before release. |
| QR scanner/parser | Keep with small follow-up | Camera UI and strict parser implemented; scan the real Mac QR on hardware. |
| Existing Tailscale health connectivity | Keep with small follow-up | Live HTTPS and client request function succeed; physical scan is outstanding. |

No implemented foundation currently requires replacement.

## Scores (1–5)

| Area | Score |
| --- | ---: |
| UI quality | 5 |
| Native iPhone feel | 4 |
| Development speed | 5 |
| Code simplicity | 4 |
| AI-agent friendliness | 5 |
| Navigation | 4 |
| Charts | 4 |
| Fixture-based E2E testability | 5 |
| Secure storage | 5 |
| Face ID | 4 |
| App-switcher privacy | 4 |
| QR | 4 |
| Existing Tailscale connectivity | 3 |
| Hebrew/English handling | 4 |
| Maintainability | 4 |
| Ability to continue directly into production | 4 |

## Decision

**INCONCLUSIVE — one additional experiment is required**

Run one physical-iPhone pass on the same Tailnet: scan the QR created by the currently running Mac Mobile Access UI and confirm the app reaches the live health endpoint. In that same hardware run, observe the Face ID prompt and app-switcher snapshot. If those three native observations succeed, continue directly in this codebase; no MVP rewrite is indicated by the work completed here.
