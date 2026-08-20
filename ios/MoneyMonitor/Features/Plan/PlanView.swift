import Charts
import SwiftUI

struct PlanView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var snapshot: MobilePlanningSnapshot?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let snapshot {
                Section("Net worth") {
                    NavigationLink {
                        NetWorthDetailView(netWorth: snapshot.netWorth, money: money)
                    } label: {
                        if let total = snapshot.netWorth.total {
                            Label(money(total), systemImage: "chart.line.uptrend.xyaxis")
                        } else {
                            Label("Net worth is unavailable", systemImage: "exclamationmark.triangle")
                        }
                    }
                    Text(snapshot.netWorth.state == "partial" ? "Some values are unavailable." : "Calculated on your Mac.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Budgets") {
                    if snapshot.budgets.isEmpty { Text("No active budgets on your Mac.") }
                    ForEach(snapshot.budgets) { budget in
                        NavigationLink {
                            BudgetDetailView(budget: budget, money: money)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(budget.displayName).font(.headline)
                                Text("\(money(budget.spent)) spent of \(money(budget.limit))")
                                Text("\(money(budget.remaining)) remaining · \(budget.period.capitalized)")
                                    .font(.footnote).foregroundStyle(.secondary)
                                Text("Projected spend: \(money(budget.pace.projectedSpent))")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Accounts") {
                    ForEach(snapshot.accounts) { account in
                        NavigationLink {
                            AccountDetailView(account: account, money: money)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(account.displayName).font(.headline)
                                Text("\(account.institutionName) · \(account.identifierMask)")
                                Text(account.balance.map(money) ?? "Balance unavailable")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Assets") {
                    if snapshot.assets.isEmpty { Text("No tracked assets on your Mac.") }
                    ForEach(snapshot.assets) { asset in
                        NavigationLink {
                            AssetDetailView(asset: asset, money: money)
                        } label: {
                            HStack {
                                Text(asset.displayName)
                                Spacer()
                                Text(asset.currentValue.map(money) ?? "Unavailable")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Latest sync") {
                    NavigationLink {
                        SyncSummaryView(sync: snapshot.latestSync, syncLabel: syncLabel)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(syncLabel(snapshot.latestSync.state))
                            if snapshot.latestSync.accountsAttentionNeeded > 0 {
                                Text("Some accounts need attention on your Mac.")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else if let errorMessage {
                ContentUnavailableView("Plan unavailable", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
            } else {
                ProgressView("Loading your plan…")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .navigationTitle("Plan")
    }

    private func load() async {
        do {
            snapshot = try await environment.planningSnapshot()
            errorMessage = nil
        } catch {
            errorMessage = "Reconnect to your Mac and try again."
        }
    }

    private func money(_ money: BootstrapMoney) -> String {
        let value = Decimal(string: money.value, locale: Locale(identifier: "en_US_POSIX")) ?? 0
        return value.formatted(.currency(code: money.currencyCode))
    }

    private func syncLabel(_ state: String) -> String {
        switch state {
        case "completed": "Last sync completed"
        case "partial": "Last sync partially completed"
        case "neverRun": "No sync has run yet"
        default: "Sync: \(state)"
        }
    }
}

private struct BudgetDetailView: View {
    let budget: MobileBudget
    let money: (BootstrapMoney) -> String

    var body: some View {
        List {
            Section("Progress") {
                LabeledContent("Limit", value: money(budget.limit))
                LabeledContent("Spent", value: money(budget.spent))
                LabeledContent("Remaining", value: money(budget.remaining))
                LabeledContent("Projected", value: money(budget.pace.projectedSpent))
                Text("Day \(budget.pace.elapsedDays) of \(budget.pace.totalDays) · \(budget.pace.state.replacingOccurrences(of: "_", with: " ").capitalized)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Included categories") {
                if budget.includedCategories.isEmpty { Text("No categories are included.") }
                ForEach(budget.includedCategories, id: \.id) { Text($0.label) }
            }
        }
        .navigationTitle(budget.displayName)
    }
}

private struct NetWorthDetailView: View {
    @EnvironmentObject private var environment: AppEnvironment
    let netWorth: MobileNetWorth
    let money: (BootstrapMoney) -> String
    @State private var selectedRange: MobileNetWorthHistoryRange = .sixMonths
    @State private var history: MobileNetWorthHistory?
    @State private var historyError: String?

    var body: some View {
        List {
            Section("Current totals") {
                row("Net worth", netWorth.total)
                row("Assets", netWorth.assetsTotal)
                row("Liabilities", netWorth.liabilitiesTotal)
                row("Bank balances", netWorth.bankBalancesTotal)
            }
            if netWorth.state == "partial" {
                Section { Text("Some source values are unavailable, so this total is partial.") }
            }
            Section("History") {
                Picker("Range", selection: $selectedRange) {
                    ForEach(MobileNetWorthHistoryRange.allCases, id: \.self) { range in
                        Text(range.title).tag(range)
                    }
                }
                .pickerStyle(.segmented)

                if let history, !history.points.isEmpty {
                    Chart(history.points) { point in
                        LineMark(
                            x: .value("Date", point.date),
                            y: .value("Net worth", decimal(point.total))
                        )
                        .foregroundStyle(.blue)
                        PointMark(
                            x: .value("Date", point.date),
                            y: .value("Net worth", decimal(point.total))
                        )
                        .foregroundStyle(.blue)
                    }
                    .chartYAxis { AxisMarks(position: .leading) }
                    .frame(height: 220)
                    Text("Estimated history. Latest known values are carried forward when your Mac has no value recorded for a date.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    LabeledContent("Period", value: "\(history.period.startDate) – \(history.period.endDate)")
                } else if let historyError {
                    ContentUnavailableView(
                        "History unavailable",
                        systemImage: "chart.line.flattrend.xyaxis",
                        description: Text(historyError)
                    )
                } else {
                    HStack {
                        ProgressView()
                        Text("Loading history…")
                    }
                }
            }
        }
        .navigationTitle("Net Worth")
        .task(id: selectedRange) { await loadHistory() }
    }

    @ViewBuilder private func row(_ label: String, _ value: BootstrapMoney?) -> some View {
        LabeledContent(label, value: value.map(money) ?? "Unavailable")
    }

    private func decimal(_ money: BootstrapMoney) -> Decimal {
        Decimal(string: money.value, locale: Locale(identifier: "en_US_POSIX")) ?? 0
    }

    private func loadHistory() async {
        history = nil
        historyError = nil
        do {
            history = try await environment.netWorthHistory(range: selectedRange)
        } catch {
            historyError = "Reconnect to your Mac and try again."
        }
    }
}

private struct AssetDetailView: View {
    let asset: MobileAsset
    let money: (BootstrapMoney) -> String

    var body: some View {
        List {
            Section("Value") { LabeledContent("Current value", value: asset.currentValue.map(money) ?? "Unavailable") }
            Section("Classification") {
                LabeledContent("Type", value: asset.type)
                LabeledContent("Liquidity", value: asset.liquidity.capitalized)
            }
            if asset.state == "unavailable" { Section { Text("The Mac has no current valuation for this asset.") } }
        }
        .navigationTitle(asset.displayName)
    }
}

private struct AccountDetailView: View {
    let account: MobilePlanningAccount
    let money: (BootstrapMoney) -> String

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Institution", value: account.institutionName)
                LabeledContent("Identifier", value: account.identifierMask)
                LabeledContent("Type", value: account.type.replacingOccurrences(of: "_", with: " ").capitalized)
                LabeledContent(account.type == "credit_card" ? "Amount due" : "Balance", value: account.balance.map(money) ?? "Unavailable")
            }
            Section("Freshness") { Text(account.freshness.status.capitalized) }
        }
        .navigationTitle(account.displayName)
    }
}

private struct SyncSummaryView: View {
    let sync: MobilePlanningSync
    let syncLabel: (String) -> String

    var body: some View {
        List {
            Section("Status") { Text(syncLabel(sync.state)) }
            Section("Results") {
                LabeledContent("Accounts completed", value: String(sync.accountsSucceeded))
                LabeledContent("Need attention", value: String(sync.accountsAttentionNeeded))
            }
            if sync.accountsAttentionNeeded > 0 { Section { Text("Continue any required action on your Mac. No credentials or verification codes are entered here.") } }
        }
        .navigationTitle("Sync History")
    }
}
