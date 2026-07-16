import Foundation
import Testing
@testable import MoneyMonitor

private actor RecordingMobileAPIClient: MobileAPIClient {
    private var requestedBaseURLs: [URL] = []

    func health(baseURL: URL) async throws -> HealthResponse {
        requestedBaseURLs.append(baseURL)
        return HealthResponse(
            data: HealthStatus(status: "ok"),
            meta: MobileResponseMetadata(
                apiVersion: "1",
                generatedAt: Date(timeIntervalSince1970: 1_752_576_000),
                source: "live"
            )
        )
    }

    func bootstrap(credential _: PairedMacCredential) async throws -> BootstrapSuccessEnvelope {
        throw MobileClientError.invalidRequest
    }

    func requests() -> [URL] {
        requestedBaseURLs
    }
}

private final class AppEnvironmentFixtureBundleToken: NSObject {}

private enum AppEnvironmentFixtureError: Error {
    case missing(String)
}

private enum PairingBootstrapBehavior: Sendable {
    case success(BootstrapSuccessEnvelope)
    case failure(MobileClientError)
}

private actor PairingFlowAPIClient: MobileAPIClient {
    private let behavior: PairingBootstrapBehavior
    private var bootstrapCallCount = 0

    init(behavior: PairingBootstrapBehavior) {
        self.behavior = behavior
    }

    func health(baseURL _: URL) async throws -> HealthResponse {
        throw MobileClientError.invalidRequest
    }

    func bootstrap(credential _: PairedMacCredential) async throws
        -> BootstrapSuccessEnvelope
    {
        bootstrapCallCount += 1
        switch behavior {
        case let .success(bootstrap):
            return bootstrap
        case let .failure(error):
            throw error
        }
    }

    func bootstrapCalls() -> Int {
        bootstrapCallCount
    }
}

private enum ControlledBootstrapBehavior: Sendable {
    case success(BootstrapSuccessEnvelope)
    case failure(MobileClientError)
    case suspended
}

private actor ControlledBootstrapAPIClient: MobileAPIClient {
    private var behaviors: [ControlledBootstrapBehavior]
    private var bootstrapCallCount = 0
    private var pendingCalls: [
        Int: CheckedContinuation<BootstrapSuccessEnvelope, any Error>
    ] = [:]

    init(behaviors: [ControlledBootstrapBehavior]) {
        self.behaviors = behaviors
    }

    func health(baseURL _: URL) async throws -> HealthResponse {
        throw MobileClientError.invalidRequest
    }

    func bootstrap(credential _: PairedMacCredential) async throws
        -> BootstrapSuccessEnvelope
    {
        bootstrapCallCount += 1
        let callNumber = bootstrapCallCount
        guard !behaviors.isEmpty else {
            throw MobileClientError.invalidRequest
        }

        switch behaviors.removeFirst() {
        case let .success(bootstrap):
            return bootstrap
        case let .failure(error):
            throw error
        case .suspended:
            return try await withCheckedThrowingContinuation { continuation in
                pendingCalls[callNumber] = continuation
            }
        }
    }

    func hasReceived(call number: Int) -> Bool {
        bootstrapCallCount >= number
    }

    func calls() -> Int {
        bootstrapCallCount
    }

    func resolve(
        call number: Int,
        with result: Result<BootstrapSuccessEnvelope, MobileClientError>
    ) {
        guard let continuation = pendingCalls.removeValue(forKey: number) else {
            return
        }
        switch result {
        case let .success(bootstrap):
            continuation.resume(returning: bootstrap)
        case let .failure(error):
            continuation.resume(throwing: error)
        }
    }
}

