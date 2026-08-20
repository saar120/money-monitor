import Foundation

enum MobileTransportFailure: Equatable, Sendable {
    case timeout
    case offline
    case tls
    case cancelled
    case other
}

enum MobileAuthenticationFailure: Equatable, Sendable {
    case required
    case invalid
    case expired
    case revoked
    case unknown
}

enum MobileAuthorizationFailure: Equatable, Sendable {
    case forbidden
    case capabilityRequired
    case unknown
}

enum MobilePairingFailure: Equatable, Sendable {
    case invalidPayload
    case rejected
    case approvalRequired
    case replayed
    case exchangeInProgress
    case expired
}

enum MobileClientError: Error, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    case invalidRequest
    case invalidResponse
    case invalidPayload
    case identityMismatch
    case transport(MobileTransportFailure)
    case authentication(MobileAuthenticationFailure)
    case authorization(MobileAuthorizationFailure)
    case pairing(MobilePairingFailure)
    case upgradeRequired
    case rateLimited
    case notFound
    case credentialStorageFailed
    case server(statusCode: Int)

    var description: String {
        switch self {
        case .invalidRequest:
            "The mobile request is not valid."
        case .invalidResponse:
            "The Mac returned an invalid response."
        case .invalidPayload:
            "The Mac returned data this version cannot safely use."
        case .identityMismatch:
            "The response did not come from the paired Mac."
        case let .transport(failure):
            "The private connection failed (\(failure.safeLabel))."
        case let .authentication(failure):
            "Device authentication failed (\(failure.safeLabel))."
        case let .authorization(failure):
            "The device is not authorized (\(failure.safeLabel))."
        case let .pairing(failure):
            "Pairing could not continue (\(failure.safeLabel))."
        case .upgradeRequired:
            "Money Monitor must be updated before this connection can continue."
        case .rateLimited:
            "Too many requests were made. Try again later."
        case .notFound:
            "The requested transaction is no longer available."
        case .credentialStorageFailed:
            "The paired device credential could not be stored securely."
        case let .server(statusCode):
            "The Mac returned an error (HTTP \(statusCode))."
        }
    }

    var debugDescription: String { description }

    static func classifyTransport(_ error: any Error) -> MobileClientError {
        if error is CancellationError {
            return .transport(.cancelled)
        }
        if error is MobileHTTPTransportError {
            return .invalidResponse
        }
        guard let urlError = error as? URLError else {
            return .transport(.other)
        }

        switch urlError.code {
        case .cancelled:
            return .transport(.cancelled)
        case .timedOut:
            return .transport(.timeout)
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed:
            return .transport(.offline)
        case .secureConnectionFailed, .serverCertificateHasBadDate,
             .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid, .clientCertificateRejected,
             .clientCertificateRequired:
            return .transport(.tls)
        default:
            return .transport(.other)
        }
    }

    static func classifyHTTP(
        statusCode: Int,
        data: Data,
        endpoint: APIEndpoint,
        decoder: BootstrapPayloadDecoder
    ) -> MobileClientError {
        let code = try? decoder.decodeError(from: data).error.code

        if statusCode == 426 || code == .upgradeRequired {
            return .upgradeRequired
        }
        if statusCode == 429 || code == .rateLimited {
            return .rateLimited
        }
        if statusCode == 404,
           code == .transactionNotFound,
           case .transactionDetail = endpoint
        {
            return .notFound
        }

        if endpoint.isPairingEndpoint {
            switch code {
            case .pairingInvalid, .validationError, .invalidRequest:
                return .pairing(.invalidPayload)
            case .pairingRejected:
                return .pairing(.rejected)
            case .pairingApprovalRequired:
                return .pairing(.approvalRequired)
            case .pairingReplayed:
                return .pairing(.replayed)
            case .pairingExchangeInProgress:
                return .pairing(.exchangeInProgress)
            case .pairingExpired:
                return .pairing(.expired)
            default:
                break
            }

            switch statusCode {
            case 400:
                return .pairing(.invalidPayload)
            case 403:
                return .pairing(.rejected)
            case 409:
                return .pairing(.approvalRequired)
            case 410:
                return .pairing(.expired)
            default:
                break
            }
        }

        switch statusCode {
        case 401:
            switch code {
            case .authenticationRequired:
                return .authentication(.required)
            case .authenticationInvalid:
                return .authentication(.invalid)
            case .authenticationExpired:
                return .authentication(.expired)
            case .authenticationRevoked:
                return .authentication(.revoked)
            default:
                return .authentication(.unknown)
            }
        case 403:
            switch code {
            case .capabilityRequired:
                return .authorization(.capabilityRequired)
            case .forbidden:
                return .authorization(.forbidden)
            default:
                return .authorization(.unknown)
            }
        default:
            return .server(statusCode: statusCode)
        }
    }
}

private extension APIEndpoint {
    var isPairingEndpoint: Bool {
        switch self {
        case .pairingStart, .pairingStatus, .pairingExchange:
            true
        case .health, .bootstrap, .homeOverview, .transactions, .transactionDetail, .planning, .netWorthHistory, .reviewResolve, .reviewSkip:
            false
        }
    }
}

private extension MobileTransportFailure {
    var safeLabel: String {
        switch self {
        case .timeout: "timeout"
        case .offline: "unavailable"
        case .tls: "secure connection"
        case .cancelled: "cancelled"
        case .other: "network"
        }
    }
}

private extension MobileAuthenticationFailure {
    var safeLabel: String {
        switch self {
        case .required: "required"
        case .invalid: "invalid"
        case .expired: "expired"
        case .revoked: "revoked"
        case .unknown: "unknown"
        }
    }
}

private extension MobileAuthorizationFailure {
    var safeLabel: String {
        switch self {
        case .forbidden: "forbidden"
        case .capabilityRequired: "capability"
        case .unknown: "unknown"
        }
    }
}

private extension MobilePairingFailure {
    var safeLabel: String {
        switch self {
        case .invalidPayload: "invalid"
        case .rejected: "rejected"
        case .approvalRequired: "approval required"
        case .replayed: "already used"
        case .exchangeInProgress: "exchange in progress"
        case .expired: "expired"
        }
    }
}
