import CryptoKit
import Foundation
import LocalAuthentication
import Security

enum DeviceAuthenticationOutcome: Sendable {
    case success
    case cancelled
    case unavailable
    case failed
}

protocol DeviceAuthenticationClient: Sendable {
    func authenticateDeviceOwner() async -> DeviceAuthenticationOutcome
}

struct SystemDeviceAuthenticationClient: DeviceAuthenticationClient, Sendable {
    func authenticateDeviceOwner() async -> DeviceAuthenticationOutcome {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return .unavailable
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock Money Monitor to view your saved financial data."
            ) { success, error in
                guard success else {
                    let laError = error as? LAError
                    continuation.resume(
                        returning: laError?.code == .userCancel || laError?.code == .systemCancel
                            ? .cancelled
                            : .failed
                    )
                    return
                }
                continuation.resume(returning: .success)
            }
        }
    }
}

enum BootstrapSnapshotStoreError: Error, Equatable {
    case invalidSnapshot
    case missingEncryptionKey
    case encryptionFailed
    case decryptionFailed
    case unsupportedVersion
    case serverMismatch
}

struct BootstrapSnapshot: Codable, Equatable, Sendable {
    static let currentVersion = 1

    let version: Int
    let serverID: UUID
    let savedAt: Date
    let bootstrap: BootstrapSuccessEnvelope
    /// Optional to preserve compatibility with encrypted snapshots written
    /// before Phase 3. This is mobile-safe data only, never a desktop row.
    let planning: MobilePlanningSnapshot?
    /// One bounded aggregate-only chart response; it shares the same encrypted
    /// snapshot envelope as the rest of the mobile-safe planning data.
    let netWorthHistory: MobileNetWorthHistory?

    init(
        bootstrap: BootstrapSuccessEnvelope,
        planning: MobilePlanningSnapshot? = nil,
        netWorthHistory: MobileNetWorthHistory? = nil,
        savedAt: Date
    ) {
        version = Self.currentVersion
        serverID = bootstrap.meta.server.id
        self.savedAt = savedAt
        self.bootstrap = bootstrap
        self.planning = planning
        self.netWorthHistory = netWorthHistory
    }
}

protocol BootstrapSnapshotStore: Sendable {
    func load(for serverID: UUID) async throws -> BootstrapSnapshot?
    func save(_ snapshot: BootstrapSnapshot) async throws
    func delete() async throws
}

/// Test-only default for dependency-injected environments. The application
/// initializer uses `EncryptedBootstrapSnapshotStore` instead.
actor TransientBootstrapSnapshotStore: BootstrapSnapshotStore {
    private var snapshot: BootstrapSnapshot?

    func load(for serverID: UUID) async throws -> BootstrapSnapshot? {
        guard let snapshot else { return nil }
        guard snapshot.serverID == serverID else {
            throw BootstrapSnapshotStoreError.serverMismatch
        }
        return snapshot
    }

    func save(_ snapshot: BootstrapSnapshot) async throws {
        self.snapshot = snapshot
    }

    func delete() async throws {
        snapshot = nil
    }
}

