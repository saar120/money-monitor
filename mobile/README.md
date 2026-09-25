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

Physical-device builds support Xcode 27 through Expo SDK 57's official `ios.enableSceneSupport` build property. Clean prebuilds generate the required scene manifest and use Expo's scene delegate.

## Product and architecture

Money Monitor for iPhone is a thin, private client of the Mac app. The Mac remains authoritative for financial data, calculations, scraping, AI, credentials, and administration; the phone consumes its authenticated mobile API and stores only its device credential in the iOS Keychain.

- **Home** gives a five-second view of spending, income, pace, budgets, and attention items.
- **Activity** provides searchable, filterable transactions and opens the focused Review workflow.
- **Explore** follows changes through categories, merchants, transactions, cash flow, budgets, and net worth.
- `MoneyDataProvider` owns pairing state, shared overview data, fixture selection, and invalidation after review actions. Feature screens call typed API helpers directly; there is no app-wide state framework or client-side financial calculation layer.

## UI rules

- Use semantic roles from `src/theme.ts`; do not add screen-local canvas or surface colors.
- Cobalt indicates interaction or chart focus. Green, amber, and red are reserved for financial or operational meaning.
- Keep one leading financial statement per viewport, align monetary values, and use tabular numerals.
- Prefer native navigation, sheets, controls, Dynamic Type, VoiceOver semantics, and 44-point targets.
- Reserve Liquid Glass for navigation and compact selection controls—not ordinary content cards.
- Preserve server-defined inclusion, date, owner, pending, transfer, and currency semantics.

## Language

Open the gear on Home (or **Settings** on the connection screen) to choose **System default**, **English**, or **עברית**. The choice is saved on the iPhone. Restart the app after switching between left-to-right and right-to-left navigation so the native tab bar and navigation controls follow the new direction. iOS permission dialogs follow the app language selected in iPhone Settings.

Interface copy lives in `src/translations.ts`. Add an English and Hebrew value for each new message key, then call `t(key)` at the point of use. Pass variable values and counts as options so the two languages can use their own word order and plural forms. System language comes from `expo-localization`.


## Deterministic E2E

Install [Maestro](https://docs.maestro.dev/getting-started/installing-maestro), then run:

```bash
cd mobile
npm run e2e:ios
```

The command prebuilds iOS, creates a Release simulator build, then runs the Maestro flows in `e2e/flows` sequentially so their launch fixtures cannot share simulator state. Tests do not require Money Monitor on the Mac, Tailscale, a network connection, or credentials.

`e2e/flows/11-hebrew-language.yaml` changes the app language to Hebrew, restarts it to apply native RTL navigation, and checks the Activity and Explore routes in demo mode.

Maestro selects a scenario with the iOS launch argument `MM_FIXTURE_SCENARIO`. The app reads it through React Native's native Settings API; normal production launches use the paired Mac, and no fixture picker is shown. Add a typed scenario beside the existing values in `src/fixtures.ts`, then launch it from a flow like this:

```yaml
- launchApp:
    clearState: true
    arguments:
      MM_FIXTURE_SCENARIO: needs-attention
```

Available scenarios are `normal`, `needs-attention`, `light-data`, `review-heavy`, `inbox-zero`, `no-budget`, `no-transactions`, `category-shift`, `slower-spending`, and `mixed-currency`. In development builds only, a deep link can also select a scenario: `moneymonitor:///home?fixture=needs-attention`. Release builds ignore fixture URL parameters.

## Real Mac integration check

This is intentionally separate from E2E:

1. Run Money Monitor on the Mac and enable its existing Mobile Access feature.
2. Confirm Tailscale is active on both devices and the iPhone is in the same Tailnet.
3. On the Mac, create the real pairing QR.
4. On iPhone, scan it from Home or Activity.
5. Approve the named iPhone in Mac Settings.
6. The iPhone exchanges the approved request for a device credential, stores it in the iOS Keychain, and loads Home, Activity, and Explore over authenticated private HTTPS.

The client preserves the `/money-monitor` mount from the QR and never configures Tailscale or weakens TLS. The Mac exposes a purpose-built overview projection; the phone does not reproduce financial calculations.

## Validation

```bash
npm run typecheck
npm test
npx expo-doctor
```
