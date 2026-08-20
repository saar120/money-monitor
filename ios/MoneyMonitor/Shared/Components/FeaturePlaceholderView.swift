import SwiftUI
import UIKit

struct FeaturePlaceholderView: View {
    let title: String
    let systemImage: String
    let message: String

    var body: some View {
        ContentUnavailableView(
            title,
            systemImage: systemImage,
            description: Text(message)
        )
    }
}

/// A compact, shared trust signal shown below each root tab's navigation title.
/// It intentionally consumes `AppEnvironment.trustState` rather than making
/// feature views infer connectivity from individual request errors.
struct GlobalTrustStatusRow: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        let state = environment.trustState

        Group {
            if state != .revoked {
                ViewThatFits(in: .horizontal) {
                    statusContent(state, isCompact: false)
                    statusContent(state, isCompact: true)
                }
                .padding(.horizontal, MoneyMonitorTheme.Spacing.standard)
                .padding(.vertical, MoneyMonitorTheme.Spacing.small)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.bar)
                .overlay(alignment: .bottom) {
                    Divider()
                }
                .accessibilityIdentifier("global-trust-status")
            }
        }
    }

    @ViewBuilder
    private func statusContent(_ state: GlobalTrustState, isCompact: Bool) -> some View {
        if isCompact {
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.small) {
                statusLabel(state)
                actionButton(for: state)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: MoneyMonitorTheme.Spacing.standard) {
                statusLabel(state)
                Spacer(minLength: MoneyMonitorTheme.Spacing.small)
                actionButton(for: state)
            }
        }
    }

    private func statusLabel(_ state: GlobalTrustState) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title(for: state))
                    .font(.subheadline.weight(.semibold))
                Text(detail(for: state))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } icon: {
            Image(systemName: symbol(for: state))
                .foregroundStyle(color(for: state))
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func actionButton(for state: GlobalTrustState) -> some View {
        switch state {
        case .checking:
            Button("Checking") {}
                .disabled(true)
                .accessibilityHint("Money Monitor is checking the saved Mac connection.")
        case .live, .partial:
            retryButton(label: "Refresh")
        case .savedView, .staleSavedView, .failed:
            retryButton(label: "Reconnect")
        case .disconnected, .noSnapshot, .incompatible, .revoked:
            EmptyView()
        }
    }

    private func retryButton(label: String) -> some View {
        Button {
            Task { await environment.retryBootstrap() }
        } label: {
            Label(label, systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("global-trust-retry")
        .accessibilityHint("Makes one explicit request to verify the Mac connection.")
    }

    private func title(for state: GlobalTrustState) -> String {
        switch state {
        case .disconnected:
            "Not connected"
        case .checking:
            "Checking saved connection"
        case .live:
            "Live connection"
        case .partial:
            "Live connection · Partial data"
        case .savedView:
            "Saved View"
        case .staleSavedView:
            "Stale Saved View"
        case let .failed(failure):
            switch failure {
            case .unavailable: "Mac unavailable"
            case .invalidResponse: "Response unavailable"
            case .incompatible: "Update required"
            case .accessRevoked: "Access removed"
            case .missingCredential: "Saved connection missing"
            case .secureStorageUnavailable: "Secure access unavailable"
            }
        case .noSnapshot:
            "Saved View unavailable"
        case .incompatible:
            "Update required"
        case .revoked:
            "Access removed"
        }
    }

    private func detail(for state: GlobalTrustState) -> String {
        let generatedAt: Date?
        switch state {
        case let .savedView(date), let .staleSavedView(date):
            generatedAt = date
        default:
            generatedAt = environment.latestBootstrap?.meta.generatedAt
        }

        let sourceTime = generatedAt.map {
            " Source generated \(Self.sourceDateFormatter.string(from: $0))."
        } ?? ""

        switch state {
        case .disconnected:
            return "Pair with your Mac to view financial data."
        case .checking:
            return "Verifying secure access to your Mac."
        case .live:
            return "Your Mac is reachable.\(sourceTime)"
        case .partial:
            return "Some source values are unavailable.\(sourceTime)"
        case .savedView:
            return "Read-only financial data from the last accepted snapshot.\(sourceTime)"
        case .staleSavedView:
            return "Read-only data may be out of date.\(sourceTime)"
        case let .failed(failure):
            let savedViewNote = environment.snapshotState.isSavedView
                ? " Saved View remains available for read-only browsing."
                : ""
            return failureDetail(failure) + savedViewNote + sourceTime
        case .noSnapshot:
            return "Your saved pairing has no usable financial snapshot."
        case .incompatible:
            return "Update Money Monitor on this iPhone and Mac to continue."
        case .revoked:
            return "Pair with your Mac again to restore access."
        }
    }

    private func failureDetail(_ failure: BootstrapRefreshFailure) -> String {
        switch failure {
        case .unavailable:
            "The Mac could not be reached; the displayed data was not replaced."
        case .invalidResponse:
            "The latest Mac response could not be used; the displayed data was not replaced."
        case .incompatible:
            "Update Money Monitor on this iPhone and Mac to continue."
        case .accessRevoked:
            "Access was removed by the Mac."
        case .missingCredential:
            "The saved Mac connection is missing."
        case .secureStorageUnavailable:
            "The saved Mac connection could not be accessed securely."
        }
    }

    private func symbol(for state: GlobalTrustState) -> String {
        switch state {
        case .checking:
            "arrow.triangle.2.circlepath"
        case .live:
            "checkmark.shield.fill"
        case .partial:
            "exclamationmark.triangle.fill"
        case .savedView:
            "lock.doc.fill"
        case .staleSavedView:
            "clock.badge.exclamationmark"
        case .failed, .noSnapshot, .incompatible:
            "exclamationmark.triangle.fill"
        case .disconnected:
            "wifi.slash"
        case .revoked:
            "person.crop.circle.badge.xmark"
        }
    }

    private func color(for state: GlobalTrustState) -> Color {
        switch state {
        case .live:
            MoneyMonitorTheme.positive
        case .partial, .savedView:
            MoneyMonitorTheme.warning
        case .staleSavedView, .failed, .noSnapshot, .incompatible, .revoked:
            MoneyMonitorTheme.negative
        case .checking, .disconnected:
            MoneyMonitorTheme.tint
        }
    }

    private static var sourceDateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.calendar = .autoupdatingCurrent
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateStyle = .medium
        formatter.timeStyle = .medium
        return formatter
    }
}

extension View {
    /// Places the global trust row between the navigation bar and feature
    /// content without adding a second navigation hierarchy.
    func globalTrustStatusInset() -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            GlobalTrustStatusRow()
        }
    }
}

