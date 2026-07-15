import Foundation

protocol MobileAPIClient: Sendable {
    func health(baseURL: URL) async throws -> HealthResponse
    func bootstrap(credential: PairedMacCredential) async throws -> BootstrapSuccessEnvelope
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
