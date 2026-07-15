import Foundation

enum APIEndpoint: Equatable {
    case health
    case pairingStart
    case pairingStatus
    case pairingExchange
    case bootstrap

    enum AuthorizationPolicy: Equatable {
        case none
        case deviceBearer
    }

    var path: String {
        switch self {
        case .health:
            "api/mobile/v1/health"
        case .pairingStart:
            "api/mobile/v1/pairing/start"
        case .pairingStatus:
            "api/mobile/v1/pairing/status"
        case .pairingExchange:
            "api/mobile/v1/pairing/exchange"
        case .bootstrap:
            "api/mobile/v1/bootstrap"
        }
    }

    var httpMethod: String {
        switch self {
        case .health, .bootstrap:
            "GET"
        case .pairingStart, .pairingStatus, .pairingExchange:
            "POST"
        }
    }

    var authorizationPolicy: AuthorizationPolicy {
        switch self {
        case .bootstrap:
            .deviceBearer
        case .health, .pairingStart, .pairingStatus, .pairingExchange:
            .none
        }
    }

    func url(relativeTo baseURL: URL) -> URL {
        path.split(separator: "/").reduce(baseURL) { url, component in
            url.appendingPathComponent(String(component))
        }
    }
}
