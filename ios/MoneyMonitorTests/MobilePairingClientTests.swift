import Foundation
import Testing
@testable import MoneyMonitor

private enum PairingClientTestError: Error {
    case noStubbedResponse
}

private struct RecordedPairingRequest: Equatable, Sendable {
    let url: URL?
    let method: String?
    let authorization: String?
    let body: Data?

    init(_ request: URLRequest) {
        url = request.url
        method = request.httpMethod
        authorization = request.value(forHTTPHeaderField: "Authorization")
        body = request.httpBody
    }
}

private actor StubPairingHTTPTransport: MobileHTTPTransport {
    private var responses: [MobileHTTPResponse]
    private var recordedRequests: [RecordedPairingRequest] = []

    init(_ responses: [MobileHTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) throws -> MobileHTTPResponse {
        recordedRequests.append(RecordedPairingRequest(request))
        guard !responses.isEmpty else { throw PairingClientTestError.noStubbedResponse }
        return responses.removeFirst()
    }

    func requests() -> [RecordedPairingRequest] {
        recordedRequests
    }
}

private actor CancellingPairingHTTPTransport: MobileHTTPTransport {
    private var sendCallCount = 0

    func send(_: URLRequest) throws -> MobileHTTPResponse {
        sendCallCount += 1
        throw CancellationError()
    }

    func sends() -> Int {
        sendCallCount
    }
}

private actor RecordingPairedProfileStore: PairedProfileStore {
    private var credential: PairedMacCredential?
    private var remainingCreateFailures: Int
    private var createCallCount = 0

    init(failCreate: Bool = false) {
        remainingCreateFailures = failCreate ? 1 : 0
    }

    func create(_ credential: PairedMacCredential) throws {
        createCallCount += 1
        if remainingCreateFailures > 0 {
            remainingCreateFailures -= 1
            throw SecureItemError.inaccessible
        }
        self.credential = credential
    }

    func load() -> PairedMacCredential? {
        credential
    }

    func replace(_ credential: PairedMacCredential) {
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
            self.credential = credential
        } else {
            try create(credential)
        }
    }

    func delete() {
        credential = nil
    }

    func creates() -> Int {
        createCallCount
    }
}

private final class PairingFixtureBundleToken: NSObject {}

private enum PairingFixtureError: Error {
    case missing(String)
    case invalidObject(String)
}

private let pairingFixtureNames = [
    "pairing-error-expired.json",
    "pairing-error-rejected.json",
    "pairing-error-replayed.json",
    "pairing-error-upgrade-required.json",
    "pairing-exchange-claimed.json",
    "pairing-qr-valid.json",
    "pairing-start-pending.json",
    "pairing-status-approved.json",
]

private func pairingFixtureData(_ filename: String) throws -> Data {
    let bundle = Bundle(for: PairingFixtureBundleToken.self)
    let name = String(filename.dropLast(".json".count))
    guard let url = bundle.url(
        forResource: name,
        withExtension: "json",
        subdirectory: "MobilePairing"
    ) else {
        throw PairingFixtureError.missing(filename)
    }
    return try Data(contentsOf: url)
}

private func mutatedPairingFixture(
    _ filename: String,
    mutate: (inout [String: Any]) throws -> Void
) throws -> Data {
    let data = try pairingFixtureData(filename)
    guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw PairingFixtureError.invalidObject(filename)
    }
    try mutate(&object)
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

private let pairingNow = Date(timeIntervalSince1970: 1_784_109_600)
private let pairingServerID = "11111111-1111-4111-8111-111111111111"
private let pairingClaimantSecret = String(repeating: "C", count: 43)
private let pairingToken = String(repeating: "T", count: 43)

private func storedCredential(
    serverID: String,
    deviceID: String = "old-device",
    token: String
) throws -> PairedMacCredential {
    let profile = try PairedMacProfile(
        serverID: try #require(UUID(uuidString: serverID)),
        baseURL: URL(string: "https://money-monitor.tailnet.ts.net:8443/money-monitor")!,
        deviceID: deviceID,
        deviceName: "Personal iPhone",
        capabilities: ["mobile.read"],
        protocolVersion: 1,
        apiVersion: 1,
        tokenVersion: 1
    )
    return try PairedMacCredential(profile: profile, token: token)
}

