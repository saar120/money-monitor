import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var isRePairScannerPresented = false

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
            case let .ready(presentation):
                homeContent(presentation)
            case .missing:
                unavailableHome(
                    message: "Pair again to load a verified snapshot from your Mac."
                )
            case .invalid:
                unavailableHome(
                    message: "The Mac response could not be presented safely. Pair again to reload it."
                )
            }
        }
        .background(MoneyMonitorTheme.canvas)
        .navigationTitle("Home")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refreshHome() }
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
                        Task {
                            await environment.disconnect()
                        }
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
    }

    private func beginRePairing(qrPayload: Data) {
        isRePairScannerPresented = false
        let currentDeviceName = deviceName()

        Task {
            await environment.pair(
                qrPayload: qrPayload,
                deviceName: currentDeviceName
            )
        }
    }

    private var presentationState: PresentationState {
        guard let bootstrap = environment.latestBootstrap else { return .missing }
        do {
            return .ready(try HomePresentationBuilder().makePresentation(from: bootstrap))
        } catch {
            return .invalid
        }
    }

    private func homeContent(_ presentation: HomePresentation) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xxLarge) {
                sourceContext(presentation)

                if let message = refreshFailureMessage {
                    statusNotice(
                        message,
                        systemImage: "arrow.clockwise.circle",
                        color: MoneyMonitorTheme.warning
                    )
                }

                if presentation.isPartial || hasUnavailableSection(in: presentation) {
                    statusNotice(
                        "Some Home data is unavailable.",
                        systemImage: "exclamationmark.triangle.fill",
                        color: MoneyMonitorTheme.warning
                    )
                }

                summarySection(presentation.summary)
                budgetSection(presentation.budget)
                reviewSection(presentation.review)
                recentActivitySection(presentation.recentActivity)
            }
            .padding(.horizontal, MoneyMonitorTheme.Spacing.large)
            .padding(.vertical, MoneyMonitorTheme.Spacing.standard)
        }
        // A short Home snapshot can otherwise have no vertical overscroll area,
        // preventing SwiftUI from recognizing the pull-to-refresh gesture.
        .scrollBounceBehavior(.always, axes: .vertical)
        .refreshable {
            await refreshHome()
        }
    }

    /// Keeps a pull gesture from cancelling the live refresh before the Mac's
    /// response can replace Home's accepted bootstrap snapshot. The toolbar
    /// button and SwiftUI's refresh control intentionally share this launcher.
    private func refreshHome() async {
        let refresh = Task { @MainActor in
            await environment.refreshBootstrap()
        }
        await refresh.value
    }

    private func sourceContext(_ presentation: HomePresentation) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(presentation.sourceLabel)
                .font(.subheadline.weight(.semibold))
            Text(presentation.calculatedLabel)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func summarySection(
        _ section: HomePresentationSection<HomePresentation.Summary>
    ) -> some View {
        switch section {
        case let .available(summary):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xLarge) {
                amountMetric(summary.spending, prominence: .primary)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: MoneyMonitorTheme.Spacing.xLarge) {
                        amountMetric(summary.income, prominence: .supporting)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Divider()
                        amountMetric(summary.netWorth, prominence: .supporting)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.large) {
                        amountMetric(summary.income, prominence: .supporting)
                        Divider()
                        amountMetric(summary.netWorth, prominence: .supporting)
                    }
                }
            }
        case .unavailable:
            unavailableSection(title: "Summary")
        }
    }

    @ViewBuilder
    private func budgetSection(
        _ section: HomePresentationSection<HomePresentation.Budget>
    ) -> some View {
        switch section {
        case let .available(budget):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Text(budget.title)
                    .font(.headline)

                Label(
                    budget.status.rawValue,
                    systemImage: budgetStatusSymbol(budget.status)
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(budgetStatusColor(budget.status))

                if let periodLabel = budget.periodLabel {
                    Text(periodLabel)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let remaining = budget.remaining {
                    amountMetric(remaining, prominence: .supporting)
                        .padding(.top, MoneyMonitorTheme.Spacing.xSmall)
                }

                if budget.spent != nil || budget.limit != nil {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: MoneyMonitorTheme.Spacing.xLarge) {
                            if let spent = budget.spent {
                                amountMetric(spent, prominence: .compact)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            if let limit = budget.limit {
                                amountMetric(limit, prominence: .compact)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }

                        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                            if let spent = budget.spent {
                                amountMetric(spent, prominence: .compact)
                            }
                            if let limit = budget.limit {
                                amountMetric(limit, prominence: .compact)
                            }
                        }
                    }
                }
            }
        case .unavailable:
            unavailableSection(title: "Budget")
        }
    }

    @ViewBuilder
    private func reviewSection(
        _ section: HomePresentationSection<HomePresentation.Review>
    ) -> some View {
        switch section {
        case let .available(review):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Text(review.title)
                    .font(.headline)
                Label(
                    review.message,
                    systemImage: review.count == 0 ? "checkmark.circle" : "tray.full"
                )
                .font(.body)
            }
            .accessibilityElement(children: .combine)
        case .unavailable:
            unavailableSection(title: "Review")
        }
    }

    @ViewBuilder
    private func recentActivitySection(
        _ section: HomePresentationSection<HomePresentation.RecentActivity>
    ) -> some View {
        switch section {
        case let .available(activity):
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                Text(activity.title)
                    .font(.headline)

                if activity.items.isEmpty {
                    Text("No recent activity")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(activity.items.enumerated()), id: \.element.id) { index, item in
                        transactionRow(item)
                        if index < activity.items.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        case .unavailable:
            unavailableSection(title: "Recent activity")
        }
    }

    private func transactionRow(_ item: HomePresentation.RecentActivity.Item) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: MoneyMonitorTheme.Spacing.standard) {
                transactionContext(item)
                Spacer(minLength: MoneyMonitorTheme.Spacing.medium)
                transactionAmount(item)
            }

            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.medium) {
                transactionContext(item)
                transactionAmount(item)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, MoneyMonitorTheme.Spacing.xSmall)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(transactionAccessibilityLabel(item))
    }

    private func transactionContext(_ item: HomePresentation.RecentActivity.Item) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(verbatim: item.merchant)
                .font(.body.weight(.medium))
            if let category = item.category {
                Text(verbatim: category)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(verbatim: item.account)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(item.occurredOn.formatted)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func transactionAmount(_ item: HomePresentation.RecentActivity.Item) -> some View {
        VStack(alignment: .trailing, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(item.amount.formatted)
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(transactionAmountColor(item.direction))

            if item.direction == .unavailable {
                Text("Direction unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let statusLabel = transactionStatusLabel(item.status) {
                Text(statusLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func amountMetric(
        _ amount: HomePresentation.Amount,
        prominence: AmountProminence
    ) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
            Text(amount.title)
                .font(prominence.titleFont)
                .foregroundStyle(prominence == .primary ? .primary : .secondary)
            Text(amount.formatted)
                .font(prominence.amountFont)
                .fontWeight(.semibold)
                .monospacedDigit()
                .minimumScaleFactor(0.8)
            if let periodLabel = amount.periodLabel {
                Text(periodLabel)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func unavailableSection(title: String) -> some View {
        VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.small) {
            Text(title)
                .font(.headline)
            Label("Data unavailable", systemImage: "exclamationmark.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func statusNotice(
        _ message: String,
        systemImage: String,
        color: Color
    ) -> some View {
        Label(message, systemImage: systemImage)
            .font(.subheadline)
            .foregroundStyle(color)
            .accessibilityElement(children: .combine)
    }

    private func unavailableHome(message: String) -> some View {
        ContentUnavailableView(
            "Home data unavailable",
            systemImage: "macbook.and.iphone",
            description: Text(message)
        )
    }

    private var refreshFailureMessage: String? {
        guard case let .failed(failure) = environment.bootstrapRefreshState else {
            return nil
        }
        switch failure {
        case .unavailable:
            return "Couldn’t refresh from the Mac. The displayed calculation was not replaced."
        case .invalidResponse:
            return "The latest response could not be used. The displayed calculation was not replaced."
        case .incompatible:
            return "Update Money Monitor on this iPhone and Mac before refreshing."
        case .accessRevoked:
            return "This iPhone is no longer paired with the Mac."
        case .missingCredential:
            return "The saved Mac connection is missing."
        case .secureStorageUnavailable:
            return "The saved Mac connection could not be accessed securely."
        }
    }

    private func hasUnavailableSection(in presentation: HomePresentation) -> Bool {
        if case .unavailable = presentation.summary { return true }
        if case .unavailable = presentation.budget { return true }
        if case .unavailable = presentation.review { return true }
        if case .unavailable = presentation.recentActivity { return true }
        return false
    }

    private func budgetStatusSymbol(_ status: HomePresentation.Budget.Status) -> String {
        switch status {
        case .onTrack:
            return "checkmark.circle.fill"
        case .watch:
            return "exclamationmark.triangle.fill"
        case .overBudget:
            return "exclamationmark.circle.fill"
        case .unavailable:
            return "minus.circle"
        }
    }

    private func budgetStatusColor(_ status: HomePresentation.Budget.Status) -> Color {
        switch status {
        case .onTrack:
            return MoneyMonitorTheme.positive
        case .watch:
            return MoneyMonitorTheme.warning
        case .overBudget:
            return MoneyMonitorTheme.negative
        case .unavailable:
            return .secondary
        }
    }

    private func transactionAmountColor(
        _ direction: HomePresentation.RecentActivity.Item.Direction
    ) -> Color {
        switch direction {
        case .debit:
            return MoneyMonitorTheme.negative
        case .credit:
            return MoneyMonitorTheme.positive
        case .unavailable:
            return .primary
        }
    }

    private func transactionStatusLabel(
        _ status: HomePresentation.RecentActivity.Item.Status
    ) -> String? {
        switch status {
        case .posted:
            return nil
        case .pending:
            return "Pending"
        case .unavailable:
            return "Status unavailable"
        }
    }

    private func transactionAccessibilityLabel(
        _ item: HomePresentation.RecentActivity.Item
    ) -> String {
        let direction: String
        switch item.direction {
        case .debit:
            direction = "Debit"
        case .credit:
            direction = "Credit"
        case .unavailable:
            direction = "Direction unavailable"
        }

        var parts = [
            item.merchant,
            direction,
            item.amount.formatted,
            item.occurredOn.formatted,
            item.account,
        ]
        if let category = item.category { parts.append(category) }
        if let status = transactionStatusLabel(item.status) { parts.append(status) }
        return parts.joined(separator: ", ")
    }

    private enum PresentationState {
        case ready(HomePresentation)
        case missing
        case invalid
    }

    private enum AmountProminence: Equatable {
        case primary
        case supporting
        case compact

        var titleFont: Font {
            self == .primary ? .headline : .subheadline
        }

        var amountFont: Font {
            switch self {
            case .primary:
                return .largeTitle
            case .supporting:
                return .title2
            case .compact:
                return .body
            }
        }
    }
}