/// Stores one complete, mobile-safe bootstrap snapshot. The payload is always
/// encrypted before it reaches Application Support; the random AES key is kept
/// separately in this-device-only Keychain storage.
actor EncryptedBootstrapSnapshotStore: BootstrapSnapshotStore {
    private static let keyAccount = "bootstrap-snapshot-key.v1"
    private static let fileName = "bootstrap-snapshot.v1"

    private let directory: URL
    private let secureItems: any SecureItemClient
    private let keyService: String

    init(
        secureItems: any SecureItemClient = SystemKeychainClient(),
        bundleIdentifier: String = Bundle.main.bundleIdentifier ?? "com.example.MoneyMonitor",
        applicationSupportDirectory: URL? = nil
    ) {
        self.secureItems = secureItems
        keyService = "\(bundleIdentifier).mobile-snapshot"
        directory = applicationSupportDirectory
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("MoneyMonitor", isDirectory: true)
    }

    func load(for serverID: UUID) async throws -> BootstrapSnapshot? {
        let url = snapshotURL
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        guard let key = try await existingEncryptionKey() else {
            throw BootstrapSnapshotStoreError.missingEncryptionKey
        }

        let encrypted = try Data(contentsOf: url)
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.SealedBox(combined: encrypted)
        } catch {
            throw BootstrapSnapshotStoreError.decryptionFailed
        }

        let plaintext: Data
        do {
            plaintext = try AES.GCM.open(sealedBox, using: key)
        } catch {
            throw BootstrapSnapshotStoreError.decryptionFailed
        }

        let snapshot: BootstrapSnapshot
        do {
            snapshot = try JSONDecoder().decode(BootstrapSnapshot.self, from: plaintext)
        } catch {
            throw BootstrapSnapshotStoreError.invalidSnapshot
        }

        guard snapshot.version == BootstrapSnapshot.currentVersion else {
            throw BootstrapSnapshotStoreError.unsupportedVersion
        }
        guard snapshot.serverID == serverID, snapshot.bootstrap.meta.server.id == serverID else {
            throw BootstrapSnapshotStoreError.serverMismatch
        }
        guard Self.isCacheableComplete(snapshot.bootstrap) else {
            throw BootstrapSnapshotStoreError.invalidSnapshot
        }
        return snapshot
    }

    func save(_ snapshot: BootstrapSnapshot) async throws {
        guard
            snapshot.version == BootstrapSnapshot.currentVersion,
            snapshot.serverID == snapshot.bootstrap.meta.server.id,
            Self.isCacheableComplete(snapshot.bootstrap)
        else {
            throw BootstrapSnapshotStoreError.invalidSnapshot
        }

        let plaintext = try JSONEncoder().encode(snapshot)
        let key = try await encryptionKey()
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.seal(plaintext, using: key)
        } catch {
            throw BootstrapSnapshotStoreError.encryptionFailed
        }
        guard let encrypted = sealedBox.combined else {
            throw BootstrapSnapshotStoreError.encryptionFailed
        }

        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [FileAttributeKey.protectionKey: FileProtectionType.complete]
        )
        try encrypted.write(to: snapshotURL, options: .atomic)
        try FileManager.default.setAttributes(
            [FileAttributeKey.protectionKey: FileProtectionType.complete],
            ofItemAtPath: snapshotURL.path
        )
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        var protectedURL = snapshotURL
        try protectedURL.setResourceValues(resourceValues)
    }

    func delete() async throws {
        let url = snapshotURL
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try await secureItems.delete(service: keyService, account: Self.keyAccount)
    }

    private var snapshotURL: URL {
        directory.appendingPathComponent(Self.fileName, isDirectory: false)
    }

    private func existingEncryptionKey() async throws -> SymmetricKey? {
        guard let data = try await secureItems.read(service: keyService, account: Self.keyAccount) else {
            return nil
        }
        guard data.count == 32 else {
            throw BootstrapSnapshotStoreError.invalidSnapshot
        }
        return SymmetricKey(data: data)
    }

    private func encryptionKey() async throws -> SymmetricKey {
        if let key = try await existingEncryptionKey() { return key }

        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw SecureItemError.unexpectedStatus(status)
        }
        let data = Data(bytes)
        do {
            try await secureItems.add(data: data, service: keyService, account: Self.keyAccount)
        } catch SecureItemError.duplicateItem {
            guard let key = try await existingEncryptionKey() else {
                throw BootstrapSnapshotStoreError.missingEncryptionKey
            }
            return key
        }
        return SymmetricKey(data: data)
    }

    private static func isCacheableComplete(_ bootstrap: BootstrapSuccessEnvelope) -> Bool {
        bootstrap.meta.cacheability.status == .cacheable
            && bootstrap.meta.completeness.status == .complete
    }
}

@MainActor
final class AppEnvironment: ObservableObject {
    @Published private(set) var connectionState: ConnectionState = .connecting
    @Published private(set) var pairingState: PairingFlowState = .restoring
    @Published private(set) var serverURL: URL?
    @Published private(set) var latestBootstrap: BootstrapSuccessEnvelope?
    @Published private(set) var latestPlanningSnapshot: MobilePlanningSnapshot?
    @Published private(set) var latestNetWorthHistory: MobileNetWorthHistory?
    @Published private(set) var bootstrapRefreshState: BootstrapRefreshState = .idle
    @Published private(set) var snapshotState: BootstrapSnapshotState = .none
    @Published private(set) var financialContentLockState: FinancialContentLockState = .notRequired

