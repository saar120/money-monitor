import Foundation
import Testing
@testable import MoneyMonitor

private final class MobileAPIFixtureBundleToken: NSObject {}

private enum MobileAPITestError: Error {
    case missingFixture(String)
    case noStubbedResponse
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

struct MobileAPIClientTests {
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
}
