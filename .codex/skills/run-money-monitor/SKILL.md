---
name: run-money-monitor
description: Build, test, and launch the Money Monitor desktop Electron app or native iOS app locally. Use when asked to run Money Monitor, start Electron development, rebuild iOS, run on a simulator, or install the app on a connected iPhone.
---

# Run Money Monitor

Use the repository containing `package.json` and `ios/MoneyMonitor.xcodeproj`. Inspect `git status --short --branch` before running anything. Do not modify source files, project settings, or lockfiles merely to launch the app.

## Prepare and validate

1. If `node_modules` is absent, run `npm ci`. Do not run `npm audit fix`.
2. Run `npm test` before a launch when practical. Report expected test-fixture logs separately from failures.
3. Check `git status --short` afterwards; builds must not leave tracked changes.

The test suite includes a live Swift-client integration test. If only that test times out while the iOS project builds successfully, report it as an environment-sensitive integration timeout; do not silently treat the suite as fully passing.

## Launch Electron

Run the desktop development build with:

```bash
env -u ELECTRON_RUN_AS_NODE npm run electron:dev
```

Keep the process running when the user asked to use the app. Confirm that Electron starts its local server and serves the dashboard.

`ELECTRON_RUN_AS_NODE=1` makes Electron behave as Node and produces missing exports such as `BrowserWindow`. Clear that variable rather than changing Electron imports or project scripts.

## Build and run iOS

### Choose Xcode explicitly

List available installations first:

```bash
ls -d /Applications/Xcode*.app
```

Use `DEVELOPER_DIR=<chosen Xcode.app>/Contents/Developer` for every Xcode/Xcode command. Do not change the global `xcode-select` setting. Respect the user's requested Xcode; signing accounts can differ between stable Xcode and Xcode Beta.

### Generic device build

Use this when simulator services are unavailable or compile validation is sufficient:

```bash
DEVELOPER_DIR=<developer-dir> xcodebuild -quiet \
  -project ios/MoneyMonitor.xcodeproj \
  -scheme MoneyMonitor \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/moneymonitor-build \
  CODE_SIGNING_ALLOWED=NO build
```

An iOS orientation warning may be emitted; report it, but do not misclassify it as a failed build. Use a temporary Derived Data location so the repository remains clean.

### Simulator

Check availability before selecting a destination:

```bash
DEVELOPER_DIR=<developer-dir> xcrun simctl list devices available
```

If CoreSimulator is unavailable, do not retry indefinitely. Explain the service problem and fall back to the generic-device build. Otherwise use a listed destination with `xcodebuild test` or `xcodebuild build` as requested.

### Physical iPhone

1. Discover destinations with:

   ```bash
   DEVELOPER_DIR=<developer-dir> xcodebuild -showdestinations \
     -project ios/MoneyMonitor.xcodeproj -scheme MoneyMonitor
   ```

2. Confirm the target device is unlocked, has trusted the Mac, and has Developer Mode enabled if iOS requests it.
3. Check signing with `xcodebuild -showBuildSettings`. The current app bundle identifier is `com.example.MoneyMonitor`.
4. Creating or updating a provisioning profile is an external Apple Developer account change. Obtain user authorization before passing `-allowProvisioningUpdates`.
5. Build the signed app for the selected device, then install and launch it:

   ```bash
   DEVELOPER_DIR=<developer-dir> xcodebuild -quiet -allowProvisioningUpdates \
     -project ios/MoneyMonitor.xcodeproj \
     -scheme MoneyMonitor \
     -destination 'id=<device-udid>' \
     -derivedDataPath /private/tmp/moneymonitor-phone build

   DEVELOPER_DIR=<developer-dir> xcrun devicectl device install app \
     --device <device-udid> \
     /private/tmp/moneymonitor-phone/Build/Products/Debug-iphoneos/MoneyMonitor.app

   DEVELOPER_DIR=<developer-dir> xcrun devicectl device process launch \
     --device <device-udid> com.example.MoneyMonitor
   ```

If installation succeeds but launch is denied for an untrusted profile, ask the user to trust the developer app in **Settings → General → VPN & Device Management**. Do not rebuild unnecessarily.

## Report

State which path ran, whether Electron/iOS is currently live, validation outcomes, and concrete blockers. Do not claim a simulator or phone launch succeeded unless the launch command completed successfully.
