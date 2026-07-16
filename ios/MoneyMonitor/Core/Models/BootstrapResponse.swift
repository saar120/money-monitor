import Foundation

/// String-backed API enums decode unknown wire values into a safe `.unknown`
/// case instead of making the complete bootstrap payload undecodable.
protocol ForwardCompatibleStringEnum: Codable, RawRepresentable where RawValue == String {
    static var unknown: Self { get }
}

extension ForwardCompatibleStringEnum {
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let wireValue = try container.decode(String.self)
        self = Self(rawValue: wireValue) ?? Self.unknown
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum BootstrapResponseSource: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case live
    case unknown
}

enum BootstrapCapability: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case mobileRead = "mobile.read"
    case unknown
}

enum BootstrapCompatibilityStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case compatible
    case notEvaluated = "not_evaluated"
    case unknown
}

enum BootstrapCompatibilityReason: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case clientVersionTooOld = "client_version_too_old"
    case protocolUnsupported = "protocol_unsupported"
    case schemaUnsupported = "schema_unsupported"
    case unknown
}

enum BootstrapCacheabilityStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case cacheable
    case notCacheable = "not_cacheable"
    case unknown
}

enum BootstrapCompletenessStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case complete
    case partial
    case unknown
}

enum BootstrapSection: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case home
    case budgetPulse = "budget_pulse"
    case review
    case recentTransactions = "recent_transactions"
    case accounts
    case latestSync = "latest_sync"
    case unknown
}

enum BootstrapSectionErrorCode: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case sourceUnavailable = "source_unavailable"
    case sourceTimeout = "source_timeout"
    case calculationFailed = "calculation_failed"
    case unknown
}

enum BootstrapBudgetStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case onTrack = "on_track"
    case watch
    case overBudget = "over_budget"
    case unavailable
    case unknown
}

enum BootstrapTransactionStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case posted
    case pending
    case unknown
}

enum BootstrapTransactionDirection: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case debit
    case credit
    case unknown
}

enum BootstrapAccountType: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case checking
    case savings
    case creditCard = "credit_card"
    case investment
    case loan
    case other
    case unknown
}

enum BootstrapFreshnessStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case fresh
    case stale
    case neverSynced = "never_synced"
    case error
    case unknown
}

enum BootstrapSyncStatus: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case succeeded
    case partial
    case failed
    case neverRun = "never_run"
    case unknown
}

enum MobileErrorCode: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case invalidRequest = "invalid_request"
    case validationError = "validation_error"
    case authenticationRequired = "authentication_required"
    case authenticationInvalid = "authentication_invalid"
    case authenticationExpired = "authentication_expired"
    case authenticationRevoked = "authentication_revoked"
    case forbidden
    case capabilityRequired = "capability_required"
    case upgradeRequired = "upgrade_required"
    case routeNotFound = "route_not_found"
    case transactionNotFound = "transaction_not_found"
    case payloadTooLarge = "payload_too_large"
    case rateLimited = "rate_limited"
    case pairingInvalid = "pairing_invalid"
    case pairingRejected = "pairing_rejected"
    case pairingApprovalRequired = "pairing_approval_required"
    case pairingReplayed = "pairing_replayed"
    case pairingExchangeInProgress = "pairing_exchange_in_progress"
    case pairingExpired = "pairing_expired"
    case internalServerError = "internal_server_error"
    case unknown
}

struct BootstrapSuccessEnvelope: Codable, Equatable, Sendable {
    let data: BootstrapData
    let meta: BootstrapMetadata
}

struct BootstrapMetadata: Codable, Equatable, Sendable {
    static let supportedAPIVersion = "1"
    static let supportedSchemaVersion = 1

    let apiVersion: String
    let generatedAt: Date
    let calculatedAt: Date
    /// Calendar date used by the Mac's finance calculations (Asia/Jerusalem).
    let financialDate: String
    let source: BootstrapResponseSource
    let bootstrapSchemaVersion: Int
    let snapshotId: String
    let server: BootstrapServer
    let cacheability: BootstrapCacheability
    let completeness: BootstrapCompleteness

