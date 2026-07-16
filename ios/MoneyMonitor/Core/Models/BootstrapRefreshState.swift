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