    private let apiClient: any MobileAPIClient
    private let transactionClient: any MobileTransactionAPIClient
    private let planningClient: any MobilePlanningAPIClient
    private let netWorthHistoryClient: any MobileNetWorthHistoryAPIClient
    private let reviewCommandClient: any MobileReviewCommandAPIClient
    private let pairingClient: any MobilePairingClient
    private let profileStore: any PairedProfileStore
    private let snapshotStore: any BootstrapSnapshotStore
    private let deviceAuthenticator: any DeviceAuthenticationClient
    private let clock: @Sendable () -> Date
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private var activeOperationID: UUID?
    private var activeRefreshOperationID: UUID?
    private var featureRevocationCleanupInProgress = false
    private var mobileReadEpoch = 0
    private var lastBackgroundedAt: Date?

    init() {
        let store = KeychainPairedProfileStore()
        let client = URLSessionMobileAPIClient()
        apiClient = client
        transactionClient = client
        planningClient = client
        netWorthHistoryClient = client
        reviewCommandClient = client
        pairingClient = URLSessionMobilePairingClient(profileStore: store)
        profileStore = store
        snapshotStore = EncryptedBootstrapSnapshotStore()
        deviceAuthenticator = SystemDeviceAuthenticationClient()
        clock = { Date() }
        sleep = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    }

    init(apiClient: any MobileAPIClient) {
        let store = KeychainPairedProfileStore()
        self.apiClient = apiClient
        transactionClient = (apiClient as? any MobileTransactionAPIClient)
            ?? UnavailableMobileTransactionAPIClient()
        planningClient = (apiClient as? any MobilePlanningAPIClient)
            ?? UnavailableMobilePlanningAPIClient()
        netWorthHistoryClient = (apiClient as? any MobileNetWorthHistoryAPIClient)
            ?? UnavailableMobileNetWorthHistoryAPIClient()
        reviewCommandClient = (apiClient as? any MobileReviewCommandAPIClient)
            ?? UnavailableMobileReviewCommandAPIClient()
        pairingClient = URLSessionMobilePairingClient(profileStore: store)
        profileStore = store
        snapshotStore = EncryptedBootstrapSnapshotStore()
        deviceAuthenticator = SystemDeviceAuthenticationClient()
        clock = { Date() }
        sleep = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    }

    init(
        apiClient: any MobileAPIClient,
        transactionClient: (any MobileTransactionAPIClient)? = nil,
        planningClient: (any MobilePlanningAPIClient)? = nil,
        netWorthHistoryClient: (any MobileNetWorthHistoryAPIClient)? = nil,
        reviewCommandClient: (any MobileReviewCommandAPIClient)? = nil,
        pairingClient: any MobilePairingClient,
        profileStore: any PairedProfileStore,
        snapshotStore: any BootstrapSnapshotStore = TransientBootstrapSnapshotStore(),
        deviceAuthenticator: any DeviceAuthenticationClient = SystemDeviceAuthenticationClient(),
        clock: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { seconds in
            try await Task.sleep(for: .seconds(seconds))
        }
    ) {
        self.apiClient = apiClient
        self.transactionClient = transactionClient
            ?? (apiClient as? any MobileTransactionAPIClient)
            ?? UnavailableMobileTransactionAPIClient()
        self.planningClient = planningClient
            ?? (apiClient as? any MobilePlanningAPIClient)
            ?? UnavailableMobilePlanningAPIClient()
        self.netWorthHistoryClient = netWorthHistoryClient
            ?? (apiClient as? any MobileNetWorthHistoryAPIClient)
            ?? UnavailableMobileNetWorthHistoryAPIClient()
        self.reviewCommandClient = reviewCommandClient
            ?? (apiClient as? any MobileReviewCommandAPIClient)
            ?? UnavailableMobileReviewCommandAPIClient()
        self.pairingClient = pairingClient
        self.profileStore = profileStore
        self.snapshotStore = snapshotStore
        self.deviceAuthenticator = deviceAuthenticator
        self.clock = clock
        self.sleep = sleep
    }

