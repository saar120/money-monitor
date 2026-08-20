import Foundation

protocol MobilePairingClient: Sendable {
    func start(qrPayload: Data, deviceName: String) async throws -> MobilePairingSession
    func status(for session: MobilePairingSession) async throws -> MobilePairingSession
    func exchange(_ session: MobilePairingSession) async throws -> PairedMacCredential
}

struct URLSessionMobilePairingClient: MobilePairingClient, Sendable {
    private let transport: any MobileHTTPTransport
    private let profileStore: any PairedProfileStore
    private let clock: @Sendable () -> Date
    private let payloadDecoder: BootstrapPayloadDecoder

    init(
        session: URLSession = MobileURLSessionFactory.makeSession(),
        profileStore: any PairedProfileStore = KeychainPairedProfileStore()
    ) {
        self.init(
            transport: URLSessionMobileHTTPTransport(session: session),
            profileStore: profileStore
        )
    }

    init(
        transport: any MobileHTTPTransport,
        profileStore: any PairedProfileStore,
        clock: @escaping @Sendable () -> Date = { Date() },
        payloadDecoder: BootstrapPayloadDecoder = BootstrapPayloadDecoder()
    ) {
        self.transport = transport
        self.profileStore = profileStore
        self.clock = clock
        self.payloadDecoder = payloadDecoder
    }

    func start(qrPayload: Data, deviceName: String) async throws -> MobilePairingSession {
        let payload: ValidatedPairingQRCodePayload
        let startInput: PairingStartRequest
        do {
            payload = try ValidatedPairingQRCodePayload(data: qrPayload, now: clock())
            startInput = try payload.makeStartRequest(deviceName: deviceName)
        } catch let error as PairingPayloadValidationError {
            if error == .expired { throw MobileClientError.pairing(.expired) }
            throw MobileClientError.pairing(.invalidPayload)
        } catch {
            throw MobileClientError.pairing(.invalidPayload)
        }

        let started = try await sendProgress(
            endpoint: .pairingStart,
            baseURL: payload.baseURL,
            body: startInput,
            expectsClaimantSecret: true
        )
        guard let claimantSecret = started.claimantSecret else {
            throw MobileClientError.invalidPayload
        }
        let progress = started.progress
        let expiry = progress.expiresAt ?? payload.expiresAt

        return MobilePairingSession(
            pairingID: payload.pairingID,
            serverID: payload.serverID,
            baseURL: payload.baseURL,
            protocolVersion: payload.protocolVersion,
            deviceName: startInput.deviceName,
            expiresAt: expiry,
            progress: progress,
            claimantSecret: claimantSecret
        )
    }

    func status(for session: MobilePairingSession) async throws -> MobilePairingSession {
        try validateUsable(session)
        let progress = try await sendProgress(
            endpoint: .pairingStatus,
            baseURL: session.baseURL,
            body: session.makeClaimantRequest(),
            expectsClaimantSecret: false
        ).progress
        return session.updating(with: progress)
    }

    func exchange(_ session: MobilePairingSession) async throws -> PairedMacCredential {
        try validateUsable(session)
        guard session.progress.state == .approved else {
            throw MobileClientError.pairing(.approvalRequired)
        }

        let body: Data
        do {
            body = try JSONEncoder().encode(session.makeClaimantRequest())
        } catch {
            throw MobileClientError.invalidRequest
        }

        let response = try await send(
            endpoint: .pairingExchange,
            baseURL: session.baseURL,
            body: body
        )

        let credential: PairedMacCredential
        do {
            credential = try decodeCredential(
                from: response.data,
                session: session,
                now: clock()
            )
        } catch {
            throw MobileClientError.invalidPayload
        }

        // The raw token becomes durable only after every response and binding
        // invariant above has passed. A Keychain failure is never success.
        do {
            try await profileStore.savePairing(credential)
        } catch PairedProfileStoreError.differentServer,
                PairedProfileStoreError.differentDevice
        {
            throw MobileClientError.identityMismatch
        } catch {
            throw MobileClientError.credentialStorageFailed
        }
        return credential
    }

