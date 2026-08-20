import Foundation

enum PairedProfileStoreError: Error, Equatable {
    case corruptedCredential
    case differentServer
    case differentDevice
}

protocol PairedProfileStore: Sendable {
    func create(_ credential: PairedMacCredential) async throws
    func load() async throws -> PairedMacCredential?
    func replace(_ credential: PairedMacCredential) async throws
    func savePairing(_ credential: PairedMacCredential) async throws
    func delete() async throws
}

struct KeychainPairedProfileStore: PairedProfileStore, Sendable {
    private static let account = "paired-mac-profile.v1"

    private let client: any SecureItemClient
    private let service: String

    init(
        client: any SecureItemClient = SystemKeychainClient(),
        bundleIdentifier: String = Bundle.main.bundleIdentifier ?? "com.example.MoneyMonitor"
    ) {
        self.client = client
        service = "\(bundleIdentifier).mobile-access"
    }

    func create(_ credential: PairedMacCredential) async throws {
        try await client.add(
            data: try Self.encode(credential),
            service: service,
            account: Self.account
        )
    }

    func load() async throws -> PairedMacCredential? {
        guard let data = try await client.read(service: service, account: Self.account) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(PairedMacCredential.self, from: data)
        } catch {
            throw PairedProfileStoreError.corruptedCredential
        }
    }

    func replace(_ credential: PairedMacCredential) async throws {
        try await client.update(
            data: try Self.encode(credential),
            service: service,
            account: Self.account
        )
    }

    func savePairing(_ credential: PairedMacCredential) async throws {
        guard let existing = try await load() else {
            try await create(credential)
            return
        }
        guard existing.profile.serverID == credential.profile.serverID else {
            throw PairedProfileStoreError.differentServer
        }
        guard existing.profile.deviceID == credential.profile.deviceID else {
            throw PairedProfileStoreError.differentDevice
        }
        try await replace(credential)
    }

    func delete() async throws {
        try await client.delete(service: service, account: Self.account)
    }

    private static func encode(_ credential: PairedMacCredential) throws -> Data {
        try JSONEncoder().encode(credential)
    }
}
