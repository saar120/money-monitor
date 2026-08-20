import Foundation

enum HomePresentationSection<Value: Equatable>: Equatable {
    case available(Value)
    case unavailable
}

struct HomePresentation: Equatable {
    let sourceMac: String
    let sourceLabel: String
    let calculatedLabel: String
    let isPartial: Bool
    let summary: HomePresentationSection<Summary>
    let budget: HomePresentationSection<Budget>
    let review: HomePresentationSection<Review>
    let recentActivity: HomePresentationSection<RecentActivity>

    struct Summary: Equatable {
        let spending: Amount
        let income: Amount
        let netWorth: Amount
    }

    struct Amount: Equatable {
        let title: String
        let value: Decimal
        let currencyCode: String
        let formatted: String
        let periodLabel: String?
    }

    struct Budget: Equatable {
        let title: String
        let status: Status
        let periodLabel: String?
        let spent: Amount?
        let limit: Amount?
        let remaining: Amount?

        enum Status: String, Equatable {
            case onTrack = "On track"
            case watch = "Watch"
            case overBudget = "Over budget"
            case unavailable = "Unavailable"
        }
    }

    struct Review: Equatable {
        let title: String
        let count: Int
        let countLabel: String
        let message: String
    }

    struct RecentActivity: Equatable {
        let title: String
        let items: [Item]

        struct Item: Equatable {
            let id: String
            let merchant: String
            let amount: Amount
            let direction: Direction
            let occurredOn: CalendarDate
            let status: Status
            let category: String?
            let account: String

            enum Direction: Equatable {
                case debit
                case credit
                case unavailable
            }

            enum Status: Equatable {
                case posted
                case pending
                case unavailable
            }
        }
    }

    struct CalendarDate: Equatable {
        let year: Int
        let month: Int
        let day: Int
        let formatted: String
    }
}

struct HomePresentationFormatting {
    let locale: Locale
    let calendar: Calendar
    let timeZone: TimeZone

    init(
        locale: Locale = .autoupdatingCurrent,
        calendar: Calendar = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) {
        self.locale = locale
        self.calendar = calendar
        self.timeZone = timeZone
    }
}

enum HomePresentationError: Error, Equatable {
    case invalidDecimal(String)
    case invalidCalendarDate(String)
    case invalidCurrencyCode(String)
    case unknownFailedSection
    case formattingFailed
}

struct HomePresentationBuilder {
    private let formatting: HomePresentationFormatting

    init(formatting: HomePresentationFormatting = HomePresentationFormatting()) {
        self.formatting = formatting
    }

    func makePresentation(from envelope: BootstrapSuccessEnvelope) throws -> HomePresentation {
        let failedSections = Set(envelope.meta.completeness.sectionErrors.map(\.section))
        guard !failedSections.contains(.unknown) else {
            throw HomePresentationError.unknownFailedSection
        }

        return HomePresentation(
            sourceMac: envelope.meta.server.displayName,
            sourceLabel: sourceLabel(
                source: envelope.meta.source,
                macName: envelope.meta.server.displayName
            ),
            calculatedLabel: try calculatedLabel(for: envelope.meta.calculatedAt),
            isPartial: envelope.meta.completeness.sectionErrors.contains { error in
                [.home, .budgetPulse, .review, .recentTransactions].contains(error.section)
            },
            summary: try makeSummary(envelope.data.home, failedSections: failedSections),
            budget: try makeBudget(envelope.data.budgetPulse, failedSections: failedSections),
            review: makeReview(envelope.data.review, failedSections: failedSections),
            recentActivity: try makeRecentActivity(
                envelope.data.recentTransactions,
                failedSections: failedSections
            )
        )
    }

    private func makeSummary(
        _ home: @autoclosure () -> BootstrapHome,
        failedSections: Set<BootstrapSection>
    ) throws -> HomePresentationSection<HomePresentation.Summary> {
        guard !failedSections.contains(.home) else { return .unavailable }
        let aggregates = home().aggregates

        return .available(
            HomePresentation.Summary(
                spending: try amount(
                    title: "Spending",
                    money: aggregates.spending.amount,
                    periodLabel: periodLabel(for: aggregates.spending.period)
                ),
                income: try amount(
                    title: "Income",
                    money: aggregates.income.amount,
                    periodLabel: periodLabel(for: aggregates.income.period)
                ),
                netWorth: try amount(
                    title: "Net worth",
                    money: aggregates.netWorth.amount,
                    periodLabel: asOfLabel(for: aggregates.netWorth.period.endDate)
                )
            )
        )
    }

