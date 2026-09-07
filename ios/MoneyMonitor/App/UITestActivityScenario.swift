#if DEBUG
import Foundation

struct UITestMobileAPIClient: MobileAPIClient {
    func health(baseURL _: URL) async throws -> HealthResponse {
        throw MobileClientError.invalidRequest
    }

    func bootstrap(credential _: PairedMacCredential) async throws -> BootstrapSuccessEnvelope {
        throw MobileClientError.invalidRequest
    }
}

actor UITestPairedProfileStore: PairedProfileStore {
    private var credential: PairedMacCredential?

    init(credential: PairedMacCredential) {
        self.credential = credential
    }

    func create(_ credential: PairedMacCredential) { self.credential = credential }
    func load() -> PairedMacCredential? { credential }
    func replace(_ credential: PairedMacCredential) { self.credential = credential }
    func savePairing(_ credential: PairedMacCredential) { self.credential = credential }
    func delete() { credential = nil }
}

struct UITestDeviceAuthenticationClient: DeviceAuthenticationClient {
    func authenticateDeviceOwner() async -> DeviceAuthenticationOutcome { .success }
}

final class UITestActivityURLProtocol: URLProtocol {
    private static let attemptsLock = NSLock()
    nonisolated(unsafe) private static var secondPageAttempts = 0

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "money-monitor.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let response = try Self.response(for: request)
            guard let url = request.url,
                  let httpResponse = HTTPURLResponse(
                      url: url,
                      statusCode: response.statusCode,
                      httpVersion: "HTTP/1.1",
                      headerFields: ["Content-Type": "application/json"]
                  )
            else { throw MobileClientError.invalidRequest }
            client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func response(for request: URLRequest) throws -> MobileHTTPResponse {
        guard
            let url = request.url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            url.path == "/api/v1/transactions"
        else { throw MobileClientError.invalidRequest }
        let query = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )
        if let search = query["q"] {
            let matches = search.localizedCaseInsensitiveContains("coffee")
                ? [(100, "Coffee Roasters")]
                : []
            return try response(matches, hasMore: false, cursor: nil, total: matches.count)
        }

        if query["cursor"] == "cursor_v2_page-2" {
            attemptsLock.lock()
            secondPageAttempts += 1
            let attempt = secondPageAttempts
            attemptsLock.unlock()
            if attempt == 1 {
                throw URLError(.notConnectedToInternet)
            }
            return try response(
                (1 ... 5).reversed().map { id in
                    (id, "Seeded merchant \(String(format: "%02d", id))")
                },
                hasMore: false,
                cursor: nil,
                total: 35
            )
        }

        return try response(
            (6 ... 35).reversed().map { id in
                (id, "Seeded merchant \(String(format: "%02d", id))")
            },
            hasMore: true,
            cursor: "cursor_v2_page-2",
            total: 35
        )
    }

    private static func response(
        _ transactions: [(Int, String)],
        hasMore: Bool,
        cursor: String?,
        total: Int
    ) throws -> MobileHTTPResponse {
        let payload: [String: Any] = [
            "data": [
                "financialDate": "2026-09-04",
                "transactions": transactions.map(UITestActivityFixtures.wireTransaction),
                "page": [
                    "hasMore": hasMore,
                    "nextCursor": cursor.map { $0 as Any } ?? NSNull(),
                    "total": total,
                ],
            ],
            "meta": [
                "apiVersion": "1",
                "generatedAt": "2026-09-04T12:00:00.000Z",
                "source": "mac-authoritative",
                "completeness": "complete",
                "server": [
                    "id": UITestActivityFixtures.serverID.uuidString.lowercased(),
                    "protocolVersion": 1,
                ],
            ],
        ]
        return MobileHTTPResponse(
            data: try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            statusCode: 200
        )
    }
}

enum UITestActivityFixtures {
    static let serverID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!

    static let credential = try! PairedMacCredential(
        profile: PairedMacProfile(
            serverID: serverID,
            baseURL: URL(string: "https://money-monitor.test:8443")!,
            deviceID: "ui-test-device",
            deviceName: "Seeded Test Mac",
            capabilities: ["mobile.read"],
            protocolVersion: 1,
            apiVersion: 1,
            tokenVersion: 1
        ),
        token: String(repeating: "T", count: 43)
    )

