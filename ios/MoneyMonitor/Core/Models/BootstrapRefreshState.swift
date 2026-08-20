import Foundation

enum BootstrapRefreshState: Equatable, Sendable {
    case idle
    case refreshing
    case failed(BootstrapRefreshFailure)

    var isChecking: Bool {
        self == .refreshing
    }
}

enum BootstrapRefreshFailure: Equatable, Sendable {
    case unavailable
    case invalidResponse
    case incompatible
    case accessRevoked
    case missingCredential
    case secureStorageUnavailable
}

enum BootstrapSnapshotState: Equatable, Sendable {
    case none
    case live
    case cached(generatedAt: Date)
    case stale(generatedAt: Date)
    case corrupt

    var isSavedView: Bool {
        switch self {
        case .cached, .stale:
            true
        case .none, .live, .corrupt:
            false
        }
    }
}

/// The one trust signal shared by every financial surface.
///
/// This is deliberately a projection rather than another source of truth. The
/// accepted bootstrap, encrypted Saved View, refresh operation, and pairing
/// credential remain the underlying state; this enum gives the shell a stable
/// vocabulary and a deterministic priority when those conditions overlap.
enum GlobalTrustState: Equatable, Sendable {
    case disconnected
    case checking
    case live
    case partial
    case savedView(generatedAt: Date)
    case staleSavedView(generatedAt: Date)
    case failed(BootstrapRefreshFailure)
    case noSnapshot
    case incompatible
    case revoked

    /// Compatibility spelling for callers that describe the absence of a
    /// Keychain pairing as "no saved access".
    static var noSavedAccess: Self { .disconnected }

    var isLive: Bool {
        self == .live || self == .partial
    }

    var isSaved: Bool {
        switch self {
        case .savedView, .staleSavedView:
            true
        case .disconnected, .checking, .live, .partial, .failed, .noSnapshot,
             .incompatible, .revoked:
            false
        }
    }

    var requiresLiveConnection: Bool {
        switch self {
        case .savedView, .staleSavedView, .noSnapshot, .incompatible, .failed,
             .disconnected, .revoked:
            true
        case .checking, .live, .partial:
            false
        }
    }
}

/// Pure state projection used by `AppEnvironment` and deterministic tests.
/// Keeping this decision table independent from SwiftUI makes overlap rules
/// (checking + Saved View, partial + failure, and revocation) auditable.
enum GlobalTrustStateProjection {
    static let staleAfter: TimeInterval = 24 * 60 * 60

    static func project(
        hasSavedCredential: Bool,
        connectionState: ConnectionState,
        pairingState: PairingFlowState,
        refreshState: BootstrapRefreshState,
        snapshotState: BootstrapSnapshotState,
        bootstrap: BootstrapSuccessEnvelope?,
        now: Date
    ) -> GlobalTrustState {
        if refreshState == .failed(.accessRevoked) || pairingState == .failed(.savedAccessRevoked) {
            return .revoked
        }

        if pairingState == .restoring || refreshState == .refreshing {
            return .checking
        }

        guard hasSavedCredential else {
            return .disconnected
        }

        if case .failed(.incompatible) = refreshState {
            return .incompatible
        }
        if pairingState == .failed(.incompatibleVersion) {
            return .incompatible
        }

        if let failure = refreshState.failure {
            if failure == .missingCredential {
                return .disconnected
            }

            // With no accepted data, recovery must explain that there is no
            // Saved View to show. A known failure is still available through
            // `bootstrapRefreshState` for the detailed retry copy.
            if bootstrap == nil, !snapshotState.isSavedView {
                switch failure {
                case .unavailable, .invalidResponse, .incompatible:
                    return failure == .incompatible ? .incompatible : .noSnapshot
                case .accessRevoked:
                    return .revoked
                case .missingCredential:
                    return .disconnected
                case .secureStorageUnavailable:
                    return .failed(failure)
                }
            }
            return .failed(failure)
        }

        if case .failed = connectionState {
            return bootstrap == nil && !snapshotState.isSavedView
                ? .noSnapshot
                : .failed(.unavailable)
        }

        if bootstrap?.meta.completeness.status == .partial,
           case .connected = connectionState
        {
            return .partial
        }

        switch snapshotState {
        case let .cached(generatedAt):
            return now.timeIntervalSince(generatedAt) > staleAfter
                ? .staleSavedView(generatedAt: generatedAt)
                : .savedView(generatedAt: generatedAt)
        case let .stale(generatedAt):
            return .staleSavedView(generatedAt: generatedAt)
        case .live:
            return bootstrap == nil ? .noSnapshot : .live
        case .none, .corrupt:
            return bootstrap == nil ? .noSnapshot : .live
        }
    }

}

private extension BootstrapRefreshState {
    var failure: BootstrapRefreshFailure? {
        guard case let .failed(failure) = self else { return nil }
        return failure
    }
}

enum FinancialContentLockState: Equatable, Sendable {
    case notRequired
    case locked
    case authenticating
    case unlocked

    var isLocked: Bool {
        self == .locked || self == .authenticating
    }
}