    private func makeBudget(
        _ pulse: @autoclosure () -> BootstrapBudgetPulse,
        failedSections: Set<BootstrapSection>
    ) throws -> HomePresentationSection<HomePresentation.Budget> {
        guard !failedSections.contains(.budgetPulse) else { return .unavailable }
        let pulse = pulse()

        let status: HomePresentation.Budget.Status
        switch pulse.status {
        case .onTrack:
            status = .onTrack
        case .watch:
            status = .watch
        case .overBudget:
            status = .overBudget
        case .unavailable:
            status = .unavailable
        case .unknown:
            return .unavailable
        }

        return .available(
            HomePresentation.Budget(
                title: "Budget",
                status: status,
                periodLabel: status == .unavailable ? nil : try periodLabel(for: pulse.period),
                spent: try pulse.spent.map { try amount(title: "Spent", money: $0) },
                limit: try pulse.limit.map { try amount(title: "Limit", money: $0) },
                remaining: try pulse.remaining.map { try amount(title: "Remaining", money: $0) }
            )
        )
    }

    private func makeReview(
        _ review: @autoclosure () -> BootstrapReview,
        failedSections: Set<BootstrapSection>
    ) -> HomePresentationSection<HomePresentation.Review> {
        guard !failedSections.contains(.review) else { return .unavailable }
        let count = review().count
        guard count >= 0 else { return .unavailable }

        let message: String
        switch count {
        case 0:
            message = "No transactions need review"
        case 1:
            message = "1 transaction needs review"
        default:
            message = "\(count) transactions need review"
        }

        return .available(
            HomePresentation.Review(
                title: "Review",
                count: count,
                countLabel: String(count),
                message: message
            )
        )
    }

    private func makeRecentActivity(
        _ transactions: @autoclosure () -> [BootstrapRecentTransaction],
        failedSections: Set<BootstrapSection>
    ) throws -> HomePresentationSection<HomePresentation.RecentActivity> {
        guard !failedSections.contains(.recentTransactions) else { return .unavailable }

        return .available(
            HomePresentation.RecentActivity(
                title: "Recent activity",
                items: try transactions().map(makeRecentItem)
            )
        )
    }

    private func makeRecentItem(
        _ transaction: BootstrapRecentTransaction
    ) throws -> HomePresentation.RecentActivity.Item {
        let direction: HomePresentation.RecentActivity.Item.Direction
        let multiplier: Decimal
        let showsPositiveSign: Bool
        switch transaction.direction {
        case .debit:
            direction = .debit
            multiplier = -1
            showsPositiveSign = false
        case .credit:
            direction = .credit
            multiplier = 1
            showsPositiveSign = true
        case .unknown:
            direction = .unavailable
            multiplier = 1
            showsPositiveSign = false
        }

        let status: HomePresentation.RecentActivity.Item.Status
        switch transaction.status {
        case .posted:
            status = .posted
        case .pending:
            status = .pending
        case .unknown:
            status = .unavailable
        }

        let unsignedValue = try decimal(from: transaction.amount.value).magnitude
        let signedAmount = try amount(
            title: "Amount",
            value: unsignedValue * multiplier,
            currencyCode: transaction.amount.currencyCode,
            showsPositiveSign: showsPositiveSign
        )

        return HomePresentation.RecentActivity.Item(
            id: transaction.id,
            merchant: transaction.displayName,
            amount: signedAmount,
            direction: direction,
            occurredOn: try calendarDate(from: transaction.occurredOn),
            status: status,
            category: transaction.category?.label,
            account: transaction.account.displayName
        )
    }

    private func amount(
        title: String,
        money: BootstrapMoney,
        periodLabel: String? = nil
    ) throws -> HomePresentation.Amount {
        try amount(
            title: title,
            value: decimal(from: money.value),
            currencyCode: money.currencyCode,
            periodLabel: periodLabel
        )
    }

    private func amount(
        title: String,
        value: Decimal,
        currencyCode: String,
        periodLabel: String? = nil,
        showsPositiveSign: Bool = false
    ) throws -> HomePresentation.Amount {
        HomePresentation.Amount(
            title: title,
            value: value,
            currencyCode: currencyCode,
            formatted: try formatMoney(
                value,
                currencyCode: currencyCode,
                showsPositiveSign: showsPositiveSign
            ),
            periodLabel: periodLabel
        )
    }

