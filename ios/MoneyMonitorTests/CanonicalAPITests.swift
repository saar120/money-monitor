import Foundation
import XCTest
@testable import MoneyMonitor

final class CanonicalTransportStub: CanonicalTransport, @unchecked Sendable {
    struct Request: Equatable {
        let method: String
        let path: String
        let headers: [String: String]
    }

    private(set) var requests: [Request] = []

    func request(
        method: String,
        path: String,
        body: Data?,
        headers: [String: String]
    ) async throws -> (status: Int, body: Data) {
        requests.append(Request(method: method, path: path, headers: headers))
        if path.hasPrefix("/api/v1/reference?") && method == "GET" {
            return (200, Data(referenceJSON.utf8))
        }
        if path == "/api/v1/reference/1" && method == "PATCH" {
            return (200, Data(referenceJSON.utf8))
        }
        if path == "/api/v1/reference/1?expectedVersion=1" && method == "DELETE" {
            return (200, Data(deleteJSON.utf8))
        }
        if path == "/api/v1/reference/commands/refresh" && method == "POST" {
            return (200, Data(commandJSON.utf8))
        }
        if path == "/api/v1/diagnostics" && method == "GET" {
            return (200, Data(diagnosticsJSON.utf8))
        }
        if path == "/api/v1/pairing/status" && method == "GET" {
            return (200, Data(pairingJSON.utf8))
        }
        return (404, Data(errorJSON.utf8))
    }

    private let referenceJSON = """
    {
      "data": {
        "id": 1,
        "title": "Canonical fixture",
        "amount": { "value": "123.45", "currencyCode": "ILS" },
        "resourceVersion": 1,
        "updatedAt": "2026-08-09T10:00:00.123Z"
      },
      "meta": {
        "apiVersion": "1",
        "generatedAt": "2026-08-09T10:00:00.123Z",
        "source": "mac-authoritative",
        "calculationVersion": "canonical-foundation-1",
        "completeness": "complete",
        "estimated": false,
        "resourceVersion": 1
      }
    }
    """

    private let deleteJSON = """
    {
      "data": { "deletedId": 1 },
      "meta": {
        "apiVersion": "1",
        "generatedAt": "2026-08-09T10:00:00.123Z",
        "source": "mac-authoritative",
        "refreshHints": [{ "domain": "reference", "resourceIds": [1] }]
      }
    }
    """

    private let commandJSON = """
    {
      "data": { "accepted": true, "resourceId": 1 },
      "meta": {
        "apiVersion": "1",
        "generatedAt": "2026-08-09T10:00:00.123Z",
        "source": "mac-authoritative",
        "refreshHints": [{ "domain": "reference", "resourceIds": [1] }],
        "receipt": { "idempotencyKey": "swift-1", "replayed": false }
      }
    }
    """

    private let diagnosticsJSON = """
    {
      "data": { "listener": "mac-local", "capabilities": ["canonical-api"] },
      "meta": {
        "apiVersion": "1",
        "generatedAt": "2026-08-09T10:00:00.123Z",
        "source": "mac-authoritative"
      }
    }
    """

    private let pairingJSON = """
    {
      "data": { "paired": true, "deviceId": "iphone-device-1" },
      "meta": {
        "apiVersion": "1",
        "generatedAt": "2026-08-09T10:00:00.123Z",
        "source": "mac-authoritative"
      }
    }
    """

    private let errorJSON = """
    {
      "error": { "code": "resource_not_found", "message": "The requested resource was not found." },
      "meta": { "apiVersion": "1", "requestId": "request-1" }
    }
    """
}

final class CanonicalURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var lastURL: URL?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lastURL = request.url
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://invalid.example")!,
            statusCode: 200,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class CanonicalAPITests: XCTestCase {
    func testURLSessionTransportPreservesMountedBasePath() async throws {
        CanonicalURLProtocol.lastURL = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CanonicalURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let transport = CanonicalURLSessionTransport(
            baseURL: URL(string: "https://mac.tailnet.ts.net/money-monitor")!,
            session: session
        )

        let result = try await transport.request(
            method: "GET",
            path: "/api/v1/reference?id=1",
            body: nil,
            headers: [:]
        )

        XCTAssertEqual(result.status, 200)
        XCTAssertEqual(
            CanonicalURLProtocol.lastURL?.absoluteString,
            "https://mac.tailnet.ts.net/money-monitor/api/v1/reference?id=1"
        )
    }

    func testGeneratedClientUsesOpenAPIModelsAndFractionalISO8601Dates() async throws {
        let transport = CanonicalTransportStub()
        let client = CanonicalAPIClient(transport: transport, token: "issued-device-token")

        let reference = try await client.getReference()
        XCTAssertEqual(reference.data.amount.value, "123.45")
        XCTAssertEqual(reference.data.amount.currencyCode, "ILS")
        XCTAssertEqual(reference.data.resourceVersion, 1)
        XCTAssertEqual(reference.data.updatedAt.timeIntervalSince1970, 1786269600.123, accuracy: 0.001)

        _ = try await client.updateReference(
            id: 1,
            request: ReferenceUpdateRequest(
                expectedVersion: 1,
                title: "Updated",
                amount: ReferenceUpdateRequestAmount(value: "99.90", currencyCode: "USD")
            )
        )
        _ = try await client.deleteReference(id: 1, expectedVersion: 1)
        _ = try await client.requestReferenceRefresh(
            request: ReferenceCommandRequest(
                resourceId: 1,
                idempotencyKey: "swift-1",
                command: "refresh"
            )
        )
        _ = try await client.getDiagnostics()
        _ = try await client.getPairingStatus()

        XCTAssertEqual(transport.requests.map(\.method), ["GET", "PATCH", "DELETE", "POST", "GET", "GET"])
        XCTAssertEqual(transport.requests[0].path, "/api/v1/reference?id=1")
        XCTAssertEqual(transport.requests[1].path, "/api/v1/reference/1")
        XCTAssertEqual(transport.requests[2].path, "/api/v1/reference/1?expectedVersion=1")
        XCTAssertEqual(transport.requests[0].headers["Authorization"], "Bearer issued-device-token")
    }

    func testGeneratedClientDecodesStableCodedErrors() async throws {
        let transport = CanonicalTransportStub()
        let client = CanonicalAPIClient(transport: transport)

        do {
            _ = try await client.deleteReference(id: 2, expectedVersion: 1)
            XCTFail("Expected a coded error")
        } catch let error as CanonicalAPIError {
            XCTAssertEqual(error, .coded(code: "resource_not_found", requestId: "request-1", status: 404))
        }
    }
}
