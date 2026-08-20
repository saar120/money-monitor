import Foundation

struct HomeOverviewMoney: Codable, Equatable, Sendable {
    let value: String
    let currencyCode: String
}

struct HomeOverviewPeriod: Codable, Equatable, Sendable {
    let startDate: String
    let endDate: String
}

struct HomeOverviewDrillDown: Codable, Equatable, Sendable {
    let category: String?
    let startDate: String
    let endDate: String
}

struct HomeOverviewAmountPeriod: Codable, Equatable, Sendable {
    let amount: HomeOverviewMoney
    let period: HomeOverviewPeriod
}

struct HomeOverviewSpending: Codable, Equatable, Sendable {
    let current: HomeOverviewAmountPeriod
    let comparison: HomeOverviewAmountPeriod
    let change: HomeOverviewMoney
}

struct HomeOverviewBudget: Codable, Equatable, Sendable {
    let state: String
    let name: String
    let spent: HomeOverviewMoney
    let limit: HomeOverviewMoney
    let remaining: HomeOverviewMoney
    let period: HomeOverviewPeriod
}

struct HomeOverviewNetWorth: Codable, Equatable, Sendable {
    let total: HomeOverviewMoney?
    let liquid: HomeOverviewMoney?
}

struct HomeOverviewCategory: Codable, Equatable, Sendable, Identifiable {
    let label: String
    let amount: HomeOverviewMoney
    let share: Double
    let transactionCount: Int
    let textSummary: String
    let drillDown: HomeOverviewDrillDown

    var id: String { "\(label)-\(drillDown.startDate)" }
}

struct HomeOverviewCashFlowPoint: Codable, Equatable, Sendable, Identifiable {
    let period: HomeOverviewPeriod
    let income: HomeOverviewMoney
    let expenses: HomeOverviewMoney
    let net: HomeOverviewMoney
    let textSummary: String
    let drillDown: HomeOverviewDrillDown

    var id: String { period.startDate }
}

struct HomeOverviewAccountFreshness: Codable, Equatable, Sendable, Identifiable {
    let displayName: String
    let status: String
    let lastSuccessfulSyncAt: Date?

    var id: String { displayName }
}

struct CanonicalHomeOverview: Codable, Equatable, Sendable {
    let financialDate: String
    let calculatedAt: Date
    let baseCurrencyCode: String
    let availableMoney: HomeOverviewMoney?
    let spending: HomeOverviewSpending
    let budget: HomeOverviewBudget?
    let netWorth: HomeOverviewNetWorth
    let categories: [HomeOverviewCategory]
    let cashFlow: [HomeOverviewCashFlowPoint]
    let accountFreshness: [HomeOverviewAccountFreshness]
    let isEmpty: Bool
}

struct CanonicalHomeOverviewMetadata: Codable, Equatable, Sendable {
    let apiVersion: String
    let generatedAt: Date
    let source: String
    let calculationVersion: String
    let completeness: String
    let estimated: Bool
    let missingSections: [String]
}

struct CanonicalHomeOverviewEnvelope: Codable, Equatable, Sendable {
    let data: CanonicalHomeOverview
    let meta: CanonicalHomeOverviewMetadata
}

enum CanonicalHomeOverviewDecoder {
    static func decode(_ data: Data) throws -> CanonicalHomeOverviewEnvelope {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let envelope = try decoder.decode(CanonicalHomeOverviewEnvelope.self, from: data)
        guard envelope.meta.apiVersion == "1",
              envelope.meta.source == "mac-authoritative",
              envelope.meta.calculationVersion == "home-overview-1",
              envelope.data.baseCurrencyCode == "ILS",
              envelope.data.categories.count <= 100,
              envelope.data.cashFlow.count <= 24,
              envelope.data.accountFreshness.count <= 100,
              envelope.data.categories.allSatisfy({ $0.share >= 0 && $0.share <= 1 }),
              envelope.data.spending.current.period.startDate <= envelope.data.spending.current.period.endDate,
              envelope.data.spending.comparison.period.startDate <= envelope.data.spending.comparison.period.endDate
        else {
            throw MobileClientError.invalidPayload
        }
        return envelope
    }
}
