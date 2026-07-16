import Foundation
import Testing
@testable import MoneyMonitor

private final class HomePresentationFixtureBundleToken: NSObject {}

private enum HomePresentationFixtureError: Error {
    case missing(String)
    case invalidObject(String)
}

private func homeFixtureData(_ filename: String) throws -> Data {
    let bundle = Bundle(for: HomePresentationFixtureBundleToken.self)
    let name = String(filename.dropLast(".json".count))
    guard let url = bundle.url(
        forResource: name,
        withExtension: "json",
        subdirectory: "MobileBootstrap"
    ) else {
        throw HomePresentationFixtureError.missing(filename)
    }
    return try Data(contentsOf: url)
}

private func mutatedHomeFixture(
    _ filename: String,
    mutate: (inout [String: Any]) throws -> Void
) throws -> Data {
    let data = try homeFixtureData(filename)
    guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw HomePresentationFixtureError.invalidObject(filename)
    }
    try mutate(&object)
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

struct HomePresentationTests {
    private let decoder = BootstrapPayloadDecoder()
    private let builder = HomePresentationBuilder(
        formatting: HomePresentationFormatting(
            locale: Locale(identifier: "en_US"),
            calendar: Calendar(identifier: .gregorian),
            timeZone: TimeZone(secondsFromGMT: 3 * 60 * 60)!
        )
    )

