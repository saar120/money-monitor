import Foundation

enum ConnectionState: Equatable {
    case notConfigured
    case connecting
    case connected(lastCheckedAt: Date)
    case failed(message: String)

    var isConnecting: Bool {
        if case .connecting = self {
            return true
        }
        return false
    }
}

