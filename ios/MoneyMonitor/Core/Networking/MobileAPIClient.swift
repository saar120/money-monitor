import Foundation
import CanonicalAPI

protocol MobileAPIClient: Sendable {
    func health(baseURL: URL) async throws -> HealthResponse
    func bootstrap(credential: PairedMacCredential) async throws -> BootstrapSuccessEnvelope
    func homeOverview(credential: PairedMacCredential) async throws -> CanonicalHomeOverviewEnvelope
}

extension MobileAPIClient {
    func homeOverview(credential _: PairedMacCredential) async throws -> CanonicalHomeOverviewEnvelope {
        throw MobileClientError.invalidRequest
    }
}

protocol MobileTransactionAPIClient: Sendable {
    func transactions(
        query: MobileTransactionQuery,
        credential: PairedMacCredential
    ) async throws -> MobileTransactionListEnvelope

    func transactionDetail(
        id: String,
        credential: PairedMacCredential
    ) async throws -> MobileTransactionDetailEnvelope
}

protocol MobilePlanningAPIClient: Sendable {
    func planningSnapshot(credential: PairedMacCredential) async throws -> MobilePlanningSnapshotEnvelope
}

protocol MobileNetWorthHistoryAPIClient: Sendable {
    func netWorthHistory(
        range: MobileNetWorthHistoryRange,
        credential: PairedMacCredential
    ) async throws -> MobileNetWorthHistoryEnvelope
}

