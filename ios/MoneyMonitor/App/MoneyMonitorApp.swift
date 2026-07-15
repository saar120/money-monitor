import SwiftUI

@main
struct MoneyMonitorApp: App {
    @StateObject private var environment = AppEnvironment()

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