private actor PairingFlowProfileStore: PairedProfileStore {
    private var credential: PairedMacCredential?
    private var deleteCallCount = 0
    private var deleteError: SecureItemError?
    private var shouldBlockNextDelete = false
    private var deleteIsBlocked = false
    private var deleteContinuation: CheckedContinuation<Void, Never>?

    init(credential: PairedMacCredential? = nil) {
        self.credential = credential
    }

    func create(_ credential: PairedMacCredential) throws {
        self.credential = credential
    }

    func load() -> PairedMacCredential? {
        credential
    }

    func replace(_ credential: PairedMacCredential) throws {
        self.credential = credential
    }

    func savePairing(_ credential: PairedMacCredential) throws {
        if let existing = self.credential {
            guard existing.profile.serverID == credential.profile.serverID else {
                throw PairedProfileStoreError.differentServer
            }
            guard existing.profile.deviceID == credential.profile.deviceID else {
                throw PairedProfileStoreError.differentDevice
            }
        }
        self.credential = credential
    }

    func delete() async throws {
        deleteCallCount += 1
        if shouldBlockNextDelete {
            shouldBlockNextDelete = false
            deleteIsBlocked = true
            await withCheckedContinuation { continuation in
                deleteContinuation = continuation
            }
            deleteIsBlocked = false
        }
        if let deleteError { throw deleteError }
        credential = nil
    }

    func blockNextDelete() {
        shouldBlockNextDelete = true
    }

    func hasBlockedDelete() -> Bool {
        deleteIsBlocked
    }

    func releaseDelete() {
        deleteContinuation?.resume()
        deleteContinuation = nil
    }

    func setDeleteError(_ error: SecureItemError?) {
        deleteError = error
    }

    func deletes() -> Int {
        deleteCallCount
    }
}

private actor RefreshLoadFailureProfileStore: PairedProfileStore {
    private var credential: PairedMacCredential?
    private var loadCount = 0

    init(credential: PairedMacCredential) {
        self.credential = credential
    }

    func create(_ credential: PairedMacCredential) throws {
        self.credential = credential
    }

    func load() throws -> PairedMacCredential? {
        loadCount += 1
        if loadCount > 1 { throw SecureItemError.inaccessible }
        return credential
    }

    func replace(_ credential: PairedMacCredential) throws {
        self.credential = credential
    }

    func savePairing(_ credential: PairedMacCredential) throws {
        self.credential = credential
    }

    func delete() throws {
        credential = nil
    }
}

private actor PairingFlowClient: MobilePairingClient {
    private let credential: PairedMacCredential
    private let profileStore: any PairedProfileStore
    private let expiresAt: Date
    private let pollAfterSeconds: Int
    private let approvesOnStatus: Bool
    private var startDeviceNames: [String] = []
    private var statusCallCount = 0
    private var exchangeCallCount = 0

    init(
        credential: PairedMacCredential,
        profileStore: any PairedProfileStore,
        expiresAt: Date,
        pollAfterSeconds: Int = 3,
        approvesOnStatus: Bool = true
    ) {
        self.credential = credential
        self.profileStore = profileStore
        self.expiresAt = expiresAt
        self.pollAfterSeconds = pollAfterSeconds
        self.approvesOnStatus = approvesOnStatus
    }

    func start(qrPayload _: Data, deviceName: String) async throws -> MobilePairingSession {
        startDeviceNames.append(deviceName)
        return makeSession(deviceName: deviceName, state: .pendingApproval)
    }

    func status(for session: MobilePairingSession) async throws -> MobilePairingSession {
        statusCallCount += 1
        guard approvesOnStatus else { return session }
        return session.updating(
            with: PairingProgress(
                state: .approved,
                expiresAt: expiresAt,
                pollAfterSeconds: nil
            )
        )
    }

    func exchange(_ session: MobilePairingSession) async throws -> PairedMacCredential {
        exchangeCallCount += 1
        guard session.deviceName == credential.profile.deviceName else {
            throw MobileClientError.identityMismatch
        }
        try await profileStore.savePairing(credential)
        return credential
    }

    func calls() -> (startDeviceNames: [String], status: Int, exchange: Int) {
        (startDeviceNames, statusCallCount, exchangeCallCount)
    }

    private func makeSession(
        deviceName: String,
        state: PairingApprovalState
    ) -> MobilePairingSession {
        MobilePairingSession(
            pairingID: "pairing-session-01",
            serverID: credential.profile.serverID,
            baseURL: credential.profile.baseURL,
            protocolVersion: credential.profile.protocolVersion,
            deviceName: deviceName,
            expiresAt: expiresAt,
            progress: PairingProgress(
                state: state,
                expiresAt: expiresAt,
                pollAfterSeconds: state == .pendingApproval ? pollAfterSeconds : nil
            ),
            claimantSecret: String(repeating: "C", count: 43)
        )
    }
}