    private func sendProgress<Body: Encodable & Sendable>(
        endpoint: APIEndpoint,
        baseURL: URL,
        body: Body,
        expectsClaimantSecret: Bool
    ) async throws -> DecodedPairingProgress {
        let encodedBody: Data
        do {
            encodedBody = try JSONEncoder().encode(body)
        } catch {
            throw MobileClientError.invalidRequest
        }

        let response = try await send(endpoint: endpoint, baseURL: baseURL, body: encodedBody)
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let envelope = try decoder.decode(PairingProgressEnvelope.self, from: response.data)
            return try envelope.validated(
                now: clock(),
                expectsClaimantSecret: expectsClaimantSecret
            )
        } catch let error as MobileClientError {
            throw error
        } catch {
            throw MobileClientError.invalidPayload
        }
    }

    private func send(endpoint: APIEndpoint, baseURL: URL, body: Data) async throws
        -> MobileHTTPResponse
    {
        let request: URLRequest
        do {
            request = try MobileRequestFactory.makeRequest(
                endpoint: endpoint,
                baseURL: baseURL,
                body: body
            )
        } catch {
            throw MobileClientError.invalidRequest
        }

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

    private func validateUsable(_ session: MobilePairingSession) throws {
        guard session.expiresAt > clock() else {
            throw MobileClientError.pairing(.expired)
        }
        guard MobileURLValidation.isSafeHTTPSBaseURL(session.baseURL) else {
            throw MobileClientError.pairing(.invalidPayload)
        }
    }

    private func decodeCredential(
        from data: Data,
        session: MobilePairingSession,
        now: Date
    ) throws -> PairedMacCredential {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(PairingClaimEnvelope.self, from: data)

        guard
            envelope.meta.apiVersion == BootstrapMetadata.supportedAPIVersion,
            envelope.meta.source == BootstrapResponseSource.live.rawValue,
            envelope.data.status == "claimed",
            envelope.data.credential.device.protocolVersion == session.protocolVersion,
            envelope.data.credential.device.revokedAt == nil,
            envelope.data.credential.device.expiresAt.map({ $0 > now }) ?? true
        else {
            throw MobileClientError.invalidPayload
        }

        let device = envelope.data.credential.device
        let profile = try PairedMacProfile(
            serverID: session.serverID,
            baseURL: session.baseURL,
            deviceID: device.id,
            deviceName: device.name,
            capabilities: device.capabilities,
            protocolVersion: device.protocolVersion,
            apiVersion: Int(envelope.meta.apiVersion) ?? 0,
            tokenVersion: device.tokenVersion
        )
        guard profile.deviceName == session.deviceName else {
            throw MobileClientError.identityMismatch
        }
        return try PairedMacCredential(
            profile: profile,
            token: envelope.data.credential.token
        )
    }
}

private struct PairingProgressEnvelope: Decodable {
    let data: PairingProgressData
    let meta: MobileResponseMetadata

    func validated(now: Date, expectsClaimantSecret: Bool) throws -> DecodedPairingProgress {
        guard
            meta.apiVersion == BootstrapMetadata.supportedAPIVersion,
            meta.source == BootstrapResponseSource.live.rawValue,
            let state = PairingApprovalState(rawValue: data.status)
        else {
            throw MobileClientError.invalidPayload
        }

        let claimantSecret = data.claimantSecret
        if expectsClaimantSecret {
            guard
                let claimantSecret,
                claimantSecret.range(
                    of: #"^[A-Za-z0-9_-]{43}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw MobileClientError.invalidPayload
            }
        } else if claimantSecret != nil {
            throw MobileClientError.invalidPayload
        }

        switch state {
        case .pendingApproval:
            guard
                let expiresAt = data.expiresAt,
                expiresAt > now,
                let pollAfterSeconds = data.pollAfterSeconds,
                (1 ... 30).contains(pollAfterSeconds)
            else {
                throw MobileClientError.invalidPayload
            }
        case .approved:
            break
        }

        return DecodedPairingProgress(
            progress: PairingProgress(
                state: state,
                expiresAt: data.expiresAt,
                pollAfterSeconds: data.pollAfterSeconds
            ),
            claimantSecret: claimantSecret
        )
    }
}

private struct PairingProgressData: Decodable {
    let status: String
    let expiresAt: Date?
    let pollAfterSeconds: Int?
    let claimantSecret: String?
}

private struct DecodedPairingProgress: Sendable {
    let progress: PairingProgress
    let claimantSecret: String?
}

private struct PairingClaimEnvelope: Decodable {
    let data: PairingClaimData
    let meta: MobileResponseMetadata
}

private struct PairingClaimData: Decodable {
    let status: String
    let credential: PairingClaimCredential
}

private struct PairingClaimCredential: Decodable, CustomStringConvertible, CustomDebugStringConvertible {
    let device: PairingClaimDevice
    let token: String

    var description: String {
        "PairingClaimCredential(deviceID: \(device.id), token: <redacted>)"
    }

    var debugDescription: String { description }
}

private struct PairingClaimDevice: Decodable {
    let id: String
    let name: String
    let capabilities: [String]
    let protocolVersion: Int
    let tokenVersion: Int
    let createdAt: Date
    let lastUsedAt: Date?
    let expiresAt: Date?
    let rotatedAt: Date?
    let revokedAt: Date?
}
