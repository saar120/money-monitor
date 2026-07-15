import CoreFoundation
import Foundation

enum BootstrapPayloadDecoderError: Error, Equatable {
    case invalidJSON
    case redactionViolation
    case invalidSuccessEnvelope
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
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw BootstrapPayloadDecoderError.invalidJSON
        }

        guard root is [String: Any] else {
            throw BootstrapPayloadDecoderError.invalidJSON
        }
        guard !containsRedactionViolation(root) else {
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
            meta.financialDate == financialDateInJerusalem(for: meta.calculatedAt),
            data.home.aggregates.netWorth.calculatedAt == meta.calculatedAt,
            data.home.aggregates.income.calculatedAt == meta.calculatedAt,
            data.home.aggregates.spending.calculatedAt == meta.calculatedAt,
            data.budgetPulse.calculatedAt == meta.calculatedAt,
            data.review.calculatedAt == meta.calculatedAt
        else {
            throw BootstrapPayloadDecoderError.invalidSuccessEnvelope
        }

        let businessDatesAreCurrent = [
            data.home.aggregates.netWorth.period.endDate,
            data.home.aggregates.income.period.endDate,
            data.home.aggregates.spending.period.endDate,
            data.budgetPulse.period.endDate,
        ].allSatisfy { $0 <= meta.financialDate }
            && data.recentTransactions.allSatisfy { $0.occurredOn <= meta.financialDate }
        guard businessDatesAreCurrent else {
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
    }

    private func financialDateInJerusalem(for instant: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        guard let timeZone = TimeZone(identifier: "Asia/Jerusalem") else { return "" }
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return "" }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func containsRedactionViolation(_ value: Any) -> Bool {
        if let string = value as? String {
            return containsForbiddenString(string)
        }

        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return false
            }
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
            "credential",
            "token",
            "hash",
            "digest",
            "rawrow",
            "databaserow",
            "fullaccountnumber",
            "accountnumber",
            "routingnumber",
            "iban",
            "cardpan",
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

    private func matches(_ pattern: String, in value: String, caseInsensitive: Bool = false) -> Bool {
        var options: String.CompareOptions = .regularExpression
        if caseInsensitive { options.insert(.caseInsensitive) }
        return value.range(of: pattern, options: options) != nil
    }
}
