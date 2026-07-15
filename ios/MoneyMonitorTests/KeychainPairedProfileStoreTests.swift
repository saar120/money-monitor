import Foundation
import Security
import Testing
@testable import MoneyMonitor

private actor InMemorySecureItemClient: SecureItemClient {
    private var storedData: Data?
    private var forcedError: SecureItemError?

    func setForcedError(_ error: SecureItemError?) {
        forcedError = error
    }

    func add(data: Data, service _: String, account _: String) throws {
        if let forcedError { throw forcedError }
        guard storedData == nil else { throw SecureItemError.duplicateItem }
        storedData = data
    }

    func read(service _: String, account _: String) throws -> Data? {
        if let forcedError { throw forcedError }
        return storedData
    }

    func update(data: Data, service _: String, account _: String) throws {
        if let forcedError { throw forcedError }
        guard storedData != nil else { throw SecureItemError.itemNotFound }
        storedData = data
    }

    func delete(service _: String, account _: String) throws {
        if let forcedError { throw forcedError }
        storedData = nil
    }

    func overwriteForTest(_ data: Data) {
        storedData = data
    }
}

struct KeychainPairedProfileStoreTests {
    private let token = String(repeating: "A", count: 43)

    @Test
    func systemKeychainAddQueryIsDeviceOnlyAndAvailableOnlyWhenUnlocked() {
        let query = SystemKeychainClient.makeAddQuery(
            data: Data("secret".utf8),
            service: "test.money-monitor",
            account: "paired-device"
        ) as NSDictionary

        #expect(
            query[kSecAttrAccessible as String] as? String
                == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String
        )
    }

    @Test
    func createsAndLoadsCredentialWithoutChangingItsValidatedProfile() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")
        let credential = try makeCredential()

        try await store.create(credential)

        #expect(try await store.load() == credential)
        #expect(!String(describing: credential).contains(token))
        #expect(!String(reflecting: credential).contains(token))
    }

    @Test
    func duplicateCreateAndMissingReplaceRemainDistinct() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")
        let credential = try makeCredential()

        await #expect(throws: SecureItemError.itemNotFound) {
            try await store.replace(credential)
        }

        try await store.create(credential)
        await #expect(throws: SecureItemError.duplicateItem) {
            try await store.create(credential)
        }
    }

    @Test
    func replacesRotatedCredentialAndDeletesOnDisconnect() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")
        let original = try makeCredential()
        let rotated = try PairedMacCredential(
            profile: makeProfile(tokenVersion: 2),
            token: String(repeating: "B", count: 43)
        )

        try await store.create(original)
        try await store.replace(rotated)
        #expect(try await store.load() == rotated)

        try await store.delete()
        #expect(try await store.load() == nil)
    }

    @Test
    func pairingSaveReplacesOnlyTheSameServerDeviceIdentity() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")
        let original = try makeCredential()
        let repaired = try PairedMacCredential(
            profile: makeProfile(tokenVersion: 2),
            token: String(repeating: "B", count: 43)
        )

        try await store.savePairing(original)
        try await store.savePairing(repaired)
        #expect(try await store.load() == repaired)

        let anotherServer = try PairedMacCredential(
            profile: PairedMacProfile(
                serverID: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
                baseURL: URL(string: "https://another.example.ts.net/money-monitor")!,
                deviceID: "device-2",
                deviceName: "Personal iPhone",
                capabilities: ["mobile.read"],
                protocolVersion: 1,
                apiVersion: 1,
                tokenVersion: 1
            ),
            token: String(repeating: "C", count: 43)
        )
        await #expect(throws: PairedProfileStoreError.differentServer) {
            try await store.savePairing(anotherServer)
        }
        #expect(try await store.load() == repaired)

        let anotherDevice = try PairedMacCredential(
            profile: PairedMacProfile(
                serverID: repaired.profile.serverID,
                baseURL: URL(string: "https://renamed-host.example.ts.net/money-monitor")!,
                deviceID: "device-2",
                deviceName: "Personal iPhone",
                capabilities: ["mobile.read"],
                protocolVersion: 1,
                apiVersion: 1,
                tokenVersion: 1
            ),
            token: String(repeating: "D", count: 43)
        )
        await #expect(throws: PairedProfileStoreError.differentDevice) {
            try await store.savePairing(anotherDevice)
        }
        #expect(try await store.load() == repaired)
    }

    @Test
    func inaccessibleKeychainAndCorruptedDataNeverReportSuccess() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")

        await client.setForcedError(.inaccessible)
        await #expect(throws: SecureItemError.inaccessible) {
            try await store.create(makeCredential())
        }

        await client.setForcedError(nil)
        await client.overwriteForTest(Data("not-json".utf8))
        await #expect(throws: PairedProfileStoreError.corruptedCredential) {
            try await store.load()
        }
    }

    @Test
    func decodedKeychainPayloadIsRevalidatedInsteadOfTrustingStoredJSON() async throws {
        let client = InMemorySecureItemClient()
        let store = KeychainPairedProfileStore(client: client, bundleIdentifier: "test.money-monitor")
        let unsafePayload = Data(
            #"{"profile":{"serverID":"11111111-2222-3333-4444-555555555555","baseURL":"http:\/\/money-monitor.example.ts.net","deviceID":"device-1","deviceName":"iPhone","capabilities":["mobile.read"],"protocolVersion":1,"apiVersion":1,"tokenVersion":1},"token":"too-short"}"#.utf8
        )

        await client.overwriteForTest(unsafePayload)

        await #expect(throws: PairedProfileStoreError.corruptedCredential) {
            try await store.load()
        }
    }

    @Test
    func rejectsUnsafeURLsAndMalformedTokensBeforePersistence() throws {
        #expect(throws: PairedMacCredentialValidationError.invalidServerURL) {
            try PairedMacProfile(
                serverID: UUID(),
                baseURL: URL(string: "http://money-monitor.example.ts.net")!,
                deviceID: "device-1",
                deviceName: "iPhone",
                capabilities: ["mobile.read"],
                protocolVersion: 1,
                apiVersion: 1,
                tokenVersion: 1
            )
        }

        #expect(throws: PairedMacCredentialValidationError.invalidToken) {
            try PairedMacCredential(profile: makeProfile(), token: "too-short")
        }
    }

    private func makeCredential() throws -> PairedMacCredential {
        try PairedMacCredential(profile: makeProfile(), token: token)
    }

    private func makeProfile(tokenVersion: Int = 1) throws -> PairedMacProfile {
        try PairedMacProfile(
            serverID: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!,
            baseURL: URL(string: "https://money-monitor.example.ts.net:8443/money-monitor")!,
            deviceID: "device-1",
            deviceName: "  Personal   iPhone  ",
            capabilities: ["mobile.read", "mobile.read"],
            protocolVersion: 1,
            apiVersion: 1,
            tokenVersion: tokenVersion
        )
    }
}