private actor PairingDelayRecorder {
    private var recordedDelays: [TimeInterval] = []

    func record(_ delay: TimeInterval) {
        recordedDelays.append(delay)
    }

    func values() -> [TimeInterval] {
        recordedDelays
    }
}

private actor BlockingPairingSleeper {
    private var started = false

    func sleep() async throws {
        started = true
        try await Task.sleep(for: .seconds(60))
    }

    func hasStarted() -> Bool {
        started
    }
}

private actor BlockingExchangePairingClient: MobilePairingClient {
    private let credential: PairedMacCredential
    private let profileStore: any PairedProfileStore
    private let expiresAt: Date
    private var exchangeStarted = false
    private var exchangeContinuation: CheckedContinuation<Void, Never>?

    init(
        credential: PairedMacCredential,
        profileStore: any PairedProfileStore,
        expiresAt: Date
    ) {
        self.credential = credential
        self.profileStore = profileStore
        self.expiresAt = expiresAt
    }

    func start(qrPayload _: Data, deviceName: String) async throws -> MobilePairingSession {
        MobilePairingSession(
            pairingID: "pairing-session-01",
            serverID: credential.profile.serverID,
            baseURL: credential.profile.baseURL,
            protocolVersion: 1,
            deviceName: deviceName,
            expiresAt: expiresAt,
            progress: PairingProgress(
                state: .approved,
                expiresAt: expiresAt,
                pollAfterSeconds: nil
            ),
            claimantSecret: String(repeating: "C", count: 43)
        )
    }

    func status(for _: MobilePairingSession) async throws -> MobilePairingSession {
        throw MobileClientError.invalidRequest
    }

    func exchange(_: MobilePairingSession) async throws -> PairedMacCredential {
        exchangeStarted = true
        await withCheckedContinuation { continuation in
            exchangeContinuation = continuation
        }
        try await profileStore.savePairing(credential)
        return credential
    }

    func hasStartedExchange() -> Bool {
        exchangeStarted
    }

    func releaseExchange() {
        exchangeContinuation?.resume()
        exchangeContinuation = nil
    }
}

private let pairingFlowNow = Date(timeIntervalSince1970: 1_784_109_600)

private func appEnvironmentFixtureData(
    _ filename: String,
    subdirectory: String
) throws -> Data {
    let bundle = Bundle(for: AppEnvironmentFixtureBundleToken.self)
    let name = String(filename.dropLast(".json".count))
    guard let url = bundle.url(
        forResource: name,
        withExtension: "json",
        subdirectory: subdirectory
    ) else {
        throw AppEnvironmentFixtureError.missing(filename)
    }
    return try Data(contentsOf: url)
}

private func pairingFlowBootstrap() throws -> BootstrapSuccessEnvelope {
    try BootstrapPayloadDecoder().decodeSuccess(
        from: appEnvironmentFixtureData(
            "bootstrap-complete.json",
            subdirectory: "MobileBootstrap"
        )
    )
}

private func refreshBootstrapFixture(_ filename: String) throws
    -> BootstrapSuccessEnvelope
{
    try BootstrapPayloadDecoder().decodeSuccess(
        from: appEnvironmentFixtureData(
            filename,
            subdirectory: "MobileBootstrap"
        )
    )
}

