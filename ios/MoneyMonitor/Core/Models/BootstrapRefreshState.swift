import Foundation

enum BootstrapRefreshState: Equatable, Sendable {
    case idle
    case refreshing
    case failed(BootstrapRefreshFailure)
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