    private enum CodingKeys: String, CodingKey {
        case apiVersion
        case generatedAt
        case calculatedAt
        case financialDate
        case source
        case bootstrapSchemaVersion
        case snapshotId
        case server
        case cacheability
        case completeness
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let apiVersion = try container.decode(String.self, forKey: .apiVersion)
        let schemaVersion = try container.decode(Int.self, forKey: .bootstrapSchemaVersion)

        guard apiVersion == Self.supportedAPIVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .apiVersion,
                in: container,
                debugDescription: "Unsupported mobile API version"
            )
        }
        guard schemaVersion == Self.supportedSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .bootstrapSchemaVersion,
                in: container,
                debugDescription: "Unsupported bootstrap schema version"
            )
        }

        self.apiVersion = apiVersion
        generatedAt = try container.decode(Date.self, forKey: .generatedAt)
        calculatedAt = try container.decode(Date.self, forKey: .calculatedAt)
        financialDate = try container.decode(String.self, forKey: .financialDate)
        source = try container.decode(BootstrapResponseSource.self, forKey: .source)
        bootstrapSchemaVersion = schemaVersion
        snapshotId = try container.decode(String.self, forKey: .snapshotId)
        server = try container.decode(BootstrapServer.self, forKey: .server)
        cacheability = try container.decode(BootstrapCacheability.self, forKey: .cacheability)
        completeness = try container.decode(BootstrapCompleteness.self, forKey: .completeness)
    }
}

struct BootstrapServer: Codable, Equatable, Sendable {
    static let supportedProtocolVersion = 1

    let id: UUID
    let displayName: String
    let serverVersion: String
    let protocolVersion: Int
    let minimumClientVersion: String
    let capabilities: [BootstrapCapability]
    let compatibility: BootstrapCompatibility

    private enum CodingKeys: String, CodingKey {
        case id
        case displayName
        case serverVersion
        case protocolVersion
        case minimumClientVersion
        case capabilities
        case compatibility
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        guard protocolVersion == Self.supportedProtocolVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: container,
                debugDescription: "Unsupported pairing protocol version"
            )
        }

        id = try container.decode(UUID.self, forKey: .id)
        displayName = try container.decode(String.self, forKey: .displayName)
        serverVersion = try container.decode(String.self, forKey: .serverVersion)
        self.protocolVersion = protocolVersion
        minimumClientVersion = try container.decode(String.self, forKey: .minimumClientVersion)
        capabilities = try container.decode([BootstrapCapability].self, forKey: .capabilities)
        compatibility = try container.decode(BootstrapCompatibility.self, forKey: .compatibility)
    }
}

struct BootstrapCompatibility: Codable, Equatable, Sendable {
    let status: BootstrapCompatibilityStatus
    let reason: BootstrapCompatibilityReason?
}

struct BootstrapCacheability: Codable, Equatable, Sendable {
    let status: BootstrapCacheabilityStatus
    let maxAgeSeconds: Int
}

struct BootstrapCompleteness: Codable, Equatable, Sendable {
    let status: BootstrapCompletenessStatus
    let sectionErrors: [BootstrapSectionError]
}

struct BootstrapSectionError: Codable, Equatable, Sendable {
    let section: BootstrapSection
    let code: BootstrapSectionErrorCode
    let retryable: Bool
}

struct BootstrapData: Codable, Equatable, Sendable {
    let home: BootstrapHome
    let budgetPulse: BootstrapBudgetPulse
    let review: BootstrapReview
    let recentTransactions: [BootstrapRecentTransaction]
    let accounts: [BootstrapAccount]
    let latestSync: BootstrapLatestSync
}

struct BootstrapHome: Codable, Equatable, Sendable {
    let primaryCurrencyCode: String
    let aggregates: BootstrapHomeAggregates
}