    @Test
    func completeFixtureExposesNamedFinancialSectionsAndAbsoluteCalculationTime() throws {
        let presentation = try presentation(for: "bootstrap-complete.json")

        #expect(presentation.sourceMac == "Saar’s Mac")
        #expect(presentation.sourceLabel == "Live from Saar’s Mac")
        #expect(presentation.calculatedLabel.hasPrefix("Calculated "))
        #expect(!presentation.isPartial)
        #expect(presentation.calculatedLabel.contains("Jul 15, 2026"))
        #expect(presentation.calculatedLabel.contains("1:00"))

        guard case let .available(summary) = presentation.summary else {
            Issue.record("Expected complete summary")
            return
        }
        #expect(summary.spending.title == "Spending")
        #expect(summary.income.title == "Income")
        #expect(summary.netWorth.title == "Net worth")
        #expect(summary.spending.value == Decimal(string: "4560.30"))
        #expect(summary.income.value == Decimal(string: "12500.00"))
        #expect(summary.netWorth.value == Decimal(string: "128430.27"))
        #expect(summary.spending.currencyCode == "ILS")
        #expect(summary.spending.periodLabel?.contains("Jul 1") == true)
        #expect(summary.spending.periodLabel?.contains("15, 2026") == true)
        #expect(summary.income.periodLabel?.contains("Jul 1") == true)
        #expect(summary.netWorth.periodLabel == "As of Jul 15, 2026")

        guard case let .available(budget) = presentation.budget else {
            Issue.record("Expected complete budget")
            return
        }
        #expect(budget.title == "Budget")
        #expect(budget.status == .onTrack)
        #expect(budget.periodLabel?.contains("Jul 1") == true)
        #expect(budget.remaining?.value == Decimal(string: "4439.70"))

        guard case let .available(review) = presentation.review else {
            Issue.record("Expected complete review")
            return
        }
        #expect(review.count == 3)
        #expect(review.countLabel == "3")
        #expect(review.message == "3 transactions need review")

        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected complete activity")
            return
        }
        #expect(activity.title == "Recent activity")
        #expect(activity.items.count == 2)
    }

    @Test
    func completeEmptyFixtureKeepsLegitimateZeroAndEmptyDataAvailable() throws {
        let presentation = try presentation(for: "bootstrap-empty.json")

        guard case let .available(summary) = presentation.summary else {
            Issue.record("Expected zero summary, not a failed summary")
            return
        }
        #expect(summary.spending.value == 0)
        #expect(summary.income.value == 0)
        #expect(summary.netWorth.value == 0)

        guard case let .available(budget) = presentation.budget else {
            Issue.record("Expected an unavailable budget summary")
            return
        }
        #expect(budget.status == .unavailable)
        #expect(budget.status.rawValue == "Unavailable")
        #expect(budget.periodLabel == nil)
        #expect(budget.spent == nil)
        #expect(budget.limit == nil)
        #expect(budget.remaining == nil)

        guard case let .available(review) = presentation.review else {
            Issue.record("Expected zero review count")
            return
        }
        #expect(review.count == 0)
        #expect(review.message == "No transactions need review")

        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected legitimate empty activity")
            return
        }
        #expect(activity.items.isEmpty)
    }

    @Test
    func partialBudgetFixtureSuppressesOnlyTheFailedBudgetSection() throws {
        let presentation = try presentation(for: "bootstrap-partial-error.json")

        #expect(presentation.isPartial)
        #expect(presentation.budget == .unavailable)
        guard case .available = presentation.summary else {
            Issue.record("Expected summary to remain available")
            return
        }
        guard case let .available(review) = presentation.review else {
            Issue.record("Expected review to remain available")
            return
        }
        #expect(review.count == 2)
        #expect(presentation.recentActivity == .available(.init(title: "Recent activity", items: [])))
    }

    @Test
    func failureOutsideTheVisibleHomeSectionsDoesNotShowHomeAsPartial() throws {
        let data = try partialFixture(section: "accounts")
        let presentation = try builder.makePresentation(from: decoder.decodeSuccess(from: data))

        #expect(!presentation.isPartial)
        #expect(presentation.summary != .unavailable)
        #expect(presentation.budget != .unavailable)
        #expect(presentation.review != .unavailable)
        #expect(presentation.recentActivity != .unavailable)
    }

    @Test
    func mixedCurrencyActivityFormatsEveryAmountWithItsOwnCurrency() throws {
        let presentation = try presentation(for: "bootstrap-mixed-currency.json")
        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected mixed-currency activity")
            return
        }

        let amounts = Dictionary(uniqueKeysWithValues: activity.items.map { item in
            (item.amount.currencyCode, item.amount)
        })
        #expect(amounts["ILS"]?.value == Decimal(string: "-42.50"))
        #expect(amounts["USD"]?.value == Decimal(string: "-19.99"))
        #expect(amounts["EUR"]?.value == Decimal(string: "-64.20"))
        #expect(amounts["ILS"]?.formatted.contains("₪") == true)
        #expect(amounts["USD"]?.formatted.contains("$") == true)
        #expect(amounts["EUR"]?.formatted.contains("€") == true)
    }

    @Test
    func mixedHebrewAndEnglishStringsArePreservedVerbatim() throws {
        let presentation = try presentation(for: "bootstrap-mixed-hebrew.json")
        guard case let .available(activity) = presentation.recentActivity,
              let item = activity.items.first
        else {
            Issue.record("Expected Hebrew activity")
            return
        }

        #expect(presentation.sourceMac == "ה-Mac של Saar")
        #expect(item.merchant == "סופר שכונתי Market")
        #expect(item.category == "מצרכים Groceries")
        #expect(item.account == "חשבון ראשי")
    }

    @Test
    func transactionDirectionControlsSignsInsteadOfTheWireMagnitude() throws {
        let presentation = try presentation(for: "bootstrap-complete.json")
        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected activity")
            return
        }

        let debit = activity.items[0]
        let credit = activity.items[1]
        #expect(debit.direction == .debit)
        #expect(debit.amount.value == Decimal(string: "-245.90"))
        #expect(
            debit.amount.formatted.contains("-")
                || debit.amount.formatted.contains("−")
        )
        #expect(credit.direction == .credit)
        #expect(credit.amount.value == Decimal(string: "12500.00"))
        #expect(credit.amount.formatted.hasPrefix("+"))
    }

    @Test
    func unknownWireStatesDegradeOnlyTheirOwnClaims() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var budget = payload["budgetPulse"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                transactions.count == 2
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            budget["status"] = "future_budget_status"
            transactions[0]["direction"] = "future_direction"
            transactions[0]["status"] = "pending"
            transactions[1]["status"] = "future_status"
            payload["budgetPulse"] = budget
            payload["recentTransactions"] = transactions
            object["data"] = payload
        }
        let envelope = try decoder.decodeSuccess(from: data)
        let presentation = try builder.makePresentation(from: envelope)

        #expect(presentation.budget == .unavailable)
        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Unknown transaction values must not hide all activity")
            return
        }
        #expect(activity.items[0].direction == .unavailable)
        #expect(activity.items[0].status == .pending)
        #expect(activity.items[0].amount.value == Decimal(string: "245.90"))
        #expect(!activity.items[0].amount.formatted.hasPrefix("−"))
        #expect(!activity.items[0].amount.formatted.hasPrefix("+"))
        #expect(activity.items[1].status == .unavailable)
        #expect(presentation.summary != .unavailable)
        #expect(presentation.review != .unavailable)
    }

    @Test
    func localizedCurrencyFormatterKeepsSignsAndSymbolsTogetherInHebrew() throws {
        let hebrewBuilder = HomePresentationBuilder(
            formatting: HomePresentationFormatting(
                locale: Locale(identifier: "he_IL"),
                calendar: Calendar(identifier: .gregorian),
                timeZone: TimeZone(identifier: "Asia/Jerusalem")!
            )
        )
        let envelope = try decoder.decodeSuccess(from: homeFixtureData("bootstrap-complete.json"))
        let presentation = try hebrewBuilder.makePresentation(from: envelope)
        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected localized activity")
            return
        }

        #expect(activity.items[0].amount.formatted.contains("₪"))
        #expect(
            activity.items[0].amount.formatted.contains("-")
                || activity.items[0].amount.formatted.contains("−")
        )
        #expect(activity.items[1].amount.formatted.contains("₪"))
        #expect(activity.items[1].amount.formatted.contains("+"))
    }

    @Test
    func negativeReviewCountIsRejectedBeforePresentation() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var review = payload["review"] as? [String: Any]
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            review["count"] = -1
            payload["review"] = review
            object["data"] = payload
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func everyFailedFinancialSectionIsSuppressedBeforeFallbackPayloadsAreRead() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var meta = object["meta"] as? [String: Any],
                var cacheability = meta["cacheability"] as? [String: Any],
                var completeness = meta["completeness"] as? [String: Any],
                var payload = object["data"] as? [String: Any],
                var home = payload["home"] as? [String: Any],
                var aggregates = home["aggregates"] as? [String: Any],
                var spending = aggregates["spending"] as? [String: Any],
                var spendingAmount = spending["amount"] as? [String: Any],
                var budget = payload["budgetPulse"] as? [String: Any],
                var review = payload["review"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                var firstTransaction = transactions.first,
                var transactionAmount = firstTransaction["amount"] as? [String: Any]
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }

            cacheability["status"] = "not_cacheable"
            cacheability["maxAgeSeconds"] = 0
            completeness["status"] = "partial"
            completeness["sectionErrors"] = [
                ["section": "home", "code": "source_unavailable", "retryable": true],
                ["section": "budget_pulse", "code": "calculation_failed", "retryable": true],
                ["section": "review", "code": "source_timeout", "retryable": true],
                ["section": "recent_transactions", "code": "source_timeout", "retryable": true],
            ]
            spendingAmount["value"] = "0.00"
            spending["amount"] = spendingAmount
            aggregates["spending"] = spending
            home["aggregates"] = aggregates
            payload["home"] = home
            budget["status"] = "unavailable"
            budget["spent"] = NSNull()
            budget["limit"] = NSNull()
            budget["remaining"] = NSNull()
            payload["budgetPulse"] = budget
            review["count"] = 0
            payload["review"] = review
            transactionAmount["value"] = "0.00"
            firstTransaction["amount"] = transactionAmount
            transactions[0] = firstTransaction
            payload["recentTransactions"] = transactions
            meta["cacheability"] = cacheability
            meta["completeness"] = completeness
            object["meta"] = meta
            object["data"] = payload
        }
        let envelope = try decoder.decodeSuccess(from: data)
        let presentation = try builder.makePresentation(from: envelope)

        #expect(presentation.summary == .unavailable)
        #expect(presentation.budget == .unavailable)
        #expect(presentation.review == .unavailable)
        #expect(presentation.recentActivity == .unavailable)
    }

    @Test
    func unknownFailedSectionIsRejectedBeforePresentation() throws {
        let data = try partialFixture(section: "future_financial_section")

        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func malformedActiveDecimalIsRejectedBeforePresentation() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var home = payload["home"] as? [String: Any],
                var aggregates = home["aggregates"] as? [String: Any],
                var spending = aggregates["spending"] as? [String: Any],
                var amount = spending["amount"] as? [String: Any]
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            amount["value"] = "12.34567"
            spending["amount"] = amount
            aggregates["spending"] = spending
            home["aggregates"] = aggregates
            payload["home"] = home
            object["data"] = payload
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func invalidCurrencyCodeIsRejectedBeforeFormatting() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                !transactions.isEmpty,
                var amount = transactions[0]["amount"] as? [String: Any]
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            amount["currencyCode"] = "ZZZ"
            transactions[0]["amount"] = amount
            payload["recentTransactions"] = transactions
            object["data"] = payload
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func impossibleActiveCalendarDateIsRejectedBeforePresentation() throws {
        let data = try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var payload = object["data"] as? [String: Any],
                var transactions = payload["recentTransactions"] as? [[String: Any]],
                !transactions.isEmpty
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            transactions[0]["occurredOn"] = "2026-02-30"
            payload["recentTransactions"] = transactions
            object["data"] = payload
        }
        #expect(throws: BootstrapPayloadDecoderError.invalidSuccessEnvelope) {
            try decoder.decodeSuccess(from: data)
        }
    }

    @Test
    func calendarDateKeepsItsBusinessDayInAnExtremeTimezone() throws {
        let extremeBuilder = HomePresentationBuilder(
            formatting: HomePresentationFormatting(
                locale: Locale(identifier: "en_US"),
                calendar: Calendar(identifier: .gregorian),
                timeZone: TimeZone(secondsFromGMT: -11 * 60 * 60)!
            )
        )
        let envelope = try decoder.decodeSuccess(from: homeFixtureData("bootstrap-complete.json"))
        let presentation = try extremeBuilder.makePresentation(from: envelope)
        guard case let .available(activity) = presentation.recentActivity else {
            Issue.record("Expected activity")
            return
        }

        #expect(activity.items[0].occurredOn.year == 2026)
        #expect(activity.items[0].occurredOn.month == 7)
        #expect(activity.items[0].occurredOn.day == 15)
        #expect(activity.items[0].occurredOn.formatted.contains("Jul 15, 2026"))
    }

    @Test
    func visibleCopyDoesNotUseUnverifiedOrMisleadingFinancialClaims() throws {
        let presentation = try presentation(for: "bootstrap-complete.json")
        let visibleCopy = visibleStrings(in: presentation).joined(separator: " ").lowercased()

        for forbidden in [
            "available money",
            "total cash",
            "comparison",
            "delta",
            "updated",
            "up to date",
        ] {
            #expect(!visibleCopy.contains(forbidden))
        }
    }

    private func presentation(for filename: String) throws -> HomePresentation {
        let envelope = try decoder.decodeSuccess(from: homeFixtureData(filename))
        return try builder.makePresentation(from: envelope)
    }

    private func partialFixture(section: String) throws -> Data {
        try mutatedHomeFixture("bootstrap-complete.json") { object in
            guard
                var meta = object["meta"] as? [String: Any],
                var cacheability = meta["cacheability"] as? [String: Any],
                var completeness = meta["completeness"] as? [String: Any]
            else {
                throw HomePresentationFixtureError.invalidObject("bootstrap-complete.json")
            }
            cacheability["status"] = "not_cacheable"
            cacheability["maxAgeSeconds"] = 0
            completeness["status"] = "partial"
            completeness["sectionErrors"] = [
                ["section": section, "code": "source_unavailable", "retryable": true],
            ]
            meta["cacheability"] = cacheability
            meta["completeness"] = completeness
            object["meta"] = meta
        }
    }

    private func visibleStrings(in presentation: HomePresentation) -> [String] {
        var strings = [
            presentation.sourceMac,
            presentation.sourceLabel,
            presentation.calculatedLabel,
        ]
        if case let .available(summary) = presentation.summary {
            strings += [
                summary.spending.title,
                summary.spending.formatted,
                summary.spending.periodLabel,
                summary.income.title,
                summary.income.formatted,
                summary.income.periodLabel,
                summary.netWorth.title,
                summary.netWorth.formatted,
                summary.netWorth.periodLabel,
            ].compactMap { $0 }
        }
        if case let .available(budget) = presentation.budget {
            strings += [budget.title, budget.status.rawValue]
            if let periodLabel = budget.periodLabel { strings.append(periodLabel) }
            strings += [budget.spent, budget.limit, budget.remaining]
                .compactMap { $0 }
                .flatMap { [$0.title, $0.formatted] }
        }
        if case let .available(review) = presentation.review {
            strings += [review.title, review.countLabel, review.message]
        }
        if case let .available(activity) = presentation.recentActivity {
            strings.append(activity.title)
            for item in activity.items {
                strings += [item.merchant, item.amount.formatted, item.occurredOn.formatted, item.account]
                if let category = item.category { strings.append(category) }
            }
        }
        return strings
    }
}

