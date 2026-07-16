import Foundation
import Testing
@testable import MoneyMonitor

struct APIEndpointTests {
    @Test
    func healthEndpointAppendsToBaseURL() {
        let baseURL = URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!

        #expect(
            APIEndpoint.health.url(relativeTo: baseURL).absoluteString
                == "https://money-monitor.example.ts.net:8443/money-monitor/api/mobile/v1/health"
        )
    }

    @Test
    func everyEndpointPreservesTheMoneyMonitorBasePath() {
        let baseURL = URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!
        let expectedPaths: [(APIEndpoint, String)] = [
            (.health, "/money-monitor/api/mobile/v1/health"),
            (.pairingStart, "/money-monitor/api/mobile/v1/pairing/start"),
            (.pairingStatus, "/money-monitor/api/mobile/v1/pairing/status"),
            (.pairingExchange, "/money-monitor/api/mobile/v1/pairing/exchange"),
            (.bootstrap, "/money-monitor/api/mobile/v1/bootstrap"),
            (
                .transactions(MobileTransactionQuery()),
                "/money-monitor/api/mobile/v1/transactions"
            ),
            (
                .transactionDetail(id: "transaction_\(String(repeating: "T", count: 22))"),
                "/money-monitor/api/mobile/v1/transactions/transaction_\(String(repeating: "T", count: 22))"
            ),
        ]

        for (endpoint, expectedPath) in expectedPaths {
            #expect(endpoint.url(relativeTo: baseURL).path == expectedPath)
        }
    }

    @Test
    func onlyFinancialReadEndpointsAllowDeviceAuthorization() {
        #expect(APIEndpoint.bootstrap.authorizationPolicy == .deviceBearer)
        #expect(
            APIEndpoint.transactions(MobileTransactionQuery()).authorizationPolicy
                == .deviceBearer
        )
        #expect(
            APIEndpoint.transactionDetail(
                id: "transaction_\(String(repeating: "T", count: 22))"
            ).authorizationPolicy == .deviceBearer
        )
        #expect(APIEndpoint.health.authorizationPolicy == .none)
        #expect(APIEndpoint.pairingStart.authorizationPolicy == .none)
        #expect(APIEndpoint.pairingStatus.authorizationPolicy == .none)
        #expect(APIEndpoint.pairingExchange.authorizationPolicy == .none)
    }

    @Test
    func requestFactoryRejectsAuthorizationOnPublicAndPairingEndpoints() throws {
        let baseURL = URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!
        let token = String(repeating: "T", count: 43)

        for endpoint in [
            APIEndpoint.health,
            .pairingStart,
            .pairingStatus,
            .pairingExchange,
        ] {
            #expect(throws: MobileRequestConstructionError.authorizationPolicyViolation) {
                try MobileRequestFactory.makeRequest(
                    endpoint: endpoint,
                    baseURL: baseURL,
                    bearerToken: token
                )
            }
        }
    }

    @Test
    func mobileRequestsBypassImplicitURLCaches() throws {
        let baseURL = URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!

        let request = try MobileRequestFactory.makeRequest(
            endpoint: .health,
            baseURL: baseURL
        )

        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
    }

    @Test
    func defaultMobileSessionConfigurationIsEphemeralAndCacheless() {
        let configuration = MobileURLSessionFactory.makeConfiguration()

        #expect(configuration.identifier == nil)
        #expect(configuration.requestCachePolicy == .reloadIgnoringLocalCacheData)
        #expect(configuration.urlCache == nil)
        #expect(configuration.httpCookieStorage == nil)
        #expect(configuration.urlCredentialStorage == nil)
        #expect(configuration.httpShouldSetCookies == false)
    }

    @Test
    func healthResponseDecodesISO8601Timestamp() throws {
        let payload = Data(
            #"{"data":{"status":"ok"},"meta":{"apiVersion":"1","generatedAt":"2026-07-14T12:00:00.000Z","source":"live"}}"#.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let response = try decoder.decode(HealthResponse.self, from: payload)

        #expect(response.data.status == "ok")
        #expect(response.meta.apiVersion == "1")
        #expect(response.meta.source == "live")
    }

    @Test
    func transactionQueryUsesExactWireNamesAndOmitsFalseFlags() throws {
        let query = MobileTransactionQuery(
            query: "  קפה & tea  ",
            cursor: "cursor_v1_abc-DEF_123",
            limit: 25,
            startDate: "2026-07-01",
            endDate: "2026-07-16",
            direction: .debit,
            status: .pending,
            needsReview: true,
            includeExcluded: false,
            accountID: "account_\(String(repeating: "A", count: 22))"
        )

        let url = APIEndpoint.transactions(query).url(
            relativeTo: URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!
        )
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let values = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )

        #expect(values["q"] == "קפה & tea")
        #expect(values["cursor"] == "cursor_v1_abc-DEF_123")
        #expect(values["limit"] == "25")
        #expect(values["startDate"] == "2026-07-01")
        #expect(values["endDate"] == "2026-07-16")
        #expect(values["direction"] == "debit")
        #expect(values["status"] == "pending")
        #expect(values["needsReview"] == "true")
        #expect(values["includeExcluded"] == nil)
        #expect(values["accountId"] == "account_\(String(repeating: "A", count: 22))")
    }
}
