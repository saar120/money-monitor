import Foundation

enum MobileRequestConstructionError: Error, Equatable, Sendable {
    case invalidBaseURL
    case invalidCredential
    case authorizationPolicyViolation
}

enum MobileURLValidation {
    static func isSafeHTTPSBaseURL(_ url: URL) -> Bool {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            !components.path.split(separator: "/").contains("..")
        else {
            return false
        }
        return true
    }
}

enum MobileRequestFactory {
    static func makeRequest(
        endpoint: APIEndpoint,
        baseURL: URL,
        body: Data? = nil,
        bearerToken: String? = nil
    ) throws -> URLRequest {
        guard MobileURLValidation.isSafeHTTPSBaseURL(baseURL) else {
            throw MobileRequestConstructionError.invalidBaseURL
        }

        switch endpoint.authorizationPolicy {
        case .none:
            guard bearerToken == nil else {
                throw MobileRequestConstructionError.authorizationPolicyViolation
            }
        case .deviceBearer:
            guard
                let bearerToken,
                bearerToken.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
            else {
                throw MobileRequestConstructionError.invalidCredential
            }
        }

        var request = URLRequest(
            url: endpoint.url(relativeTo: baseURL),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: endpoint.isFinancialRead ? 15 : 10
        )
        request.httpMethod = endpoint.httpMethod
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if endpoint.authorizationPolicy == .deviceBearer, let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }

        return request
    }
}

private extension APIEndpoint {
    var isFinancialRead: Bool {
        switch self {
        case .bootstrap, .transactions, .transactionDetail:
            true
        case .health, .pairingStart, .pairingStatus, .pairingExchange:
            false
        }
    }
}