/// A fail-closed root surface for states in which there is no usable Saved
/// View or the Mac has explicitly removed this device's access.
struct GlobalTrustRecoveryView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var isScannerPresented = false

    let state: GlobalTrustState
    let scannerFactory: PairingScannerViewFactory

    var body: some View {
        VStack(spacing: MoneyMonitorTheme.Spacing.large) {
            Image(systemName: symbol)
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(MoneyMonitorTheme.tint)
                .accessibilityHidden(true)

            VStack(spacing: MoneyMonitorTheme.Spacing.small) {
                Text(title)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: MoneyMonitorTheme.Spacing.medium) {
                if allowsRetry {
                    Button {
                        Task { await environment.retryBootstrap() }
                    } label: {
                        Label("Retry connection", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("global-trust-retry-recovery")
                }

                Button {
                    isScannerPresented = true
                } label: {
                    Label("Pair again with Mac", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(environment.pairingState.isInProgress)
                .accessibilityIdentifier("global-trust-pair-again")
            }
            .frame(maxWidth: 360)
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MoneyMonitorTheme.canvas.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("global-trust-recovery")
        .sheet(isPresented: $isScannerPresented) {
            ScenePrivacyProtectionContainer {
                scannerFactory.makeView(
                    onScanned: beginPairing,
                    onCancel: { isScannerPresented = false }
                )
            }
        }
    }

    private var allowsRetry: Bool {
        switch state {
        case .noSnapshot:
            true
        case let .failed(failure):
            failure == .unavailable
        case .incompatible, .revoked, .disconnected, .checking, .live, .partial, .savedView, .staleSavedView:
            false
        }
    }

    private var title: String {
        switch state {
        case .revoked:
            "Access removed"
        case .checking:
            "Checking saved connection"
        case .noSnapshot:
            "Saved access needs recovery"
        case .incompatible, .failed(.incompatible):
            "Update required"
        case .failed(.secureStorageUnavailable):
            "Secure access unavailable"
        default:
            "Reconnect to Money Monitor"
        }
    }

    private var message: String {
        switch state {
        case .revoked:
            "The Mac removed this iPhone's access. No financial data is available here. Pair again from your Mac to continue."
        case .checking:
            "Verifying the saved Mac connection. This recovery screen will update when the check finishes."
        case .noSnapshot:
            "This iPhone still has a saved pairing, but no usable Saved View is available. Keep your Mac and Tailscale available, then retry or pair again."
        case .incompatible, .failed(.incompatible):
            "Update Money Monitor on this iPhone and Mac before reconnecting."
        case .failed(.secureStorageUnavailable):
            "Money Monitor could not access the saved connection securely. Unlock your iPhone, then pair again from your Mac."
        case .failed(.unavailable):
            "The saved Mac connection could not be verified and there is no usable Saved View. Make the Mac available, then retry."
        default:
            "Reconnect your Mac to restore access to Money Monitor."
        }
    }

    private var symbol: String {
        switch state {
        case .revoked:
            "person.crop.circle.badge.xmark"
        case .checking:
            "arrow.triangle.2.circlepath"
        case .incompatible, .failed(.incompatible):
            "arrow.triangle.2.circlepath"
        case .failed(.secureStorageUnavailable):
            "lock.trianglebadge.exclamationmark"
        default:
            "macbook.and.iphone"
        }
    }

    private func beginPairing(qrPayload: Data) {
        isScannerPresented = false
        Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: UIDevice.current.name
            )
        }
    }
}
