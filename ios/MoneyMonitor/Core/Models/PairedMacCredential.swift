import Foundation

enum PairedMacCredentialValidationError: Error, Equatable {
    case invalidServerURL
    case invalidDeviceID
    case invalidDeviceName
    case invalidCapabilities
    case invalidVersion
    case invalidToken
}

struct PairedMacProfile: Codable, Equatable, Sendable {
    let serverID: UUID
    let baseURL: URL
    let deviceID: String
    let deviceName: String
    let capabilities: [String]
    let protocolVersion: Int
    let apiVersion: Int
    let tokenVersion: Int

    private enum CodingKeys: String, CodingKey {
        case serverID
        case baseURL
        case deviceID
        case deviceName
        case capabilities
        case protocolVersion
        case apiVersion
        case tokenVersion
    }

    init(
        serverID: UUID,
        baseURL: URL,
        deviceID: String,
        deviceName: String,
        capabilities: [String],
        protocolVersion: Int,
        apiVersion: Int,
        tokenVersion: Int
    ) throws {
        guard
            let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil
        else {
            throw PairedMacCredentialValidationError.invalidServerURL
        }

        let normalizedDeviceID = deviceID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedDeviceID.isEmpty, normalizedDeviceID.count <= 128 else {
            throw PairedMacCredentialValidationError.invalidDeviceID
        }

        let normalizedDeviceName = deviceName
            .split(whereSeparator: \Character.isWhitespace)
            .joined(separator: " ")
        guard !normalizedDeviceName.isEmpty, normalizedDeviceName.count <= 80 else {
            throw PairedMacCredentialValidationError.invalidDeviceName
        }

        let normalizedCapabilities = Array(Set(capabilities)).sorted()
        guard
            normalizedCapabilities.contains("mobile.read"),
            normalizedCapabilities.allSatisfy({ !$0.isEmpty && $0.count <= 64 })
        else {
            throw PairedMacCredentialValidationError.invalidCapabilities
        }

        guard protocolVersion > 0, apiVersion > 0, tokenVersion > 0 else {
            throw PairedMacCredentialValidationError.invalidVersion
        }

        self.serverID = serverID
        self.baseURL = baseURL
        self.deviceID = normalizedDeviceID
        self.deviceName = normalizedDeviceName
        self.capabilities = normalizedCapabilities
        self.protocolVersion = protocolVersion
        self.apiVersion = apiVersion
        self.tokenVersion = tokenVersion
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            serverID: container.decode(UUID.self, forKey: .serverID),
            baseURL: container.decode(URL.self, forKey: .baseURL),
            deviceID: container.decode(String.self, forKey: .deviceID),
            deviceName: container.decode(String.self, forKey: .deviceName),
            capabilities: container.decode([String].self, forKey: .capabilities),
            protocolVersion: container.decode(Int.self, forKey: .protocolVersion),
            apiVersion: container.decode(Int.self, forKey: .apiVersion),
            tokenVersion: container.decode(Int.self, forKey: .tokenVersion)
        )
    }
}

struct PairedMacCredential: Codable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    let profile: PairedMacProfile
    let token: String

    private enum CodingKeys: String, CodingKey {
        case profile
        case token
    }

    init(profile: PairedMacProfile, token: String) throws {
        guard token.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil else {
            throw PairedMacCredentialValidationError.invalidToken
        }
        self.profile = profile
        self.token = token
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            profile: container.decode(PairedMacProfile.self, forKey: .profile),
            token: container.decode(String.self, forKey: .token)
        )
    }

    var description: String {
        "PairedMacCredential(serverID: \(profile.serverID), deviceID: \(profile.deviceID), token: <redacted>)"
    }

    var debugDescription: String { description }
}