struct MobilePairingClientTests {
    @Test
    func sharedPairingFixtureInventoryIsCompleteAndValidJSON() throws {
        let bundle = Bundle(for: PairingFixtureBundleToken.self)
        let fixtureURLs = try #require(
            bundle.urls(forResourcesWithExtension: "json", subdirectory: "MobilePairing")
        )

        #expect(fixtureURLs.map(\.lastPathComponent).sorted() == pairingFixtureNames.sorted())
        for name in pairingFixtureNames {
            let object = try JSONSerialization.jsonObject(with: pairingFixtureData(name))
            #expect(object is [String: Any])
        }
    }

    @Test
    func fullExchangeUsesFixedBodyEndpointsAndStoresOnlyTheValidatedCredential() async throws {
        let transport = StubPairingHTTPTransport([
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-start-pending.json"),
                statusCode: 202
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-status-approved.json"),
                statusCode: 200
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-exchange-claimed.json"),
                statusCode: 201
            ),
        ])
        let store = RecordingPairedProfileStore()
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )

        let pending = try await client.start(
            qrPayload: pairingFixtureData("pairing-qr-valid.json"),
            deviceName: "  Personal   iPhone "
        )
        let approved = try await client.status(for: pending)
        let credential = try await client.exchange(approved)
        let requests = await transport.requests()

        #expect(pending.progress.state == .pendingApproval)
        #expect(approved.progress.state == .approved)
        #expect(credential.profile.serverID.uuidString.lowercased() == pairingServerID)
        #expect(credential.profile.baseURL.path == "/money-monitor")
        #expect(credential.profile.capabilities == ["mobile.read"])
        #expect(await store.load() == credential)
        #expect(await store.creates() == 1)
        #expect(requests.map(\.url?.path) == [
            "/money-monitor/api/mobile/v1/pairing/start",
            "/money-monitor/api/mobile/v1/pairing/status",
            "/money-monitor/api/mobile/v1/pairing/exchange",
        ])
        #expect(requests.allSatisfy { $0.method == "POST" })
        #expect(requests.allSatisfy { $0.authorization == nil })

        let startBody = try #require(requests.first?.body)
        let startJSON = try #require(
            JSONSerialization.jsonObject(with: startBody) as? [String: Any]
        )
        #expect(startJSON["pairingId"] as? String == "pairing-session-01")
        #expect(startJSON["deviceName"] as? String == "Personal iPhone")
        #expect(startJSON["nonce"] as? String == String(repeating: "N", count: 43))
        #expect(startJSON["serverId"] as? String == pairingServerID)

        for request in requests.dropFirst() {
            let body = try #require(request.body)
            let json = try #require(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            #expect(json.keys.sorted() == ["claimantSecret", "pairingId"])
            #expect(json["claimantSecret"] as? String == pairingClaimantSecret)
        }
    }

    @Test
    func invalidOrExpiredQRNeverMakesARequestOrCreatesAKeychainItem() async throws {
        let transport = StubPairingHTTPTransport([])
        let store = RecordingPairedProfileStore()
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )

        let expiredQR = try mutatedPairingFixture("pairing-qr-valid.json") { object in
            object["expiresAt"] = "2026-07-15T09:59:59.000Z"
        }
        await #expect(throws: MobileClientError.pairing(.expired)) {
            try await client.start(
                qrPayload: expiredQR,
                deviceName: "Personal iPhone"
            )
        }
        await #expect(throws: MobileClientError.pairing(.invalidPayload)) {
            try await client.start(
                qrPayload: Data(#"{"kind":"not-money-monitor"}"#.utf8),
                deviceName: "Personal iPhone"
            )
        }

        #expect(await transport.requests().isEmpty)
        #expect(await store.creates() == 0)
    }

    @Test
    func cancelledPairingIsTypedAsCancelledAndCreatesNoKeychainItem() async throws {
        let transport = CancellingPairingHTTPTransport()
        let store = RecordingPairedProfileStore()
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )

        await #expect(throws: MobileClientError.transport(.cancelled)) {
            try await client.start(
                qrPayload: pairingFixtureData("pairing-qr-valid.json"),
                deviceName: "Personal iPhone"
            )
        }

        #expect(await transport.sends() == 1)
        #expect(await store.creates() == 0)
        #expect(await store.load() == nil)
    }

    @Test
    func startRejectsAMalformedClaimantSecretWithoutRetainingIt() async throws {
        let malformedSecret = "not-a-secret"
        let malformedPending = try mutatedPairingFixture("pairing-start-pending.json") { object in
            guard var data = object["data"] as? [String: Any] else {
                throw PairingFixtureError.invalidObject("pairing-start-pending.json")
            }
            data["claimantSecret"] = malformedSecret
            object["data"] = data
        }
        let transport = StubPairingHTTPTransport([
            MobileHTTPResponse(data: malformedPending, statusCode: 202),
        ])
        let store = RecordingPairedProfileStore()
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )

        await #expect(throws: MobileClientError.invalidPayload) {
            try await client.start(
                qrPayload: pairingFixtureData("pairing-qr-valid.json"),
                deviceName: "Personal iPhone"
            )
        }
        #expect(await store.load() == nil)
        #expect(!String(describing: MobileClientError.invalidPayload).contains(malformedSecret))
    }

    @Test
    func malformedClaimNeverPersistsTheToken() async throws {
        let malformedClaim = try mutatedPairingFixture("pairing-exchange-claimed.json") { object in
            guard
                var data = object["data"] as? [String: Any],
                var credential = data["credential"] as? [String: Any]
            else {
                throw PairingFixtureError.invalidObject("pairing-exchange-claimed.json")
            }
            credential["token"] = "too-short"
            data["credential"] = credential
            object["data"] = data
        }
        let transport = StubPairingHTTPTransport([
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-start-pending.json"),
                statusCode: 202
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-status-approved.json"),
                statusCode: 200
            ),
            MobileHTTPResponse(data: malformedClaim, statusCode: 201),
        ])
        let store = RecordingPairedProfileStore()
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )

        let pending = try await client.start(
            qrPayload: pairingFixtureData("pairing-qr-valid.json"),
            deviceName: "Personal iPhone"
        )
        let approved = try await client.status(for: pending)
        await #expect(throws: MobileClientError.invalidPayload) {
            try await client.exchange(approved)
        }

        #expect(await store.creates() == 0)
        #expect(await store.load() == nil)
    }

    @Test
    func keychainFailureCannotReportSuccessfulPairing() async throws {
        let transport = StubPairingHTTPTransport([
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-start-pending.json"),
                statusCode: 202
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-status-approved.json"),
                statusCode: 200
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-exchange-claimed.json"),
                statusCode: 201
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-exchange-claimed.json"),
                statusCode: 200
            ),
        ])
        let store = RecordingPairedProfileStore(failCreate: true)
        let client = URLSessionMobilePairingClient(
            transport: transport,
            profileStore: store,
            clock: { pairingNow }
        )
        let pending = try await client.start(
            qrPayload: pairingFixtureData("pairing-qr-valid.json"),
            deviceName: "Personal iPhone"
        )
        let approved = try await client.status(for: pending)

        await #expect(throws: MobileClientError.credentialStorageFailed) {
            try await client.exchange(approved)
        }
        #expect(await store.creates() == 1)
        #expect(await store.load() == nil)

        let recovered = try await client.exchange(approved)
        #expect(await store.creates() == 2)
        #expect(await store.load() == recovered)
    }

    @Test
    func validatedRepairReplacesOnlyTheSameServerProfile() async throws {
        let replacementTransport = StubPairingHTTPTransport([
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-start-pending.json"),
                statusCode: 202
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-status-approved.json"),
                statusCode: 200
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-exchange-claimed.json"),
                statusCode: 201
            ),
        ])
        let replacementStore = RecordingPairedProfileStore()
        let original = try storedCredential(
            serverID: pairingServerID,
            deviceID: "device-01",
            token: String(repeating: "A", count: 43)
        )
        await replacementStore.replace(original)
        let replacementClient = URLSessionMobilePairingClient(
            transport: replacementTransport,
            profileStore: replacementStore,
            clock: { pairingNow }
        )
        let pending = try await replacementClient.start(
            qrPayload: pairingFixtureData("pairing-qr-valid.json"),
            deviceName: "Personal iPhone"
        )
        let approved = try await replacementClient.status(for: pending)
        let replacement = try await replacementClient.exchange(approved)
        #expect(await replacementStore.load() == replacement)
        #expect(replacement.token == pairingToken)

        let blockedTransport = StubPairingHTTPTransport([
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-start-pending.json"),
                statusCode: 202
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-status-approved.json"),
                statusCode: 200
            ),
            MobileHTTPResponse(
                data: try pairingFixtureData("pairing-exchange-claimed.json"),
                statusCode: 201
            ),
        ])
        let blockedStore = RecordingPairedProfileStore()
        let anotherServer = try storedCredential(
            serverID: "22222222-2222-4222-8222-222222222222",
            token: String(repeating: "B", count: 43)
        )
        await blockedStore.replace(anotherServer)
        let blockedClient = URLSessionMobilePairingClient(
            transport: blockedTransport,
            profileStore: blockedStore,
            clock: { pairingNow }
        )
        let blockedPending = try await blockedClient.start(
            qrPayload: pairingFixtureData("pairing-qr-valid.json"),
            deviceName: "Personal iPhone"
        )
        let blockedApproved = try await blockedClient.status(for: blockedPending)
        await #expect(throws: MobileClientError.identityMismatch) {
            try await blockedClient.exchange(blockedApproved)
        }
        #expect(await blockedStore.load() == anotherServer)
    }

    @Test
    func pairingRejectionReplayExpiryAndUpgradeStayDistinct() async throws {
        let cases: [(Int, String, MobileClientError)] = [
            (403, "pairing-error-rejected.json", .pairing(.rejected)),
            (409, "pairing-error-replayed.json", .pairing(.replayed)),
            (410, "pairing-error-expired.json", .pairing(.expired)),
            (426, "pairing-error-upgrade-required.json", .upgradeRequired),
        ]

        for (statusCode, fixtureName, expectedError) in cases {
            let transport = StubPairingHTTPTransport([
                MobileHTTPResponse(
                    data: try pairingFixtureData(fixtureName),
                    statusCode: statusCode
                ),
            ])
            let store = RecordingPairedProfileStore()
            let client = URLSessionMobilePairingClient(
                transport: transport,
                profileStore: store,
                clock: { pairingNow }
            )

            do {
                _ = try await client.start(
                    qrPayload: pairingFixtureData("pairing-qr-valid.json"),
                    deviceName: "Personal iPhone"
                )
                Issue.record("Expected \(expectedError)")
            } catch let error as MobileClientError {
                #expect(error == expectedError)
            }
            #expect(await store.creates() == 0)
        }
    }

    @Test
    func pairingModelsAndErrorsRedactNonceAndCredential() async throws {
        let payload = try ValidatedPairingQRCodePayload(
            data: pairingFixtureData("pairing-qr-valid.json"),
            now: pairingNow
        )
        let start = try payload.makeStartRequest(deviceName: "Personal iPhone")
        let nonce = String(repeating: "N", count: 43)

        #expect(!String(describing: payload).contains(nonce))
        #expect(!String(reflecting: payload).contains(nonce))
        #expect(!String(describing: start).contains(nonce))
        #expect(!String(reflecting: start).contains(nonce))
        let pending = MobilePairingSession(
            pairingID: "pairing-session-01",
            serverID: try #require(UUID(uuidString: pairingServerID)),
            baseURL: try #require(
                URL(string: "https://money-monitor.tailnet.ts.net:8443/money-monitor")
            ),
            protocolVersion: 1,
            deviceName: "Personal iPhone",
            expiresAt: pairingNow.addingTimeInterval(300),
            progress: PairingProgress(
                state: .pendingApproval,
                expiresAt: pairingNow.addingTimeInterval(300),
                pollAfterSeconds: 1
            ),
            claimantSecret: pairingClaimantSecret
        )
        let claimantRequest = pending.makeClaimantRequest()
        #expect(!String(describing: pending).contains(pairingClaimantSecret))
        #expect(!String(reflecting: pending).contains(pairingClaimantSecret))
        #expect(!String(describing: claimantRequest).contains(pairingClaimantSecret))
        #expect(!String(reflecting: claimantRequest).contains(pairingClaimantSecret))
        #expect(!String(describing: MobileClientError.pairing(.rejected)).contains(pairingToken))
    }
}