private func waitForBootstrapCall(
    _ number: Int,
    client: ControlledBootstrapAPIClient
) async {
    for _ in 0 ..< 100 {
        if await client.hasReceived(call: number) {
            return
        }
        await Task.yield()
    }
    Issue.record("Timed out waiting for bootstrap call \(number)")
}

private func waitForBlockedDelete(store: PairingFlowProfileStore) async {
    for _ in 0 ..< 100 {
        if await store.hasBlockedDelete() {
            return
        }
        await Task.yield()
    }
    Issue.record("Timed out waiting for credential deletion to block")
}

private func pairingFlowQRPayload() throws -> Data {
    try appEnvironmentFixtureData(
        "pairing-qr-valid.json",
        subdirectory: "MobilePairing"
    )
}

private func pairingFlowCredential(
    token: Character = "T",
    deviceName: String = "Personal iPhone"
) throws -> PairedMacCredential {
    try PairedMacCredential(
        profile: PairedMacProfile(
            serverID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            baseURL: URL(
                string: "https://money-monitor.tailnet.ts.net:8443/money-monitor"
            )!,
            deviceID: "device-01",
            deviceName: deviceName,
            capabilities: ["mobile.read"],
            protocolVersion: 1,
            apiVersion: 1,
            tokenVersion: token == "T" ? 1 : 2
        ),
        token: String(repeating: token, count: 43)
    )
}

struct AppEnvironmentTests {
    @MainActor
    @Test
    func launchStartsRestoringThenEmptyKeychainShowsOnboarding() async throws {
        let store = PairingFlowProfileStore()
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let pairingClient = PairingFlowClient(
            credential: try pairingFlowCredential(),
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )

        #expect(environment.connectionState == .connecting)
        #expect(environment.pairingState == .restoring)

        await environment.restoreSavedConnection()

        #expect(environment.connectionState == .notConfigured)
        #expect(environment.pairingState == .idle)
        #expect(await apiClient.bootstrapCalls() == 0)
    }