protocol MobileReviewCommandAPIClient: Sendable {
    func resolveReview(
        command: MobileReviewResolveCommand,
        credential: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope

    func skipReview(
        command: MobileReviewSkipCommand,
        credential: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope
}

struct URLSessionMobileAPIClient: MobileAPIClient, Sendable {
    private let transport: any MobileHTTPTransport
    private let payloadDecoder: BootstrapPayloadDecoder

    init(session: URLSession = MobileURLSessionFactory.makeSession()) {
        self.init(transport: URLSessionMobileHTTPTransport(session: session))
    }

    init(
        transport: any MobileHTTPTransport,
        payloadDecoder: BootstrapPayloadDecoder = BootstrapPayloadDecoder()
    ) {
        self.transport = transport
        self.payloadDecoder = payloadDecoder
    }

    func health(baseURL: URL) async throws -> HealthResponse {
        let request: URLRequest
        do {
            request = try MobileRequestFactory.makeRequest(
                endpoint: .health,
                baseURL: baseURL
            )
        } catch {
            throw MobileClientError.invalidRequest
        }

        let response = try await send(request, endpoint: .health)
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let health = try decoder.decode(HealthResponse.self, from: response.data)
            guard
                health.data.status == "ok",
                health.meta.apiVersion == BootstrapMetadata.supportedAPIVersion,
                health.meta.source == BootstrapResponseSource.live.rawValue
            else {
                throw MobileClientError.invalidPayload
            }
            return health
        } catch let error as MobileClientError {
            throw error
        } catch {
            throw MobileClientError.invalidPayload
        }
    }

    func bootstrap(credential: PairedMacCredential) async throws -> BootstrapSuccessEnvelope {
        let request: URLRequest
        do {
            request = try MobileRequestFactory.makeRequest(
                endpoint: .bootstrap,
                baseURL: credential.profile.baseURL,
                bearerToken: credential.token
            )
        } catch {
            throw MobileClientError.invalidRequest
        }

        let response = try await send(request, endpoint: .bootstrap)
        let bootstrap: BootstrapSuccessEnvelope
        do {
            // This decoder validates redaction, compatibility, calculation
            // coherence, completeness, and cacheability before returning data.
            bootstrap = try payloadDecoder.decodeSuccess(from: response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }

        guard
            bootstrap.meta.server.id == credential.profile.serverID,
            bootstrap.meta.server.protocolVersion == credential.profile.protocolVersion,
            bootstrap.meta.apiVersion == String(credential.profile.apiVersion),
            credential.profile.capabilities.contains(BootstrapCapability.mobileRead.rawValue)
        else {
            throw MobileClientError.identityMismatch
        }

        return bootstrap
    }

    func homeOverview(credential: PairedMacCredential) async throws -> CanonicalHomeOverviewEnvelope {
        let responseRecorder = MobileCanonicalResponseRecorder()
        do {
            let generatedClient = CanonicalAPIClient(
                transport: MobileCanonicalTransportAdapter(
                    transport: transport,
                    baseURL: credential.profile.baseURL,
                    responseRecorder: responseRecorder
                ),
                token: credential.token
            )
            let generatedResponse = try await generatedClient.getHomeOverview()
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let envelope = try CanonicalHomeOverviewDecoder.decode(
                try encoder.encode(generatedResponse)
            )
            guard envelope.meta.apiVersion == String(credential.profile.apiVersion) else {
                throw MobileClientError.identityMismatch
            }
            return envelope
        } catch let error as MobileClientError {
            throw error
        } catch {
            if let response = responseRecorder.response,
               !(200 ..< 300).contains(response.statusCode)
            {
                throw MobileClientError.classifyHTTP(
                    statusCode: response.statusCode,
                    data: response.data,
                    endpoint: .homeOverview,
                    decoder: payloadDecoder
                )
            }
            if error is CanonicalAPIError {
                throw MobileClientError.invalidPayload
            }
            throw MobileClientError.invalidPayload
        }
    }

    private func send(_ request: URLRequest, endpoint: APIEndpoint) async throws
        -> MobileHTTPResponse
    {
        let response: MobileHTTPResponse
        do {
            response = try await transport.send(request)
        } catch {
            throw MobileClientError.classifyTransport(error)
        }

        guard (200 ..< 300).contains(response.statusCode) else {
            throw MobileClientError.classifyHTTP(
                statusCode: response.statusCode,
                data: response.data,
                endpoint: endpoint,
                decoder: payloadDecoder
            )
        }
        return response
    }
}

private final class MobileCanonicalResponseRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var latestResponse: MobileHTTPResponse?

    var response: MobileHTTPResponse? {
        lock.lock()
        defer { lock.unlock() }
        return latestResponse
    }

    func record(_ response: MobileHTTPResponse) {
        lock.lock()
        latestResponse = response
        lock.unlock()
    }
}

private struct MobileCanonicalTransportAdapter: CanonicalTransport, @unchecked Sendable {
    let transport: any MobileHTTPTransport
    let baseURL: URL
    let responseRecorder: MobileCanonicalResponseRecorder