    static let bootstrap: BootstrapSuccessEnvelope = {
        let json = #"""
        {
          "data": {
            "home": {
              "primaryCurrencyCode": "ILS",
              "aggregates": {
                "netWorth": {"amount":{"value":"0.00","currencyCode":"ILS"},"period":{"startDate":"2026-09-04","endDate":"2026-09-04"},"comparisonPeriod":null,"calculatedAt":"2026-09-04T12:00:00Z"},
                "income": {"amount":{"value":"0.00","currencyCode":"ILS"},"period":{"startDate":"2026-09-01","endDate":"2026-09-04"},"comparisonPeriod":null,"calculatedAt":"2026-09-04T12:00:00Z"},
                "spending": {"amount":{"value":"0.00","currencyCode":"ILS"},"period":{"startDate":"2026-09-01","endDate":"2026-09-04"},"comparisonPeriod":null,"calculatedAt":"2026-09-04T12:00:00Z"}
              }
            },
            "budgetPulse": {"status":"unavailable","spent":null,"limit":null,"remaining":null,"period":{"startDate":"2026-09-01","endDate":"2026-09-04"},"calculatedAt":"2026-09-04T12:00:00Z"},
            "review": {"count":0,"calculatedAt":"2026-09-04T12:00:00Z"},
            "recentTransactions": [],
            "accounts": [],
            "latestSync": {"status":"never_run","startedAt":null,"completedAt":null,"accountsSucceeded":0,"accountsFailed":0}
          },
          "meta": {
            "apiVersion":"1",
            "generatedAt":"2026-09-04T12:00:00Z",
            "calculatedAt":"2026-09-04T12:00:00Z",
            "financialDate":"2026-09-04",
            "source":"live",
            "bootstrapSchemaVersion":1,
            "snapshotId":"ui-test-activity",
            "server":{"id":"11111111-1111-4111-8111-111111111111","displayName":"Seeded Test Mac","serverVersion":"1.0.0","protocolVersion":1,"minimumClientVersion":"0.1.0","capabilities":["mobile.read"],"compatibility":{"status":"compatible","reason":null}},
            "cacheability":{"status":"cacheable","maxAgeSeconds":300},
            "completeness":{"status":"complete","sectionErrors":[]}
          }
        }
        """#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try! decoder.decode(BootstrapSuccessEnvelope.self, from: Data(json.utf8))
    }()

    static func client() -> URLSessionMobileAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UITestActivityURLProtocol.self]
        return URLSessionMobileAPIClient(session: URLSession(configuration: configuration))
    }

    static func publicID(_ kind: String, _ id: Int) -> String {
        "\(kind)_\(String(format: "%022d", id))"
    }

    static func wireTransaction(_ input: (Int, String)) -> [String: Any] {
        let (id, name) = input
        return [
            "id": publicID("transaction", id),
            "occurredOn": "2026-09-04",
            "processedOn": "2026-09-04",
            "displayName": name,
            "amount": ["value": "12.50", "currencyCode": "ILS"],
            "direction": "debit",
            "status": "posted",
            "category": [
                "id": publicID("category", 1),
                "name": "dining",
                "label": "Dining",
            ],
            "account": [
                "id": publicID("account", 1),
                "displayName": "Main Card",
                "identifierMask": "•••• 4242",
                "type": "credit_card",
            ],
            "owner": ["id": NSNull(), "kind": "shared", "displayName": NSNull()],
            "needsReview": false,
            "reviewReason": NSNull(),
            "confidence": NSNull(),
            "excludedFromReports": false,
        ]
    }

    static func transaction(id: Int, name: String) -> MobileTransaction {
        MobileTransaction(
            id: publicID("transaction", id),
            occurredOn: "2026-09-04",
            displayName: name,
            amount: BootstrapMoney(value: "12.50", currencyCode: "ILS"),
            direction: .debit,
            status: .posted,
            category: BootstrapTransactionCategory(id: publicID("category", 1), label: "Dining"),
            account: BootstrapTransactionAccount(
                id: publicID("account", 1),
                displayName: "Main Card",
                identifierMask: "•••• 4242"
            ),
            needsReview: false,
            excludedFromReports: false,
            owner: MobileTransactionOwner(id: nil, kind: .shared, displayName: nil)
        )
    }
}
#endif
