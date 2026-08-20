import AVFoundation
import SwiftUI
import UIKit
import VisionKit

/// A privacy-preserving, one-shot QR scanner for the Mac pairing flow.
///
/// The scanned value is delivered as UTF-8 bytes and is never retained by this view.
/// The caller remains responsible for validating it as a `ValidatedPairingQRCodePayload`.
struct PairingQRCodeScannerView: View {
    let onScan: @MainActor (Data) -> Void
    let onCancel: @MainActor () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = PairingQRScannerModel()
    @StateObject private var lifecycle = PairingQRScannerLifecycle()

    var body: some View {
        NavigationStack {
            Group {
                switch model.accessState {
                case .checking, .requestPermission:
                    statusView(
                        symbol: "camera.viewfinder",
                        title: "Preparing camera",
                        message: "Camera access is used only to scan your Mac's pairing code.",
                        showsProgress: true
                    )
                case .ready:
                    cameraView
                case .denied:
                    statusView(
                        symbol: "camera.fill",
                        title: "Camera access is off",
                        message: "Allow camera access in Settings to scan the pairing code.",
                        primaryAction: ("Open Settings", openSettings)
                    )
                case .restricted:
                    statusView(
                        symbol: "camera.fill",
                        title: "Camera access is restricted",
                        message: "Camera access is disabled by a device restriction. You can cancel and connect manually."
                    )
                case .unavailable:
                    statusView(
                        symbol: "camera.viewfinder",
                        title: "QR scanning is unavailable",
                        message: "The camera is not currently available. Try again or cancel and connect manually.",
                        primaryAction: ("Try Again", model.prepare)
                    )
                }
            }
            .background(MoneyMonitorTheme.canvas.ignoresSafeArea())
            .navigationTitle("Scan Mac QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: cancel)
                }
            }
        }
        .task {
            model.prepare()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.prepare()
            }
        }
        .onDisappear {
            model.cancelPreparation()
            lifecycle.stop()
        }
    }

    private var cameraView: some View {
        ZStack(alignment: .bottom) {
            PairingQRScannerCameraView(
                lifecycle: lifecycle,
                onScan: onScan,
                onUnavailable: model.markUnavailable
            )
            .ignoresSafeArea(edges: .bottom)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("QR code camera preview")
            .accessibilityHint("Point the camera at the pairing code displayed on your Mac")

            Label("Point your iPhone at the code on your Mac", systemImage: "viewfinder")
                .font(.callout.weight(.medium))
                .multilineTextAlignment(.center)
                .padding(.horizontal, MoneyMonitorTheme.Spacing.standard)
                .padding(.vertical, MoneyMonitorTheme.Spacing.medium)
                .background(.regularMaterial, in: Capsule())
                .padding(MoneyMonitorTheme.Spacing.large)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    @ViewBuilder
    private func statusView(
        symbol: String,
        title: String,
        message: String,
        showsProgress: Bool = false,
        primaryAction: (title: String, action: @MainActor () -> Void)? = nil
    ) -> some View {
        VStack(spacing: MoneyMonitorTheme.Spacing.xLarge) {
            Spacer()

            Image(systemName: symbol)
                .font(.system(size: 46, weight: .regular))
                .foregroundStyle(MoneyMonitorTheme.tint)
                .accessibilityHidden(true)

            VStack(spacing: MoneyMonitorTheme.Spacing.small) {
                Text(title)
                    .font(.title2.bold())

                Text(message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if showsProgress {
                ProgressView()
                    .controlSize(.large)
                    .accessibilityLabel("Preparing camera")
            }

            if let primaryAction {
                Button(primaryAction.title, action: primaryAction.action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }

            Spacer()
        }
        .frame(maxWidth: 520)
        .padding(MoneyMonitorTheme.Spacing.xLarge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func cancel() {
        model.cancelPreparation()
        lifecycle.cancel(onCancel: onCancel)
    }

    private func openSettings() {
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(settingsURL)
    }
}

@MainActor
private final class PairingQRScannerModel: ObservableObject {
    @Published private(set) var accessState: PairingQRScannerAccessState = .checking

    private var permissionTask: Task<Void, Never>?

    func prepare() {
        permissionTask?.cancel()

        let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
        let evaluatedState = PairingQRScannerAccessPolicy.evaluate(
            authorizationStatus: authorizationStatus,
            isScannerSupported: DataScannerViewController.isSupported,
            isScannerAvailable: DataScannerViewController.isAvailable
        )
        accessState = evaluatedState

        guard evaluatedState == .requestPermission else { return }

        permissionTask = Task { [weak self] in
            _ = await AVCaptureDevice.requestAccess(for: .video)
            guard !Task.isCancelled else { return }
            self?.refreshAccessState()
        }
    }

    func cancelPreparation() {
        permissionTask?.cancel()
        permissionTask = nil
    }

    func markUnavailable() {
        accessState = .unavailable
    }

    private func refreshAccessState() {
        accessState = PairingQRScannerAccessPolicy.evaluate(
            authorizationStatus: AVCaptureDevice.authorizationStatus(for: .video),
            isScannerSupported: DataScannerViewController.isSupported,
            isScannerAvailable: DataScannerViewController.isAvailable
        )
    }
}

@MainActor
private final class PairingQRScannerLifecycle: ObservableObject {
    private weak var scanner: DataScannerViewController?
    private var terminalGate = PairingQRScannerTerminalGate()

    func attach(_ scanner: DataScannerViewController) {
        self.scanner = scanner
    }

    func deliver(_ payload: Data, onScan: @MainActor (Data) -> Void) {
        guard terminalGate.claimTerminalEvent() else { return }
        scanner?.stopScanning()
        onScan(payload)
    }

    func cancel(onCancel: @MainActor () -> Void) {
        guard terminalGate.claimTerminalEvent() else { return }
        scanner?.stopScanning()
        onCancel()
    }

    func stop() {
        scanner?.stopScanning()
    }
}

private struct PairingQRScannerCameraView: UIViewControllerRepresentable {
    @ObservedObject var lifecycle: PairingQRScannerLifecycle
    let onScan: @MainActor (Data) -> Void
    let onUnavailable: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(lifecycle: lifecycle, onScan: onScan, onUnavailable: onUnavailable)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        lifecycle.attach(scanner)
        context.coordinator.start(scanner)
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.start(scanner)
    }

    static func dismantleUIViewController(
        _ scanner: DataScannerViewController,
        coordinator _: Coordinator
    ) {
        scanner.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let lifecycle: PairingQRScannerLifecycle
        private let onScan: @MainActor (Data) -> Void
        private let onUnavailable: @MainActor () -> Void
        private var isScanning = false

        init(
            lifecycle: PairingQRScannerLifecycle,
            onScan: @escaping @MainActor (Data) -> Void,
            onUnavailable: @escaping @MainActor () -> Void
        ) {
            self.lifecycle = lifecycle
            self.onScan = onScan
            self.onUnavailable = onUnavailable
        }

        func start(_ scanner: DataScannerViewController) {
            guard !isScanning else { return }
            do {
                try scanner.startScanning()
                isScanning = true
            } catch {
                onUnavailable()
            }
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems _: [RecognizedItem]
        ) {
            for item in addedItems {
                guard
                    case let .barcode(barcode) = item,
                    let payload = barcode.payloadStringValue?.data(using: .utf8)
                else { continue }

                isScanning = false
                dataScanner.stopScanning()
                lifecycle.deliver(payload, onScan: onScan)
                return
            }
        }

        func dataScanner(
            _: DataScannerViewController,
            becameUnavailableWithError _: DataScannerViewController.ScanningUnavailable
        ) {
            isScanning = false
            onUnavailable()
        }
    }
}
