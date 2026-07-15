import SwiftUI

/// The seam between onboarding and a camera-backed scanner.
///
/// A scanner implementation owns camera permission and QR capture, then calls
/// `onScanned` with the exact QR bytes. Onboarding owns validation and pairing.
/// Scanner implementations must deliver both handlers on the main actor.
@MainActor
struct PairingScannerViewFactory {
    typealias ScanHandler = @MainActor @Sendable (Data) -> Void
    typealias CancelHandler = @MainActor @Sendable () -> Void

    private let builder: (@escaping ScanHandler, @escaping CancelHandler) -> AnyView

    init<Content: View>(
        @ViewBuilder _ builder: @escaping (
            @escaping ScanHandler,
            @escaping CancelHandler
        ) -> Content
    ) {
        self.builder = { onScanned, onCancel in
            AnyView(builder(onScanned, onCancel))
        }
    }

    func makeView(
        onScanned: @escaping ScanHandler,
        onCancel: @escaping CancelHandler
    ) -> AnyView {
        builder(onScanned, onCancel)
    }

    static let integrationPending = PairingScannerViewFactory { _, onCancel in
        NavigationStack {
            ContentUnavailableView {
                Label("QR scanner unavailable", systemImage: "qrcode.viewfinder")
            } description: {
                Text("The camera scanner component still needs to be connected to this flow.")
            } actions: {
                Button("Close", action: onCancel)
                    .buttonStyle(.borderedProminent)
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
