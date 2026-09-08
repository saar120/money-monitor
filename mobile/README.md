# Money Monitor for iPhone

Production-candidate Expo application for the private Money Monitor client. The Mac remains authoritative for data, calculations, credentials, scraping, Advisor, and machine administration.

## Run

Requirements: Node.js, Xcode with an iPhone simulator, and CocoaPods.

```bash
cd mobile
npm install
npm run ios
```

This app uses native Expo modules, so Face ID, secure storage, app-switcher protection, and the camera should be evaluated in a development build rather than Expo Go.

For physical-device builds, use Xcode 26.6 until Expo's generated iOS shell adopts the `UIScene` lifecycle required by the iOS 27 SDK. Xcode 27 beta builds of Expo SDK 57 terminate before React starts; the same app built with the iOS 26.5 SDK runs on iOS 27.

## Deterministic E2E

Install [Maestro](https://docs.maestro.dev/getting-started/installing-maestro), then run:

```bash
cd mobile
npm run e2e:ios
```

The command prebuilds iOS, creates a Release simulator build, then runs the Maestro flows in `e2e/flows`. Tests do not require Money Monitor on the Mac, Tailscale, a network connection, or credentials.

Maestro selects a scenario with the iOS launch argument `MM_FIXTURE_SCENARIO`. The app reads it through React Native's native Settings API; normal production launches use the paired Mac, and no fixture picker is shown. Add a typed scenario beside the existing values in `src/fixtures.ts`, then launch it from a flow like this:

```yaml
- launchApp:
    clearState: true
    arguments:
      MM_FIXTURE_SCENARIO: needs-attention
```

Available scenarios are `normal`, `needs-attention`, and `light-data`. In development builds only, a deep link can also select a scenario: `moneymonitor:///home?fixture=needs-attention`. Release builds ignore fixture URL parameters.

## Real Mac integration check

This is intentionally separate from E2E:

1. Run Money Monitor on the Mac and enable its existing Mobile Access feature.
2. Confirm Tailscale is active on both devices and the iPhone is in the same Tailnet.
3. On the Mac, create the real pairing QR.
4. On iPhone, scan it from Home, Activity, or Advisor.
5. Approve the named iPhone in Mac Settings.
6. The iPhone exchanges the approved request for a device credential, stores it in the iOS Keychain, and loads Home and Activity over authenticated private HTTPS.

The client preserves the `/money-monitor` mount from the QR and never configures Tailscale or weakens TLS. Category breakdown, spending pace, and net-worth decomposition remain fixture-only until the Mac API exposes those Mac-calculated projections.

## Validation

```bash
npm run typecheck
npm test
npx expo-doctor
```

Product screenshots are in [`docs/screenshots`](./docs/screenshots). The feasibility result and limitations are in [`FEASIBILITY.md`](./FEASIBILITY.md).
