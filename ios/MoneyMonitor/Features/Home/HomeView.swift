import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var isRePairScannerPresented = false
    @State private var isDisconnectConfirmationPresented = false

    private let scannerFactory: PairingScannerViewFactory
    private let deviceName: () -> String

    init(
        scannerFactory: PairingScannerViewFactory = .integrationPending,
        deviceName: @escaping () -> String = { UIDevice.current.name }
    ) {
        self.scannerFactory = scannerFactory
        self.deviceName = deviceName
    }

    var body: some View {
        Group {
            switch presentationState {
            case let .ready(presentation): homeContent(presentation)
            case .missing: unavailableHome(message: missingMessage)
            case .invalid: unavailableHome(message: "The Mac Home projection could not be presented safely. Retry to reload it.")
            }
        }
        .background(MoneyMonitorTheme.canvas)
        .navigationTitle("Home")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await environment.refreshHomeOverview() }
                } label: {
                    Label("Refresh Home data", systemImage: "arrow.clockwise")
                }
                .disabled(environment.bootstrapRefreshState == .refreshing)
                .accessibilityIdentifier("refresh-home-data")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        isRePairScannerPresented = true
                    } label: {
                        Label("Re-pair with Mac", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(environment.pairingState.isInProgress)
                    .accessibilityIdentifier("repair-mac-connection")

                    Button("Disconnect", role: .destructive) {
                        isDisconnectConfirmationPresented = true
                    }
                } label: {
                    Label("Profile and settings", systemImage: "person.crop.circle")
                }
            }
        }
        .sheet(isPresented: $isRePairScannerPresented) {
            ScenePrivacyProtectionContainer {
                scannerFactory.makeView(
                    onScanned: beginRePairing,
                    onCancel: { isRePairScannerPresented = false }
                )
            }
        }
        .confirmationDialog(
            "Disconnect this iPhone?",
            isPresented: $isDisconnectConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("Disconnect and remove saved data", role: .destructive) {
                Task { await environment.disconnect() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes this iPhone’s saved Mac connection and encrypted financial snapshot. You can pair again later from your Mac.")
        }
    }

    private enum PresentationState {
        case ready(HomeOverviewPresentation)
        case missing
        case invalid
    }

    private var presentationState: PresentationState {
        guard let overview = environment.latestHomeOverview else { return .missing }
        do { return .ready(try HomeOverviewPresentationBuilder().makePresentation(from: overview)) }
        catch { return .invalid }
    }

    private var missingMessage: String {
        switch environment.trustState {
        case .savedView, .staleSavedView:
            "This Saved View has no accepted Home projection. Reconnect to load Home from your Mac."
        case .failed:
            "Home could not be refreshed. Retry when your Mac is available."
        case .noSnapshot, .incompatible:
            "Pair again to load a verified Home projection from your Mac."
        default:
            "Connect to your Mac to load Home."
        }
    }

    private func beginRePairing(qrPayload: Data) {
        isRePairScannerPresented = false
        Task { await environment.pair(qrPayload: qrPayload, deviceName: deviceName()) }
    }

    private func homeContent(_ presentation: HomeOverviewPresentation) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.large) {
                trustContext(presentation)
                if presentation.isEmpty {
                    Text("No financial activity is available for this period yet.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("No financial activity is available for this period yet")
                }
                summarySection(presentation)
                budgetSection(presentation.budget)
                categorySection(presentation.categories)
                cashFlowSection(presentation.cashFlow)
                freshnessSection(presentation.accountFreshness)
                Text("Financial date \(presentation.financialDate) · Calculated \(presentation.calculatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityElement(children: .combine)
            }
            .padding(.horizontal, MoneyMonitorTheme.Spacing.large)
            .padding(.vertical, MoneyMonitorTheme.Spacing.standard)
        }
        .scrollBounceBehavior(.always, axes: .vertical)
        .refreshable { await environment.refreshHomeOverview() }
    }

    private func trustContext(_ presentation: HomeOverviewPresentation) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(trustLabel)
                .font(.subheadline.weight(.semibold))
            Text(presentation.completeness == "partial" ? "Partial Home data · affected values are marked unavailable." : "Mac is the source of truth.")
                .font(.footnote)
                .foregroundStyle(presentation.completeness == "partial" ? MoneyMonitorTheme.warning : .secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var trustLabel: String {
        switch environment.trustState {
        case .savedView: "Saved View"
        case .staleSavedView: "Stale Saved View"
        case .partial: "Partial"
        case .checking: "Checking with Mac…"
        case .failed: "Home refresh failed"
        default: "Live Home"
        }
    }

    private func amountMetric(_ title: String, _ amount: HomeOverviewPresentation.Amount?, prominence: Font.TextStyle = .body) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Text(amount?.formatted ?? "Unavailable")
                .font(.system(prominence == .title ? .title2 : .body, design: .rounded).weight(.semibold))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(amount?.formatted ?? "Unavailable")")
    }

    private func summarySection(_ presentation: HomeOverviewPresentation) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
            amountMetric("Available money", presentation.availableMoney, prominence: .title)
            HStack(alignment: .top, spacing: MoneyMonitorTheme.Spacing.large) {
                amountMetric("Spending", presentation.currentSpending)
                Divider()
                amountMetric("Prior period", presentation.comparisonSpending)
                Divider()
                amountMetric("Net worth", presentation.netWorth.total)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("Change vs prior period: \(presentation.spendingChange.formatted)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder
    private func budgetSection(_ budget: HomeOverviewBudget?) -> some View {
        if let budget {
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.small) {
                Text(budget.name).font(.headline)
                amountMetric("Budget remaining", try? HomeOverviewPresentationBuilder().makeAmount(budget.remaining))
                Text("\(budget.state.replacingOccurrences(of: "_", with: " ").capitalized) · \(budget.period.startDate)–\(budget.period.endDate)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(MoneyMonitorTheme.Spacing.large)
            .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
        }
    }

    private func categorySection(_ categories: [HomeOverviewPresentation.Category]) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
            Text("Spending by category").font(.headline)
            if categories.isEmpty {
                Text("No spending data for this period.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(categories) { category in
                    NavigationLink {
                        HomeOverviewDrillDownView(title: category.label, summary: category.textSummary, period: category.drillDown)
                    } label: {
                        HStack {
                            Text(category.textSummary).font(.subheadline).multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "chevron.forward").foregroundStyle(.secondary).accessibilityHidden(true)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private func cashFlowSection(_ cashFlow: [HomeOverviewPresentation.CashFlow]) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
            Text("Cash flow").font(.headline)
            if cashFlow.isEmpty {
                Text("No cash-flow data yet.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(cashFlow.suffix(3)) { point in
                    NavigationLink {
                        HomeOverviewDrillDownView(title: "Cash flow", summary: point.textSummary, period: point.drillDown)
                    } label: {
                        HStack {
                            Text(point.textSummary).font(.subheadline).multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "chevron.forward").foregroundStyle(.secondary).accessibilityHidden(true)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private func freshnessSection(_ accounts: [HomeOverviewAccountFreshness]) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
            Text("Account freshness").font(.headline)
            if accounts.isEmpty {
                Text("No accounts configured.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(accounts) { account in
                    HStack {
                        Text(account.displayName)
                        Spacer()
                        Text(account.status.capitalized)
                            .foregroundStyle(account.status == "stale" ? MoneyMonitorTheme.warning : .secondary)
                    }
                    .font(.subheadline)
                }
            }
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .background(MoneyMonitorTheme.quietControl, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private func unavailableHome(message: String) -> some View {
        ContentUnavailableView("Home unavailable", systemImage: "house", description: Text(message))
    }
}

private struct HomeOverviewDrillDownView: View {
    let title: String
    let summary: String
    let period: HomeOverviewDrillDown

    var body: some View {
        List {
            Section(title) {
                Text(summary).accessibilityAddTraits(.isHeader)
                LabeledContent("Period", value: "\(period.startDate) – \(period.endDate)")
                if let category = period.category {
                    LabeledContent("Category", value: category)
                }
            }
        }
        .navigationTitle(title)
    }
}
