import CoreFoundation
import Foundation

enum BootstrapPayloadDecoderError: Error, Equatable {
    case invalidJSON
    case redactionViolation
    case invalidSuccessEnvelope
}

enum MobilePayloadSecurityValidationError: Error, Equatable {
    case invalidJSON
    case redactionViolation
}

/// Shared raw-payload boundary used before Codable can discard unknown fields.
struct MobilePayloadSecurityValidator {
    func validate(_ data: Data) throws {
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw MobilePayloadSecurityValidationError.invalidJSON
        }
        guard root is [String: Any] else {
            throw MobilePayloadSecurityValidationError.invalidJSON
        }
        guard !containsRedactionViolation(root) else {
            throw MobilePayloadSecurityValidationError.redactionViolation
        }
    }

    private func containsRedactionViolation(_ value: Any) -> Bool {
        if let string = value as? String {
            return containsForbiddenString(string)
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return false }
            let doubleValue = number.doubleValue
            return !doubleValue.isFinite || doubleValue.rounded(.towardZero) != doubleValue
        }
        if let array = value as? [Any] {
            return array.contains(where: containsRedactionViolation)
        }
        if let dictionary = value as? [String: Any] {
            return dictionary.contains { key, child in
                isForbiddenKey(key) || containsRedactionViolation(child)
            }
        }
        return false
    }

    private func isForbiddenKey(_ key: String) -> Bool {
        let normalized = String(
            key.unicodeScalars.filter { scalar in
                (48 ... 57).contains(scalar.value)
                    || (65 ... 90).contains(scalar.value)
                    || (97 ... 122).contains(scalar.value)
            }
        ).lowercased()
        return [
            "credential", "token", "hash", "digest", "rawrow", "databaserow",
            "fullaccountnumber", "accountnumber", "routingnumber", "iban", "cardpan",
        ].contains(where: normalized.contains)
    }

    private func containsForbiddenString(_ value: String) -> Bool {
        matches(#"(?:forbidden|secret)[_-]?sentinel"#, in: value, caseInsensitive: true)
            || matches(#"^(?:Bearer\s+|keychain://|credential://)"#, in: value, caseInsensitive: true)
            || matches(
                #"^(?:sk|pk|rk|ghp|github_pat|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{8,}$"#,
                in: value,
                caseInsensitive: true
            )
            || matches(
                #"^(?:[A-Za-z0-9_-]{43}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$"#,
                in: value
            )
            || matches(#"^[a-fA-F0-9]{64}$"#, in: value)
            || containsLongFinancialIdentifier(value)
    }

    private func containsLongFinancialIdentifier(_ value: String) -> Bool {
        guard let expression = try? NSRegularExpression(pattern: #"[\d -]{12,32}"#) else {
            return false
        }
        let range = NSRange(value.startIndex ..< value.endIndex, in: value)
        return expression.matches(in: value, range: range).contains { match in
            guard let candidateRange = Range(match.range, in: value) else { return false }
            let digitCount = value[candidateRange].unicodeScalars.count { scalar in
                (48 ... 57).contains(scalar.value)
            }
            return (12 ... 19).contains(digitCount)
        }
    }

    private func matches(
        _ pattern: String,
        in value: String,
        caseInsensitive: Bool = false
    ) -> Bool {
        var options: String.CompareOptions = .regularExpression
        if caseInsensitive { options.insert(.caseInsensitive) }
        return value.range(of: pattern, options: options) != nil
    }
}

enum MobileTransactionPayloadDecoderError: Error, Equatable {
    case invalidJSON
    case redactionViolation
    case invalidEnvelope
}

private struct MobileTransactionRawShapeValidator {
    private let rootKeys: Set<String> = ["data", "meta"]
    private let listDataKeys: Set<String> = ["financialDate", "transactions", "page"]
    private let detailDataKeys: Set<String> = ["transaction"]
    private let listTransactionKeys: Set<String> = [
        "id", "occurredOn", "displayName", "amount", "direction", "status",
        "category", "account", "needsReview", "excludedFromReports",
    ]
    private let detailTransactionKeys: Set<String> = [
        "id", "occurredOn", "displayName", "amount", "direction", "status",
        "category", "account", "needsReview", "excludedFromReports", "owner",
    ]
    private let amountKeys: Set<String> = ["value", "currencyCode"]
    private let categoryKeys: Set<String> = ["id", "label"]
    private let accountKeys: Set<String> = ["id", "displayName", "identifierMask"]
    private let pageKeys: Set<String> = ["hasMore", "nextCursor"]
    private let metaKeys: Set<String> = ["apiVersion", "generatedAt", "source", "server"]
    private let serverKeys: Set<String> = ["id", "protocolVersion"]
    private let ownerKeys: Set<String> = ["kind", "displayName"]

    func validateList(_ data: Data) throws {
        let root = try rootObject(data)
        let payload = try exactObject(root["data"], keys: listDataKeys)
        guard let transactions = payload["transactions"] as? [Any] else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        for value in transactions {
            try validateTransaction(value, includesOwner: false)
        }
        let page = try exactObject(payload["page"], keys: pageKeys)
        guard page["nextCursor"] is NSNull || page["nextCursor"] is String else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        try validateMetadata(root["meta"])
    }

    func validateDetail(_ data: Data) throws {
        let root = try rootObject(data)
        let payload = try exactObject(root["data"], keys: detailDataKeys)
        try validateTransaction(payload["transaction"], includesOwner: true)
        try validateMetadata(root["meta"])
    }

    private func rootObject(_ data: Data) throws -> [String: Any] {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(root.keys) == rootKeys
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        return root
    }

    private func exactObject(
        _ value: Any?,
        keys: Set<String>
    ) throws -> [String: Any] {
        guard
            let object = value as? [String: Any],
            Set(object.keys) == keys
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        return object
    }

    private func validateTransaction(_ value: Any?, includesOwner: Bool) throws {
        let transaction = try exactObject(
            value,
            keys: includesOwner ? detailTransactionKeys : listTransactionKeys
        )
        _ = try exactObject(transaction["amount"], keys: amountKeys)
        if !(transaction["category"] is NSNull) {
            _ = try exactObject(transaction["category"], keys: categoryKeys)
        }
        _ = try exactObject(transaction["account"], keys: accountKeys)
        try requireString(
            transaction["direction"],
            in: ["debit", "credit", "unknown"]
        )
        try requireString(
            transaction["status"],
            in: ["posted", "pending", "unknown"]
        )

        guard includesOwner else { return }
        let owner = try exactObject(transaction["owner"], keys: ownerKeys)
        try requireString(
            owner["kind"],
            in: ["member", "shared", "unassigned", "unknown"]
        )
        guard owner["displayName"] is NSNull || owner["displayName"] is String else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
    }

    private func validateMetadata(_ value: Any?) throws {
        let meta = try exactObject(value, keys: metaKeys)
        guard
            meta["apiVersion"] as? String == "1",
            meta["source"] as? String == "live",
            let generatedAt = meta["generatedAt"] as? String,
            isExactUTCInstant(generatedAt)
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        let server = try exactObject(meta["server"], keys: serverKeys)
        guard
            let protocolVersion = server["protocolVersion"] as? NSNumber,
            CFGetTypeID(protocolVersion) != CFBooleanGetTypeID(),
            protocolVersion.intValue == 1,
            protocolVersion.doubleValue == 1
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
    }

    private func requireString(_ value: Any?, in allowed: Set<String>) throws {
        guard let value = value as? String, allowed.contains(value) else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
    }

    private func isExactUTCInstant(_ value: String) -> Bool {
        guard value.range(
            of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$"#,
            options: .regularExpression
        ) != nil else {
            return false
        }
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = value.contains(".")
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        guard let date = formatter.date(from: value), date.timeIntervalSince1970.isFinite else {
            return false
        }
        return formatter.string(from: date) == value
    }
}

struct MobileTransactionPayloadDecoder: Sendable {
    func decodeList(from data: Data) throws -> MobileTransactionListEnvelope {
        try validateSecurity(data)
        try MobileTransactionRawShapeValidator().validateList(data)
        let envelope = try decode(MobileTransactionListEnvelope.self, from: data)
        guard
            isValidMetadata(envelope.meta),
            isValidFinancialDate(envelope.data.financialDate),
            envelope.data.transactions.count <= 50,
            Set(envelope.data.transactions.map(\.id)).count == envelope.data.transactions.count,
            envelope.data.transactions.allSatisfy({ transaction in
                isValid(transaction, maximumDate: envelope.data.financialDate, requiresOwner: false)
            }),
            envelope.data.page.hasMore == (envelope.data.page.nextCursor != nil),
            envelope.data.page.nextCursor.map(isValidCursor) ?? true
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        return envelope
    }

    func decodeDetail(from data: Data) throws -> MobileTransactionDetailEnvelope {
        try validateSecurity(data)
        try MobileTransactionRawShapeValidator().validateDetail(data)
        let envelope = try decode(MobileTransactionDetailEnvelope.self, from: data)
        guard
            isValidMetadata(envelope.meta),
            isValid(envelope.data.transaction, maximumDate: nil, requiresOwner: true)
        else {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
        return envelope
    }

    private func validateSecurity(_ data: Data) throws {
        do {
            try MobilePayloadSecurityValidator().validate(data)
        } catch MobilePayloadSecurityValidationError.invalidJSON {
            throw MobileTransactionPayloadDecoderError.invalidJSON
        } catch {
            throw MobileTransactionPayloadDecoderError.redactionViolation
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw MobileTransactionPayloadDecoderError.invalidEnvelope
        }
    }

    private func isValidMetadata(_ meta: MobileTransactionMetadata) -> Bool {
        meta.apiVersion == MobileTransactionMetadata.supportedAPIVersion
            && meta.source == .live
            && meta.server.protocolVersion == BootstrapServer.supportedProtocolVersion
    }

    private func isValid(
        _ transaction: MobileTransaction,
        maximumDate: String?,
        requiresOwner: Bool
    ) -> Bool {
        guard
            isValidPublicID(transaction.id, kind: "transaction"),
            isValidFinancialDate(transaction.occurredOn),
            maximumDate.map({ transaction.occurredOn <= $0 }) ?? true,
            isValidDisplayText(transaction.displayName, maximum: 160),
            isValidMoney(transaction.amount),
            transaction.category.map({
                isValidPublicID($0.id, kind: "category")
                    && isValidDisplayText($0.label, maximum: 80)
            }) ?? true,
            isValidPublicID(transaction.account.id, kind: "account"),
            isValidDisplayText(transaction.account.displayName, maximum: 80),
            isValidIdentifierMask(transaction.account.identifierMask)
        else {
            return false
        }

        if requiresOwner {
            guard let owner = transaction.owner else { return false }
            return isValid(owner)
        }
        return transaction.owner == nil
    }

    private func isValid(_ owner: MobileTransactionOwner) -> Bool {
        switch owner.kind {
        case .member:
            guard let displayName = owner.displayName else { return false }
            return isValidDisplayText(displayName, maximum: 80)
        case .shared, .unassigned, .unknown:
            return owner.displayName == nil
        }
    }

    private func isValidMoney(_ money: BootstrapMoney) -> Bool {
        matches(#"^(?:0|[1-9]\d*)(?:\.\d{1,4})?$"#, in: money.value)
            && Decimal(string: money.value, locale: Locale(identifier: "en_US_POSIX")) != nil
            && matches(#"^[A-Z]{3}$"#, in: money.currencyCode)
            && Locale.commonISOCurrencyCodes.contains(money.currencyCode)
    }

    private func isValidPublicID(_ value: String, kind: String) -> Bool {
        matches("^\(kind)_[A-Za-z0-9_-]{22}$", in: value)
    }

    private func isValidCursor(_ value: String) -> Bool {
        value.count <= 512 && matches(#"^cursor_v1_[A-Za-z0-9_-]+$"#, in: value)
    }

    private func isValidIdentifierMask(_ value: String) -> Bool {
        matches(#"^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$"#, in: value)
    }

    private func isValidDisplayText(_ value: String, maximum: Int) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= maximum
    }

    private func isValidFinancialDate(_ value: String) -> Bool {
        guard matches(#"^\d{4}-\d{2}-\d{2}$"#, in: value) else { return false }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
        ) else {
            return false
        }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == parts[0]
            && roundTrip.month == parts[1]
            && roundTrip.day == parts[2]
    }

    private func matches(_ pattern: String, in value: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
}

/// Validates the raw JSON tree before Codable can discard unknown keys, then
/// decodes one of the two explicit mobile bootstrap envelope shapes.
struct BootstrapPayloadDecoder: Sendable {
    func decodeSuccess(from data: Data) throws -> BootstrapSuccessEnvelope {
        try validateRedactionBoundary(data)
        let response = try makeJSONDecoder().decode(BootstrapSuccessEnvelope.self, from: data)
        try validateSuccessEnvelope(response)
        return response
    }

    func decodeError(from data: Data) throws -> MobileErrorEnvelope {
        try validateRedactionBoundary(data)
        return try makeJSONDecoder().decode(MobileErrorEnvelope.self, from: data)
    }

    private func makeJSONDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private func validateRedactionBoundary(_ data: Data) throws {
        do {
            try MobilePayloadSecurityValidator().validate(data)
        } catch MobilePayloadSecurityValidationError.invalidJSON {
            throw BootstrapPayloadDecoderError.invalidJSON
        } catch {
            throw BootstrapPayloadDecoderError.redactionViolation
        }
    }

    private func validateSuccessEnvelope(_ response: BootstrapSuccessEnvelope) throws {
        let meta = response.meta
        let data = response.data

        guard
            meta.server.capabilities.contains(.mobileRead),
            [.compatible, .notEvaluated].contains(meta.server.compatibility.status),
            meta.server.compatibility.reason == nil,
            meta.calculatedAt <= meta.generatedAt,
            isValidFinancialDate(meta.financialDate),
            meta.financialDate == financialDateInJerusalem(for: meta.calculatedAt),
            meta.source == .live,
            isValidOpaqueID(meta.snapshotId)
        else {
            throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
        }

        switch meta.cacheability.status {
        case .cacheable:
            guard meta.cacheability.maxAgeSeconds > 0 else {
                throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
            }
        case .notCacheable:
            guard meta.cacheability.maxAgeSeconds == 0 else {
                throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
            }
        case .unknown:
            throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
        }

        switch meta.completeness.status {
        case .complete:
            guard meta.completeness.sectionErrors.isEmpty else {
                throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
            }
        case .partial:
            let errors = meta.completeness.sectionErrors
            let uniqueSections = Set(errors.map(\.section.rawValue))
            guard
                !errors.isEmpty,
                uniqueSections.count == errors.count,
                !errors.contains(where: { $0.section == .unknown }),
                meta.cacheability.status == .notCacheable
            else {
                throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
            }
            if errors.contains(where: { $0.section == .budgetPulse }) {
                guard data.budgetPulse.status == .unavailable else {
                    throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
                }
            }
        case .unknown:
            throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
        }

        try validateSections(data, meta: meta)
    }

    private func validateSections(
        _ data: BootstrapData,
        meta: BootstrapMetadata
    ) throws {
        let aggregates = [
            data.home.aggregates.netWorth,
            data.home.aggregates.income,
            data.home.aggregates.spending,
        ]
        guard
            isValidCurrency(data.home.primaryCurrencyCode),
            aggregates.allSatisfy({ aggregate in
                aggregate.calculatedAt == meta.calculatedAt
                    && aggregate.period.endDate <= meta.financialDate
                    && isValidMoney(aggregate.amount)
                    && aggregate.amount.currencyCode == data.home.primaryCurrencyCode
                    && isValidPeriod(aggregate.period)
                    && isValidComparisonPeriod(
                        aggregate.comparisonPeriod,
                        primaryPeriod: aggregate.period
                    )
            }),
            data.budgetPulse.calculatedAt == meta.calculatedAt,
            data.budgetPulse.period.endDate <= meta.financialDate,
            isValidPeriod(data.budgetPulse.period),
            isValidBudgetPulse(data.budgetPulse),
            data.review.calculatedAt == meta.calculatedAt,
            data.review.count >= 0,
            data.recentTransactions.count <= 20,
            Set(data.recentTransactions.map(\.id)).count == data.recentTransactions.count,
            data.recentTransactions.allSatisfy({ transaction in
                isValidOpaqueID(transaction.id)
                    && isValidFinancialDate(transaction.occurredOn)
                    && transaction.occurredOn <= meta.financialDate
                    && isValidMoney(transaction.amount)
                    && (transaction.category.map { isValidOpaqueID($0.id) } ?? true)
                    && isValidOpaqueID(transaction.account.id)
                    && isValidIdentifierMask(transaction.account.identifierMask)
            }),
            data.accounts.allSatisfy({ account in
                isValidOpaqueID(account.id)
                    && isValidCurrency(account.currencyCode)
                    && isValidIdentifierMask(account.identifierMask)
                    && isValidAccountFreshness(account.freshness, generatedAt: meta.generatedAt)
            }),
            isValidLatestSync(data.latestSync, generatedAt: meta.generatedAt)
        else {
            throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
        }
    }

    private func isValidMoney(_ money: BootstrapMoney) -> Bool {
        matches(#"^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$"#, in: money.value)
            && Decimal(string: money.value, locale: Locale(identifier: "en_US_POSIX")) != nil
            && isValidCurrency(money.currencyCode)
    }

    private func isValidCurrency(_ value: String) -> Bool {
        matches(#"^[A-Z]{3}$"#, in: value)
            && Locale.commonISOCurrencyCodes.contains(value)
    }

    private func isValidOpaqueID(_ value: String) -> Bool {
        matches(#"^(?!\d+$)[A-Za-z0-9_-]{8,128}$"#, in: value)
    }

    private func isValidIdentifierMask(_ value: String) -> Bool {
        matches(#"^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$"#, in: value)
    }

    private func isValidPeriod(_ period: BootstrapPeriod) -> Bool {
        isValidFinancialDate(period.startDate)
            && isValidFinancialDate(period.endDate)
            && period.startDate <= period.endDate
    }

    private func isValidComparisonPeriod(
        _ comparisonPeriod: BootstrapPeriod?,
        primaryPeriod: BootstrapPeriod
    ) -> Bool {
        guard let comparisonPeriod else { return true }
        return isValidPeriod(comparisonPeriod)
            && comparisonPeriod.endDate < primaryPeriod.startDate
    }

    private func isValidBudgetPulse(_ pulse: BootstrapBudgetPulse) -> Bool {
        let amounts = [pulse.spent, pulse.limit, pulse.remaining]
        if pulse.status == .unavailable {
            return amounts.allSatisfy { $0 == nil }
        }
        guard
            let spent = pulse.spent,
            let limit = pulse.limit,
            let remaining = pulse.remaining,
            [spent, limit, remaining].allSatisfy(isValidMoney)
        else {
            return false
        }
        return Set([spent.currencyCode, limit.currencyCode, remaining.currencyCode]).count == 1
    }

    private func isValidFinancialDate(_ value: String) -> Bool {
        guard matches(#"^\d{4}-\d{2}-\d{2}$"#, in: value) else { return false }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard
            parts.count == 3,
            let year = Int(parts[0]),
            let month = Int(parts[1]),
            let day = Int(parts[2])
        else {
            return false
        }

        var calendar = Calendar(identifier: .gregorian)
        guard let timeZone = TimeZone(secondsFromGMT: 0) else { return false }
        calendar.timeZone = timeZone
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else {
            return false
        }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == year && roundTrip.month == month && roundTrip.day == day
    }

    private func isValidAccountFreshness(
        _ freshness: BootstrapAccountFreshness,
        generatedAt: Date
    ) -> Bool {
        if let lastSuccessfulSyncAt = freshness.lastSuccessfulSyncAt,
           lastSuccessfulSyncAt > generatedAt
        {
            return false
        }
        switch freshness.status {
        case .fresh, .stale:
            return freshness.lastSuccessfulSyncAt != nil
        case .neverSynced:
            return freshness.lastSuccessfulSyncAt == nil
        case .error, .unknown:
            return true
        }
    }

    private func isValidLatestSync(_ sync: BootstrapLatestSync, generatedAt: Date) -> Bool {
        guard sync.accountsSucceeded >= 0, sync.accountsFailed >= 0 else { return false }
        if sync.status == .neverRun {
            return sync.startedAt == nil
                && sync.completedAt == nil
                && sync.accountsSucceeded == 0
                && sync.accountsFailed == 0
        }
        guard
            let startedAt = sync.startedAt,
            let completedAt = sync.completedAt,
            startedAt <= completedAt,
            completedAt <= generatedAt
        else {
            return false
        }
        if sync.status == .succeeded { return sync.accountsFailed == 0 }
        if sync.status == .partial || sync.status == .failed { return sync.accountsFailed > 0 }
        return true
    }

    private func financialDateInJerusalem(for instant: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        guard let timeZone = TimeZone(identifier: "Asia/Jerusalem") else { return "" }
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return "" }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func matches(_ pattern: String, in value: String, caseInsensitive: Bool = false) -> Bool {
        var options: String.CompareOptions = .regularExpression
        if caseInsensitive { options.insert(.caseInsensitive) }
        return value.range(of: pattern, options: options) != nil
    }
}