private let transactionPresentationAccount = BootstrapTransactionAccount(
    id: "account_\(String(repeating: "A", count: 22))",
    displayName: "כרטיס ראשי",
    identifierMask: "•••• 4242"
)

private func transactionPresentationFixture(
    idCharacter: Character,
    occurredOn: String = "2026-07-15",
    displayName: String = "קפה Central",
    direction: BootstrapTransactionDirection = .debit,
    status: BootstrapTransactionStatus = .posted,
    needsReview: Bool = false
) -> MobileTransaction {
    MobileTransaction(
        id: "transaction_\(String(repeating: idCharacter, count: 22))",
        occurredOn: occurredOn,
        displayName: displayName,
        amount: BootstrapMoney(value: "42.50", currencyCode: "ILS"),
        direction: direction,
        status: status,
        category: BootstrapTransactionCategory(
            id: "category_\(String(repeating: "C", count: 22))",
            label: "Dining"
        ),
        account: transactionPresentationAccount,
        needsReview: needsReview,
        excludedFromReports: false,
        owner: nil
    )
}

private func transactionPresentationEnvelope(
    transactions: [MobileTransaction],
    hasMore: Bool = false,
    nextCursor: String? = nil
) -> MobileTransactionListEnvelope {
    MobileTransactionListEnvelope(
        data: MobileTransactionListData(
            financialDate: "2026-07-16",
            transactions: transactions,
            page: MobileTransactionPage(hasMore: hasMore, nextCursor: nextCursor)
        ),
        meta: MobileTransactionMetadata(
            apiVersion: "1",
            generatedAt: Date(timeIntervalSince1970: 1_784_109_600),
            source: .live,
            server: MobileTransactionServer(
                id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
                protocolVersion: 1
            )
        )
    )
}

