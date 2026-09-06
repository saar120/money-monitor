import SwiftUI

@main
struct MoneyMonitorApp: App {
    @StateObject private var environment: AppEnvironment

    init() {
#if DEBUG
        let activityRunID = ProcessInfo.processInfo.environment["UITEST_ACTIVITY_RUN_ID"]
            ?? "missing-run-id"
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-activity") {
            _environment = StateObject(wrappedValue: AppEnvironment(
                uiTestActivityScenario: false,
                runID: activityRunID
            ))
            return
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-saved-activity") {
            _environment = StateObject(wrappedValue: AppEnvironment(
                uiTestActivityScenario: true,
                runID: activityRunID
            ))
            return
        }
#endif
        _environment = StateObject(wrappedValue: AppEnvironment())
    }

    var body: some Scene {
        WindowGroup {
            RootView(
                scannerFactory: PairingScannerViewFactory { onScan, onCancel in
                    PairingQRCodeScannerView(onScan: onScan, onCancel: onCancel)
                }
            )
                .environmentObject(environment)
                .tint(MoneyMonitorTheme.tint)
        }
    }
}
