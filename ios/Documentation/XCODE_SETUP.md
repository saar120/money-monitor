# Xcode setup

## Supported toolchain

- Xcode 26.6 or newer stable Xcode 26 release.
- iOS 26 SDK for the current system appearance.
- Minimum deployment target: iOS 18.0.
- Swift 6 language mode.
- SwiftUI app lifecycle.

The project specification is [`ios/project.yml`](../project.yml). XcodeGen 2.45 or later is the reproducible project generator used in this repository.

## Generate the project

```sh
cd ios
xcodegen generate
open MoneyMonitor.xcodeproj
```

Do not hand-edit `project.pbxproj` for settings that belong in `project.yml`. Xcode-managed signing selections and local user state may remain local.

## First local run

1. Select the `MoneyMonitor` scheme.
2. Pick an iOS 18+ simulator.
3. Build and run.
4. The starter opens the Connect to Mac screen.
5. A manual Money Monitor Tailscale base address can exercise `GET /api/mobile/v1/health` once Mobile Access is enabled on the Mac.

## Device signing

1. Replace `com.example.MoneyMonitor` and both test bundle identifiers in `project.yml`.
2. Regenerate the project.
3. In Signing & Capabilities, enable automatic signing and select your team.
4. Enable Developer Mode on the iPhone when prompted.
5. Install Tailscale on both devices and sign them into the same Tailnet.

A free Personal Team is sufficient for early device tests, but provisioning is short-lived and must be renewed. Use a paid team before TestFlight or App Store distribution.

## Project conventions

- One production application target, one unit/integration test target, and one UI test target.
- Feature-first source organization with shared infrastructure under `Core`.
- No third-party package dependency until a concrete requirement justifies it.
- `URLSession`, Swift Concurrency, Swift Charts, LocalAuthentication, Security/Keychain, and CryptoKit are the preferred system frameworks.
- Use asset catalog colors and SF Symbols; do not export web mockup icons into the app.
- Keep preview and test data in fixtures, clearly separated from live models.

## Liquid Glass compatibility

Use standard `NavigationStack`, `TabView`, `Tab`, `.searchable`, toolbars, sheets, lists, and buttons first. They receive the current system appearance on iOS 26.

The following APIs are iOS 26 enhancements and must be guarded with availability checks if introduced:

- `glassEffect(_:in:)`
- `GlassEffectContainer`
- `.buttonStyle(.glass)` and `.buttonStyle(.glassProminent)`
- `.tabBarMinimizeBehavior`
- `.searchToolbarBehavior`
- `.tabViewBottomAccessory`

Do not manually recreate the system tab bar or place glass behind financial content.

## Build verification

From the repository root:

```sh
xcodegen generate --spec ios/project.yml
xcodebuild \
  -project ios/MoneyMonitor.xcodeproj \
  -scheme MoneyMonitor \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/MoneyMonitorDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Run unit tests on an installed simulator runtime. Connectivity acceptance must use a physical iPhone because Simulator shares important parts of the Mac environment.
