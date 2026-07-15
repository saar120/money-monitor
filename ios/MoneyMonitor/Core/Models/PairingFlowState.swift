import Foundation

enum PairingFlowState: Equatable {
    case idle
    case restoring
    case disconnecting
    case starting
    case waitingForApproval(expiresAt: Date)
    case securingConnection
    case failed(PairingFlowFailure)

    var isInProgress: Bool {
        switch self {
        case .restoring, .disconnecting, .starting, .waitingForApproval,
             .securingConnection:
            true
        case .idle, .failed:
            false
        }
    }

    var isCancellable: Bool {
        switch self {
        case .starting, .waitingForApproval:
            true
        case .idle, .restoring, .disconnecting, .securingConnection, .failed:
            false
        }
    }
}

enum PairingFlowFailure: Equatable {
    case invalidCode
    case expiredCode
    case rejected
    case macUnavailable
    case incompatibleVersion
    case identityMismatch
    case secureStorageUnavailable
    case savedAccessRevoked
    case savedConnectionUnavailable
    case unexpectedResponse

    var message: String {
        switch self {
        case .invalidCode:
            "That pairing code isn’t valid. Create a new code on your Mac and scan it again."
        case .expiredCode:
            "That pairing code expired or was already used. Create a new code on your Mac."
        case .rejected:
            "The pairing request wasn’t approved on your Mac."
        case .macUnavailable:
            "Your Mac couldn’t be reached. Check that Money Monitor and Tailscale are available."
        case .incompatibleVersion:
            "Update Money Monitor on both devices before pairing again."
        case .identityMismatch:
            "The response didn’t match the Mac in the pairing code. Create a new code and try again."
        case .secureStorageUnavailable:
            "This iPhone couldn’t store the connection securely. Unlock it and try again."
        case .savedAccessRevoked:
            "This iPhone’s saved access expired or was revoked. Create a new pairing code on your Mac."
        case .savedConnectionUnavailable:
            "The saved Mac connection couldn’t be verified. Make sure the Mac is available, then retry."
        case .unexpectedResponse:
            "The Mac returned information this version can’t safely use."
        }
    }

    var canRetrySavedConnection: Bool {
        self == .savedConnectionUnavailable
    }
}
