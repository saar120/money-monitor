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
    static let savedTransactionLimit = 200

    let version: Int
    let serverID: UUID
    let savedAt: Date
    let bootstrap: BootstrapSuccessEnvelope
    /// The canonical Home overview is accepted and retained alongside the
    /// remaining mobile read models so Saved View does not fall back to the
    /// retired bootstrap Home projection.
    let homeOverview: CanonicalHomeOverviewEnvelope?
    /// Optional to preserve compatibility with encrypted snapshots written
    /// before Phase 3. This is mobile-safe data only, never a desktop row.
    let planning: MobilePlanningSnapshot?
    /// One bounded aggregate-only chart response; it shares the same encrypted
    /// snapshot envelope as the rest of the mobile-safe planning data.
    let netWorthHistory: MobileNetWorthHistory?
    /// Optional for compatibility with snapshots written before Saved View
    /// Activity existed. This is a bounded, mobile-safe recent-transaction
    /// projection, never an assertion of complete history.
    let transactions: [MobileTransaction]?

    init(
        bootstrap: BootstrapSuccessEnvelope,
        homeOverview: CanonicalHomeOverviewEnvelope? = nil,
        planning: MobilePlanningSnapshot? = nil,
        netWorthHistory: MobileNetWorthHistory? = nil,
        transactions: [MobileTransaction]? = nil,
        savedAt: Date
    ) {
        version = Self.currentVersion
        serverID = bootstrap.meta.server.id
        self.savedAt = savedAt
        self.bootstrap = bootstrap
        self.homeOverview = homeOverview
        self.planning = planning
        self.netWorthHistory = netWorthHistory
        self.transactions = transactions.map(Self.boundedTransactions)
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case serverID
        case savedAt
        case bootstrap
        case homeOverview
        case planning
        case netWorthHistory
        case transactions
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        serverID = try container.decode(UUID.self, forKey: .serverID)
        savedAt = try container.decode(Date.self, forKey: .savedAt)
        bootstrap = try container.decode(BootstrapSuccessEnvelope.self, forKey: .bootstrap)
        homeOverview = try container.decodeIfPresent(CanonicalHomeOverviewEnvelope.self, forKey: .homeOverview)
        planning = try container.decodeIfPresent(MobilePlanningSnapshot.self, forKey: .planning)
        netWorthHistory = try container.decodeIfPresent(MobileNetWorthHistory.self, forKey: .netWorthHistory)
        let decodedTransactions = try container.decodeIfPresent([MobileTransaction].self, forKey: .transactions)
        transactions = decodedTransactions.map(Self.boundedTransactions)
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(serverID, forKey: .serverID)
        try container.encode(savedAt, forKey: .savedAt)
        try container.encode(bootstrap, forKey: .bootstrap)
        try container.encodeIfPresent(homeOverview, forKey: .homeOverview)
        try container.encodeIfPresent(planning, forKey: .planning)
        try container.encodeIfPresent(netWorthHistory, forKey: .netWorthHistory)
        try container.encodeIfPresent(transactions, forKey: .transactions)
    }

    private static func boundedTransactions(_ transactions: [MobileTransaction]) -> [MobileTransaction] {
        var seen = Set<String>()
        let unique = transactions.filter { seen.insert($0.id).inserted }
        return Array(unique.prefix(savedTransactionLimit))
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
    @Published private(set) var latestHomeOverview: CanonicalHomeOverviewEnvelope?
    @Published private(set) var latestPlanningSnapshot: MobilePlanningSnapshot?
    @Published private(set) var latestNetWorthHistory: MobileNetWorthHistory?
    @Published private(set) var latestSavedTransactions: [MobileTransaction] = []
    @Published private(set) var bootstrapRefreshState: BootstrapRefreshState = .idle
    @Published private(set) var snapshotState: BootstrapSnapshotState = .none
    @Published private(set) var financialContentLockState: FinancialContentLockState = .notRequired
    @Published private(set) var pairedMacName: String? = nil

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
    private var snapshotPersistenceTail: Task<Void, Never>?
    private var lastBackgroundedAt: Date?
    private var hasSavedCredential = false

    /// A single projection for shell/status-row consumers. It is computed from
    /// the published primitives so a controlled clock can move a Saved View
    /// across the 24-hour boundary without timer polling.
    var trustState: GlobalTrustState {
        GlobalTrustStateProjection.project(
            hasSavedCredential: hasSavedCredential,
            connectionState: connectionState,
            pairingState: pairingState,
            refreshState: bootstrapRefreshState,
            snapshotState: snapshotState,
            bootstrap: latestBootstrap,
            now: clock()
        )
    }

    /// Descriptive alias for consumers that prefer the full state name.
    var globalTrustState: GlobalTrustState { trustState }

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
        hasSavedCredential = false
        pairedMacName = nil
        latestBootstrap = nil
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
        snapshotState = .none

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
                hasSavedCredential = false
                pairedMacName = nil
                finishAsNotConfigured(operationID: operationID)
                return
            }
            try ensureActive(operationID)
            hasSavedCredential = true
            pairedMacName = credential.profile.deviceName

            await restoreSnapshotIfUsable(for: credential, operationID: operationID)
            try ensureActive(operationID)

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActive(operationID)
            latestHomeOverview = try? await apiClient.homeOverview(credential: credential)
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
                bootstrapRefreshState = .failed(.accessRevoked)
                return
            }
            if latestBootstrap != nil {
                activeOperationID = nil
                pairingState = .idle
                bootstrapRefreshState = .failed(Self.bootstrapRefreshFailure(for: error))
                return
            }
            let isIncompatible: Bool
            if case .upgradeRequired = error as? MobileClientError {
                isIncompatible = true
            } else {
                isIncompatible = false
            }
            finish(
                error: error,
                operationID: operationID,
                fallbackFailure: isIncompatible
                    ? .incompatibleVersion
                    : .savedConnectionUnavailable
            )
            if isIncompatible {
                bootstrapRefreshState = .failed(.incompatible)
            }
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
            hasSavedCredential = true
            pairedMacName = credential.profile.deviceName
            try ensureActive(operationID)

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActive(operationID)
            latestHomeOverview = try? await apiClient.homeOverview(credential: credential)
            try ensureActive(operationID)
            try await saveSnapshot(bootstrap, operationID: operationID)
            try ensureActive(operationID)
            finishConnected(
                credential: credential,
                bootstrap: bootstrap,
                operationID: operationID
            )
        } catch {
            // Pairing persists the credential before the first authenticated
            // bootstrap. If that first bootstrap authoritatively revokes the
            // just-paired device, it must follow the same fail-closed cleanup
            // path as restore and refresh rather than leaving local access.
            if credentialWasStored, Self.isAuthoritativeRevocation(error) {
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
        let canRecoverWithoutSnapshot = hasSavedCredential && trustState == .noSnapshot
        let isConnected: Bool
        if case .connected = connectionState {
            isConnected = true
        } else {
            isConnected = false
        }
        guard
            activeOperationID == nil,
            activeRefreshOperationID == nil,
            (canRecoverWithoutSnapshot || isConnected)
        else {
            return
        }

        let operationID = UUID()
        activeRefreshOperationID = operationID
        refreshSnapshotFreshness()
        bootstrapRefreshState = .refreshing

        do {
            let credential = try await profileStore.load()
            try ensureActiveRefresh(operationID)
            guard let credential else {
                hasSavedCredential = false
                pairedMacName = nil
                finishRefreshAsNotConfigured(operationID: operationID)
                return
            }
            hasSavedCredential = true
            pairedMacName = credential.profile.deviceName

            let bootstrap = try await apiClient.bootstrap(credential: credential)
            try ensureActiveRefresh(operationID)
            latestHomeOverview = try? await apiClient.homeOverview(credential: credential)
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

            if let bootstrap = latestBootstrap {
                snapshotState = freshnessState(for: bootstrap.meta.generatedAt)
            }
            activeRefreshOperationID = nil
            bootstrapRefreshState = .failed(Self.bootstrapRefreshFailure(for: error))
        }
    }

    /// Explicit recovery entry point for the global status row and feature
    /// pull-to-refresh affordances. It intentionally performs one request.
    func retryBootstrap() async {
        await refreshBootstrap()
    }

    /// Refreshes Home through the canonical shared projection. The legacy
    /// bootstrap remains available to Activity and Plan, but Home never uses
    /// its embedded summary and therefore cannot drift from the Mac view.
    func refreshHomeOverview() async {
        guard
            activeOperationID == nil,
            activeRefreshOperationID == nil,
            case .connected = connectionState
        else { return }

        let operationID = UUID()
        activeRefreshOperationID = operationID
        refreshSnapshotFreshness()
        bootstrapRefreshState = .refreshing

        do {
            guard let credential = try await profileStore.load() else {
                finishRefreshAsNotConfigured(operationID: operationID)
                return
            }
            try ensureActiveRefresh(operationID)
            let homeOverview = try await apiClient.homeOverview(credential: credential)
            try ensureActiveRefresh(operationID)
            latestHomeOverview = homeOverview
            if let bootstrap = latestBootstrap, Self.isPersistableSnapshot(bootstrap) {
                try await saveValidatedSnapshot(
                    BootstrapSnapshot(
                        bootstrap: bootstrap,
                        homeOverview: homeOverview,
                        planning: latestPlanningSnapshot,
                        netWorthHistory: latestNetWorthHistory,
                        transactions: savedTransactions(for: bootstrap),
                        savedAt: clock()
                    )
                )
            }
            try ensureActiveRefresh(operationID)
            activeRefreshOperationID = nil
            snapshotState = .live
            bootstrapRefreshState = .idle
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

    /// Hook for a connectivity-restored notification. The app has no timer
    /// loop; callers invoke this only when the system reports a change.
    func connectivityRestored() async {
        await refreshBootstrap()
    }

    /// Re-evaluate age-sensitive presentation with the injected clock. This
    /// is also called before refreshes and on foreground return.
    func reevaluateSnapshotFreshness() {
        refreshSnapshotFreshness()
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
        let returnedFromBackground = lastBackgroundedAt != nil
        defer { lastBackgroundedAt = nil }
        refreshSnapshotFreshness()
        guard
            financialContentLockState == .unlocked,
            let lastBackgroundedAt,
            clock().timeIntervalSince(lastBackgroundedAt) > Self.backgroundGrace
        else {
            if returnedFromBackground {
                Task { @MainActor [weak self] in
                    await self?.refreshBootstrap()
                }
            }
            return
        }
        financialContentLockState = .locked
        if returnedFromBackground {
            Task { @MainActor [weak self] in
                await self?.refreshBootstrap()
            }
        }
    }

    func transactions(
        query: MobileTransactionQuery
    ) async throws -> MobileTransactionListEnvelope {
        // A Saved View is deliberately local and read-only. The trust row may
        // be `.failed` while a valid snapshot remains on screen, so use the
        // snapshot source whenever it is retained and the connection is not
        // currently live; this avoids implying that a failed retry refreshed
        // Activity data.
        if snapshotState.isSavedView, !trustState.isLive {
            return savedTransactions(for: query)
        }

        let session = try await mobileReadSession()
        do {
            let envelope = try await transactionClient.transactions(
                query: query,
                credential: session.credential
            )
            try ensureCurrentMobileReadEpoch(session.epoch)
            if let bootstrap = latestBootstrap {
                let savedTransactions = Self.boundedSavedTransactions(
                    envelope.data.transactions + latestSavedTransactions
                )
                try await persistSnapshotIfCacheable(
                    bootstrap: bootstrap,
                    planning: latestPlanningSnapshot,
                    netWorthHistory: latestNetWorthHistory,
                    transactions: savedTransactions
                )
                try ensureCurrentMobileReadEpoch(session.epoch)
                latestSavedTransactions = savedTransactions
            } else {
                try ensureCurrentMobileReadEpoch(session.epoch)
                mergeSavedTransactions(envelope.data.transactions)
            }
            return envelope
        } catch {
            if Self.isAuthoritativeRevocation(error) {
                try await finishFeatureReadAsRevoked(expectedEpoch: session.epoch)
            }
            throw error
        }
    }

    /// Applies the Activity query language to the bounded local cache. Cursor
    /// pagination is intentionally disabled: Saved View Activity is a finite
    /// recent window, not a claim of complete history.
    private func savedTransactions(for query: MobileTransactionQuery) -> MobileTransactionListEnvelope {
        let desired = query.firstPage
        let filtered = latestSavedTransactions.filter { transaction in
            guard desired.includeExcluded || !transaction.excludedFromReports else { return false }
            if let search = desired.query {
                let haystack: [String] = [
                    transaction.displayName,
                    transaction.category?.label,
                    transaction.account.displayName,
                    transaction.account.identifierMask,
                ].compactMap { $0 }
                guard haystack.contains(where: { Self.matches($0, search: search) }) else { return false }
            }
            if let startDate = desired.startDate, transaction.occurredOn < startDate { return false }
            if let endDate = desired.endDate, transaction.occurredOn > endDate { return false }
            if let direction = desired.direction, transaction.direction != direction { return false }
            if let status = desired.status, transaction.status != status { return false }
            if desired.needsReview && !transaction.needsReview { return false }
            if let accountID = desired.accountID, transaction.account.id != accountID { return false }
            return true
        }

        let limit = max(0, min(desired.limit, BootstrapSnapshot.savedTransactionLimit))
        let page = Array(filtered.prefix(limit))
        let generatedAt = latestBootstrap?.meta.generatedAt ?? clock()
        let financialDate = latestBootstrap?.meta.financialDate ?? ""
        return MobileTransactionListEnvelope(
            data: MobileTransactionListData(
                financialDate: financialDate,
                transactions: page,
                page: MobileTransactionPage(hasMore: false, nextCursor: nil)
            ),
            meta: MobileTransactionMetadata(
                apiVersion: MobileTransactionMetadata.supportedAPIVersion,
                generatedAt: generatedAt,
                source: .unknown,
                server: MobileTransactionServer(
                    id: latestBootstrap?.meta.server.id ?? UUID(),
                    protocolVersion: BootstrapServer.supportedProtocolVersion
                )
            )
        )
    }

    private static func matches(_ value: String, search: String) -> Bool {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .localizedCaseInsensitiveContains(
                search.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            )
    }

    private func mergeSavedTransactions(_ incoming: [MobileTransaction]) {
        latestSavedTransactions = Self.boundedSavedTransactions(
            incoming + latestSavedTransactions
        )
    }

    private static func boundedSavedTransactions(_ transactions: [MobileTransaction]) -> [MobileTransaction] {
        var seen = Set<String>()
        let unique = transactions.filter { seen.insert($0.id).inserted }
        return Array(
            unique
                .sorted {
                    if $0.occurredOn == $1.occurredOn { return $0.id > $1.id }
                    return $0.occurredOn > $1.occurredOn
                }
                .prefix(BootstrapSnapshot.savedTransactionLimit)
        )
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
                try await persistSnapshotIfCacheable(
                    bootstrap: bootstrap,
                    planning: envelope.data,
                    netWorthHistory: latestNetWorthHistory
                )
                try ensureCurrentMobileReadEpoch(session.epoch)
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
                try await persistSnapshotIfCacheable(
                    bootstrap: bootstrap,
                    planning: latestPlanningSnapshot,
                    netWorthHistory: envelope.data
                )
                try ensureCurrentMobileReadEpoch(session.epoch)
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
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
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
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
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

            latestBootstrap = snapshot.bootstrap
            latestHomeOverview = snapshot.homeOverview
            latestPlanningSnapshot = snapshot.planning
            latestNetWorthHistory = snapshot.netWorthHistory
            latestSavedTransactions = Self.boundedSavedTransactions(
                snapshot.transactions
                    ?? snapshot.bootstrap.data.recentTransactions.map(\.mobileTransaction)
            )
            serverURL = credential.profile.baseURL
            connectionState = .connected(lastCheckedAt: snapshot.bootstrap.meta.generatedAt)
            snapshotState = freshnessState(for: snapshot.bootstrap.meta.generatedAt)
            if financialContentLockState != .unlocked {
                financialContentLockState = .locked
            }
        } catch {
            guard activeOperationID == operationID else { return }
            latestBootstrap = nil
            latestHomeOverview = nil
            latestPlanningSnapshot = nil
            latestNetWorthHistory = nil
            latestSavedTransactions = []
            snapshotState = .corrupt
        }
    }

    private func saveSnapshot(
        _ bootstrap: BootstrapSuccessEnvelope,
        operationID: UUID
    ) async throws {
        guard Self.isPersistableSnapshot(bootstrap) else {
            try ensureActive(operationID)
            return
        }
        let transactions = savedTransactions(for: bootstrap)
        try await saveValidatedSnapshot(
            BootstrapSnapshot(
                bootstrap: bootstrap,
                homeOverview: latestHomeOverview,
                planning: latestPlanningSnapshot,
                netWorthHistory: latestNetWorthHistory,
                transactions: transactions,
                savedAt: clock()
            )
        )
        try ensureActive(operationID)
        latestSavedTransactions = transactions
    }

    private func persistSnapshotIfCacheable(
        bootstrap: BootstrapSuccessEnvelope,
        planning: MobilePlanningSnapshot?,
        netWorthHistory: MobileNetWorthHistory?,
        transactions: [MobileTransaction]? = nil
    ) async throws {
        guard Self.isPersistableSnapshot(bootstrap) else { return }
        let boundedTransactions = transactions ?? self.savedTransactions(for: bootstrap)
        try await saveValidatedSnapshot(
            BootstrapSnapshot(
                bootstrap: bootstrap,
                homeOverview: latestHomeOverview,
                planning: planning,
                netWorthHistory: netWorthHistory,
                transactions: boundedTransactions,
                savedAt: clock()
            )
        )
    }

    private func saveSnapshot(
        _ bootstrap: BootstrapSuccessEnvelope,
        refreshOperationID: UUID
    ) async throws {
        guard Self.isPersistableSnapshot(bootstrap) else {
            try ensureActiveRefresh(refreshOperationID)
            return
        }
        let transactions = savedTransactions(for: bootstrap)
        try await saveValidatedSnapshot(
            BootstrapSnapshot(
                bootstrap: bootstrap,
                homeOverview: latestHomeOverview,
                planning: latestPlanningSnapshot,
                netWorthHistory: latestNetWorthHistory,
                transactions: transactions,
                savedAt: clock()
            )
        )
        try ensureActiveRefresh(refreshOperationID)
        latestSavedTransactions = transactions
    }

    private func savedTransactions(for bootstrap: BootstrapSuccessEnvelope) -> [MobileTransaction] {
        Self.boundedSavedTransactions(
            bootstrap.data.recentTransactions.map(\.mobileTransaction) + latestSavedTransactions
        )
    }

    /// Snapshot I/O can suspend in Keychain or disk work. Queue every write
    /// and deletion in invocation order so a pre-revocation save is always
    /// followed by the revocation deletion, and a later re-pair save follows
    /// that deletion rather than being overwritten by stale work.
    private func saveValidatedSnapshot(_ snapshot: BootstrapSnapshot) async throws {
        let predecessor = snapshotPersistenceTail
        let write = Task { [snapshotStore] in
            if let predecessor { await predecessor.value }
            try await snapshotStore.save(snapshot)
        }
        snapshotPersistenceTail = Task { _ = try? await write.value }
        try await write.value
    }

    private func deletePersistedSnapshot() async throws {
        let predecessor = snapshotPersistenceTail
        let deletion = Task { [snapshotStore] in
            if let predecessor { await predecessor.value }
            try await snapshotStore.delete()
        }
        snapshotPersistenceTail = Task { _ = try? await deletion.value }
        try await deletion.value
    }

    private func deleteSecureAccess() async throws {
        try await deletePersistedSnapshot()
        try await profileStore.delete()
        hasSavedCredential = false
        pairedMacName = nil
        latestBootstrap = nil
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
        snapshotState = .none
        financialContentLockState = .notRequired
    }

    private func freshnessState(for generatedAt: Date) -> BootstrapSnapshotState {
        if clock().timeIntervalSince(generatedAt) > Self.snapshotStaleThreshold {
            return .stale(generatedAt: generatedAt)
        }
        return .cached(generatedAt: generatedAt)
    }

    private func refreshSnapshotFreshness() {
        switch snapshotState {
        case let .cached(generatedAt), let .stale(generatedAt):
            snapshotState = freshnessState(for: generatedAt)
        case .none, .live, .corrupt:
            break
        }
    }

    private static func isPersistableSnapshot(
        _ bootstrap: BootstrapSuccessEnvelope
    ) -> Bool {
        bootstrap.meta.cacheability.status == .cacheable
            && bootstrap.meta.completeness.status == .complete
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
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
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
        hasSavedCredential = true
        pairedMacName = credential.profile.deviceName
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
        hasSavedCredential = false
        pairedMacName = nil
        serverURL = nil
        latestBootstrap = nil
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
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
        latestHomeOverview = nil
        latestPlanningSnapshot = nil
        latestNetWorthHistory = nil
        latestSavedTransactions = []
        snapshotState = .none
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
        hasSavedCredential = true
        pairedMacName = credential.profile.deviceName
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
        hasSavedCredential = false
        pairedMacName = nil
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