struct BootstrapHomeAggregates: Codable, Equatable, Sendable {
    let netWorth: BootstrapMonetaryAggregate
    let income: BootstrapMonetaryAggregate
    let spending: BootstrapMonetaryAggregate
}

struct BootstrapMonetaryAggregate: Codable, Equatable, Sendable {
    let amount: BootstrapMoney
    let period: BootstrapPeriod
    let comparisonPeriod: BootstrapPeriod?
    let calculatedAt: Date
}

struct BootstrapMoney: Codable, Equatable, Sendable {
    /// Decimal money stays textual at the transport boundary to avoid binary
    /// floating-point changes before the domain layer chooses a decimal type.
    let value: String
    let currencyCode: String
}

struct BootstrapPeriod: Codable, Equatable, Sendable {
    let startDate: String
    let endDate: String
}

struct BootstrapBudgetPulse: Codable, Equatable, Sendable {
    let status: BootstrapBudgetStatus
    let spent: BootstrapMoney?
    let limit: BootstrapMoney?
    let remaining: BootstrapMoney?
    let period: BootstrapPeriod
    let calculatedAt: Date
}

struct BootstrapReview: Codable, Equatable, Sendable {
    let count: Int
    let calculatedAt: Date
}

struct BootstrapRecentTransaction: Codable, Equatable, Sendable {
    let id: String
    let occurredOn: String
    let displayName: String
    let amount: BootstrapMoney
    let direction: BootstrapTransactionDirection
    let status: BootstrapTransactionStatus
    let category: BootstrapTransactionCategory?
    let account: BootstrapTransactionAccount
}

struct BootstrapTransactionCategory: Codable, Equatable, Sendable {
    let id: String
    let label: String
}

struct BootstrapTransactionAccount: Codable, Equatable, Sendable {
    let id: String
    let displayName: String
    let identifierMask: String
}

struct BootstrapAccount: Codable, Equatable, Sendable {
    let id: String
    let displayName: String
    let institutionName: String
    let type: BootstrapAccountType
    let currencyCode: String
    let identifierMask: String
    let freshness: BootstrapAccountFreshness
}

struct BootstrapAccountFreshness: Codable, Equatable, Sendable {
    let status: BootstrapFreshnessStatus
    let lastSuccessfulSyncAt: Date?
}

struct BootstrapLatestSync: Codable, Equatable, Sendable {
    let status: BootstrapSyncStatus
    let startedAt: Date?
    let completedAt: Date?
    let accountsSucceeded: Int
    let accountsFailed: Int
}

struct MobileErrorEnvelope: Codable, Equatable, Sendable {
    let error: MobileErrorBody
    let meta: MobileErrorMetadata
}

struct MobileErrorBody: Codable, Equatable, Sendable {
    let code: MobileErrorCode
    let message: String
}

struct MobileErrorMetadata: Codable, Equatable, Sendable {
    let apiVersion: String
    let requestId: String
}

enum MobileTransactionOwnerKind: String, ForwardCompatibleStringEnum, Equatable, Sendable {
    case member
    case shared
    case unassigned
    case unknown
}

struct MobileTransactionQuery: Equatable, Hashable, Sendable {
    var query: String?
    var cursor: String?
    var limit: Int
    var startDate: String?
    var endDate: String?
    var direction: BootstrapTransactionDirection?
    var status: BootstrapTransactionStatus?
    var needsReview: Bool
    var includeExcluded: Bool
    var accountID: String?

    init(
        query: String? = nil,
        cursor: String? = nil,
        limit: Int = 30,
        startDate: String? = nil,
        endDate: String? = nil,
        direction: BootstrapTransactionDirection? = nil,
        status: BootstrapTransactionStatus? = nil,
        needsReview: Bool = false,
        includeExcluded: Bool = false,
        accountID: String? = nil
    ) {
        self.query = Self.canonicalSearchText(query)
        self.cursor = cursor
        self.limit = limit
        self.startDate = startDate
        self.endDate = endDate
        self.direction = direction
        self.status = status
        self.needsReview = needsReview
        self.includeExcluded = includeExcluded
        self.accountID = accountID
    }

