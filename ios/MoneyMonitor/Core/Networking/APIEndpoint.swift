import Foundation

enum APIEndpoint: Equatable {
    case health
    case pairingStart
    case pairingStatus
    case pairingExchange
    case bootstrap
    case transactions(MobileTransactionQuery)
    case transactionDetail(id: String)
    case planning
    case netWorthHistory(range: MobileNetWorthHistoryRange)
    case reviewResolve
    case reviewSkip

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
        case .transactions:
            "api/mobile/v1/transactions"
        case let .transactionDetail(id):
            "api/mobile/v1/transactions/\(id)"
        case .planning:
            "api/mobile/v1/planning"
        case .netWorthHistory:
            "api/mobile/v1/net-worth/history"
        case .reviewResolve:
            "api/mobile/v1/reviews/resolve"
        case .reviewSkip:
            "api/mobile/v1/reviews/skip"
        }
    }

    var httpMethod: String {
        switch self {
        case .health, .bootstrap, .transactions, .transactionDetail, .planning, .netWorthHistory:
            "GET"
        case .pairingStart, .pairingStatus, .pairingExchange, .reviewResolve, .reviewSkip:
            "POST"
        }
    }

    var authorizationPolicy: AuthorizationPolicy {
        switch self {
        case .bootstrap, .transactions, .transactionDetail, .planning, .netWorthHistory, .reviewResolve, .reviewSkip:
            .deviceBearer
        case .health, .pairingStart, .pairingStatus, .pairingExchange:
            .none
        }
    }

    func url(relativeTo baseURL: URL) -> URL {
        let endpointURL = path.split(separator: "/").reduce(baseURL) { url, component in
            url.appendingPathComponent(String(component))
        }
        guard case let .transactions(query) = self else {
            guard case let .netWorthHistory(range) = self else { return endpointURL }
            var components = URLComponents(url: endpointURL, resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "range", value: range.rawValue)]
            return components?.url ?? endpointURL
        }

        var components = URLComponents(url: endpointURL, resolvingAgainstBaseURL: false)
        components?.queryItems = query.queryItems
        return components?.url ?? endpointURL
    }
}

private extension MobileTransactionQuery {
    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        items.append(URLQueryItem(name: "limit", value: String(limit)))
        if let startDate { items.append(URLQueryItem(name: "startDate", value: startDate)) }
        if let endDate { items.append(URLQueryItem(name: "endDate", value: endDate)) }
        if let direction { items.append(URLQueryItem(name: "direction", value: direction.rawValue)) }
        if let status { items.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if needsReview { items.append(URLQueryItem(name: "needsReview", value: "true")) }
        if includeExcluded { items.append(URLQueryItem(name: "includeExcluded", value: "true")) }
        if let accountID { items.append(URLQueryItem(name: "accountId", value: accountID)) }
        return items
    }
}