    private func decimal(from wireValue: String) throws -> Decimal {
        let pattern = #"^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$"#
        guard
            wireValue.range(of: pattern, options: .regularExpression) != nil,
            let value = Decimal(string: wireValue, locale: Locale(identifier: "en_US_POSIX"))
        else {
            throw HomePresentationError.invalidDecimal(wireValue)
        }
        return value
    }

    private func formatMoney(
        _ value: Decimal,
        currencyCode: String,
        showsPositiveSign: Bool = false
    ) throws -> String {
        guard
            currencyCode.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil,
            Locale.commonISOCurrencyCodes.contains(currencyCode)
        else {
            throw HomePresentationError.invalidCurrencyCode(currencyCode)
        }

        let formatter = NumberFormatter()
        formatter.locale = formatting.locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        formatter.usesGroupingSeparator = true
        if showsPositiveSign {
            formatter.positivePrefix = (formatter.plusSign ?? "+")
                + (formatter.positivePrefix ?? "")
        }

        guard let result = formatter.string(from: NSDecimalNumber(decimal: value)) else {
            throw HomePresentationError.formattingFailed
        }
        return result
    }

    private func periodLabel(for period: BootstrapPeriod) throws -> String {
        let start = try resolvedCalendarDate(from: period.startDate)
        let end = try resolvedCalendarDate(from: period.endDate)
        guard start.date <= end.date else {
            throw HomePresentationError.invalidCalendarDate(
                "\(period.startDate)...\(period.endDate)"
            )
        }

        let formatter = DateIntervalFormatter()
        formatter.locale = formatting.locale
        formatter.calendar = calendarInConfiguredTimeZone()
        formatter.timeZone = formatting.timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: start.date, to: end.date)
    }

    private func asOfLabel(for wireValue: String) throws -> String {
        "As of \(try calendarDate(from: wireValue).formatted)"
    }

    private func calendarDate(from wireValue: String) throws -> HomePresentation.CalendarDate {
        try resolvedCalendarDate(from: wireValue).presentation
    }

    private func resolvedCalendarDate(from wireValue: String) throws -> ResolvedCalendarDate {
        let components = wireValue.split(separator: "-", omittingEmptySubsequences: false)
        guard
            components.count == 3,
            components[0].count == 4,
            components[1].count == 2,
            components[2].count == 2,
            let year = Int(components[0]),
            let month = Int(components[1]),
            let day = Int(components[2])
        else {
            throw HomePresentationError.invalidCalendarDate(wireValue)
        }

        let calendar = calendarInConfiguredTimeZone()
        let requested = DateComponents(
            calendar: calendar,
            timeZone: formatting.timeZone,
            year: year,
            month: month,
            day: day
        )
        guard let date = calendar.date(from: requested) else {
            throw HomePresentationError.invalidCalendarDate(wireValue)
        }
        let resolved = calendar.dateComponents([.year, .month, .day], from: date)
        guard resolved.year == year, resolved.month == month, resolved.day == day else {
            throw HomePresentationError.invalidCalendarDate(wireValue)
        }

        let formatter = DateFormatter()
        formatter.locale = formatting.locale
        formatter.calendar = calendar
        formatter.timeZone = formatting.timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none

        return ResolvedCalendarDate(
            date: date,
            presentation: HomePresentation.CalendarDate(
                year: year,
                month: month,
                day: day,
                formatted: formatter.string(from: date)
            )
        )
    }

    private func calendarInConfiguredTimeZone() -> Calendar {
        var calendar = formatting.calendar
        calendar.timeZone = formatting.timeZone
        return calendar
    }

    private func sourceLabel(source: BootstrapResponseSource, macName: String) -> String {
        switch source {
        case .live:
            return "Live from \(macName)"
        case .unknown:
            return "Source unavailable"
        }
    }

    private func calculatedLabel(for date: Date) throws -> String {
        let formatter = DateFormatter()
        formatter.locale = formatting.locale
        formatter.calendar = formatting.calendar
        formatter.timeZone = formatting.timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short

        let absoluteDate = formatter.string(from: date)
        guard !absoluteDate.isEmpty else { throw HomePresentationError.formattingFailed }
        return "Calculated \(absoluteDate)"
    }

    private struct ResolvedCalendarDate {
        let date: Date
        let presentation: HomePresentation.CalendarDate
    }
}
