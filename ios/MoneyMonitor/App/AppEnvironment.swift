import Foundation

@MainActor
final class AppEnvironment: ObservableObject {
    @Published private(set) var connectionState: ConnectionState = .connecting
    @Published private(set) var pairingState: PairingFlowState = .restoring
    @Published private(set) var serverURL: URL?
    @Published private(set) var latestBootstrap: BootstrapSuccessEnvelope?
    @Published private(set) var bootstrapRefreshState: BootstrapRefreshState = .idle

    private let apiClient: any MobileAPIClient
    private let pairingClient: any MobilePairingClient
    private let profileStore: any PairedProfileStore
    private let clock: @Sendable () -> Date
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private var activeOperationID: UUID?
    private var activeRefreshOperationID: UUID?

    init() {
        let store = KeychainPairedProfileStore()
        apiClient = URLSessionMobileAPIClient()
        pairingClient = URLSessionMobilePairingClient(profileStore: store)
        profileStore = store
        clock = { Date() }
        sleep = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    }

    init(apiClient: any MobileAPIClient) {
        let store = KeychainPairedProfileStore()
        self.apiClient = apiClient
        pairingClient = URLSessionMobilePairingClient(profileStore: store)
        profileStore = store
        clock = { Date() }
        sleep = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    }

    init(
        apiClient: any MobileAPIClient,
        pairingClient: any MobilePairingClient,
        profileStore: any PairedProfileStore,
        clock: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    ) {
        self.apiClient = apiClient
        self.pairingClient = pairingClient
        self.profileStore = profileStore
        self.clock = clock
        self.sleep = sleep
    }

    func connect(to rawAddress: String) async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        activeOperationID = nil
        invalidateBootstrapRefresh()
        pairingState = .idle
        latestBootstrap = nil

        guard let baseURL = Self.normalizedHTTPSURL(from: rawAddress) else {
            connectionState = .failed(
                message: "Enter the private HTTPS address shown by Money Monitor on your Mac."
            )
            return
        }

        connectionState = .connecting