private actor DelayedTransactionListRead {
    private var started = false
    private var continuation: CheckedContinuation<MobileTransactionListEnvelope, Never>?

    func load() async -> MobileTransactionListEnvelope {
        started = true
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func hasStarted() -> Bool {
        started
    }

    func resolve(_ envelope: MobileTransactionListEnvelope) {
        continuation?.resume(returning: envelope)
        continuation = nil
    }
}

private func waitForTransactionListRead(_ read: DelayedTransactionListRead) async {
    for _ in 0 ..< 100 {
        if await read.hasStarted() { return }
        await Task.yield()
    }
    Issue.record("Timed out waiting for transaction list read")
}

private actor ControlledTransactionDebounce {
    private var started = false
    private var recordedDuration: Duration?
    private var continuation: CheckedContinuation<Void, Never>?

    func sleep(for duration: Duration) async throws {
        started = true
        recordedDuration = duration
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
        try Task.checkCancellation()
    }

    func hasStarted() -> Bool {
        started
    }

    func duration() -> Duration? {
        recordedDuration
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

private actor TransactionLoaderCallCounter {
    private var count = 0

    func record() {
        count += 1
    }

    func calls() -> Int {
        count
    }
}

private func waitForTransactionDebounce(_ debounce: ControlledTransactionDebounce) async {
    for _ in 0 ..< 100 {
        if await debounce.hasStarted() { return }
        await Task.yield()
    }
    Issue.record("Timed out waiting for transaction debounce")
}

struct TransactionPresentationTests {
    @MainActor
    @Test
    func paginationDeduplicatesRowsAndAdvancesTheOpaqueCursor() async {
        let first = transactionPresentationFixture(idCharacter: "A")
        let second = transactionPresentationFixture(
            idCharacter: "B",
            occurredOn: "2026-07-14",
            displayName: "Salary",
            direction: .credit
        )
        let model = TransactionListModel()
        let query = MobileTransactionQuery(limit: 30)
        await model.replace(with: query) { _ in
            transactionPresentationEnvelope(
                transactions: [first],
                hasMore: true,
                nextCursor: "cursor_v1_page-2"
            )
        }

        await model.append { requestedQuery in
            #expect(requestedQuery.cursor == "cursor_v1_page-2")
            return transactionPresentationEnvelope(transactions: [first, second])
        }

        #expect(model.transactions.map(\.id) == [first.id, second.id])
        #expect(model.hasMore == false)
        #expect(model.nextCursor == nil)
        #expect(model.appendState == .idle)
    }

    @MainActor
    @Test
    func repeatedCursorFailureRetainsEveryAcceptedRow() async {
        let transaction = transactionPresentationFixture(idCharacter: "A")
        let model = TransactionListModel()
        await model.replace(with: MobileTransactionQuery()) { _ in
            transactionPresentationEnvelope(
                transactions: [transaction],
                hasMore: true,
                nextCursor: "cursor_v1_repeat"
            )
        }

        await model.append { _ in
            transactionPresentationEnvelope(
                transactions: [transaction],
                hasMore: true,
                nextCursor: "cursor_v1_repeat"
            )
        }

        #expect(model.transactions == [transaction])
        #expect(model.hasMore)
        #expect(model.nextCursor == "cursor_v1_repeat")
        #expect(model.appendState == .failed("More transactions could not be loaded safely."))
    }

    @MainActor
    @Test
    func refreshFailureRetainsAcceptedRowsAndExposesRetryCopy() async {
        let transaction = transactionPresentationFixture(idCharacter: "A")
        let query = MobileTransactionQuery()
        let model = TransactionListModel()
        await model.replace(with: query) { _ in
            transactionPresentationEnvelope(transactions: [transaction])
        }

        await model.refresh(query: query) { _ in
            throw MobileClientError.transport(.offline)
        }

        #expect(model.transactions == [transaction])
        #expect(model.loadState == .loaded)
        #expect(model.refreshMessage == "Couldn’t reach the Mac. Try again.")
    }

    @MainActor
    @Test
    func staleGenerationCannotReplaceTheNewestAcceptedQuery() async {
        let old = transactionPresentationFixture(idCharacter: "A", displayName: "Old")
        let newest = transactionPresentationFixture(idCharacter: "B", displayName: "Newest")
        let oldQuery = MobileTransactionQuery(query: "old")
        let newestQuery = MobileTransactionQuery(query: "new")
        let gate = DelayedTransactionListRead()
        let model = TransactionListModel()

        let lateReplace = Task {
            await model.replace(with: oldQuery) { _ in
                await gate.load()
            }
        }
        await waitForTransactionListRead(gate)
        await model.replace(with: newestQuery) { _ in
            transactionPresentationEnvelope(transactions: [newest])
        }
        await gate.resolve(transactionPresentationEnvelope(transactions: [old]))
        await lateReplace.value

        #expect(model.acceptedQuery == newestQuery)
        #expect(model.transactions == [newest])
        #expect(model.loadState == .loaded)
    }

    @Test
    func filtersAndAccessibleCopyPreserveNativeWireSemanticsAndMixedScripts() {
        var filters = TransactionFilters()
        filters.direction = .expenses
        filters.status = .pending
        filters.accountID = transactionPresentationAccount.id
        filters.needsReview = true
        filters.includeExcluded = true

        let query = filters.makeQuery(searchText: "  קפה  ")
        #expect(query.query == "קפה")
        #expect(query.direction == .debit)
        #expect(query.status == .pending)
        #expect(query.accountID == transactionPresentationAccount.id)
        #expect(query.needsReview)
        #expect(query.includeExcluded)

        let transaction = transactionPresentationFixture(
            idCharacter: "A",
            status: .pending,
            needsReview: true
        )
        let label = TransactionPresentation.accessibilityLabel(transaction)
        #expect(label.contains("קפה Central"))
        #expect(label.contains("כרטיס ראשי"))
        #expect(label.contains("Pending"))
        #expect(label.contains("Needs review"))
    }

    @MainActor
    @Test
    func firstLoadFailureCanRetryToAnAcceptedSuccess() async {
        let query = MobileTransactionQuery()
        let transaction = transactionPresentationFixture(idCharacter: "R")
        let model = TransactionListModel()
        await model.replace(with: query) { _ in
            throw MobileClientError.transport(.offline)
        }

        #expect(model.acceptedQuery == nil)
        #expect(model.loadState == .failed("Couldn’t reach the Mac. Try again."))

        await model.refresh(query: query) { _ in
            transactionPresentationEnvelope(transactions: [transaction])
        }

        #expect(model.acceptedQuery == query)
        #expect(model.transactions == [transaction])
        #expect(model.loadState == .loaded)
    }

    @Test
    func calendarDateFormattingKeepsTheBusinessDayInLosAngeles() throws {
        let losAngeles = try #require(TimeZone(identifier: "America/Los_Angeles"))

        let formatted = TransactionPresentation.formattedDate(
            "2026-07-15",
            locale: Locale(identifier: "en_US"),
            timeZone: losAngeles
        )

        #expect(formatted == "Jul 15, 2026")
    }

    @Test
    func searchCanonicalizationPreservesHebrewAndCollapsesUnicodeWhitespace() {
        let hebrew = "ש\u{05B8}\u{05C1}לו\u{05B9}ם"
        let expectedHebrew = hebrew.precomposedStringWithCompatibilityMapping
        let raw = "\u{00A0}\(hebrew)\t \n\u{2003}ﬃ\u{00A0}"

        #expect(
            MobileTransactionQuery.canonicalSearchText(raw)
                == "\(expectedHebrew) ffi"
        )
        #expect(MobileTransactionQuery(query: raw).query == "\(expectedHebrew) ffi")
    }

    @Test
    func rawSearchBoundingUsesCanonicalUTF16WithoutSplittingCharacters() {
        let compatibilityExpansion = String(repeating: "ﬃ", count: 34)
        let boundedExpansion = MobileTransactionQuery.boundedRawSearchInput(
            compatibilityExpansion
        )
        #expect(
            boundedExpansion
                == String(String(repeating: "ffi", count: 34).prefix(100))
        )
        #expect(boundedExpansion.utf16.count == 100)

        let combiningCharacter = "ש\u{05B8}"
        let combiningBoundary = String(repeating: "a", count: 99) + combiningCharacter
        let boundedCombining = MobileTransactionQuery.boundedRawSearchInput(
            combiningBoundary
        )
        #expect(boundedCombining == String(repeating: "a", count: 99))
        #expect(
            MobileTransactionQuery.canonicalSearchText(boundedCombining)?.utf16.count == 99
        )

        let largePaste = String(repeating: "a", count: 10_000)
        let boundedLargePaste = MobileTransactionQuery.boundedRawSearchInput(largePaste)
        #expect(boundedLargePaste == String(repeating: "a", count: 100))
        #expect(boundedLargePaste.utf16.count == 100)

        let whitespaceOnlyPaste = String(repeating: "\u{FEFF}", count: 10_000)
        #expect(MobileTransactionQuery.boundedRawSearchInput(whitespaceOnlyPaste).isEmpty)
    }

    @MainActor
    @Test
    func exactSearchDebounceAndCancellationNeverReachTheSupersededLoader() async {
        #expect(TransactionSearchPolicy.debounce == .milliseconds(300))

        let supersededDebounce = ControlledTransactionDebounce()
        let supersededCalls = TransactionLoaderCallCounter()
        let model = TransactionListModel()
        let newest = transactionPresentationFixture(idCharacter: "N")
        let superseded = Task {
            await model.replace(
                with: MobileTransactionQuery(query: "old"),
                debounce: TransactionSearchPolicy.debounce,
                sleep: { duration in
                    try await supersededDebounce.sleep(for: duration)
                }
            ) { _ in
                await supersededCalls.record()
                throw MobileClientError.transport(.offline)
            }
        }
        await waitForTransactionDebounce(supersededDebounce)
        #expect(await supersededDebounce.duration() == .milliseconds(300))

        let newestQuery = MobileTransactionQuery(query: "new")
        await model.replace(with: newestQuery) { _ in
            transactionPresentationEnvelope(transactions: [newest])
        }
        await supersededDebounce.release()
        await superseded.value

        #expect(await supersededCalls.calls() == 0)
        #expect(model.acceptedQuery == newestQuery)
        #expect(model.transactions == [newest])
        #expect(model.loadState == .loaded)

        let cancelledDebounce = ControlledTransactionDebounce()
        let cancelledCalls = TransactionLoaderCallCounter()
        let cancelledModel = TransactionListModel()
        let cancelled = Task {
            await cancelledModel.replace(
                with: MobileTransactionQuery(query: "cancelled"),
                debounce: TransactionSearchPolicy.debounce,
                sleep: { duration in
                    try await cancelledDebounce.sleep(for: duration)
                }
            ) { _ in
                await cancelledCalls.record()
                throw MobileClientError.transport(.offline)
            }
        }
        await waitForTransactionDebounce(cancelledDebounce)
        cancelled.cancel()
        await cancelledDebounce.release()
        await cancelled.value

        #expect(await cancelledCalls.calls() == 0)
        if case .failed = cancelledModel.loadState {
            Issue.record("Cancellation must not publish a failure")
        }
    }

    @Test
    func filterDraftResetAndCancelPreserveValueSemantics() {
        var applied = TransactionFilters()
        applied.direction = .income
        applied.status = .pending
        applied.accountID = transactionPresentationAccount.id
        applied.needsReview = true

        var draft = applied
        draft.direction = .expenses
        draft.includeExcluded = true

        let afterCancel = applied
        #expect(afterCancel.direction == .income)
        #expect(afterCancel.includeExcluded == false)
        #expect(afterCancel.accountID == transactionPresentationAccount.id)

        draft.reset()
        #expect(draft.isDefault)
        #expect(draft.direction == .all)
        #expect(draft.status == .all)
        #expect(draft.accountID == nil)
        #expect(draft.needsReview == false)
        #expect(draft.includeExcluded == false)
        #expect(applied.direction == .income)
        #expect(applied.needsReview)
    }
}
