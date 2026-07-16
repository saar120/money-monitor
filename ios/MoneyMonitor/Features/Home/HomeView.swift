import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var isRePairScannerPresented = false

    private let scannerFactory: PairingScannerViewFactory
    private let deviceName: () -> String

    init(
        scannerFactory: PairingScannerViewFactory = .integrationPending,
        deviceName: @escaping () -> String = { UIDevice.current.name }
    ) {
        self.scannerFactory = scannerFactory
        self.deviceName = deviceName
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: MoneyMonitorTheme.Spacing.medium) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(MoneyMonitorTheme.positive)

                    VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
                        Text("Mac connection checked")
                            .font(.headline)
                        Text(freshnessText)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            Section("Next implementation slice") {
                Text("Load a masked, read-only Home snapshot from /api/mobile/v1/bootstrap.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Home")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        isRePairScannerPresented = true
                    } label: {
                        Label("Re-pair with Mac", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(environment.pairingState.isInProgress)
                    .accessibilityIdentifier("repair-mac-connection")

                    Button("Disconnect", role: .destructive) {
                        Task {
                            await environment.disconnect()
                        }
                    }
                } label: {
                    Label("Profile and settings", systemImage: "person.crop.circle")
                }
            }
        }
        .sheet(isPresented: $isRePairScannerPresented) {
            ScenePrivacyProtectionContainer {
                scannerFactory.makeView(
                    onScanned: beginRePairing,
                    onCancel: { isRePairScannerPresented = false }
                )
            }
        }
    }

    private func beginRePairing(qrPayload: Data) {
        isRePairScannerPresented = false
        let currentDeviceName = deviceName()

        Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: currentDeviceName
            )
        }
    }

    private var freshnessText: String {
        guard case let .connected(lastCheckedAt) = environment.connectionState else {
            return "Connection status unavailable"
        }
        return "Health response received \(lastCheckedAt.formatted(.relative(presentation: .named)))"
    }
}