        do {
            let health = try await apiClient.health(baseURL: baseURL)
            guard health.data.status == "ok", health.meta.apiVersion == "1" else {
                connectionState = .failed(message: "The Mac returned an unexpected health status.")
                return
            }

            serverURL = baseURL
            connectionState = .connected(lastCheckedAt: health.meta.generatedAt)
        } catch {
            connectionState = .failed(
                message: "Couldn’t reach Money Monitor. Check that the Mac and Tailscale are available."
            )
        }
    }

    func restoreSavedConnection() async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        let operationID = beginOperation(state: .restoring)

        do {
            guard let credential = try await profileStore.load() else {
                finishAsNotConfigured(operationID: operationID)
                return
            }
            try ensureActive(operationID)

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActive(operationID)
            finishConnected(
                credential: credential,
                bootstrap: bootstrap,
                operationID: operationID
            )
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                do {
                    try await profileStore.delete()
                } catch {
                    finish(
                        error: error,
                        operationID: operationID,
                        fallbackFailure: .secureStorageUnavailable
                    )
                    return
                }
                finish(
                    error: error,
                    operationID: operationID,
                    fallbackFailure: .savedAccessRevoked
                )
                return
            }
            finish(
                error: error,
                operationID: operationID,
                fallbackFailure: .savedConnectionUnavailable
            )
        }
    }

    func pair(qrPayload: Data, deviceName: String) async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        let operationID = beginOperation(state: .starting)
        var credentialWasStored = false

        do {
            let effectiveDeviceName = await effectiveDeviceName(
                requestedName: deviceName,
                qrPayload: qrPayload
            )
            try ensureActive(operationID)
            var session = try await pairingClient.start(
                qrPayload: qrPayload,
                deviceName: effectiveDeviceName
            )
            try ensureActive(operationID)

            while session.progress.state == .pendingApproval {
                let remaining = session.expiresAt.timeIntervalSince(clock())
                guard remaining > 0 else {
                    throw MobileClientError.pairing(.expired)
                }
                guard let pollAfterSeconds = session.progress.pollAfterSeconds,
                      pollAfterSeconds > 0
                else {
                    throw MobileClientError.invalidPayload
                }

                pairingState = .waitingForApproval(expiresAt: session.expiresAt)
                try await sleep(min(TimeInterval(pollAfterSeconds), remaining))
                try ensureActive(operationID)

                guard session.expiresAt > clock() else {
                    throw MobileClientError.pairing(.expired)
                }
                session = try await pairingClient.status(for: session)
                try ensureActive(operationID)
            }

            pairingState = .securingConnection
            try ensureActive(operationID)
            let credential = try await pairingClient.exchange(session)
            credentialWasStored = true
            try ensureActive(operationID)

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActive(operationID)
            finishConnected(
                credential: credential,
                bootstrap: bootstrap,
                operationID: operationID
            )
        } catch {
            finish(
                error: error,
                operationID: operationID,
                fallbackFailure: credentialWasStored
                    ? .savedConnectionUnavailable
                    : Self.pairingFailure(for: error)
            )
        }
    }

    func refreshBootstrap() async {
        guard
            activeOperationID == nil,
            activeRefreshOperationID == nil,
            case .connected = connectionState
        else {
            return
        }

        let operationID = UUID()
        activeRefreshOperationID = operationID
        bootstrapRefreshState = .refreshing

        do {
            let credential = try await profileStore.load()
            try ensureActiveRefresh(operationID)
            guard let credential else {
                finishRefreshAsNotConfigured(operationID: operationID)
                return
            }

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActiveRefresh(operationID)
            finishRefreshConnected(
                credential: credential,
                bootstrap: bootstrap,
                operationID: operationID
            )
        } catch {
            guard activeRefreshOperationID == operationID else { return }

            if Self.isAuthoritativeRevocation(error) {
                await finishRefreshAsRevoked(operationID: operationID)
                return
            }

            if Task.isCancelled || Self.isCancellation(error) {
                activeRefreshOperationID = nil
                bootstrapRefreshState = .idle
                return
            }

            activeRefreshOperationID = nil
            bootstrapRefreshState = .failed(Self.bootstrapRefreshFailure(for: error))
        }
    }

    func cancelPairing() {
        guard pairingState.isCancellable else { return }
        activeOperationID = nil
        invalidateBootstrapRefresh()
        pairingState = .idle
        connectionState = .notConfigured
        serverURL = nil
        latestBootstrap = nil
    }

    func disconnect() async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        let operationID = beginOperation(state: .disconnecting)
        do {
            try await profileStore.delete()
            try ensureActive(operationID)
            finishAsNotConfigured(operationID: operationID)
        } catch {
            finish(
                error: error,
                operationID: operationID,
                fallbackFailure: .secureStorageUnavailable
            )
        }
    }

    private func beginOperation(state: PairingFlowState) -> UUID {
        let operationID = UUID()
        invalidateBootstrapRefresh()
        activeOperationID = operationID
        pairingState = state
        connectionState = .connecting
        serverURL = nil
        latestBootstrap = nil
        return operationID
    }

    private func ensureActive(_ operationID: UUID) throws {
        try Task.checkCancellation()
        guard activeOperationID == operationID else {
            throw CancellationError()
        }
    }

    private func ensureActiveRefresh(_ operationID: UUID) throws {
        try Task.checkCancellation()
        guard activeRefreshOperationID == operationID, activeOperationID == nil else {
            throw CancellationError()
        }
    }

    private func invalidateBootstrapRefresh() {
        activeRefreshOperationID = nil
        bootstrapRefreshState = .idle
    }

    private var isRefreshRevocationCleanupInProgress: Bool {
        activeRefreshOperationID != nil && pairingState == .disconnecting
    }

    private func finishRefreshConnected(
        credential: PairedMacCredential,
        bootstrap: BootstrapSuccessEnvelope,
        operationID: UUID
    ) {
        guard activeRefreshOperationID == operationID else { return }
        activeRefreshOperationID = nil
        serverURL = credential.profile.baseURL
        latestBootstrap = bootstrap
        connectionState = .connected(lastCheckedAt: bootstrap.meta.generatedAt)
        bootstrapRefreshState = .idle
    }

    private func finishRefreshAsNotConfigured(operationID: UUID) {
        guard activeRefreshOperationID == operationID else { return }
        activeRefreshOperationID = nil
        serverURL = nil
        latestBootstrap = nil
        pairingState = .idle
        connectionState = .notConfigured
        bootstrapRefreshState = .failed(.missingCredential)
    }

    private func finishRefreshAsRevoked(operationID: UUID) async {
        guard activeRefreshOperationID == operationID else { return }

        // Clear financial memory immediately, but keep setup blocked until the
        // revoked credential has actually been removed from Keychain.
        serverURL = nil
        latestBootstrap = nil
        pairingState = .disconnecting
        connectionState = .connecting

        do {
            try await profileStore.delete()
            guard activeRefreshOperationID == operationID else { return }
            activeRefreshOperationID = nil
            pairingState = .failed(.savedAccessRevoked)
            connectionState = .notConfigured
            bootstrapRefreshState = .failed(.accessRevoked)
        } catch {
            guard activeRefreshOperationID == operationID else { return }
            activeRefreshOperationID = nil
            pairingState = .failed(.secureStorageUnavailable)
            connectionState = .failed(message: PairingFlowFailure.secureStorageUnavailable.message)
            bootstrapRefreshState = .failed(.secureStorageUnavailable)
        }
    }

    private func finishConnected(
        credential: PairedMacCredential,
        bootstrap: BootstrapSuccessEnvelope,
        operationID: UUID
    ) {
        guard activeOperationID == operationID else { return }
        activeOperationID = nil
        serverURL = credential.profile.baseURL
        latestBootstrap = bootstrap
        pairingState = .idle
        connectionState = .connected(lastCheckedAt: bootstrap.meta.generatedAt)
    }

    private func finishAsNotConfigured(operationID: UUID) {
        guard activeOperationID == operationID else { return }
        activeOperationID = nil
        pairingState = .idle
        connectionState = .notConfigured
    }

    private func finish(
        error: any Error,
        operationID: UUID,
        fallbackFailure: PairingFlowFailure
    ) {
        guard activeOperationID == operationID else { return }
        activeOperationID = nil

        if Task.isCancelled || Self.isCancellation(error) {
            pairingState = .idle
            connectionState = .notConfigured
            return
        }

        let failure: PairingFlowFailure
        switch fallbackFailure {
        case .savedAccessRevoked, .savedConnectionUnavailable, .secureStorageUnavailable:
            failure = fallbackFailure
        default:
            failure = Self.pairingFailure(for: error)
        }
        pairingState = .failed(failure)
        if failure == .secureStorageUnavailable {
            connectionState = .failed(message: failure.message)
        } else {
            connectionState = .notConfigured
        }
    }

    private static func isCancellation(_ error: any Error) -> Bool {
        if error is CancellationError { return true }
        return (error as? MobileClientError) == .transport(.cancelled)
    }

    private static func isAuthoritativeRevocation(_ error: any Error) -> Bool {
        guard let error = error as? MobileClientError else { return false }
        switch error {
        case .authentication(.expired), .authentication(.revoked):
            return true
        default:
            return false
        }
    }

    private static func bootstrapRefreshFailure(
        for error: any Error
    ) -> BootstrapRefreshFailure {
        if error is SecureItemError || error is PairedProfileStoreError {
            return .secureStorageUnavailable
        }

        guard let error = error as? MobileClientError else {
            return .unavailable
        }

        switch error {
        case .transport, .rateLimited, .server:
            return .unavailable
        case .upgradeRequired:
            return .incompatible
        case .invalidRequest, .invalidResponse, .invalidPayload, .identityMismatch,
             .authentication, .authorization, .pairing, .credentialStorageFailed:
            return .invalidResponse
        }
    }

    private func effectiveDeviceName(
        requestedName: String,
        qrPayload: Data
    ) async -> String {
        guard
            let existing = try? await profileStore.load(),
            let qr = try? ValidatedPairingQRCodePayload(data: qrPayload, now: clock()),
            existing.profile.serverID == qr.serverID
        else {
            return requestedName
        }

        // A re-pair rotates the existing server-side device row. Preserve its
        // registered name so a local device rename cannot break response binding
        // after the old token has already been invalidated.
        return existing.profile.deviceName
    }

    private static func pairingFailure(for error: any Error) -> PairingFlowFailure {
        guard let error = error as? MobileClientError else {
            return .unexpectedResponse
        }

        switch error {
        case .pairing(.invalidPayload), .invalidRequest:
            return .invalidCode
        case .pairing(.expired), .pairing(.replayed):
            return .expiredCode
        case .pairing(.rejected):
            return .rejected
        case .transport:
            return .macUnavailable
        case .upgradeRequired:
            return .incompatibleVersion
        case .identityMismatch:
            return .identityMismatch
        case .credentialStorageFailed:
            return .secureStorageUnavailable
        case .invalidResponse, .invalidPayload, .authentication, .authorization,
             .pairing(.approvalRequired), .pairing(.exchangeInProgress), .rateLimited,
             .server:
            return .unexpectedResponse
        }
    }

    private static func normalizedHTTPSURL(from rawAddress: String) -> URL? {
        let trimmed = rawAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let address = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard
            let components = URLComponents(string: address),
            components.scheme?.lowercased() == "https",
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            !components.path.contains(".."),
            let url = components.url
        else {
            return nil
        }

        return url
    }
}