    func connect(to rawAddress: String) async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        advanceMobileReadEpoch()
        activeOperationID = nil
        invalidateBootstrapRefresh()
        pairingState = .idle
        latestBootstrap = nil
        latestPlanningSnapshot = nil

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

            await restoreSnapshotIfUsable(for: credential, operationID: operationID)
            try ensureActive(operationID)

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActive(operationID)
            try await saveSnapshot(bootstrap, operationID: operationID)
            try ensureActive(operationID)
            finishConnected(
                credential: credential,
                bootstrap: bootstrap,
                operationID: operationID
            )
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                do {
                    try await deleteSecureAccess()
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
            if latestBootstrap != nil {
                activeOperationID = nil
                pairingState = .idle
                bootstrapRefreshState = .failed(Self.bootstrapRefreshFailure(for: error))
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
            try await saveSnapshot(bootstrap, operationID: operationID)
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
            try await saveSnapshot(bootstrap, refreshOperationID: operationID)
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

    var isFinancialContentLocked: Bool {
        financialContentLockState.isLocked
    }

    func unlockFinancialContent() async {
        guard financialContentLockState == .locked else { return }
        financialContentLockState = .authenticating
        switch await deviceAuthenticator.authenticateDeviceOwner() {
        case .success:
            financialContentLockState = .unlocked
        case .cancelled, .unavailable, .failed:
            financialContentLockState = .locked
        }
    }

    func scenePhaseChanged(isActive: Bool) {
        if !isActive {
            lastBackgroundedAt = clock()
            return
        }
        defer { lastBackgroundedAt = nil }
        guard
            financialContentLockState == .unlocked,
            let lastBackgroundedAt,
            clock().timeIntervalSince(lastBackgroundedAt) > Self.backgroundGrace
        else {
            return
        }
        financialContentLockState = .locked
    }

    func transactions(
        query: MobileTransactionQuery
    ) async throws -> MobileTransactionListEnvelope {
        let session = try await mobileReadSession()
        do {
            let envelope = try await transactionClient.transactions(
                query: query,
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            return envelope
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            throw error
        }
    }

    func transactionDetail(id: String) async throws -> MobileTransactionDetailEnvelope {
        let session = try await mobileReadSession()
        do {
            let envelope = try await transactionClient.transactionDetail(
                id: id,
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            return envelope
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            throw error
        }
    }

    /// Commands are live-only. This method never reads from or writes to the
    /// encrypted snapshot cache, so a cached/offline screen cannot imply that
    /// a review was queued or accepted.
    func resolveReview(
        transactionID: String,
        categoryID: String,
        idempotencyKey: String
    ) async throws -> MobileReviewCommandEnvelope {
        let session = try await mobileReadSession()
        do {
            let envelope = try await reviewCommandClient.resolveReview(
                command: MobileReviewResolveCommand(
                    idempotencyKey: idempotencyKey,
                    transactionID: transactionID,
                    categoryID: categoryID
                ),
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            return envelope
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            throw error
        }
    }

    func skipReview(
        transactionID: String,
        idempotencyKey: String
    ) async throws -> MobileReviewCommandEnvelope {
        let session = try await mobileReadSession()
        do {
            let envelope = try await reviewCommandClient.skipReview(
                command: MobileReviewSkipCommand(
                    idempotencyKey: idempotencyKey,
                    transactionID: transactionID
                ),
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            return envelope
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            throw error
        }
    }

    func planningSnapshot() async throws -> MobilePlanningSnapshot {
        let session = try await mobileReadSession()
        do {
            let envelope = try await planningClient.planningSnapshot(credential: session.credential)
            try ensureCurrentMobileReadEpoch(session.epoch)
            latestPlanningSnapshot = envelope.data
            if let bootstrap = latestBootstrap {
                try await snapshotStore.save(
                    BootstrapSnapshot(
                        bootstrap: bootstrap,
                        planning: envelope.data,
                        netWorthHistory: latestNetWorthHistory,
                        savedAt: clock()
                    )
                )
            }
            return envelope.data
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            if let latestPlanningSnapshot, Self.isRecoverablePlanningRead(error) {
                return latestPlanningSnapshot
            }
            throw error
        }
    }

    func netWorthHistory(range: MobileNetWorthHistoryRange) async throws -> MobileNetWorthHistory {
        let session = try await mobileReadSession()
        do {
            let envelope = try await netWorthHistoryClient.netWorthHistory(
                range: range,
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            latestNetWorthHistory = envelope.data
            if let bootstrap = latestBootstrap {
                try await snapshotStore.save(
                    BootstrapSnapshot(
                        bootstrap: bootstrap,
                        planning: latestPlanningSnapshot,
                        netWorthHistory: envelope.data,
                        savedAt: clock()
                    )
                )
            }
            return envelope.data
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            if let latestNetWorthHistory,
               latestNetWorthHistory.range == range,
               Self.isRecoverablePlanningRead(error) {
                return latestNetWorthHistory
            }
            throw error
        }
    }

    func cancelPairing() {
        guard pairingState.isCancellable else { return }
        advanceMobileReadEpoch()
        activeOperationID = nil
        invalidateBootstrapRefresh()
        pairingState = .idle
        connectionState = .notConfigured
        serverURL = nil
        latestBootstrap = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
    }

    func disconnect() async {
        guard !isRefreshRevocationCleanupInProgress else { return }
        let operationID = beginOperation(state: .disconnecting)
        do {
            try await deleteSecureAccess()
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
        advanceMobileReadEpoch()
        invalidateBootstrapRefresh()
        activeOperationID = operationID
        pairingState = state
        connectionState = .connecting
        serverURL = nil
        latestBootstrap = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        snapshotState = .none
        financialContentLockState = .notRequired
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
        featureRevocationCleanupInProgress
            || (activeRefreshOperationID != nil && pairingState == .disconnecting)
    }

    private func mobileReadSession() async throws -> (
        credential: PairedMacCredential,
        epoch: Int
    ) {
        let epoch = mobileReadEpoch
        guard
            !isRefreshRevocationCleanupInProgress,
            activeOperationID == nil,
            case .connected = connectionState
        else {
            throw MobileClientError.invalidRequest
        }
        guard let credential = try await profileStore.load() else {
            throw MobileClientError.authentication(.required)
        }
        try ensureCurrentMobileReadEpoch(epoch)
        return (credential, epoch)
    }

    private func ensureCurrentMobileReadEpoch(_ epoch: Int) throws {
        try Task.checkCancellation()
        guard epoch == mobileReadEpoch, case .connected = connectionState else {
            throw CancellationError()
        }
    }

    private func advanceMobileReadEpoch() {
        mobileReadEpoch &+= 1
    }

    private func restoreSnapshotIfUsable(
        for credential: PairedMacCredential,
        operationID: UUID
    ) async {
        do {
            guard let snapshot = try await snapshotStore.load(for: credential.profile.serverID) else {
                return
            }
            guard activeOperationID == operationID else { return }

            if clock().timeIntervalSince(snapshot.savedAt) > Self.snapshotRetention {
                try await snapshotStore.delete()
                return
            }

            latestBootstrap = snapshot.bootstrap
            latestPlanningSnapshot = snapshot.planning
            latestNetWorthHistory = snapshot.netWorthHistory
            serverURL = credential.profile.baseURL
            connectionState = .connected(lastCheckedAt: snapshot.bootstrap.meta.generatedAt)
            snapshotState = freshnessState(for: snapshot.bootstrap.meta.generatedAt)
            if financialContentLockState != .unlocked {
                financialContentLockState = .locked
            }
        } catch {
            guard activeOperationID == operationID else { return }
            latestBootstrap = nil
            snapshotState = .corrupt
            try? await snapshotStore.delete()
        }
    }

    private func saveSnapshot(
        _ bootstrap: BootstrapSuccessEnvelope,
        operationID: UUID
    ) async throws {
        try await snapshotStore.save(
            BootstrapSnapshot(
                bootstrap: bootstrap,
                planning: latestPlanningSnapshot,
                netWorthHistory: latestNetWorthHistory,
                savedAt: clock()
            )
        )
        try ensureActive(operationID)
    }

    private func saveSnapshot(
        _ bootstrap: BootstrapSuccessEnvelope,
        refreshOperationID: UUID
    ) async throws {
        try await snapshotStore.save(
            BootstrapSnapshot(
                bootstrap: bootstrap,
                planning: latestPlanningSnapshot,
                netWorthHistory: latestNetWorthHistory,
                savedAt: clock()
            )
        )
        try ensureActiveRefresh(refreshOperationID)
    }

    private func deleteSecureAccess() async throws {
        try await snapshotStore.delete()
        try await profileStore.delete()
        latestBootstrap = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        snapshotState = .none
        financialContentLockState = .notRequired
    }

    private func freshnessState(for generatedAt: Date) -> BootstrapSnapshotState {
        if clock().timeIntervalSince(generatedAt) > Self.snapshotStaleThreshold {
            return .stale(generatedAt: generatedAt)
        }
        return .cached(generatedAt: generatedAt)
    }

    private func finishFeatureReadAsRevoked(expectedEpoch: Int) async throws {
        guard
            expectedEpoch == mobileReadEpoch,
            !isRefreshRevocationCleanupInProgress,
            activeOperationID == nil,
            case .connected = connectionState
        else {
            throw CancellationError()
        }
        featureRevocationCleanupInProgress = true
        advanceMobileReadEpoch()
        activeOperationID = nil
        invalidateBootstrapRefresh()
        serverURL = nil
        latestBootstrap = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        pairingState = .disconnecting
        connectionState = .connecting

        do {
            try await deleteSecureAccess()
            pairingState = .failed(.savedAccessRevoked)
            connectionState = .notConfigured
            bootstrapRefreshState = .failed(.accessRevoked)
        } catch {
            pairingState = .failed(.secureStorageUnavailable)
            connectionState = .failed(message: PairingFlowFailure.secureStorageUnavailable.message)
            bootstrapRefreshState = .failed(.secureStorageUnavailable)
        }
        featureRevocationCleanupInProgress = false
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
        snapshotState = .live
        if financialContentLockState == .notRequired {
            financialContentLockState = .locked
        }
        connectionState = .connected(lastCheckedAt: bootstrap.meta.generatedAt)
        bootstrapRefreshState = .idle
    }

    private func finishRefreshAsNotConfigured(operationID: UUID) {
        guard activeRefreshOperationID == operationID else { return }
        activeRefreshOperationID = nil
        advanceMobileReadEpoch()
        serverURL = nil
        latestBootstrap = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        snapshotState = .none
        financialContentLockState = .notRequired
        pairingState = .idle
        connectionState = .notConfigured
        bootstrapRefreshState = .failed(.missingCredential)
    }

    private func finishRefreshAsRevoked(operationID: UUID) async {
        guard activeRefreshOperationID == operationID else { return }

        // Clear financial memory immediately, but keep setup blocked until the
        // revoked credential has actually been removed from Keychain.
        advanceMobileReadEpoch()
        serverURL = nil
        latestBootstrap = nil
        pairingState = .disconnecting
        connectionState = .connecting

        do {
            try await deleteSecureAccess()
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
        snapshotState = .live
        if financialContentLockState == .notRequired {
            financialContentLockState = .locked
        }
        pairingState = .idle
        connectionState = .connected(lastCheckedAt: bootstrap.meta.generatedAt)
    }

    private func finishAsNotConfigured(operationID: UUID) {
        guard activeOperationID == operationID else { return }
        activeOperationID = nil
        pairingState = .idle
        connectionState = .notConfigured
        snapshotState = .none
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

    private static let snapshotStaleThreshold: TimeInterval = 24 * 60 * 60
    private static let snapshotRetention: TimeInterval = 30 * 24 * 60 * 60
    private static let backgroundGrace: TimeInterval = 2 * 60

    private static func isAuthoritativeRevocation(_ error: any Error) -> Bool {
        guard let error = error as? MobileClientError else { return false }
        switch error {
        case .authentication(.expired), .authentication(.revoked):
            return true
        default:
            return false
        }
    }

    private static func isRecoverablePlanningRead(_ error: any Error) -> Bool {
        guard let error = error as? MobileClientError else { return false }
        switch error {
        case .transport(.offline), .transport(.timeout), .transport(.tls), .rateLimited, .server:
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
        case .invalidRequest, .invalidResponse, .invalidPayload, .identityMismatch, .notFound,
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
        case .invalidResponse, .invalidPayload, .notFound, .authentication, .authorization,
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
