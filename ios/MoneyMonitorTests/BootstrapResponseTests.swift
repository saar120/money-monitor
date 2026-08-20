import Foundation
import Testing
@testable import MoneyMonitor

private final class BootstrapFixtureBundleToken: NSObject {}

private enum BootstrapFixtureError: Error {
    case missing(String)
    case invalidObject(String)
}

private func bootstrapFixtureData(_ filename: String) throws -> Data {
    let bundle = Bundle(for: BootstrapFixtureBundleToken.self)
    let name = String(filename.dropLast(".json".count))
    guard let url = bundle.url(
        forResource: name,
        withExtension: "json",
        subdirectory: "MobileBootstrap"
    ) else {
        throw BootstrapFixtureError.missing(filename)
    }
    return try Data(contentsOf: url)
}

private func mutatedBootstrapFixture(
    _ filename: String,
    mutate: (inout [String: Any]) throws -> Void
) throws -> Data {
    let data = try bootstrapFixtureData(filename)
    guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw BootstrapFixtureError.invalidObject(filename)
    }
    try mutate(&object)
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

struct BootstrapResponseTests {
    private let decoder = BootstrapPayloadDecoder()

    @Test
    func completeFixtureDecodesTypedMetadataAndDecimalStrings() throws {
        let response = try decoder.decodeSuccess(
            from: bootstrapFixtureData("bootstrap-complete.json")
        )

        #expect(response.meta.apiVersion == "1")
        #expect(response.meta.bootstrapSchemaVersion == 1)
        #expect(
            response.meta.server.id
                == UUID(uuidString: "11111111-1111-4111-8111-111111111111")
        )
        #expect(response.meta.server.protocolVersion == 1)
        #expect(response.meta.server.capabilities == [.mobileRead])
        #expect(response.meta.financialDate == "2026-07-15")
        #expect(response.meta.server.compatibility.status == .notEvaluated)
        #expect(response.meta.server.compatibility.reason == nil)
        #expect(response.data.home.aggregates.netWorth.amount.value == "128430.27")
        #expect(response.data.home.aggregates.netWorth.amount.currencyCode == "ILS")
        #expect(response.meta.calculatedAt == response.data.home.aggregates.netWorth.calculatedAt)
        #expect(response.meta.calculatedAt == response.data.home.aggregates.income.calculatedAt)
        #expect(response.meta.calculatedAt == response.data.home.aggregates.spending.calculatedAt)
        #expect(response.meta.calculatedAt == response.data.budgetPulse.calculatedAt)
        #expect(response.meta.calculatedAt == response.data.review.calculatedAt)
    }

    @Test
    func explicitlyEvaluatedCompatibilityAlsoRemainsAValidSuccessState() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard
                var meta = object["meta"] as? [String: Any],
                var server = meta["server"] as? [String: Any],
                var compatibility = server["compatibility"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            compatibility["status"] = "compatible"
            server["compatibility"] = compatibility
            meta["server"] = server
            object["meta"] = meta
        }

        #expect(try decoder.decodeSuccess(from: data).meta.server.compatibility.status == .compatible)
    }

    @Test
    func summerMidnightUsesTheJerusalemFinanceDate() throws {
        let response = try decoder.decodeSuccess(
            from: midnightFixture(
                calculatedAt: "2026-07-14T21:30:00.000Z",
                financialDate: "2026-07-15"
            )
        )

        #expect(response.meta.financialDate == "2026-07-15")
    }

    @Test
    func winterMidnightUsesTheJerusalemFinanceDate() throws {
        let response = try decoder.decodeSuccess(
            from: midnightFixture(
                calculatedAt: "2026-12-14T22:30:00.000Z",
                financialDate: "2026-12-15"
            )
        )

        #expect(response.meta.financialDate == "2026-12-15")
    }

    @Test
    func emptyFixturePreservesExplicitEmptyAndNeverRunStates() throws {
        let response = try decoder.decodeSuccess(from: bootstrapFixtureData("bootstrap-empty.json"))

        #expect(response.data.accounts.isEmpty)
        #expect(response.data.recentTransactions.isEmpty)
        #expect(response.data.budgetPulse.status == .unavailable)
        #expect(response.data.budgetPulse.spent == nil)
        #expect(response.data.review.count == 0)
        #expect(response.data.latestSync.status == .neverRun)
        #expect(response.data.latestSync.startedAt == nil)
        #expect(response.data.latestSync.completedAt == nil)
    }

    @Test
    func partialFixtureIsTypedAsNonCacheableWithOneSafeSectionError() throws {
        let response = try decoder.decodeSuccess(
            from: bootstrapFixtureData("bootstrap-partial-error.json")
        )

        #expect(response.meta.completeness.status == .partial)
        #expect(response.meta.cacheability.status == .notCacheable)
        #expect(response.meta.cacheability.maxAgeSeconds == 0)
        #expect(
            response.meta.completeness.sectionErrors
                == [
                    BootstrapSectionError(
                        section: .budgetPulse,
                        code: .calculationFailed,
                        retryable: true
                    ),
                ]
        )
        #expect(response.data.budgetPulse.status == .unavailable)
        #expect(response.data.latestSync.status == .partial)
        #expect(response.meta.calculatedAt == response.data.review.calculatedAt)
    }

    @Test
    func incompatibleFixtureDecodesOnlyAsUpgradeRequiredError() throws {
        let data = try bootstrapFixtureData("bootstrap-incompatible.json")
        let errorEnvelope = try decoder.decodeError(from: data)

        #expect(errorEnvelope.error.code == .upgradeRequired)
        #expect(errorEnvelope.error.message == "Update Money Monitor on this iPhone and Mac to continue.")
        #expect(errorEnvelope.meta.apiVersion == "1")
        #expect(errorEnvelope.meta.requestId == "fixture-incompatible-01")
        #expect(throws: DecodingError.self) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func mixedHebrewFixturePreservesBidirectionalContent() throws {
        let response = try decoder.decodeSuccess(
            from: bootstrapFixtureData("bootstrap-mixed-hebrew.json")
        )

        #expect(response.meta.server.displayName == "ה-Mac של Saar")
        #expect(response.data.recentTransactions.first?.displayName == "סופר שכונתי Market")
        #expect(response.data.recentTransactions.first?.category?.label == "מצרכים Groceries")
        #expect(response.data.accounts.first?.displayName == "חשבון ראשי")
        #expect(response.data.accounts.first?.institutionName == "בנק לדוגמה Example Bank")
    }

    @Test
    func mixedCurrencyFixturePreservesEveryOriginalMoneyStringAndCurrency() throws {
        let response = try decoder.decodeSuccess(
            from: bootstrapFixtureData("bootstrap-mixed-currency.json")
        )
        let moneyByCurrency = Dictionary(
            uniqueKeysWithValues: response.data.recentTransactions.map {
                ($0.amount.currencyCode, $0.amount.value)
            }
        )

        #expect(moneyByCurrency == ["ILS": "42.50", "USD": "19.99", "EUR": "64.20"])
        #expect(Set(response.data.accounts.map(\.currencyCode)) == Set(["ILS", "USD", "EUR"]))
        #expect(response.data.home.primaryCurrencyCode == "ILS")
        #expect(response.data.home.aggregates.netWorth.amount.currencyCode == "ILS")
    }

    @Test
    func forbiddenFixtureIsRejectedBeforeUnknownKeysCanBeDiscarded() throws {
        let data = try bootstrapFixtureData("bootstrap-forbidden-redaction.json")

        #expect(throws: BootstrapPayloadDecoderError.redactionViolation) {
            try decoder.decodeSuccess(from: data)
        }
        #expect(throws: BootstrapPayloadDecoderError.redactionViolation) {
            try decoder.decodeError(from: data)
        }
    }

    @Test
    func unknownOptionalFieldsAndEnumValuesRemainForwardCompatible() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            object["futureEnvelopeField"] = ["enabled": true]
            guard
                var payload = object["data"] as? [String: Any],
                var budget = payload["budgetPulse"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            budget["status"] = "future_budget_state"
            payload["budgetPulse"] = budget
            object["data"] = payload
        }

        let response = try decoder.decodeSuccess(from: data)

        #expect(response.data.budgetPulse.status == .unknown)
    }

    @Test
    func unsupportedRequiredSchemaVersionFailsSuccessDecoding() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard var meta = object["meta"] as? [String: Any] else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            meta["bootstrapSchemaVersion"] = 2
            object["meta"] = meta
        }

        #expect(throws: DecodingError.self) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func mismatchedCalculationPointIsRejected() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var home = payload["home"] as? [String: Any],
                var aggregates = home["aggregates"] as? [String: Any],
                var income = aggregates["income"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            income["calculatedAt"] = "2026-07-15T09:59:59.000Z"
            aggregates["income"] = income
            home["aggregates"] = aggregates
            payload["home"] = home
            object["data"] = payload
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func mismatchedFinancialDateAndFutureBusinessDateAreRejected() throws {
        let mismatchedDate = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard var meta = object["meta"] as? [String: Any] else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            meta["financialDate"] = "2026-07-14"
            object["meta"] = meta
        }
        let futureTransaction = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                !transactions.isEmpty
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            transactions[0]["occurredOn"] = "2026-07-16"
            payload["recentTransactions"] = transactions
            object["data"] = payload
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: mismatchedDate)
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: futureTransaction)
        }
    }

    @Test
    func contradictoryPartialSnapshotsAreRejected() throws {
        let cacheablePartial = try mutatedBootstrapFixture("bootstrap-partial-error.json") { object in
            guard
                var meta = object["meta"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-partial-error.json")
            }
            meta["cacheability"] = ["status": "cacheable", "maxAgeSeconds": 300]
            object["meta"] = meta
        }
        let availableFailedBudget = try mutatedBootstrapFixture(
            "bootstrap-partial-error.json"
        ) { object in
            guard
                var payload = object["data"] as? [String: Any],
                var budget = payload["budgetPulse"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-partial-error.json")
            }
            budget["status"] = "on_track"
            payload["budgetPulse"] = budget
            object["data"] = payload
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: cacheablePartial)
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: availableFailedBudget)
        }
    }

    @Test
    func activeMoneyRequiresCanonicalDecimalAndRecognizedCurrency() throws {
        for invalidValue in ["01.00", "+1.00", "1.", "1.00000", "1e2"] {
            let data = try mutatedHomeMoney(value: invalidValue)
            #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
                try decoder.decodeSuccess(from: data)
            }
        }

        let unknownCurrency = try mutatedHomeMoney(currencyCode: "ZZZ")
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: unknownCurrency)
        }
    }

    @Test
    func activeCalendarDatesMustRoundTripAndPeriodsMustBeOrdered() throws {
        let impossibleDate = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                !transactions.isEmpty
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            transactions[0]["occurredOn"] = "2026-02-30"
            payload["recentTransactions"] = transactions
            object["data"] = payload
        }
        let reversedPeriod = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var home = payload["home"] as? [String: Any],
                var aggregates = home["aggregates"] as? [String: Any],
                var spending = aggregates["spending"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            spending["period"] = ["startDate": "2026-07-15", "endDate": "2026-07-01"]
            aggregates["spending"] = spending
            home["aggregates"] = aggregates
            payload["home"] = home
            object["data"] = payload
        }

        for data in [impossibleDate, reversedPeriod] {
            #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
                try decoder.decodeSuccess(from: data)
            }
        }
    }

    @Test
    func activeReviewAccountsAndLatestSyncRejectInvalidFinancialState() throws {
        let negativeReview = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                var review = try requiredDictionary(payload["review"])
                review["count"] = -1
                payload["review"] = review
            }
        }
        let unknownAccountCurrency = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                var accounts = payload["accounts"] as? [[String: Any]] ?? []
                guard !accounts.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                accounts[0]["currencyCode"] = "ZZZ"
                payload["accounts"] = accounts
            }
        }
        let negativeSyncCount = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                var latestSync = try requiredDictionary(payload["latestSync"])
                latestSync["accountsSucceeded"] = -1
                payload["latestSync"] = latestSync
            }
        }

        for data in [negativeReview, unknownAccountCurrency, negativeSyncCount] {
            #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
                try decoder.decodeSuccess(from: data)
            }
        }
    }

    @Test
    func successfulEnvelopeRequiresTheCanonicalLiveSource() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard var meta = object["meta"] as? [String: Any] else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            meta["source"] = "future_source"
            object["meta"] = meta
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func internalOrUnmaskedIdentifiersAreRejectedAtTheMobileBoundary() throws {
        let numericSnapshotID = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            var meta = try requiredDictionary(object["meta"])
            meta["snapshotId"] = "42"
            object["meta"] = meta
        }
        let numericTransactionAccountID = try mutatedBootstrapFixture(
            "bootstrap-complete.json"
        ) { object in
            try mutatePayload(&object) { payload in
                var transactions = payload["recentTransactions"] as? [[String: Any]] ?? []
                guard !transactions.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                var account = try requiredDictionary(transactions[0]["account"])
                account["id"] = "42"
                transactions[0]["account"] = account
                payload["recentTransactions"] = transactions
            }
        }
        let unmaskedTransactionAccount = try mutatedBootstrapFixture(
            "bootstrap-complete.json"
        ) { object in
            try mutatePayload(&object) { payload in
                var transactions = payload["recentTransactions"] as? [[String: Any]] ?? []
                guard !transactions.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                var account = try requiredDictionary(transactions[0]["account"])
                account["identifierMask"] = "1234567890"
                transactions[0]["account"] = account
                payload["recentTransactions"] = transactions
            }
        }
        let unmaskedSummaryAccount = try mutatedBootstrapFixture(
            "bootstrap-complete.json"
        ) { object in
            try mutatePayload(&object) { payload in
                var accounts = payload["accounts"] as? [[String: Any]] ?? []
                guard !accounts.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                accounts[0]["identifierMask"] = "1234567890"
                payload["accounts"] = accounts
            }
        }

        for data in [
            numericSnapshotID,
            numericTransactionAccountID,
            unmaskedTransactionAccount,
            unmaskedSummaryAccount,
        ] {
            #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
                try decoder.decodeSuccess(from: data)
            }
        }
    }

    @Test
    func recentTransactionsRequireUniqueIDsAndTheContractRowLimit() throws {
        let duplicateID = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                var transactions = payload["recentTransactions"] as? [[String: Any]] ?? []
                guard let first = transactions.first else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                transactions.append(first)
                payload["recentTransactions"] = transactions
            }
        }
        let oversized = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                let transactions = payload["recentTransactions"] as? [[String: Any]] ?? []
                guard let first = transactions.first else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                payload["recentTransactions"] = (0 ..< 21).map { index in
                    var transaction = first
                    transaction["id"] = String(format: "txn_item_%02d", index)
                    return transaction
                }
            }
        }

        for data in [duplicateID, oversized] {
            #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
                try decoder.decodeSuccess(from: data)
            }
        }
    }

    @Test
    func unknownFailedSectionIsRejected() throws {
        let data = try mutatedBootstrapFixture("bootstrap-partial-error.json") { object in
            guard
                var meta = object["meta"] as? [String: Any],
                var completeness = meta["completeness"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-partial-error.json")
            }
            completeness["sectionErrors"] = [
                ["section": "future_section", "code": "source_timeout", "retryable": true],
            ]
            meta["completeness"] = completeness
            object["meta"] = meta
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func explicitlyFailedSectionsStillRequireCanonicalTransportContent() throws {
        let data = try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            guard var meta = object["meta"] as? [String: Any] else {
                throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
            }
            meta["cacheability"] = ["status": "not_cacheable", "maxAgeSeconds": 0]
            meta["completeness"] = [
                "status": "partial",
                "sectionErrors": [
                    ["section": "budget_pulse", "code": "calculation_failed", "retryable": true],
                    ["section": "review", "code": "source_timeout", "retryable": true],
                    ["section": "recent_transactions", "code": "source_timeout", "retryable": true],
                    ["section": "accounts", "code": "source_timeout", "retryable": true],
                    ["section": "latest_sync", "code": "source_timeout", "retryable": true],
                ],
            ]
            object["meta"] = meta

            try mutatePayload(&object) { payload in
                var budget = try requiredDictionary(payload["budgetPulse"])
                budget["status"] = "unavailable"
                budget["spent"] = ["value": "01.00", "currencyCode": "ZZZ"]
                budget["period"] = ["startDate": "2026-02-30", "endDate": "2026-02-01"]
                payload["budgetPulse"] = budget

                var review = try requiredDictionary(payload["review"])
                review["count"] = -1
                payload["review"] = review

                var transactions = payload["recentTransactions"] as? [[String: Any]] ?? []
                guard !transactions.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                transactions[0]["occurredOn"] = "2026-02-30"
                transactions[0]["amount"] = ["value": "01.00", "currencyCode": "ZZZ"]
                payload["recentTransactions"] = transactions

                var accounts = payload["accounts"] as? [[String: Any]] ?? []
                guard !accounts.isEmpty else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
                }
                accounts[0]["currencyCode"] = "ZZZ"
                payload["accounts"] = accounts

                var latestSync = try requiredDictionary(payload["latestSync"])
                latestSync["accountsSucceeded"] = -1
                payload["latestSync"] = latestSync
            }
        }

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    private func mutatedHomeMoney(
        value: String? = nil,
        currencyCode: String? = nil
    ) throws -> Data {
        try mutatedBootstrapFixture("bootstrap-complete.json") { object in
            try mutatePayload(&object) { payload in
                var home = try requiredDictionary(payload["home"])
                var aggregates = try requiredDictionary(home["aggregates"])
                var spending = try requiredDictionary(aggregates["spending"])
                var amount = try requiredDictionary(spending["amount"])
                if let value { amount["value"] = value }
                if let currencyCode { amount["currencyCode"] = currencyCode }
                spending["amount"] = amount
                aggregates["spending"] = spending
                home["aggregates"] = aggregates
                payload["home"] = home
            }
        }
    }

    private func mutatePayload(
        _ object: inout [String: Any],
        mutate: (inout [String: Any]) throws -> Void
    ) throws {
        var payload = try requiredDictionary(object["data"])
        try mutate(&payload)
        object["data"] = payload
    }

    private func requiredDictionary(_ value: Any?) throws -> [String: Any] {
        guard let dictionary = value as? [String: Any] else {
            throw BootstrapFixtureError.invalidObject("bootstrap-complete.json")
        }
        return dictionary
    }

    private func midnightFixture(calculatedAt: String, financialDate: String) throws -> Data {
        try mutatedBootstrapFixture("bootstrap-empty.json") { object in
            guard
                var meta = object["meta"] as? [String: Any],
                var payload = object["data"] as? [String: Any],
                var home = payload["home"] as? [String: Any],
                var aggregates = home["aggregates"] as? [String: Any],
                var budget = payload["budgetPulse"] as? [String: Any],
                var review = payload["review"] as? [String: Any]
            else {
                throw BootstrapFixtureError.invalidObject("bootstrap-empty.json")
            }

            for key in ["netWorth", "income", "spending"] {
                guard var aggregate = aggregates[key] as? [String: Any] else {
                    throw BootstrapFixtureError.invalidObject("bootstrap-empty.json")
                }
                aggregate["calculatedAt"] = calculatedAt
                aggregates[key] = aggregate
            }
            home["aggregates"] = aggregates
            budget["calculatedAt"] = calculatedAt
            review["calculatedAt"] = calculatedAt
            payload["home"] = home
            payload["budgetPulse"] = budget
            payload["review"] = review
            object["data"] = payload

            meta["calculatedAt"] = calculatedAt
            meta["generatedAt"] = calculatedAt
            meta["financialDate"] = financialDate
            object["meta"] = meta
        }
    }
}