    static func canonicalSearchText(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.precomposedStringWithCompatibilityMapping
        var result = ""
        result.reserveCapacity(normalized.utf8.count)
        var needsSeparator = false
        for scalar in normalized.unicodeScalars {
            if isECMAScriptWhitespace(scalar) {
                if !result.isEmpty { needsSeparator = true }
                continue
            }
            if needsSeparator {
                result.append(" ")
                needsSeparator = false
            }
            result.unicodeScalars.append(scalar)
        }
        return result.isEmpty ? nil : result
    }

    static func boundedRawSearchInput(
        _ value: String,
        maximumCanonicalUTF16Count: Int = 100
    ) -> String {
        guard maximumCanonicalUTF16Count > 0 else { return "" }
        let rawUTF16Count = value.utf16.count
        guard let canonical = canonicalSearchText(value) else {
            return rawUTF16Count <= maximumCanonicalUTF16Count ? value : ""
        }
        let canonicalUTF16Count = canonical.utf16.count
        if canonicalUTF16Count <= maximumCanonicalUTF16Count {
            return rawUTF16Count <= maximumCanonicalUTF16Count ? value : canonical
        }

        var prefix = ""
        prefix.reserveCapacity(maximumCanonicalUTF16Count)
        var prefixUTF16Count = 0
        for character in canonical {
            let next = String(character)
            let nextUTF16Count = next.utf16.count
            guard
                prefixUTF16Count + nextUTF16Count <= maximumCanonicalUTF16Count
            else {
                break
            }
            prefix.append(character)
            prefixUTF16Count += nextUTF16Count
        }
        return prefix
    }

    private static func isECMAScriptWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x0009 ... 0x000D,
             0x0020,
             0x00A0,
             0x1680,
             0x2000 ... 0x200A,
             0x2028,
             0x2029,
             0x202F,
             0x205F,
             0x3000,
             0xFEFF:
            true
        default:
            false
        }
    }

    var firstPage: Self {
        var copy = self
        copy.cursor = nil
        return copy
    }

    func page(after cursor: String) -> Self {
        var copy = self
        copy.cursor = cursor
        return copy
    }
}

struct MobileTransactionListEnvelope: Codable, Equatable, Sendable {
    let data: MobileTransactionListData
    let meta: MobileTransactionMetadata
}

struct MobileTransactionDetailEnvelope: Codable, Equatable, Sendable {
    let data: MobileTransactionDetailData
    let meta: MobileTransactionMetadata
}

struct MobileTransactionListData: Codable, Equatable, Sendable {
    let financialDate: String
    let transactions: [MobileTransaction]
    let page: MobileTransactionPage
}

struct MobileTransactionDetailData: Codable, Equatable, Sendable {
    let transaction: MobileTransaction
}

struct MobileTransactionMetadata: Codable, Equatable, Sendable {
    static let supportedAPIVersion = "1"

    let apiVersion: String
    let generatedAt: Date
    let source: BootstrapResponseSource
    let server: MobileTransactionServer
}

struct MobileTransactionServer: Codable, Equatable, Sendable {
    let id: UUID
    let protocolVersion: Int
}

struct MobileTransactionPage: Codable, Equatable, Sendable {
    let hasMore: Bool
    let nextCursor: String?
}

struct MobileTransaction: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let occurredOn: String
    let displayName: String
    let amount: BootstrapMoney
    let direction: BootstrapTransactionDirection
    let status: BootstrapTransactionStatus
    let category: BootstrapTransactionCategory?
    let account: BootstrapTransactionAccount
    let needsReview: Bool
    let excludedFromReports: Bool
    let owner: MobileTransactionOwner?
}

struct MobileTransactionOwner: Codable, Equatable, Sendable {
    let kind: MobileTransactionOwnerKind
    let displayName: String?
}
