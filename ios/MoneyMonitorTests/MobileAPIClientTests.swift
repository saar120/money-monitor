import Foundation
import Testing
@testable import MoneyMonitor

private final class MobileAPIFixtureBundleToken: NSObject {}

private enum MobileAPITestError: Error {
    case missingFixture(String)
    case noStubbedResponse
    case invalidFixture(String)
}

private struct RecordedMobileRequest: Equatable, Sendable {
    let url: URL?
    let method: String?
    let authorization: String?
    let accept: String?
    let contentType: String?
    let body: Data?

    init(_ request: URLRequest) {
        url = request.url
        method = request.httpMethod
        authorization = request.value(forHTTPHeaderField: "Authorization")
        accept = request.value(forHTTPHeaderField: "Accept")
        contentType = request.value(forHTTPHeaderField: "Content-Type")
        body = request.httpBody
    }
}

private actor StubMobileHTTPTransport: MobileHTTPTransport {
    private var responses: [MobileHTTPResponse]
    private let failureCode: URLError.Code?
    private var recordedRequests: [RecordedMobileRequest] = []

    init(responses: [MobileHTTPResponse]) {
        self.responses = responses
        failureCode = nil
    }

    init(failureCode: URLError.Code) {
        responses = []
        self.failureCode = failureCode
    }

    func send(_ request: URLRequest) throws -> MobileHTTPResponse {
        recordedRequests.append(RecordedMobileRequest(request))
        if let failureCode { throw URLError(failureCode) }
        guard !responses.isEmpty else { throw MobileAPITestError.noStubbedResponse }
        return responses.removeFirst()
    }

    func requests() -> [RecordedMobileRequest] {
        recordedRequests
    }
}

private func mobileAPIFixture(_ filename: String) throws -> Data {
    let bundle = Bundle(for: MobileAPIFixtureBundleToken.self)
    let name = String(filename.dropLast(".json".count))
    guard let url = bundle.url(
        forResource: name,
        withExtension: "json",
        subdirectory: "MobileBootstrap"
    ) else {
        throw MobileAPITestError.missingFixture(filename)
    }
    return try Data(contentsOf: url)
}

private struct MobileSearchNormalizationVector: Decodable {
    let name: String
    let input: String
    let expected: String
}

private func mobileSearchNormalizationVectors() throws
    -> [MobileSearchNormalizationVector]
{
    try JSONDecoder().decode(
        [MobileSearchNormalizationVector].self,
        from: mobileAPIFixture("transaction-search-normalization.json")
    )
}

private func mobileErrorPayload(_ code: String) -> Data {
    Data(
        """
        {"error":{"code":"\(code)","message":"Safe message"},"meta":{"apiVersion":"1","requestId":"request-1"}}
        """.utf8
    )
}

private func makeMobileAPICredential(
    token: String = String(repeating: "T", count: 43),
    serverID: UUID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
) throws -> PairedMacCredential {
    let profile = try PairedMacProfile(
        serverID: serverID,
        baseURL: URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!,
        deviceID: "device-1",
        deviceName: "Personal iPhone",
        capabilities: ["mobile.read"],
        protocolVersion: 1,
        apiVersion: 1,
        tokenVersion: 1
    )
    return try PairedMacCredential(profile: profile, token: token)
}

private let mobileTransactionID = "transaction_\(String(repeating: "T", count: 22))"
private let mobileAccountID = "account_\(String(repeating: "A", count: 22))"
private let mobileCategoryID = "category_\(String(repeating: "C", count: 22))"