    func send(
        _ request: CanonicalHTTPRequest,
        body: CanonicalHTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (CanonicalHTTPResponse, CanonicalHTTPBody?) {
        guard body == nil, let requestPath = request.path,
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let pathComponents = URLComponents(string: requestPath)
        else {
            throw MobileClientError.invalidRequest
        }

        let mountedPath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = mountedPath + pathComponents.path
        components.query = pathComponents.query
        guard let url = components.url else { throw MobileClientError.invalidRequest }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        for field in request.headerFields {
            urlRequest.setValue(field.value, forHTTPHeaderField: field.name.rawName)
        }
        let response = try await transport.send(urlRequest)
        responseRecorder.record(response)
        return (
            CanonicalHTTPResponse(
                status: .init(code: response.statusCode),
                headerFields: [.contentType: "application/json"]
            ),
            CanonicalHTTPBody(response.data)
        )
    }
}

extension URLSessionMobileAPIClient: MobileTransactionAPIClient {
    func transactions(
        query: MobileTransactionQuery,
        credential: PairedMacCredential
    ) async throws -> MobileTransactionListEnvelope {
        guard Self.isValid(query) else { throw MobileClientError.invalidRequest }
        let endpoint = APIEndpoint.transactions(query)
        let request = try makeProtectedRequest(endpoint: endpoint, credential: credential)
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobileTransactionListEnvelope
        do {
            envelope = try MobileTransactionPayloadDecoder().decodeList(from: response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        try validateIdentity(envelope.meta, credential: credential)
        return envelope
    }

    func transactionDetail(
        id: String,
        credential: PairedMacCredential
    ) async throws -> MobileTransactionDetailEnvelope {
        guard Self.isValidPublicID(id, kind: "transaction") else {
            throw MobileClientError.invalidRequest
        }
        let endpoint = APIEndpoint.transactionDetail(id: id)
        let request = try makeProtectedRequest(endpoint: endpoint, credential: credential)
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobileTransactionDetailEnvelope
        do {
            envelope = try MobileTransactionPayloadDecoder().decodeDetail(from: response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        try validateIdentity(envelope.meta, credential: credential)
        guard envelope.data.transaction.id == id else {
            throw MobileClientError.invalidPayload
        }
        return envelope
    }

    private func makeProtectedRequest(
        endpoint: APIEndpoint,
        credential: PairedMacCredential
    ) throws -> URLRequest {
        do {
            return try MobileRequestFactory.makeRequest(
                endpoint: endpoint,
                baseURL: credential.profile.baseURL,
                bearerToken: credential.token
            )
        } catch {
            throw MobileClientError.invalidRequest
        }
    }

    private func validateIdentity(
        _ metadata: MobileTransactionMetadata,
        credential: PairedMacCredential
    ) throws {
        guard
            metadata.server.id == credential.profile.serverID,
            metadata.server.protocolVersion == credential.profile.protocolVersion,
            metadata.apiVersion == String(credential.profile.apiVersion),
            credential.profile.capabilities.contains(BootstrapCapability.mobileRead.rawValue)
        else {
            throw MobileClientError.identityMismatch
        }
    }

    private static func isValid(_ query: MobileTransactionQuery) -> Bool {
        let canonicalQuery = MobileTransactionQuery.canonicalSearchText(query.query)
        return query.limit >= 1
            && query.limit <= 50
            && query.query == canonicalQuery
            && (canonicalQuery?.utf16.count ?? 0) <= 100
            && (query.cursor?.count ?? 0) <= 512
            && (query.cursor?.range(
                of: #"^cursor_v1_[A-Za-z0-9_-]+$"#,
                options: .regularExpression
            ) != nil || query.cursor == nil)
            && query.direction != .unknown
            && query.status != .unknown
            && query.startDate.map(isValidFinancialDate) ?? true
            && query.endDate.map(isValidFinancialDate) ?? true
            && Self.isOrdered(query.startDate, query.endDate)
            && query.accountID.map({ isValidPublicID($0, kind: "account") }) ?? true
    }

    private static func isOrdered(_ start: String?, _ end: String?) -> Bool {
        guard let start, let end else { return true }
        return start <= end
    }

    private static func isValidFinancialDate(_ value: String) -> Bool {
        guard value.range(
            of: #"^\d{4}-\d{2}-\d{2}$"#,
            options: .regularExpression
        ) != nil else {
            return false
        }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
            .compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
        ) else {
            return false
        }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == parts[0]
            && roundTrip.month == parts[1]
            && roundTrip.day == parts[2]
    }

    private static func isValidPublicID(_ value: String, kind: String) -> Bool {
        value.range(
            of: "^\(kind)_[A-Za-z0-9_-]{22}$",
            options: .regularExpression
        ) != nil
    }
}

extension URLSessionMobileAPIClient: MobilePlanningAPIClient {
    func planningSnapshot(credential: PairedMacCredential) async throws -> MobilePlanningSnapshotEnvelope {
        let endpoint = APIEndpoint.planning
        let request = try makeProtectedRequest(endpoint: endpoint, credential: credential)
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobilePlanningSnapshotEnvelope
        do {
            envelope = try MobilePlanningPayloadDecoder().decode(response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        try validateIdentity(envelope.meta, credential: credential)
        guard Self.isValidPlanning(envelope.data) else { throw MobileClientError.invalidPayload }
        return envelope
    }

    private static func isValidPlanning(_ snapshot: MobilePlanningSnapshot) -> Bool {
        snapshot.baseCurrencyCode == "ILS"
            && snapshot.financialDate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            && snapshot.budgets.count <= 100
            && snapshot.accounts.count <= 100
            && snapshot.assets.count <= 100
            && snapshot.accounts.allSatisfy { account in
                account.id.range(of: #"^account_[A-Za-z0-9_-]{22}$"#, options: .regularExpression) != nil
                    && account.identifierMask.range(of: #"^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$"#, options: .regularExpression) != nil
                    && (account.type != "credit_card" || account.balance == nil)
            }
    }
}

struct UnavailableMobilePlanningAPIClient: MobilePlanningAPIClient {
    func planningSnapshot(credential _: PairedMacCredential) async throws -> MobilePlanningSnapshotEnvelope {
        throw MobileClientError.invalidRequest
    }
}

extension URLSessionMobileAPIClient: MobileNetWorthHistoryAPIClient {
    func netWorthHistory(
        range: MobileNetWorthHistoryRange,
        credential: PairedMacCredential
    ) async throws -> MobileNetWorthHistoryEnvelope {
        let endpoint = APIEndpoint.netWorthHistory(range: range)
        let request = try makeProtectedRequest(endpoint: endpoint, credential: credential)
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobileNetWorthHistoryEnvelope
        do {
            envelope = try MobileNetWorthHistoryPayloadDecoder().decode(response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        try validateIdentity(envelope.meta, credential: credential)
        guard envelope.data.range == range else { throw MobileClientError.invalidPayload }
        return envelope
    }
}

extension URLSessionMobileAPIClient: MobileReviewCommandAPIClient {
    func resolveReview(
        command: MobileReviewResolveCommand,
        credential: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope {
        guard
            command.idempotencyKey.range(of: #"^[A-Za-z0-9_-]{16,128}$"#, options: .regularExpression) != nil,
            Self.isValidPublicID(command.transactionID, kind: "transaction"),
            Self.isValidPublicID(command.categoryID, kind: "category")
        else {
            throw MobileClientError.invalidRequest
        }

        let body: Data
        do {
            body = try JSONEncoder().encode(command)
        } catch {
            throw MobileClientError.invalidRequest
        }
        let endpoint = APIEndpoint.reviewResolve
        let request = try MobileRequestFactory.makeRequest(
            endpoint: endpoint,
            baseURL: credential.profile.baseURL,
            body: body,
            bearerToken: credential.token
        )
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobileReviewCommandEnvelope
        do {
            envelope = try MobileReviewCommandPayloadDecoder.decode(response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        guard
            envelope.meta.server.id == credential.profile.serverID,
            envelope.meta.server.protocolVersion == credential.profile.protocolVersion,
            envelope.meta.apiVersion == String(credential.profile.apiVersion),
            envelope.meta.source == .live,
            envelope.data.transactionID == command.transactionID
        else {
            throw MobileClientError.identityMismatch
        }
        return envelope
    }

    func skipReview(
        command: MobileReviewSkipCommand,
        credential: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope {
        guard
            command.idempotencyKey.range(of: #"^[A-Za-z0-9_-]{16,128}$"#, options: .regularExpression) != nil,
            Self.isValidPublicID(command.transactionID, kind: "transaction")
        else {
            throw MobileClientError.invalidRequest
        }

        let body: Data
        do {
            body = try JSONEncoder().encode(command)
        } catch {
            throw MobileClientError.invalidRequest
        }
        let endpoint = APIEndpoint.reviewSkip
        let request = try MobileRequestFactory.makeRequest(
            endpoint: endpoint,
            baseURL: credential.profile.baseURL,
            body: body,
            bearerToken: credential.token
        )
        let response = try await send(request, endpoint: endpoint)
        let envelope: MobileReviewCommandEnvelope
        do {
            envelope = try MobileReviewCommandPayloadDecoder.decode(response.data)
        } catch {
            throw MobileClientError.invalidPayload
        }
        guard
            envelope.meta.server.id == credential.profile.serverID,
            envelope.meta.server.protocolVersion == credential.profile.protocolVersion,
            envelope.meta.apiVersion == String(credential.profile.apiVersion),
            envelope.meta.source == .live,
            envelope.data.transactionID == command.transactionID
        else {
            throw MobileClientError.identityMismatch
        }
        return envelope
    }
}

struct UnavailableMobileNetWorthHistoryAPIClient: MobileNetWorthHistoryAPIClient {
    func netWorthHistory(
        range _: MobileNetWorthHistoryRange,
        credential _: PairedMacCredential
    ) async throws -> MobileNetWorthHistoryEnvelope {
        throw MobileClientError.invalidRequest
    }
}

struct UnavailableMobileReviewCommandAPIClient: MobileReviewCommandAPIClient {
    func resolveReview(
        command _: MobileReviewResolveCommand,
        credential _: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope {
        throw MobileClientError.invalidRequest
    }

    func skipReview(
        command _: MobileReviewSkipCommand,
        credential _: PairedMacCredential
    ) async throws -> MobileReviewCommandEnvelope {
        throw MobileClientError.invalidRequest
    }
}

private struct MobileNetWorthHistoryPayloadDecoder {
    func decode(_ data: Data) throws -> MobileNetWorthHistoryEnvelope {
        try MobilePayloadSecurityValidator().validate(data)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(root.keys) == ["data", "meta"],
              let payload = root["data"] as? [String: Any],
              Set(payload.keys) == ["financialDate", "range", "period", "baseCurrencyCode", "estimatedHistory", "estimationMethod", "points"],
              let period = payload["period"] as? [String: Any],
              Set(period.keys) == ["startDate", "endDate"],
              let points = payload["points"] as? [Any], points.count <= 1_000,
              let meta = root["meta"] as? [String: Any],
              Set(meta.keys) == ["apiVersion", "generatedAt", "source", "server"],
              let server = meta["server"] as? [String: Any],
              Set(server.keys) == ["id", "protocolVersion"]
        else { throw MobileClientError.invalidPayload }

        var previousDate: String?
        for point in points {
            guard let object = point as? [String: Any],
                  Set(object.keys) == ["date", "total", "assetsTotal", "liabilitiesTotal", "bankBalancesTotal"],
                  let date = object["date"] as? String,
                  previousDate.map({ date > $0 }) ?? true
            else { throw MobileClientError.invalidPayload }
            previousDate = date
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(MobileNetWorthHistoryEnvelope.self, from: data)
        guard envelope.data.baseCurrencyCode == "ILS",
              envelope.data.estimatedHistory,
              envelope.data.estimationMethod == "latest_known_values_carried_forward",
              envelope.data.period.endDate == envelope.data.financialDate,
              envelope.data.points.allSatisfy({ $0.total.currencyCode == "ILS" && $0.assetsTotal.currencyCode == "ILS" && $0.liabilitiesTotal.currencyCode == "ILS" && $0.bankBalancesTotal.currencyCode == "ILS" })
        else { throw MobileClientError.invalidPayload }
        return envelope
    }
}

/// Fail closed before `Codable` can discard unexpected desktop-shaped fields.
private struct MobilePlanningPayloadDecoder {
    func decode(_ data: Data) throws -> MobilePlanningSnapshotEnvelope {
        try MobilePayloadSecurityValidator().validate(data)
        let root = try object(data)
        guard Set(root.keys) == ["data", "meta"] else { throw MobileClientError.invalidPayload }
        let payload = try object(root["data"])
        guard Set(payload.keys) == ["financialDate", "calculatedAt", "baseCurrencyCode", "budgets", "netWorth", "accounts", "assets", "latestSync"] else {
            throw MobileClientError.invalidPayload
        }
        try validateBudgetRows(payload["budgets"])
        try validateAccountRows(payload["accounts"])
        try validateAssetRows(payload["assets"])
        guard try keys(payload["netWorth"]) == ["state", "total", "assetsTotal", "liabilitiesTotal", "bankBalancesTotal"],
              try keys(payload["latestSync"]) == ["state", "startedAt", "completedAt", "accountsSucceeded", "accountsAttentionNeeded"],
              try keys(root["meta"]) == ["apiVersion", "generatedAt", "source", "server"],
              try keys(try object(root["meta"])["server"]) == ["id", "protocolVersion"]
        else { throw MobileClientError.invalidPayload }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(MobilePlanningSnapshotEnvelope.self, from: data)
        guard envelope.data.baseCurrencyCode == "ILS",
              envelope.data.budgets.count <= 100,
              envelope.data.accounts.count <= 100,
              envelope.data.assets.count <= 100,
              envelope.data.accounts.allSatisfy({ $0.type != "credit_card" || $0.balance == nil })
        else { throw MobileClientError.invalidPayload }
        return envelope
    }

    private func validateBudgetRows(_ value: Any?) throws {
        guard let rows = value as? [Any], rows.count <= 100 else { throw MobileClientError.invalidPayload }
        for row in rows {
            let object = try object(row)
            guard Set(object.keys) == ["id", "displayName", "period", "periodRange", "limit", "spent", "remaining", "state", "pace", "includedCategories"],
                  try keys(object["periodRange"]) == ["startDate", "endDate"],
                  try keys(object["pace"]) == ["elapsedDays", "totalDays", "expectedSpent", "projectedSpent", "state"],
                  let categories = object["includedCategories"] as? [Any], categories.count <= 100
            else { throw MobileClientError.invalidPayload }
            for category in categories {
                guard try keys(category) == ["id", "label"] else { throw MobileClientError.invalidPayload }
            }
        }
    }

    private func validateAccountRows(_ value: Any?) throws {
        guard let rows = value as? [Any], rows.count <= 100 else { throw MobileClientError.invalidPayload }
        for row in rows {
            let object = try object(row)
            guard Set(object.keys) == ["id", "institutionName", "displayName", "type", "identifierMask", "currencyCode", "state", "freshness", "balance"],
                  try keys(object["freshness"]) == ["status", "lastSuccessfulSyncAt"]
            else { throw MobileClientError.invalidPayload }
        }
    }

    private func validateAssetRows(_ value: Any?) throws {
        guard let rows = value as? [Any], rows.count <= 100 else { throw MobileClientError.invalidPayload }
        for row in rows {
            guard try keys(row) == ["id", "displayName", "type", "liquidity", "currentValue", "state"] else {
                throw MobileClientError.invalidPayload
            }
        }
    }

    private func object(_ value: Any?) throws -> [String: Any] {
        guard let value = value as? [String: Any] else { throw MobileClientError.invalidPayload }
        return value
    }

    private func keys(_ value: Any?) throws -> Set<String> {
        Set(try object(value).keys)
    }

    private func object(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MobileClientError.invalidPayload
        }
        return value
    }
}

struct UnavailableMobileTransactionAPIClient: MobileTransactionAPIClient {
    func transactions(
        query _: MobileTransactionQuery,
        credential _: PairedMacCredential
    ) async throws -> MobileTransactionListEnvelope {
        throw MobileClientError.invalidRequest
    }

    func transactionDetail(
        id _: String,
        credential _: PairedMacCredential
    ) async throws -> MobileTransactionDetailEnvelope {
        throw MobileClientError.invalidRequest
    }
}