    @MainActor
    @Test
    func acceptsAPathScopedTailscaleHTTPSBaseURL() async {
        let client = RecordingMobileAPIClient()
        let environment = AppEnvironment(apiClient: client)

        await environment.connect(to: "money-monitor.example.ts.net:8443/money-monitor")

        #expect(
            environment.serverURL?.absoluteString
                == "https://money-monitor.example.ts.net:8443/money-monitor"
        )
        #expect(await client.requests().count == 1)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected a connected state")
            return
        }
    }

    @MainActor
    @Test(
        arguments: [
            "http://money-monitor.example.ts.net",
            "https://user:password@money-monitor.example.ts.net",
            "https://money-monitor.example.ts.net?token=secret",
            "https://money-monitor.example.ts.net/#private",
        ]
    )
    func rejectsUnsafeManualAddressesWithoutMakingARequest(address: String) async {
        let client = RecordingMobileAPIClient()
        let environment = AppEnvironment(apiClient: client)

        await environment.connect(to: address)

        #expect(environment.serverURL == nil)
        #expect(await client.requests().isEmpty)
        guard case .failed = environment.connectionState else {
            Issue.record("Expected an input-validation failure")
            return
        }
    }

    @MainActor
    @Test
    func pairingPollsAtServerDelayStoresThenBootstrapsBeforeConnecting() async throws {
        let bootstrap = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore()
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(bootstrap))
        let delays = PairingDelayRecorder()
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow },
            sleep: { delay in await delays.record(delay) }
        )

        await environment.pair(
            qrPayload: try pairingFlowQRPayload(),
            deviceName: "Personal iPhone"
        )

        #expect(await delays.values() == [3])
        #expect(await pairingClient.calls().status == 1)
        #expect(await pairingClient.calls().exchange == 1)
        #expect(await apiClient.bootstrapCalls() == 1)
        #expect(await store.load() == credential)
        #expect(environment.serverURL == credential.profile.baseURL)
        #expect(environment.latestBootstrap == bootstrap)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected authenticated bootstrap to connect the app")
            return
        }
    }

    @MainActor
    @Test
    func cancellationDuringPollingCannotExchangeStoreOrBootstrap() async throws {
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore()
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(300),
            approvesOnStatus: false
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let sleeper = BlockingPairingSleeper()
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow },
            sleep: { _ in try await sleeper.sleep() }
        )

        let qrPayload = try pairingFlowQRPayload()
        let task = Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: "Personal iPhone"
            )
        }
        for _ in 0 ..< 100 where !(await sleeper.hasStarted()) {
            await Task.yield()
        }
        #expect(await sleeper.hasStarted())

        task.cancel()
        await task.value

        #expect(await pairingClient.calls().status == 0)
        #expect(await pairingClient.calls().exchange == 0)
        #expect(await apiClient.bootstrapCalls() == 0)
        #expect(await store.load() == nil)
        #expect(environment.pairingState == .idle)
        #expect(environment.connectionState == .notConfigured)
    }

    @MainActor
    @Test
    func cancelledRepairPreservesTheExistingCredentialWithoutDeletingIt() async throws {
        let original = try pairingFlowCredential(token: "A", deviceName: "Registered iPhone")
        let rotated = try pairingFlowCredential(token: "B", deviceName: "Registered iPhone")
        let store = PairingFlowProfileStore(credential: original)
        let pairingClient = PairingFlowClient(
            credential: rotated,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(300),
            approvesOnStatus: false
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let sleeper = BlockingPairingSleeper()
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow },
            sleep: { _ in try await sleeper.sleep() }
        )

        let qrPayload = try pairingFlowQRPayload()
        let task = Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: "Personal iPhone"
            )
        }
        for _ in 0 ..< 100 where !(await sleeper.hasStarted()) {
            await Task.yield()
        }
        #expect(await sleeper.hasStarted())

        task.cancel()
        await task.value

        #expect(await pairingClient.calls().exchange == 0)
        #expect(await store.load() == original)
        #expect(await store.deletes() == 0)
    }

    @MainActor
    @Test
    func expiredSessionStopsBeforePollingOrExchange() async throws {
        let store = PairingFlowProfileStore()
        let pairingClient = PairingFlowClient(
            credential: try pairingFlowCredential(),
            profileStore: store,
            expiresAt: pairingFlowNow
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow },
            sleep: { _ in Issue.record("An expired session must not sleep") }
        )

        await environment.pair(
            qrPayload: try pairingFlowQRPayload(),
            deviceName: "Personal iPhone"
        )

        #expect(await pairingClient.calls().status == 0)
        #expect(await pairingClient.calls().exchange == 0)
        #expect(environment.pairingState == .failed(.expiredCode))
    }

    @MainActor
    @Test
    func launchRestoresKeychainCredentialThroughAuthenticatedBootstrap() async throws {
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )

        await environment.restoreSavedConnection()

        #expect(await apiClient.bootstrapCalls() == 1)
        #expect(environment.serverURL == credential.profile.baseURL)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected saved credential restoration to connect")
            return
        }
    }

    @MainActor
    @Test
    func authoritativeRevocationClearsSavedCredentialButOfflineFailurePreservesIt() async throws {
        let credential = try pairingFlowCredential()

        let revokedStore = PairingFlowProfileStore(credential: credential)
        let revokedAPI = PairingFlowAPIClient(
            behavior: .failure(.authentication(.revoked))
        )
        let revokedPairing = PairingFlowClient(
            credential: credential,
            profileStore: revokedStore,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let revokedEnvironment = AppEnvironment(
            apiClient: revokedAPI,
            pairingClient: revokedPairing,
            profileStore: revokedStore
        )
        await revokedEnvironment.restoreSavedConnection()

        #expect(await revokedStore.load() == nil)
        #expect(await revokedStore.deletes() == 1)
        #expect(revokedEnvironment.pairingState == .failed(.savedAccessRevoked))

        let offlineStore = PairingFlowProfileStore(credential: credential)
        let offlineAPI = PairingFlowAPIClient(behavior: .failure(.transport(.offline)))
        let offlinePairing = PairingFlowClient(
            credential: credential,
            profileStore: offlineStore,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let offlineEnvironment = AppEnvironment(
            apiClient: offlineAPI,
            pairingClient: offlinePairing,
            profileStore: offlineStore
        )
        await offlineEnvironment.restoreSavedConnection()

        #expect(await offlineStore.load() == credential)
        #expect(await offlineStore.deletes() == 0)
        #expect(offlineEnvironment.pairingState == .failed(.savedConnectionUnavailable))
    }

    @MainActor
    @Test
    func repairUsesStoredDeviceNameSoLocalRenameCannotBreakRotationBinding() async throws {
        let original = try pairingFlowCredential(token: "A", deviceName: "Registered iPhone")
        let rotated = try pairingFlowCredential(token: "B", deviceName: "Registered iPhone")
        let store = PairingFlowProfileStore(credential: original)
        let pairingClient = PairingFlowClient(
            credential: rotated,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow },
            sleep: { _ in }
        )

        await environment.pair(
            qrPayload: try pairingFlowQRPayload(),
            deviceName: "Renamed iPhone"
        )

        #expect(await pairingClient.calls().startDeviceNames == ["Registered iPhone"])
        #expect(await store.load() == rotated)
        #expect(await store.deletes() == 0)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected same-device repair to complete")
            return
        }
    }

    @MainActor
    @Test
    func securingCommitPhaseIgnoresUiCancellationAndFinishesBootstrap() async throws {
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore()
        let pairingClient = BlockingExchangePairingClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store,
            clock: { pairingFlowNow }
        )
        let qrPayload = try pairingFlowQRPayload()
        let task = Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: "Personal iPhone"
            )
        }
        for _ in 0 ..< 100 {
            if await pairingClient.hasStartedExchange() { break }
            await Task.yield()
        }

        #expect(environment.pairingState == .securingConnection)
        environment.cancelPairing()
        #expect(environment.pairingState == .securingConnection)

        await pairingClient.releaseExchange()
        await task.value

        #expect(await store.load() == credential)
        #expect(await apiClient.bootstrapCalls() == 1)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected securing commit phase to finish")
            return
        }
    }

    @MainActor
    @Test
    func disconnectDeletesCredentialBeforeReportingNotConfigured() async throws {
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        await environment.disconnect()

        #expect(await store.load() == nil)
        #expect(await store.deletes() == 1)
        #expect(environment.serverURL == nil)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.connectionState == .notConfigured)
    }

    @MainActor
    @Test
    func disconnectStorageFailureClearsMemoryAndDoesNotClaimSuccess() async throws {
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = PairingFlowAPIClient(behavior: .success(try pairingFlowBootstrap()))
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        await store.setDeleteError(.inaccessible)

        await environment.disconnect()

        #expect(await store.load() == credential)
        #expect(environment.serverURL == nil)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.pairingState == .failed(.secureStorageUnavailable))
        guard case .failed = environment.connectionState else {
            Issue.record("Expected disconnect to fail closed")
            return
        }
    }

    @MainActor
    @Test
    func refreshRetainsConnectedSnapshotInFlightThenAtomicallyReplacesIt() async throws {
        let original = try pairingFlowBootstrap()
        let replacement = try refreshBootstrapFixture("bootstrap-empty.json")
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .suspended]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        let connectedState = environment.connectionState

        let refresh = Task { await environment.refreshBootstrap() }
        await waitForBootstrapCall(2, client: apiClient)

        #expect(environment.bootstrapRefreshState == .refreshing)
        #expect(environment.latestBootstrap == original)
        #expect(environment.serverURL == credential.profile.baseURL)
        #expect(environment.connectionState == connectedState)

        await apiClient.resolve(call: 2, with: .success(replacement))
        await refresh.value

        #expect(environment.bootstrapRefreshState == .idle)
        #expect(environment.latestBootstrap == replacement)
        #expect(
            environment.connectionState
                == .connected(lastCheckedAt: replacement.meta.generatedAt)
        )
    }

    @MainActor
    @Test(
        arguments: [
            MobileClientError.transport(.offline),
            MobileClientError.transport(.timeout),
            MobileClientError.rateLimited,
            MobileClientError.server(statusCode: 503),
        ]
    )
    func unavailableRefreshRetainsTheAcceptedSnapshot(error: MobileClientError) async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(error)]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        let connectedState = environment.connectionState

        await environment.refreshBootstrap()

        #expect(environment.bootstrapRefreshState == .failed(.unavailable))
        #expect(environment.latestBootstrap == original)
        #expect(environment.serverURL == credential.profile.baseURL)
        #expect(environment.connectionState == connectedState)
        #expect(await store.load() == credential)
    }

    @MainActor
    @Test(
        arguments: [
            MobileClientError.invalidResponse,
            MobileClientError.invalidPayload,
        ]
    )
    func malformedRefreshIsDistinctAndRetainsTheAcceptedSnapshot(
        error: MobileClientError
    ) async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(error)]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        let connectedState = environment.connectionState

        await environment.refreshBootstrap()

        #expect(environment.bootstrapRefreshState == .failed(.invalidResponse))
        #expect(environment.latestBootstrap == original)
        #expect(environment.connectionState == connectedState)
        #expect(await store.load() == credential)
    }

    @MainActor
    @Test
    func incompatibleRefreshIsDistinctAndRetainsTheAcceptedSnapshot() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(.upgradeRequired)]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        let connectedState = environment.connectionState

        await environment.refreshBootstrap()

        #expect(environment.bootstrapRefreshState == .failed(.incompatible))
        #expect(environment.latestBootstrap == original)
        #expect(environment.connectionState == connectedState)
        #expect(await store.load() == credential)
    }

    @MainActor
    @Test
    func credentialLoadFailureRetainsSnapshotAndReportsSecureStorage() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = RefreshLoadFailureProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(behaviors: [.success(original)])
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        let connectedState = environment.connectionState

        await environment.refreshBootstrap()

        #expect(await apiClient.calls() == 1)
        #expect(environment.latestBootstrap == original)
        #expect(environment.connectionState == connectedState)
        #expect(environment.bootstrapRefreshState == .failed(.secureStorageUnavailable))
    }

    @MainActor
    @Test
    func authoritativeRefreshRevocationDeletesCredentialAndRoutesToRecovery() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(.authentication(.revoked))]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        await environment.refreshBootstrap()

        #expect(await store.load() == nil)
        #expect(await store.deletes() == 1)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.serverURL == nil)
        #expect(environment.connectionState == .notConfigured)
        #expect(environment.pairingState == .failed(.savedAccessRevoked))
        #expect(environment.bootstrapRefreshState == .failed(.accessRevoked))
    }

    @MainActor
    @Test
    func revocationCleanupBlocksRepairUntilTheOldCredentialIsDeleted() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        await store.blockNextDelete()
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(.authentication(.revoked))]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        let refresh = Task { await environment.refreshBootstrap() }
        await waitForBlockedDelete(store: store)

        #expect(environment.latestBootstrap == nil)
        #expect(environment.serverURL == nil)
        #expect(environment.connectionState == .connecting)
        #expect(environment.pairingState == .disconnecting)
        #expect(environment.bootstrapRefreshState == .refreshing)

        await environment.pair(
            qrPayload: try pairingFlowQRPayload(),
            deviceName: "Personal iPhone"
        )
        #expect(await pairingClient.calls().startDeviceNames.isEmpty)

        await store.releaseDelete()
        await refresh.value

        #expect(await store.load() == nil)
        #expect(environment.connectionState == .notConfigured)
        #expect(environment.pairingState == .failed(.savedAccessRevoked))
        #expect(environment.bootstrapRefreshState == .failed(.accessRevoked))
    }

    @MainActor
    @Test
    func revocationCredentialDeletionFailureReportsSecureStorageUnavailable() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        await store.setDeleteError(.inaccessible)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .failure(.authentication(.expired))]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        await environment.refreshBootstrap()

        #expect(await store.load() == credential)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.serverURL == nil)
        #expect(environment.pairingState == .failed(.secureStorageUnavailable))
        #expect(
            environment.bootstrapRefreshState
                == .failed(.secureStorageUnavailable)
        )
        guard case .failed = environment.connectionState else {
            Issue.record("Expected credential cleanup failure to fail closed")
            return
        }
    }

    @MainActor
    @Test
    func missingRefreshCredentialFailsClosedWithoutMakingARequest() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(behaviors: [.success(original)])
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()
        try await store.delete()

        await environment.refreshBootstrap()

        #expect(await apiClient.calls() == 1)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.serverURL == nil)
        #expect(environment.connectionState == .notConfigured)
        #expect(environment.pairingState == .idle)
        #expect(environment.bootstrapRefreshState == .failed(.missingCredential))
    }

    @MainActor
    @Test
    func concurrentRefreshIsIgnoredWhileTheAcceptedRefreshIsInFlight() async throws {
        let original = try pairingFlowBootstrap()
        let replacement = try refreshBootstrapFixture("bootstrap-empty.json")
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .suspended]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        let firstRefresh = Task { await environment.refreshBootstrap() }
        await waitForBootstrapCall(2, client: apiClient)
        await environment.refreshBootstrap()

        #expect(await apiClient.calls() == 2)
        #expect(environment.latestBootstrap == original)
        #expect(environment.bootstrapRefreshState == .refreshing)

        await apiClient.resolve(call: 2, with: .success(replacement))
        await firstRefresh.value

        #expect(environment.latestBootstrap == replacement)
        #expect(environment.bootstrapRefreshState == .idle)
    }

    @MainActor
    @Test
    func concurrentRefreshCannotDisplaceAnInFlightAuthoritativeRevocation() async throws {
        let original = try pairingFlowBootstrap()
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .suspended]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        let revokingRefresh = Task { await environment.refreshBootstrap() }
        await waitForBootstrapCall(2, client: apiClient)
        await environment.refreshBootstrap()

        #expect(await apiClient.calls() == 2)
        await apiClient.resolve(
            call: 2,
            with: .failure(.authentication(.expired))
        )
        await revokingRefresh.value

        #expect(await store.load() == nil)
        #expect(environment.latestBootstrap == nil)
        #expect(environment.connectionState == .notConfigured)
        #expect(environment.bootstrapRefreshState == .failed(.accessRevoked))
    }

    @MainActor
    @Test
    func cancelledRefreshRetainsTheAcceptedSnapshotAndReturnsToIdle() async throws {
        let original = try pairingFlowBootstrap()
        let ignored = try refreshBootstrapFixture("bootstrap-empty.json")
        let credential = try pairingFlowCredential()
        let store = PairingFlowProfileStore(credential: credential)
        let apiClient = ControlledBootstrapAPIClient(
            behaviors: [.success(original), .suspended]
        )
        let pairingClient = PairingFlowClient(
            credential: credential,
            profileStore: store,
            expiresAt: pairingFlowNow.addingTimeInterval(60)
        )
        let environment = AppEnvironment(
            apiClient: apiClient,
            pairingClient: pairingClient,
            profileStore: store
        )
        await environment.restoreSavedConnection()

        let refresh = Task { await environment.refreshBootstrap() }
        await waitForBootstrapCall(2, client: apiClient)
        refresh.cancel()
        await apiClient.resolve(call: 2, with: .success(ignored))
        await refresh.value

        #expect(environment.latestBootstrap == original)
        #expect(environment.serverURL == credential.profile.baseURL)
        #expect(environment.bootstrapRefreshState == .idle)
        guard case .connected = environment.connectionState else {
            Issue.record("Expected cancellation to preserve the connected state")
            return
        }
    }
}
