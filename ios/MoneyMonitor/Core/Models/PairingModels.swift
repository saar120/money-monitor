import Foundation

enum PairingPayloadValidationError: Error, Equatable, Sendable {
    case invalidJSON
    case invalidKind
    case unsupportedVersion
    case invalidPairingID
    case invalidNonce
    case invalidServerID
    case invalidBaseURL
    case expired
    case invalidDeviceName
}

struct ValidatedPairingQRCodePayload: Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    static let supportedQRVersion = 1
    static let supportedProtocolVersion = 1

    let pairingID: String
    let serverID: UUID
    let baseURL: URL
    let protocolVersion: Int
    let expiresAt: Date

    private let nonce: String

    init(data: Data, now: Date) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let wire: PairingQRCodeWire
        do {
            wire = try decoder.decode(PairingQRCodeWire.self, from: data)
        } catch {
            throw PairingPayloadValidationError.invalidJSON
        }

        guard wire.kind == "money-monitor-pairing" else {
            throw PairingPayloadValidationError.invalidKind
        }
        guard
            wire.version == Self.supportedQRVersion,
            wire.protocolVersion == Self.supportedProtocolVersion
        else {
            throw PairingPayloadValidationError.unsupportedVersion
        }
        guard Self.isOpaqueIdentifier(wire.pairingID) else {
            throw PairingPayloadValidationError.invalidPairingID
        }
        guard wire.nonce.range(
            of: #"^[A-Za-z0-9_-]{43}$"#,
            options: .regularExpression
        ) != nil else {
            throw PairingPayloadValidationError.invalidNonce
        }
        guard let serverID = UUID(uuidString: wire.serverID) else {
            throw PairingPayloadValidationError.invalidServerID
        }
        guard MobileURLValidation.isSafeHTTPSBaseURL(wire.baseURL) else {
            throw PairingPayloadValidationError.invalidBaseURL
        }
        guard wire.expiresAt > now else {
            throw PairingPayloadValidationError.expired
        }

        pairingID = wire.pairingID
        nonce = wire.nonce
        self.serverID = serverID
        baseURL = wire.baseURL
        protocolVersion = wire.protocolVersion
        expiresAt = wire.expiresAt
    }

    var description: String {
        "ValidatedPairingQRCodePayload(pairingID: \(pairingID), serverID: \(serverID), nonce: <redacted>)"
    }

    var debugDescription: String { description }

    func makeStartRequest(deviceName: String) throws -> PairingStartRequest {
        let normalizedDeviceName = try Self.normalizedDeviceName(deviceName)
        return PairingStartRequest(
            pairingId: pairingID,
            nonce: nonce,
            serverId: serverID.uuidString.lowercased(),
            protocolVersion: protocolVersion,
            deviceName: normalizedDeviceName
        )
    }

    static func normalizedDeviceName(_ deviceName: String) throws -> String {
        let normalized = deviceName
            .split(whereSeparator: \Character.isWhitespace)
            .joined(separator: " ")
        guard !normalized.isEmpty, normalized.count <= 80 else {
            throw PairingPayloadValidationError.invalidDeviceName
        }
        return normalized
    }

    private static func isOpaqueIdentifier(_ value: String) -> Bool {
        guard (1 ... 128).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            (48 ... 57).contains(scalar.value)
                || (65 ... 90).contains(scalar.value)
                || (97 ... 122).contains(scalar.value)
                || scalar == "-"
                || scalar == "_"
        }
    }
}

enum PairingApprovalState: String, Equatable, Sendable {
    case pendingApproval = "pending_approval"
    case approved
}

struct PairingProgress: Equatable, Sendable {
    let state: PairingApprovalState
    let expiresAt: Date?
    let pollAfterSeconds: Int?
}

struct MobilePairingSession: Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    let pairingID: String
    let serverID: UUID
    let baseURL: URL
    let protocolVersion: Int
    let deviceName: String
    let expiresAt: Date
    let progress: PairingProgress
    private let claimantSecret: String

    init(
        pairingID: String,
        serverID: UUID,
        baseURL: URL,
        protocolVersion: Int,
        deviceName: String,
        expiresAt: Date,
        progress: PairingProgress,
        claimantSecret: String
    ) {
        self.pairingID = pairingID
        self.serverID = serverID
        self.baseURL = baseURL
        self.protocolVersion = protocolVersion
        self.deviceName = deviceName
        self.expiresAt = expiresAt
        self.progress = progress
        self.claimantSecret = claimantSecret
    }

    var description: String {
        "MobilePairingSession(pairingID: \(pairingID), serverID: \(serverID), state: \(progress.state.rawValue))"
    }

    var debugDescription: String { description }

    func updating(with progress: PairingProgress) -> MobilePairingSession {
        MobilePairingSession(
            pairingID: pairingID,
            serverID: serverID,
            baseURL: baseURL,
            protocolVersion: protocolVersion,
            deviceName: deviceName,
            expiresAt: progress.expiresAt ?? expiresAt,
            progress: progress,
            claimantSecret: claimantSecret
        )
    }

    func makeClaimantRequest() -> PairingClaimantRequest {
        PairingClaimantRequest(pairingId: pairingID, claimantSecret: claimantSecret)
    }
}

struct PairingStartRequest: Encodable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    let pairingId: String
    let nonce: String
    let serverId: String
    let protocolVersion: Int
    let deviceName: String

    var description: String {
        "PairingStartRequest(pairingId: \(pairingId), serverId: \(serverId), nonce: <redacted>)"
    }

    var debugDescription: String { description }
}

struct PairingClaimantRequest: Encodable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    let pairingId: String
    let claimantSecret: String

    var description: String {
        "PairingClaimantRequest(pairingId: \(pairingId), claimantSecret: <redacted>)"
    }

    var debugDescription: String { description }
}

private struct PairingQRCodeWire: Decodable {
    let kind: String
    let version: Int
    let pairingID: String
    let nonce: String
    let serverID: String
    let baseURL: URL
    let protocolVersion: Int
    let expiresAt: Date

    private enum CodingKeys: String, CodingKey {
        case kind
        case version
        case pairingID = "pairingId"
        case nonce
        case serverID = "serverId"
        case baseURL
        case protocolVersion
        case expiresAt
    }
}
