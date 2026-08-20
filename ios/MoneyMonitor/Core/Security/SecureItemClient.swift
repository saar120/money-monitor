import Foundation
import Security

enum SecureItemError: Error, Equatable {
    case duplicateItem
    case itemNotFound
    case inaccessible
    case invalidData
    case unexpectedStatus(OSStatus)
}

protocol SecureItemClient: Sendable {
    func add(data: Data, service: String, account: String) async throws
    func read(service: String, account: String) async throws -> Data?
    func update(data: Data, service: String, account: String) async throws
    func delete(service: String, account: String) async throws
}

struct SystemKeychainClient: SecureItemClient, Sendable {
    func add(data: Data, service: String, account: String) async throws {
        let status = SecItemAdd(Self.makeAddQuery(data: data, service: service, account: account), nil)
        try Self.validate(status)
    }

    func read(service: String, account: String) async throws -> Data? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ] as CFDictionary,
            &result
        )

        if status == errSecItemNotFound { return nil }
        try Self.validate(status)
        guard let data = result as? Data else { throw SecureItemError.invalidData }
        return data
    }

    func update(data: Data, service: String, account: String) async throws {
        let status = SecItemUpdate(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ] as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        try Self.validate(status)
    }

    func delete(service: String, account: String) async throws {
        let status = SecItemDelete(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ] as CFDictionary
        )
        if status == errSecItemNotFound { return }
        try Self.validate(status)
    }

    private static func validate(_ status: OSStatus) throws {
        switch status {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            throw SecureItemError.duplicateItem
        case errSecItemNotFound:
            throw SecureItemError.itemNotFound
        case errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable:
            throw SecureItemError.inaccessible
        default:
            throw SecureItemError.unexpectedStatus(status)
        }
    }

    static func makeAddQuery(data: Data, service: String, account: String) -> CFDictionary {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: data,
        ] as CFDictionary
    }
}