private func mutatedMobileTransactionFixture(
    _ filename: String,
    mutate: (inout [String: Any]) throws -> Void
) throws -> Data {
    guard
        var object = try JSONSerialization.jsonObject(
            with: mobileAPIFixture(filename)
        ) as? [String: Any]
    else {
        throw MobileAPITestError.invalidFixture(filename)
    }
    try mutate(&object)
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

enum TransactionUnknownKeyNesting: String, CaseIterable, Sendable {
    case root
    case data
    case transaction
    case amount
    case category
    case account
    case page
    case meta
    case server
    case owner
}

enum TransactionMissingNullableKey: String, CaseIterable, Sendable {
    case category
    case nextCursor
    case ownerDisplayName
}

enum TransactionArbitraryEnum: String, CaseIterable, Sendable {
    case direction
    case status
    case source
    case ownerKind
}

private func mutateListTransaction(
    in root: inout [String: Any],
    mutate: (inout [String: Any]) throws -> Void
) throws {
    guard
        var data = root["data"] as? [String: Any],
        var transactions = data["transactions"] as? [[String: Any]],
        !transactions.isEmpty
    else {
        throw MobileAPITestError.invalidFixture("transaction-list-live.json")
    }
    try mutate(&transactions[0])
    data["transactions"] = transactions
    root["data"] = data
}

private func mutateDetailTransaction(
    in root: inout [String: Any],
    mutate: (inout [String: Any]) throws -> Void
) throws {
    guard
        var data = root["data"] as? [String: Any],
        var transaction = data["transaction"] as? [String: Any]
    else {
        throw MobileAPITestError.invalidFixture("transaction-detail-live.json")
    }
    try mutate(&transaction)
    data["transaction"] = transaction
    root["data"] = data
}

private func mutateTransactionMetadata(
    in root: inout [String: Any],
    mutate: (inout [String: Any]) throws -> Void
) throws {
    guard var meta = root["meta"] as? [String: Any] else {
        throw MobileAPITestError.invalidFixture("transaction metadata")
    }
    try mutate(&meta)
    root["meta"] = meta
}

private func transactionFixtureWithUnknownKey(
    at nesting: TransactionUnknownKeyNesting
) throws -> Data {
    let filename = nesting == .owner
        ? "transaction-detail-live.json"
        : "transaction-list-live.json"
    return try mutatedMobileTransactionFixture(filename) { root in
        switch nesting {
        case .root:
            root["arbitraryExtra"] = true
        case .data:
            guard var data = root["data"] as? [String: Any] else {
                throw MobileAPITestError.invalidFixture(filename)
            }
            data["arbitraryExtra"] = true
            root["data"] = data
        case .transaction:
            try mutateListTransaction(in: &root) { $0["arbitraryExtra"] = true }
        case .amount:
            try mutateListTransaction(in: &root) { transaction in
                guard var amount = transaction["amount"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture(filename)
                }
                amount["arbitraryExtra"] = true
                transaction["amount"] = amount
            }
        case .category:
            try mutateListTransaction(in: &root) { transaction in
                guard var category = transaction["category"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture(filename)
                }
                category["arbitraryExtra"] = true
                transaction["category"] = category
            }
        case .account:
            try mutateListTransaction(in: &root) { transaction in
                guard var account = transaction["account"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture(filename)
                }
                account["arbitraryExtra"] = true
                transaction["account"] = account
            }
        case .page:
            guard
                var data = root["data"] as? [String: Any],
                var page = data["page"] as? [String: Any]
            else {
                throw MobileAPITestError.invalidFixture(filename)
            }
            page["arbitraryExtra"] = true
            data["page"] = page
            root["data"] = data
        case .meta:
            try mutateTransactionMetadata(in: &root) { $0["arbitraryExtra"] = true }
        case .server:
            try mutateTransactionMetadata(in: &root) { meta in
                guard var server = meta["server"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture(filename)
                }
                server["arbitraryExtra"] = true
                meta["server"] = server
            }
        case .owner:
            try mutateDetailTransaction(in: &root) { transaction in
                guard var owner = transaction["owner"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture(filename)
                }
                owner["arbitraryExtra"] = true
                transaction["owner"] = owner
            }
        }
    }
}

struct MobileAPIClientTests {
    @Test
    func sharedSearchNormalizationVectorsMatchTheSwiftWireCanonicalizer() throws {
        for vector in try mobileSearchNormalizationVectors() {
            #expect(MobileTransactionQuery.canonicalSearchText(vector.input) == vector.expected)
        }
    }

    @Test
    func healthIsPathScopedAndNeverCarriesAuthorization() async throws {
        let responseData = Data(
            #"{"data":{"status":"ok"},"meta":{"apiVersion":"1","generatedAt":"2026-07-15T10:00:00.000Z","source":"live"}}"#.utf8
        )
        let transport = StubMobileHTTPTransport(
            responses: [MobileHTTPResponse(data: responseData, statusCode: 200)]
        )
        let client = URLSessionMobileAPIClient(transport: transport)
        let baseURL = URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!

        let health = try await client.health(baseURL: baseURL)
        let request = try #require(await transport.requests().first)

        #expect(health.data.status == "ok")
        #expect(request.url?.path == "/money-monitor/api/mobile/v1/health")
        #expect(request.method == "GET")
        #expect(request.authorization == nil)
        #expect(request.accept == "application/json")
    }

    @Test
    func bootstrapAloneCarriesBearerAndUsesTheValidatedSharedFixture() async throws {
        let token = String(repeating: "T", count: 43)
        let transport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: try mobileAPIFixture("bootstrap-complete.json"),
                    statusCode: 200
                ),
            ]
        )
        let client = URLSessionMobileAPIClient(transport: transport)

        let bootstrap = try await client.bootstrap(
            credential: makeMobileAPICredential(token: token)
        )
        let request = try #require(await transport.requests().first)

        #expect(bootstrap.meta.cacheability.status == .cacheable)
        #expect(bootstrap.meta.completeness.status == .complete)
        #expect(request.url?.path == "/money-monitor/api/mobile/v1/bootstrap")
        #expect(request.method == "GET")
        #expect(request.authorization == "Bearer \(token)")
        #expect(request.body == nil)
    }

    @Test
    func forbiddenBootstrapFixtureNeverBecomesAcceptedData() async throws {
        let transport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: try mobileAPIFixture("bootstrap-forbidden-redaction.json"),
                    statusCode: 200
                ),
            ]
        )
        let client = URLSessionMobileAPIClient(transport: transport)

        await #expect(throws: MobileClientError.invalidPayload) {
            try await client.bootstrap(credential: makeMobileAPICredential())
        }
    }

    @Test
    func bootstrapRejectsAValidPayloadFromAnotherServerIdentity() async throws {
        let transport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: try mobileAPIFixture("bootstrap-complete.json"),
                    statusCode: 200
                ),
            ]
        )
        let client = URLSessionMobileAPIClient(transport: transport)

        await #expect(throws: MobileClientError.identityMismatch) {
            try await client.bootstrap(
                credential: makeMobileAPICredential(serverID: UUID())
            )
        }
    }

    @Test
    func authenticationAuthorizationAndCompatibilityRemainDistinct() async throws {
        let cases: [(Int, String, MobileClientError)] = [
            (401, "authentication_revoked", .authentication(.revoked)),
            (403, "capability_required", .authorization(.capabilityRequired)),
            (426, "upgrade_required", .upgradeRequired),
        ]

        for (statusCode, code, expectedError) in cases {
            let transport = StubMobileHTTPTransport(
                responses: [
                    MobileHTTPResponse(
                        data: mobileErrorPayload(code),
                        statusCode: statusCode
                    ),
                ]
            )
            let client = URLSessionMobileAPIClient(transport: transport)

            do {
                _ = try await client.bootstrap(credential: makeMobileAPICredential())
                Issue.record("Expected \(expectedError)")
            } catch let error as MobileClientError {
                #expect(error == expectedError)
            } catch {
                Issue.record("Expected a typed MobileClientError")
            }
        }
    }

    @Test
    func errorsNeverIncludeTheBearerTokenOrRawServerMessage() async throws {
        let token = String(repeating: "S", count: 43)
        let payload = Data(
            """
            {"error":{"code":"authentication_revoked","message":"\(token)"},"meta":{"apiVersion":"1","requestId":"request-1"}}
            """.utf8
        )
        let transport = StubMobileHTTPTransport(
            responses: [MobileHTTPResponse(data: payload, statusCode: 401)]
        )
        let client = URLSessionMobileAPIClient(transport: transport)

        do {
            _ = try await client.bootstrap(
                credential: makeMobileAPICredential(token: token)
            )
            Issue.record("Expected authentication failure")
        } catch let error as MobileClientError {
            #expect(error == .authentication(.unknown))
            #expect(!String(describing: error).contains(token))
            #expect(!String(reflecting: error).contains(token))
        }
    }

    @Test
    func transportTimeoutHasNoUnderlyingURLOrRequestDescription() async throws {
        let transport = StubMobileHTTPTransport(failureCode: .timedOut)
        let client = URLSessionMobileAPIClient(transport: transport)

        await #expect(throws: MobileClientError.transport(.timeout)) {
            try await client.health(
                baseURL: URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!
            )
        }
    }

    @Test
    func transactionListUsesBearerExactFiltersAndValidatedLiveData() async throws {
        let token = String(repeating: "L", count: 43)
        let transport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: try mobileAPIFixture("transaction-list-live.json"),
                    statusCode: 200
                ),
            ]
        )
        let client = URLSessionMobileAPIClient(transport: transport)
        let query = MobileTransactionQuery(
            query: " קפה ",
            cursor: "cursor_v1_previous",
            limit: 20,
            startDate: "2026-07-01",
            endDate: "2026-07-16",
            direction: .debit,
            status: .posted,
            needsReview: true,
            includeExcluded: true,
            accountID: mobileAccountID
        )

        let envelope = try await client.transactions(
            query: query,
            credential: makeMobileAPICredential(token: token)
        )
        let request = try #require(await transport.requests().first)
        let components = try #require(request.url.flatMap {
            URLComponents(url: $0, resolvingAgainstBaseURL: false)
        })
        let values = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )

        #expect(envelope.data.transactions.map(\.id) == [mobileTransactionID])
        #expect(envelope.data.transactions.first?.owner == nil)
        #expect(envelope.data.page.nextCursor == nil)
        #expect(request.authorization == "Bearer \(token)")
        #expect(request.method == "GET")
        #expect(values["q"] == "קפה")
        #expect(values["cursor"] == "cursor_v1_previous")
        #expect(values["limit"] == "20")
        #expect(values["needsReview"] == "true")
        #expect(values["includeExcluded"] == "true")
        #expect(values["accountId"] == mobileAccountID)
    }

    @Test
    func transactionDetailRequiresOwnerAndReturnsTheExactOpaqueID() async throws {
        let transport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: try mobileAPIFixture("transaction-detail-live.json"),
                    statusCode: 200
                ),
            ]
        )
        let client = URLSessionMobileAPIClient(transport: transport)

        let envelope = try await client.transactionDetail(
            id: mobileTransactionID,
            credential: makeMobileAPICredential()
        )
        let request = try #require(await transport.requests().first)

        #expect(envelope.data.transaction.id == mobileTransactionID)
        #expect(envelope.data.transaction.owner?.kind == .member)
        #expect(envelope.data.transaction.owner?.displayName == "Saar")
        #expect(request.url?.lastPathComponent == mobileTransactionID)
    }

    @Test
    func transactionDecoderRejectsSwappedIdentifierKindsAndSensitiveKeys() throws {
        let decoder = MobileTransactionPayloadDecoder()
        let swappedID = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            try mutateListTransaction(in: &root) { transaction in
                guard var account = transaction["account"] as? [String: Any] else {
                    throw MobileAPITestError.invalidFixture("transaction-list-live.json")
                }
                account["id"] = mobileCategoryID
                transaction["account"] = account
            }
        }
        let redacted = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            root["accessToken"] = "must-not-cross"
        }

        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try decoder.decodeList(from: swappedID)
        }
        #expect(throws: MobileTransactionPayloadDecoderError.redactionViolation) {
            try decoder.decodeList(from: redacted)
        }
    }

    @Test
    func transactionDecoderRejectsUnsafeCursorAndInvalidOwnerSemantics() throws {
        let decoder = MobileTransactionPayloadDecoder()
        let unsafeCursor = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            guard
                var data = root["data"] as? [String: Any],
                var page = data["page"] as? [String: Any]
            else {
                throw MobileAPITestError.invalidFixture("transaction-list-live.json")
            }
            page["hasMore"] = true
            page["nextCursor"] = "next-page"
            data["page"] = page
            root["data"] = data
        }
        let impossibleDate = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            try mutateListTransaction(in: &root) {
                $0["occurredOn"] = "2026-02-31"
            }
        }
        let invalidOwner = try mutatedMobileTransactionFixture(
            "transaction-detail-live.json"
        ) { root in
            try mutateDetailTransaction(in: &root) { transaction in
                transaction["owner"] = [
                    "kind": "shared",
                    "displayName": "Leaked member",
                ]
            }
        }

        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try decoder.decodeList(from: unsafeCursor)
        }
        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try decoder.decodeList(from: impossibleDate)
        }
        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try decoder.decodeDetail(from: invalidOwner)
        }
    }

    @Test(arguments: TransactionUnknownKeyNesting.allCases)
    func transactionDecoderRejectsUnknownKeysAtEveryNesting(
        _ nesting: TransactionUnknownKeyNesting
    ) throws {
        let payload = try transactionFixtureWithUnknownKey(at: nesting)
        let decoder = MobileTransactionPayloadDecoder()

        if nesting == .owner {
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try decoder.decodeDetail(from: payload)
            }
        } else {
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try decoder.decodeList(from: payload)
            }
        }
    }

    @Test(arguments: TransactionMissingNullableKey.allCases)
    func transactionDecoderRequiresExplicitNullableKeys(
        _ missingKey: TransactionMissingNullableKey
    ) throws {
        let decoder = MobileTransactionPayloadDecoder()
        switch missingKey {
        case .category:
            let payload = try mutatedMobileTransactionFixture(
                "transaction-list-live.json"
            ) { root in
                try mutateListTransaction(in: &root) { $0.removeValue(forKey: "category") }
            }
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try decoder.decodeList(from: payload)
            }
        case .nextCursor:
            let payload = try mutatedMobileTransactionFixture(
                "transaction-list-live.json"
            ) { root in
                guard
                    var data = root["data"] as? [String: Any],
                    var page = data["page"] as? [String: Any]
                else {
                    throw MobileAPITestError.invalidFixture("transaction-list-live.json")
                }
                page.removeValue(forKey: "nextCursor")
                data["page"] = page
                root["data"] = data
            }
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try decoder.decodeList(from: payload)
            }
        case .ownerDisplayName:
            let payload = try mutatedMobileTransactionFixture(
                "transaction-detail-live.json"
            ) { root in
                try mutateDetailTransaction(in: &root) { transaction in
                    guard var owner = transaction["owner"] as? [String: Any] else {
                        throw MobileAPITestError.invalidFixture(
                            "transaction-detail-live.json"
                        )
                    }
                    owner.removeValue(forKey: "displayName")
                    transaction["owner"] = owner
                }
            }
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try decoder.decodeDetail(from: payload)
            }
        }
    }

    @Test(arguments: TransactionArbitraryEnum.allCases)
    func transactionDecoderRejectsArbitraryWireEnums(
        _ arbitraryEnum: TransactionArbitraryEnum
    ) throws {
        let isDetail = arbitraryEnum == .ownerKind
        let filename = isDetail
            ? "transaction-detail-live.json"
            : "transaction-list-live.json"
        let payload = try mutatedMobileTransactionFixture(filename) { root in
            switch arbitraryEnum {
            case .direction:
                try mutateListTransaction(in: &root) { $0["direction"] = "outgoing" }
            case .status:
                try mutateListTransaction(in: &root) { $0["status"] = "settled" }
            case .source:
                try mutateTransactionMetadata(in: &root) { $0["source"] = "cache" }
            case .ownerKind:
                try mutateDetailTransaction(in: &root) { transaction in
                    guard var owner = transaction["owner"] as? [String: Any] else {
                        throw MobileAPITestError.invalidFixture(filename)
                    }
                    owner["kind"] = "family"
                    transaction["owner"] = owner
                }
            }
        }

        if isDetail {
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try MobileTransactionPayloadDecoder().decodeDetail(from: payload)
            }
        } else {
            #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
                try MobileTransactionPayloadDecoder().decodeList(from: payload)
            }
        }
    }

    @Test(arguments: [
        "2026-07-16T10:00:00+00:00",
        "2026-07-16T10:00:00.12Z",
        "2026-07-16T10:00:00.1234Z",
        "2026-02-31T10:00:00.000Z",
        "not-an-instant",
    ])
    func transactionDecoderRejectsNonCanonicalOrInvalidTimestamps(
        _ generatedAt: String
    ) throws {
        let payload = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            try mutateTransactionMetadata(in: &root) { $0["generatedAt"] = generatedAt }
        }

        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try MobileTransactionPayloadDecoder().decodeList(from: payload)
        }
    }

    @Test
    func listForbidsOwnerAndDetailRequiresOwner() throws {
        let listWithOwner = try mutatedMobileTransactionFixture(
            "transaction-list-live.json"
        ) { root in
            try mutateListTransaction(in: &root) {
                $0["owner"] = ["kind": "shared", "displayName": NSNull()]
            }
        }
        let detailWithoutOwner = try mutatedMobileTransactionFixture(
            "transaction-detail-live.json"
        ) { root in
            try mutateDetailTransaction(in: &root) { $0.removeValue(forKey: "owner") }
        }

        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try MobileTransactionPayloadDecoder().decodeList(from: listWithOwner)
        }
        #expect(throws: MobileTransactionPayloadDecoderError.invalidEnvelope) {
            try MobileTransactionPayloadDecoder().decodeDetail(from: detailWithoutOwner)
        }
    }

    @Test
    func invalidTransactionRequestNeverReachesTransport() async throws {
        let transport = StubMobileHTTPTransport(responses: [])
        let client = URLSessionMobileAPIClient(transport: transport)

        await #expect(throws: MobileClientError.invalidRequest) {
            try await client.transactionDetail(
                id: mobileAccountID,
                credential: makeMobileAPICredential()
            )
        }
        await #expect(throws: MobileClientError.invalidRequest) {
            try await client.transactions(
                query: MobileTransactionQuery(
                    startDate: "2026-02-29",
                    endDate: "2026-02-31"
                ),
                credential: makeMobileAPICredential()
            )
        }
        await #expect(throws: MobileClientError.invalidRequest) {
            try await client.transactions(
                query: MobileTransactionQuery(
                    query: String(repeating: "ﬃ", count: 34)
                ),
                credential: makeMobileAPICredential()
            )
        }
        var nonCanonical = MobileTransactionQuery(query: "valid")
        nonCanonical.query = "  valid  "
        await #expect(throws: MobileClientError.invalidRequest) {
            try await client.transactions(
                query: nonCanonical,
                credential: makeMobileAPICredential()
            )
        }
        #expect(await transport.requests().isEmpty)
    }

    @Test
    func transactionDetailRejectsAValidDifferentOpaqueID() async throws {
        let payload = try mutatedMobileTransactionFixture(
            "transaction-detail-live.json"
        ) { root in
            try mutateDetailTransaction(in: &root) {
                $0["id"] = "transaction_\(String(repeating: "U", count: 22))"
            }
        }
        let transport = StubMobileHTTPTransport(
            responses: [MobileHTTPResponse(data: payload, statusCode: 200)]
        )

        await #expect(throws: MobileClientError.invalidPayload) {
            try await URLSessionMobileAPIClient(transport: transport)
                .transactionDetail(
                    id: mobileTransactionID,
                    credential: makeMobileAPICredential()
                )
        }
    }

    @Test
    func onlyDetailTransactionNotFoundMapsToNotFound() async throws {
        let detailTransport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: mobileErrorPayload("transaction_not_found"),
                    statusCode: 404
                ),
            ]
        )
        let listTransport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: mobileErrorPayload("transaction_not_found"),
                    statusCode: 404
                ),
            ]
        )
        let serverErrorTransport = StubMobileHTTPTransport(
            responses: [
                MobileHTTPResponse(
                    data: mobileErrorPayload("transaction_not_found"),
                    statusCode: 500
                ),
            ]
        )

        await #expect(throws: MobileClientError.notFound) {
            try await URLSessionMobileAPIClient(transport: detailTransport)
                .transactionDetail(
                    id: mobileTransactionID,
                    credential: makeMobileAPICredential()
                )
        }
        await #expect(throws: MobileClientError.server(statusCode: 404)) {
            try await URLSessionMobileAPIClient(transport: listTransport)
                .transactions(
                    query: MobileTransactionQuery(),
                    credential: makeMobileAPICredential()
                )
        }
        await #expect(throws: MobileClientError.server(statusCode: 500)) {
            try await URLSessionMobileAPIClient(transport: serverErrorTransport)
                .transactionDetail(
                    id: mobileTransactionID,
                    credential: makeMobileAPICredential()
                )
        }
    }
}
