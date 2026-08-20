import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

// Keep the app-facing names stable while making the generated schemas the only
// wire-model definitions. These aliases intentionally contain no Codable code.
public typealias Money = Components.Schemas.Money
public typealias CanonicalMeta = Components.Schemas.CanonicalMeta
public typealias CanonicalErrorEnvelope = Components.Schemas.CanonicalErrorEnvelope
public typealias ReferenceResource = Components.Schemas.ReferenceResource
public typealias ReferenceResponse = Components.Schemas.ReferenceResponse
public typealias ReferenceReadQuery = Components.Schemas.ReferenceReadQuery
public typealias ReferenceUpdateRequest = Components.Schemas.ReferenceUpdateRequest
public typealias ReferenceDeleteResponse = Components.Schemas.ReferenceDeleteResponse
public typealias ReferenceDeleteQuery = Components.Schemas.ReferenceDeleteQuery
public typealias ReferenceCommandRequest = Components.Schemas.ReferenceCommandRequest
public typealias ReferenceCommandResponse = Components.Schemas.ReferenceCommandResponse
public typealias DiagnosticsResponse = Components.Schemas.DiagnosticsResponse
public typealias PairingStatusResponse = Components.Schemas.PairingStatusResponse

public typealias ReferenceResourceAmount = Components.Schemas.ReferenceResource.AmountPayload
public typealias ReferenceResponseData = Components.Schemas.ReferenceResponse.DataPayload
public typealias ReferenceResponseMeta = Components.Schemas.ReferenceResponse.MetaPayload
public typealias ReferenceUpdateRequestAmount = Components.Schemas.ReferenceUpdateRequest.AmountPayload
public typealias ReferenceDeleteResponseData = Components.Schemas.ReferenceDeleteResponse.DataPayload
public typealias ReferenceDeleteResponseMeta = Components.Schemas.ReferenceDeleteResponse.MetaPayload
public typealias ReferenceCommandResponseData = Components.Schemas.ReferenceCommandResponse.DataPayload
public typealias ReferenceCommandResponseMeta = Components.Schemas.ReferenceCommandResponse.MetaPayload
public typealias DiagnosticsResponseData = Components.Schemas.DiagnosticsResponse.DataPayload
public typealias DiagnosticsResponseMeta = Components.Schemas.DiagnosticsResponse.MetaPayload
public typealias PairingStatusResponseData = Components.Schemas.PairingStatusResponse.DataPayload
public typealias PairingStatusResponseMeta = Components.Schemas.PairingStatusResponse.MetaPayload
public typealias CanonicalErrorEnvelopeError = Components.Schemas.CanonicalErrorEnvelope._ErrorPayload
public typealias CanonicalErrorEnvelopeMeta = Components.Schemas.CanonicalErrorEnvelope.MetaPayload

// These aliases let app tests provide a generated ClientTransport without
// importing OpenAPIRuntime directly.
public typealias CanonicalHTTPRequest = HTTPRequest
public typealias CanonicalHTTPBody = HTTPBody
public typealias CanonicalHTTPResponse = HTTPResponse
public typealias CanonicalClientTransport = ClientTransport
public typealias CanonicalTransport = ClientTransport
public typealias CanonicalURLSessionTransport = URLSessionTransport

public enum CanonicalAPIError: Error, Equatable {
    case coded(code: String, requestId: String, status: Int)
    case invalidResponse(status: Int)
}

public enum CanonicalRefreshResult: Sendable, Equatable {
    case accepted(ReferenceCommandResponse)
    case unknown(ReferenceResponse)
}

private struct BearerAuthenticationMiddleware: ClientMiddleware {
    let token: String

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.authorization] = "Bearer \(token)"
        return try await next(request, body, baseURL)
    }
}

/// Stable app-facing façade over the generated OpenAPI client.
///
/// The generated `Client` owns request serialization, response decoding, and
/// operation typing. This façade only preserves the small legacy call surface
/// and maps generated response outcomes to the app's stable error enum.
public struct CanonicalAPIClient: Sendable {
    private let client: Client

    private static let configuration = Configuration(
        dateTranscoder: .iso8601WithFractionalSeconds
    )

