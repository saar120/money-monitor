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
        ]

        for (endpoint, expectedPath) in expectedPaths {
            #expect(endpoint.url(relativeTo: baseURL).path == expectedPath)
        }
    }

    @Test
    func onlyBootstrapAllowsDeviceAuthorization() {
        #expect(APIEndpoint.bootstrap.authorizationPolicy == .deviceBearer)
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
}
