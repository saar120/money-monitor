import Foundation

struct HomeOverviewPresentation: Equatable {
    struct Amount: Equatable {
        let value: Decimal
        let currencyCode: String
        let formatted: String
    }

    struct Category: Equatable, Identifiable {
        let id: String
        let label: String
        let amount: Amount
        let textSummary: String
        let drillDown: HomeOverviewDrillDown
    }

    struct CashFlow: Equatable, Identifiable {
        let id: String
        let period: HomeOverviewPeriod
        let income: Amount
        let expenses: Amount
        let net: Amount
        let textSummary: String
        let drillDown: HomeOverviewDrillDown
    }

    struct NetWorth: Equatable {
        let total: Amount?
        let liquid: Amount?
    }

    let financialDate: String
    let calculatedAt: Date
    let availableMoney: Amount?
    let currentSpending: Amount
    let comparisonSpending: Amount
    let spendingChange: Amount
    let budget: HomeOverviewBudget?
    let netWorth: NetWorth
    let categories: [Category]
    let cashFlow: [CashFlow]
    let accountFreshness: [HomeOverviewAccountFreshness]
    let completeness: String
    let estimated: Bool
    let isEmpty: Bool
}

enum HomeOverviewPresentationError: Error, Equatable {
    case invalidDecimal(String)
    case invalidCurrency(String)
}

struct HomeOverviewPresentationBuilder {
    let locale: Locale

    init(locale: Locale = .autoupdatingCurrent) {
        self.locale = locale
    }

    func makePresentation(from envelope: CanonicalHomeOverviewEnvelope) throws -> HomeOverviewPresentation {
        let data = envelope.data
        return HomeOverviewPresentation(
            financialDate: data.financialDate,
            calculatedAt: data.calculatedAt,
            availableMoney: try data.availableMoney.map(makeAmount),
            currentSpending: try makeAmount(data.spending.current.amount),
            comparisonSpending: try makeAmount(data.spending.comparison.amount),
            spendingChange: try makeAmount(data.spending.change),
            budget: data.budget,
            netWorth: HomeOverviewPresentation.NetWorth(
                total: try data.netWorth.total.map(makeAmount),
                liquid: try data.netWorth.liquid.map(makeAmount)
            ),
            categories: try data.categories.map { category in
                HomeOverviewPresentation.Category(
                    id: category.id,
                    label: category.label,
                    amount: try makeAmount(category.amount),
                    textSummary: category.textSummary,
                    drillDown: category.drillDown
                )
            },
            cashFlow: try data.cashFlow.map { point in
                HomeOverviewPresentation.CashFlow(
                    id: point.id,
                    period: point.period,
                    income: try makeAmount(point.income),
                    expenses: try makeAmount(point.expenses),
                    net: try makeAmount(point.net),
                    textSummary: point.textSummary,
                    drillDown: point.drillDown
                )
            },
            accountFreshness: data.accountFreshness,
            completeness: envelope.meta.completeness,
            estimated: envelope.meta.estimated,
            isEmpty: data.isEmpty
        )
    }

    func makeAmount(_ money: HomeOverviewMoney) throws -> HomeOverviewPresentation.Amount {
        guard money.currencyCode == "ILS" else {
            throw HomeOverviewPresentationError.invalidCurrency(money.currencyCode)
        }
        guard let value = Decimal(string: money.value, locale: Locale(identifier: "en_US_POSIX")) else {
            throw HomeOverviewPresentationError.invalidDecimal(money.value)
        }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = money.currencyCode
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        guard let formatted = formatter.string(from: value as NSDecimalNumber) else {
            throw HomeOverviewPresentationError.invalidDecimal(money.value)
        }
        return HomeOverviewPresentation.Amount(value: value, currencyCode: money.currencyCode, formatted: formatted)
    }
}