    public init(transport: any ClientTransport, token: String? = nil) {
        let middlewares: [any ClientMiddleware] = token.map {
            [BearerAuthenticationMiddleware(token: $0)]
        } ?? []
        self.client = Client(
            serverURL: URL(string: "http://127.0.0.1")!,
            configuration: Self.configuration,
            transport: transport,
            middlewares: middlewares
        )
    }

    public init(baseURL: URL, token: String, session: URLSession = .shared) {
        self.client = Client(
            serverURL: baseURL,
            configuration: Self.configuration,
            transport: URLSessionTransport(configuration: .init(session: session)),
            middlewares: [BearerAuthenticationMiddleware(token: token)]
        )
    }

    public func getReference(id: Int? = 1) async throws -> ReferenceResponse {
        let output = try await client.getReference(query: .init(id: id))
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func updateReference(
        id: Int,
        request: ReferenceUpdateRequest
    ) async throws -> ReferenceResponse {
        let output = try await client.updateReference(
            path: .init(id: id),
            body: .json(request)
        )
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func deleteReference(id: Int, expectedVersion: Int) async throws -> ReferenceDeleteResponse {
        let output = try await client.deleteReference(
            path: .init(id: id),
            query: .init(expectedVersion: expectedVersion)
        )
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func requestReferenceRefresh(
        request: ReferenceCommandRequest
    ) async throws -> ReferenceCommandResponse {
        let output = try await client.requestReferenceRefresh(body: .json(request))
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func getDiagnostics() async throws -> DiagnosticsResponse {
        let output = try await client.getDiagnostics()
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func getPairingStatus() async throws -> PairingStatusResponse {
        let output = try await client.getPairingStatus()
        switch output {
        case let .ok(response):
            return try response.body.json
        case let .clientError(statusCode, response):
            throw try codedError(statusCode: statusCode, body: response.body.json)
        case let .undocumented(statusCode, payload):
            throw await undocumentedError(statusCode: statusCode, payload: payload)
        }
    }

    public func requestRefresh(_ request: ReferenceCommandRequest) async throws -> ReferenceCommandResponse {
        try await requestReferenceRefresh(request: request)
    }

    /// Retries a receipt-protected command only when the server reports an
    /// unknown outcome. The same idempotency key is reused for both attempts;
    /// a second unknown outcome is resolved by reading the resource.
    public func requestRefreshWithRecovery(
        _ request: ReferenceCommandRequest
    ) async throws -> CanonicalRefreshResult {
        do {
            return .accepted(try await requestRefresh(request))
        } catch let error as CanonicalAPIError where error.isUnknownOutcome {
            do {
                return .accepted(try await requestRefresh(request))
            } catch let retryError as CanonicalAPIError where retryError.isUnknownOutcome {
                return .unknown(try await getReference(id: request.resourceId))
            }
        }
    }

    private func codedError(
        statusCode: Int,
        body: CanonicalErrorEnvelope
    ) throws -> CanonicalAPIError {
        .coded(
            code: body.error.code.rawValue,
            requestId: body.meta.requestId,
            status: statusCode
        )
    }

    private func undocumentedError(
        statusCode: Int,
        payload: UndocumentedPayload
    ) async -> CanonicalAPIError {
        guard
            let body = payload.body,
            let data = try? await Data(collecting: body, upTo: 1_048_576),
            let envelope = try? JSONDecoder().decode(CanonicalErrorEnvelope.self, from: data)
        else {
            return .invalidResponse(status: statusCode)
        }
        return .coded(
            code: envelope.error.code.rawValue,
            requestId: envelope.meta.requestId,
            status: statusCode
        )
    }
}

private extension CanonicalAPIError {
    var isUnknownOutcome: Bool {
        guard case let .coded(code, _, _) = self else { return false }
        return code == "unknown_outcome"
    }
}

public extension ReferenceCommandRequest {
    /// Compatibility initializer for callers that already hold the literal
    /// command value from the canonical contract.
    init(resourceId: Int, idempotencyKey: String, command: String) {
        self.init(resourceId: resourceId, idempotencyKey: idempotencyKey, command: .refresh)
    }
}
