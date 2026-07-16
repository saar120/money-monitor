import SwiftUI
import UIKit

struct ConnectMacView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.scenePhase) private var scenePhase
    @State private var address = ""
    @State private var isScannerPresented = false
    @State private var pairingTask: Task<Void, Never>?
    @State private var isDevelopmentConnectionExpanded = false
    @FocusState private var addressIsFocused: Bool

    private let scannerFactory: PairingScannerViewFactory
    private let deviceName: () -> String

    init(
        scannerFactory: PairingScannerViewFactory,
        deviceName: @escaping () -> String = { UIDevice.current.name }
    ) {
        self.scannerFactory = scannerFactory
        self.deviceName = deviceName
    }

    var body: some View {
        ScrollView {
            VStack(spacing: MoneyMonitorTheme.Spacing.xLarge) {
                Spacer(minLength: MoneyMonitorTheme.Spacing.xxLarge)

                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 50, weight: .regular))
                    .foregroundStyle(MoneyMonitorTheme.tint)
                    .accessibilityHidden(true)

                VStack(spacing: MoneyMonitorTheme.Spacing.small) {
                    Text("Connect to your Mac")
                        .font(.largeTitle.bold())
                        .multilineTextAlignment(.center)

                    Text("Scan the pairing code shown in Money Monitor on your Mac, then approve this iPhone there.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                pairingControls
                pairingStatus
                developmentConnection

                Label(
                    "Bank credentials and scraping stay on this Mac.",
                    systemImage: "lock.shield"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)

                Spacer(minLength: MoneyMonitorTheme.Spacing.xxLarge)
            }
            .frame(maxWidth: 520)
            .padding(.horizontal, MoneyMonitorTheme.Spacing.large)
        }
        .navigationTitle("Money Monitor")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isScannerPresented) {
            ScenePrivacyProtectionContainer {
                scannerFactory.makeView(
                    onScanned: beginPairing,
                    onCancel: { isScannerPresented = false }
                )
            }
        }
        .onDisappear {
            cancelPairing()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase != .active else { return }
            cancelPairing()
        }
    }

    private var pairingControls: some View {
        Button {
            addressIsFocused = false
            isScannerPresented = true
        } label: {
            Label("Scan Mac pairing code", systemImage: "qrcode.viewfinder")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(environment.pairingState.isInProgress)
        .accessibilityIdentifier("scan-pairing-code")
    }

    @ViewBuilder
    private var pairingStatus: some View {
        switch environment.pairingState {
        case .idle:
            EmptyView()
        case .restoring:
            statusCard(
                title: "Checking saved connection…",
                message: "Verifying secure access to your Mac.",
                showsProgress: true
            )
        case .disconnecting:
            statusCard(
                title: "Removing secure access…",
                message: "Deleting this iPhone’s saved Mac credential.",
                showsProgress: true
            )
        case .starting:
            statusCard(
                title: "Requesting access…",
                message: "Sending this iPhone’s pairing request to your Mac.",
                showsProgress: true,
                showsCancel: true
            )
        case let .waitingForApproval(expiresAt):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Label("Approve this iPhone on your Mac", systemImage: "checkmark.shield")
                    .font(.headline)

                HStack {
                    Text("Pairing code expires in")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(expiresAt, style: .timer)
                        .monospacedDigit()
                }
                .font(.footnote)

                Button("Cancel pairing", role: .cancel, action: cancelPairing)
                    .font(.footnote.weight(.semibold))
            }
            .padding(MoneyMonitorTheme.Spacing.standard)
            .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityIdentifier("pairing-awaiting-approval")
        case .securingConnection:
            statusCard(
                title: "Securing connection…",
                message: "Saving device access and verifying the first private data response.",
                showsProgress: true
            )
        case let .failed(failure):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Label(failure.message, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(MoneyMonitorTheme.warning)

                if failure.canRetrySavedConnection {
                    Button("Retry saved connection") {
                        pairingTask?.cancel()
                        pairingTask = Task {
                            await environment.restoreSavedConnection()
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(MoneyMonitorTheme.Spacing.standard)
            .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityIdentifier("pairing-error")
        }
    }

    private var developmentConnection: some View {
        DisclosureGroup(
            "Development connection",
            isExpanded: $isDevelopmentConnectionExpanded
        ) {
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Text("Check a private HTTPS address without pairing. This temporary path is for local development only.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("https://money-monitor.your-tailnet.ts.net", text: $address)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .focused($addressIsFocused)
                    .submitLabel(.go)
                    .onSubmit(connect)
                    .padding(.horizontal, MoneyMonitorTheme.Spacing.standard)
                    .frame(minHeight: 50)
                    .background(
                        MoneyMonitorTheme.quietControl,
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                    .accessibilityLabel("Private Mac address")

                Button(action: connect) {
                    HStack(spacing: MoneyMonitorTheme.Spacing.small) {
                        if environment.connectionState.isConnecting {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(
                            environment.connectionState.isConnecting
                                ? "Checking…"
                                : "Check connection"
                        )
                        .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(
                    address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || environment.connectionState.isConnecting
                )

                if case let .failed(message) = environment.connectionState {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(MoneyMonitorTheme.warning)
                        .accessibilityIdentifier("connection-error")
                }
            }
            .padding(.top, MoneyMonitorTheme.Spacing.medium)
        }
        .font(.subheadline)
    }

    private func statusCard(
        title: String,
        message: String,
        showsProgress: Bool,
        showsCancel: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
            HStack(spacing: MoneyMonitorTheme.Spacing.small) {
                if showsProgress {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(title)
                    .font(.headline)
            }

            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)

            if showsCancel {
                Button("Cancel pairing", role: .cancel, action: cancelPairing)
                    .font(.footnote.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(MoneyMonitorTheme.Spacing.standard)
        .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
    }

    private func beginPairing(qrPayload: Data) {
        isScannerPresented = false
        addressIsFocused = false
        pairingTask?.cancel()
        environment.cancelPairing()

        let currentDeviceName = deviceName()
        pairingTask = Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: currentDeviceName
            )
        }
    }

    private func cancelPairing() {
        guard environment.pairingState.isCancellable else { return }
        pairingTask?.cancel()
        pairingTask = nil
        environment.cancelPairing()
    }

    private func connect() {
        addressIsFocused = false
        pairingTask?.cancel()
        environment.cancelPairing()
        Task {
            await environment.connect(to: address)
        }
    }
}
