import Foundation
import SwiftUI

struct ActivityView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @StateObject private var model = TransactionListModel()
    @State private var filters = TransactionFilters()
    @State private var isFilterPresented = false

    var body: some View {
        TransactionListResults(
            model: model,
            desiredQuery: request,
            emptyTitle: filters.isDefault ? "No activity" : "No matching transactions",
            emptyDescription: filters.isDefault
                ? "Transactions from your Mac will appear here."
                : "Try changing or resetting the filters.",
            savedViewNotice: savedViewNotice,
            reload: reload,
            loadNextPage: loadNextPage
        )
        .navigationTitle("Activity")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isFilterPresented = true
                } label: {
                    Label(
                        filters.activeCount == 0 ? "Filters" : "Filters, \(filters.activeCount) active",
                        systemImage: filters.activeCount == 0
                            ? "line.3.horizontal.decrease"
                            : "line.3.horizontal.decrease.circle.fill"
                    )
                }
                .accessibilityIdentifier("activity-filters")
            }
        }
        .sheet(isPresented: $isFilterPresented) {
            ScenePrivacyProtectionContainer {
                TransactionFiltersView(
                    initial: filters,
                    accounts: environment.latestBootstrap?.data.accounts ?? []
                ) { filters = $0 }
            }
        }
        .task(id: request) {
            await model.replace(with: request, using: environment.transactions)
        }
        .refreshable {
            await model.refresh(query: request, using: environment.transactions)
        }
    }

    private var request: MobileTransactionQuery {
        filters.makeQuery()
    }

    private var savedViewNotice: String? {
        guard environment.snapshotState.isSavedView, !environment.trustState.isLive else {
            return nil
        }
        return "Saved View · showing up to 200 recent transactions. History may be incomplete."
    }

    private func loadNextPage() async {
        await model.append(using: environment.transactions)
    }

    private func reload() async {
        await model.refresh(query: request, using: environment.transactions)
    }
}

struct TransactionFilters: Equatable, Hashable {
    enum DateRange: String, CaseIterable, Identifiable {
        case all
        case thisMonth
        case last30Days
        case custom

        var id: Self { self }

        var label: String {
            switch self {
            case .all: "All time"
            case .thisMonth: "This month"
            case .last30Days: "Last 30 days"
            case .custom: "Custom range"
            }
        }
    }

    enum Direction: String, CaseIterable, Identifiable {
        case all
        case expenses
        case income

        var id: Self { self }

        var label: String {
            switch self {
            case .all: "All"
            case .expenses: "Expenses"
            case .income: "Income"
            }
        }

        var wireValue: BootstrapTransactionDirection? {
            switch self {
            case .all: nil
            case .expenses: .debit
            case .income: .credit
            }
        }
    }

    enum Status: String, CaseIterable, Identifiable {
        case all
        case posted
        case pending

        var id: Self { self }
        var label: String { rawValue.capitalized }

        var wireValue: BootstrapTransactionStatus? {
            switch self {
            case .all: nil
            case .posted: .posted
            case .pending: .pending
            }
        }
    }

    var dateRange: DateRange = .all
    var customStart = Calendar.autoupdatingCurrent.date(byAdding: .day, value: -29, to: Date())!
    var customEnd = Date()
    var direction: Direction = .all
    var status: Status = .all
    var accountID: String?
    var needsReview = false
    var includeExcluded = false

    var isDefault: Bool { activeCount == 0 }

    var activeCount: Int {
        [
            dateRange == .all,
            direction == .all,
            status == .all,
            accountID == nil,
            !needsReview,
            !includeExcluded,
        ].filter { !$0 }.count
    }

    func makeQuery(searchText: String? = nil) -> MobileTransactionQuery {
        let bounds = dateBounds
        return MobileTransactionQuery(
            query: searchText,
            startDate: bounds?.start,
            endDate: bounds?.end,
            direction: direction.wireValue,
            status: status.wireValue,
            needsReview: needsReview,
            includeExcluded: includeExcluded,
            accountID: accountID
        )
    }

    mutating func reset() {
        self = Self()
    }

    private var dateBounds: (start: String, end: String)? {
        let calendar = Calendar.autoupdatingCurrent
        let now = Date()
        switch dateRange {
        case .all:
            return nil
        case .thisMonth:
            guard let start = calendar.dateInterval(of: .month, for: now)?.start else { return nil }
            return (Self.wireDate(start), Self.wireDate(now))
        case .last30Days:
            guard let start = calendar.date(byAdding: .day, value: -29, to: now) else { return nil }
            return (Self.wireDate(start), Self.wireDate(now))
        case .custom:
            return (
                Self.wireDate(min(customStart, customEnd)),
                Self.wireDate(max(customStart, customEnd))
            )
        }
    }

    private static func wireDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

enum TransactionListLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

enum TransactionAppendState: Equatable {
    case idle
    case loading
    case failed(String)
}

@MainActor
final class TransactionListModel: ObservableObject {
    typealias Loader = (MobileTransactionQuery) async throws -> MobileTransactionListEnvelope

    @Published private(set) var transactions: [MobileTransaction] = []
    @Published private(set) var loadState: TransactionListLoadState = .idle
    @Published private(set) var appendState: TransactionAppendState = .idle
    @Published private(set) var refreshMessage: String?
    @Published private(set) var acceptedQuery: MobileTransactionQuery?

    private(set) var nextCursor: String?
    private(set) var hasMore = false
    private var generation = 0

    func reset() {
        generation += 1
        transactions = []
        acceptedQuery = nil
        nextCursor = nil
        hasMore = false
        loadState = .idle
        appendState = .idle
        refreshMessage = nil
    }

    func replace(
        with query: MobileTransactionQuery,
        debounce: Duration? = nil,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { duration in
            try await Task.sleep(for: duration)
        },
        using loader: @escaping Loader
    ) async {
        let desired = query.firstPage
        generation += 1
        let operation = generation
        loadState = .loading
        appendState = .idle
        refreshMessage = nil

        do {
            if let debounce { try await sleep(debounce) }
            try Task.checkCancellation()
            guard generation == operation else { return }
            let envelope = try await loader(desired)
            try Task.checkCancellation()
            guard generation == operation else { return }
            accept(envelope, query: desired)
        } catch {
            guard generation == operation, !Self.isCancellation(error) else { return }
            loadState = .failed(Self.message(for: error))
        }
    }

    func refresh(query: MobileTransactionQuery, using loader: @escaping Loader) async {
        let desired = query.firstPage
        guard acceptedQuery == desired, loadState == .loaded else {
            await replace(with: desired, using: loader)
            return
        }
        generation += 1
        let operation = generation
        refreshMessage = nil
        appendState = .idle

        do {
            let envelope = try await loader(desired)
            try Task.checkCancellation()
            guard generation == operation else { return }
            accept(envelope, query: desired)
        } catch {
            guard generation == operation, !Self.isCancellation(error) else { return }
            refreshMessage = Self.message(for: error)
        }
    }

    func append(using loader: @escaping Loader) async {
        guard
            loadState == .loaded,
            appendState != .loading,
            let acceptedQuery,
            hasMore,
            let cursor = nextCursor
        else {
            return
        }

        let operation = generation
        appendState = .loading
        do {
            let envelope = try await loader(acceptedQuery.page(after: cursor))
            try Task.checkCancellation()
            guard generation == operation else { return }

            let knownIDs = Set(transactions.map(\.id))
            let additions = envelope.data.transactions.filter { !knownIDs.contains($0.id) }
            if envelope.data.page.hasMore,
               additions.isEmpty || envelope.data.page.nextCursor == cursor
            {
                appendState = .failed("More transactions could not be loaded safely.")
                return
            }

            transactions.append(contentsOf: additions)
            hasMore = envelope.data.page.hasMore
            nextCursor = envelope.data.page.nextCursor
            appendState = .idle
        } catch {
            guard generation == operation, !Self.isCancellation(error) else { return }
            appendState = .failed(Self.message(for: error))
        }
    }

    func isAccepted(_ query: MobileTransactionQuery) -> Bool {
        acceptedQuery == query.firstPage
    }

    private func accept(_ envelope: MobileTransactionListEnvelope, query: MobileTransactionQuery) {
        transactions = envelope.data.transactions
        acceptedQuery = query
        hasMore = envelope.data.page.hasMore
        nextCursor = envelope.data.page.nextCursor
        loadState = .loaded
        appendState = .idle
        refreshMessage = nil
    }

    private static func isCancellation(_ error: any Error) -> Bool {
        if Task.isCancelled || error is CancellationError { return true }
        return (error as? MobileClientError) == .transport(.cancelled)
    }

    static func message(for error: any Error) -> String {
        guard let error = error as? MobileClientError else {
            return "Transactions could not be loaded. Try again."
        }
        switch error {
        case .transport, .rateLimited, .server:
            return "Couldn’t reach the Mac. Try again."
        case .upgradeRequired:
            return "Update Money Monitor on this iPhone and Mac to continue."
        case .notFound:
            return "This transaction is no longer available."
        case .authentication, .authorization:
            return "This iPhone no longer has access to this data."
        case .invalidRequest, .invalidResponse, .invalidPayload, .identityMismatch,
             .pairing, .credentialStorageFailed:
            return "The Mac response could not be used safely."
        }
    }
}

struct TransactionListResults: View {
    @EnvironmentObject private var environment: AppEnvironment
    @ObservedObject var model: TransactionListModel
    let desiredQuery: MobileTransactionQuery
    let emptyTitle: String
    let emptyDescription: String
    let savedViewNotice: String?
    let reload: () async -> Void
    let loadNextPage: () async -> Void

    var body: some View {
        Group {
            if model.isAccepted(desiredQuery) {
                acceptedContent
            } else {
                replacementContent
            }
        }
        .background(MoneyMonitorTheme.canvas)
    }

    @ViewBuilder
    private var acceptedContent: some View {
        if model.transactions.isEmpty {
            ContentUnavailableView {
                Label(emptyTitle, systemImage: "list.bullet.rectangle")
            } description: {
                Text(emptyDescription)
            } actions: {
                Button("Refresh") {
                    Task { await reload() }
                }
            }
        } else {
            List {
                if let savedViewNotice {
                    Section {
                        Label(savedViewNotice, systemImage: "lock.doc.fill")
                            .font(.footnote)
                            .foregroundStyle(MoneyMonitorTheme.warning)
                            .accessibilityIdentifier("saved-view-activity-notice")
                    }
                }

                if let message = model.refreshMessage {
                    Section {
                        Label(message, systemImage: "arrow.clockwise.circle")
                            .foregroundStyle(MoneyMonitorTheme.warning)
                            .accessibilityIdentifier("transaction-refresh-warning")
                    }
                }

                ForEach(TransactionPresentation.groups(model.transactions)) { group in
                    Section(group.title) {
                        ForEach(group.transactions) { transaction in
                            Group {
                                if isSavedView {
                                    TransactionRowView(transaction: transaction)
                                        .accessibilityHint("Saved View transaction details require a live Mac connection.")
                                } else {
                                    NavigationLink {
                                        TransactionDetailView(transactionID: transaction.id)
                                    } label: {
                                        TransactionRowView(transaction: transaction)
                                    }
                                }
                            }
                            .onAppear {
                                guard transaction.id == model.transactions.last?.id else { return }
                                Task { await loadNextPage() }
                            }
                        }
                    }
                }

                if model.appendState == .loading {
                    HStack {
                        Spacer()
                        ProgressView("Loading more…")
                        Spacer()
                    }
                } else if case let .failed(message) = model.appendState {
                    VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.small) {
                        Text(message)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Retry loading more") {
                            Task { await loadNextPage() }
                        }
                    }
                    .accessibilityIdentifier("transaction-append-retry")
                }
            }
            .listStyle(.plain)
            .accessibilityIdentifier("transaction-list")
        }
    }

    private var isSavedView: Bool {
        savedViewNotice != nil || !environment.trustState.isLive
    }

    @ViewBuilder
    private var replacementContent: some View {
        switch model.loadState {
        case .idle, .loading, .loaded:
            ProgressView("Loading transactions…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .failed(message):
            ContentUnavailableView {
                Label("Transactions unavailable", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task { await reload() }
                }
            }
        }
    }
}

struct TransactionRowView: View {
    let transaction: MobileTransaction

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: MoneyMonitorTheme.Spacing.standard) {
                context
                Spacer(minLength: MoneyMonitorTheme.Spacing.medium)
                amount
            }
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.small) {
                context
                amount.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, MoneyMonitorTheme.Spacing.xSmall)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TransactionPresentation.accessibilityLabel(transaction))
    }

    private var context: some View {
        HStack(alignment: .top, spacing: MoneyMonitorTheme.Spacing.medium) {
            Image(systemName: TransactionPresentation.symbol(transaction))
                .foregroundStyle(.secondary)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
                Text(verbatim: transaction.displayName)
                    .font(.body.weight(.semibold))
                Text(TransactionPresentation.rowContext(transaction))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if let status = TransactionPresentation.attentionLabel(transaction) {
                    Text(status)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var amount: some View {
        Text(TransactionPresentation.formattedAmount(transaction))
            .font(.body.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(TransactionPresentation.amountColor(transaction.direction))
    }
}

enum TransactionPresentation {
    struct Group: Identifiable {
        let id: String
        let title: String
        let transactions: [MobileTransaction]
    }

    static func groups(_ transactions: [MobileTransaction]) -> [Group] {
        var order: [String] = []
        var grouped: [String: [MobileTransaction]] = [:]
        for transaction in transactions {
            if grouped[transaction.occurredOn] == nil { order.append(transaction.occurredOn) }
            grouped[transaction.occurredOn, default: []].append(transaction)
        }
        return order.map { date in
            Group(id: date, title: formattedDate(date), transactions: grouped[date] ?? [])
        }
    }

    static func formattedAmount(_ transaction: MobileTransaction) -> String {
        let value = Decimal(
            string: transaction.amount.value,
            locale: Locale(identifier: "en_US_POSIX")
        ) ?? 0
        let signed: Decimal
        switch transaction.direction {
        case .debit: signed = -value.magnitude
        case .credit: signed = value.magnitude
        case .unknown: signed = value.magnitude
        }
        let formatter = NumberFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.numberStyle = .currency
        formatter.currencyCode = transaction.amount.currencyCode
        if transaction.direction == .credit {
            formatter.positivePrefix = (formatter.plusSign ?? "+") + (formatter.positivePrefix ?? "")
        }
        return formatter.string(from: NSDecimalNumber(decimal: signed))
            ?? "\(transaction.amount.value) \(transaction.amount.currencyCode)"
    }

    static func rowContext(_ transaction: MobileTransaction) -> String {
        [transaction.category?.label, transaction.account.displayName]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    static func attentionLabel(_ transaction: MobileTransaction) -> String? {
        var values: [String] = []
        if transaction.status == .pending { values.append("Pending") }
        if transaction.needsReview { values.append("Needs review") }
        if transaction.excludedFromReports { values.append("Excluded from reports") }
        if transaction.status == .unknown { values.append("Status unavailable") }
        return values.isEmpty ? nil : values.joined(separator: " · ")
    }

    static func symbol(_ transaction: MobileTransaction) -> String {
        switch transaction.direction {
        case .debit: "arrow.down.left"
        case .credit: "arrow.up.right"
        case .unknown: "arrow.left.arrow.right"
        }
    }

    static func amountColor(_ direction: BootstrapTransactionDirection) -> Color {
        switch direction {
        case .debit: MoneyMonitorTheme.negative
        case .credit: MoneyMonitorTheme.positive
        case .unknown: .primary
        }
    }

    static func accessibilityLabel(_ transaction: MobileTransaction) -> String {
        let direction: String
        switch transaction.direction {
        case .debit: direction = "Debit"
        case .credit: direction = "Credit"
        case .unknown: direction = "Direction unavailable"
        }
        return [
            transaction.displayName,
            direction,
            formattedAmount(transaction),
            formattedDate(transaction.occurredOn),
            transaction.category?.label,
            transaction.account.displayName,
            attentionLabel(transaction),
        ].compactMap { $0 }.joined(separator: ", ")
    }

    static func formattedDate(
        _ value: String,
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> String {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard
            parts.count == 3,
            let year = Int(parts[0]),
            let month = Int(parts[1]),
            let day = Int(parts[2])
        else {
            return value
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard let date = calendar.date(
            from: DateComponents(year: year, month: month, day: day)
        ) else {
            return value
        }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        guard
            roundTrip.year == year,
            roundTrip.month == month,
            roundTrip.day == day
        else {
            return value
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

struct TransactionFiltersView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: TransactionFilters

    let accounts: [BootstrapAccount]
    let apply: (TransactionFilters) -> Void

    init(
        initial: TransactionFilters,
        accounts: [BootstrapAccount],
        apply: @escaping (TransactionFilters) -> Void
    ) {
        _draft = State(initialValue: initial)
        self.accounts = accounts
        self.apply = apply
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Date") {
                    Picker("Period", selection: $draft.dateRange) {
                        ForEach(TransactionFilters.DateRange.allCases) { value in
                            Text(value.label).tag(value)
                        }
                    }
                    if draft.dateRange == .custom {
                        DatePicker("From", selection: $draft.customStart, displayedComponents: .date)
                        DatePicker("To", selection: $draft.customEnd, displayedComponents: .date)
                    }
                }

                Section("Transaction") {
                    Picker("Direction", selection: $draft.direction) {
                        ForEach(TransactionFilters.Direction.allCases) { value in
                            Text(value.label).tag(value)
                        }
                    }
                    Picker("Status", selection: $draft.status) {
                        ForEach(TransactionFilters.Status.allCases) { value in
                            Text(value.label).tag(value)
                        }
                    }
                    Picker("Account", selection: accountSelection) {
                        Text("All accounts").tag("")
                        ForEach(accounts, id: \.id) { account in
                            Text("\(account.displayName) · \(account.identifierMask)")
                                .tag(account.id)
                        }
                    }
                }

                Section("Review") {
                    Toggle("Only needs review", isOn: $draft.needsReview)
                    Toggle("Include excluded", isOn: $draft.includeExcluded)
                }
        }
        .navigationTitle("Filters")
        .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Reset") { draft.reset() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        apply(draft)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .globalTrustStatusInset()
        .presentationDetents([.large])
    }

    private var accountSelection: Binding<String> {
        Binding(
            get: { draft.accountID ?? "" },
            set: { draft.accountID = $0.isEmpty ? nil : $0 }
        )
    }
}

@MainActor
final class TransactionDetailModel: ObservableObject {
    @Published private(set) var state: State = .loading
    private var generation = 0

    enum State: Equatable {
        case loading
        case loaded(MobileTransaction)
        case failed(String)
    }

    func load(
        id: String,
        using loader: (String) async throws -> MobileTransactionDetailEnvelope
    ) async {
        generation += 1
        let operation = generation
        state = .loading
        do {
            let envelope = try await loader(id)
            try Task.checkCancellation()
            guard generation == operation else { return }
            state = .loaded(envelope.data.transaction)
        } catch {
            guard generation == operation, !Task.isCancelled else { return }
            state = .failed(TransactionListModel.message(for: error))
        }
    }
}

enum ReviewResolutionState: Equatable {
    case idle
    case submitting
    case confirmed
    case validationFailed
    case conflict
    case failed(String)
}

@MainActor
final class ReviewResolutionModel: ObservableObject {
    @Published private(set) var state: ReviewResolutionState = .idle
    private var resolveIdempotencyKey: String?
    private var skipIdempotencyKey: String?

    func submit(
        transactionID: String,
        categoryID: String,
        using resolve: (String, String, String) async throws -> MobileReviewCommandEnvelope
    ) async -> Bool {
        guard state != .submitting else { return false }
        let key = resolveIdempotencyKey ?? UUID().uuidString
        resolveIdempotencyKey = key
        state = .submitting

        do {
            let result = try await resolve(transactionID, categoryID, key).data
            switch result.outcome {
            case .confirmed:
                state = .confirmed
                return true
            case .validationFailed:
                state = .validationFailed
            case .conflict:
                state = .conflict
            }
        } catch {
            state = .failed(message(for: error))
        }
        return false
    }

    func submitSkip(
        transactionID: String,
        using skip: (String, String) async throws -> MobileReviewCommandEnvelope
    ) async -> Bool {
        guard state != .submitting else { return false }
        let key = skipIdempotencyKey ?? UUID().uuidString
        skipIdempotencyKey = key
        state = .submitting

        do {
            let result = try await skip(transactionID, key).data
            switch result.outcome {
            case .confirmed:
                state = .confirmed
                return true
            case .validationFailed:
                state = .validationFailed
            case .conflict:
                state = .conflict
            }
        } catch {
            state = .failed(message(for: error))
        }
        return false
    }

    private func message(for error: any Error) -> String {
        guard let error = error as? MobileClientError else {
            return "Couldn’t confirm the review. Nothing was queued. Try again."
        }
        switch error {
        case .transport:
            return "Live access to your Mac is required. Nothing was queued."
        case .authorization(.capabilityRequired):
            return "Enable Review actions for this iPhone in Money Monitor on your Mac."
        case .authentication(.revoked), .authentication(.expired):
            return "This iPhone’s access has changed. Reconnect it from your Mac."
        default:
            return TransactionListModel.message(for: error)
        }
    }
}

struct TransactionDetailView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @StateObject private var model = TransactionDetailModel()
    @StateObject private var reviewModel = ReviewResolutionModel()
    @State private var isReviewConfirmationPresented = false
    @State private var isSkipConfirmationPresented = false
    let transactionID: String

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView("Loading transaction…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(transaction):
                detail(transaction)
            case let .failed(message):
                ContentUnavailableView {
                    Label("Transaction unavailable", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try Again") {
                        Task { await reload() }
                    }
                }
            }
        }
        .background(MoneyMonitorTheme.canvas)
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: transactionID) {
            await reload()
        }
        .confirmationDialog(
            "Confirm category?",
            isPresented: $isReviewConfirmationPresented,
            titleVisibility: .visible
        ) {
            if case let .loaded(transaction) = model.state, let category = transaction.category {
                Button("Confirm \(category.label)") {
                    Task { await submitReview(transaction: transaction, categoryID: category.id) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This marks the transaction as reviewed using its current category on your Mac.")
        }
        .confirmationDialog(
            "Skip review?",
            isPresented: $isSkipConfirmationPresented,
            titleVisibility: .visible
        ) {
            if case let .loaded(transaction) = model.state {
                Button("Skip review", role: .destructive) {
                    Task { await submitSkip(transaction: transaction) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This clears the review flag only. Your category, owner, amounts, and report settings will not change.")
        }
    }

    private func reload() async {
        await model.load(id: transactionID, using: environment.transactionDetail)
    }

    private func detail(_ transaction: MobileTransaction) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xxLarge) {
                VStack(spacing: MoneyMonitorTheme.Spacing.medium) {
                    Image(systemName: TransactionPresentation.symbol(transaction))
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(verbatim: transaction.displayName)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    Text(TransactionPresentation.formattedAmount(transaction))
                        .font(.largeTitle.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(TransactionPresentation.amountColor(transaction.direction))
                    Text(
                        "\(TransactionPresentation.formattedDate(transaction.occurredOn)) · \(statusLabel(transaction.status))"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(TransactionPresentation.accessibilityLabel(transaction))

                VStack(spacing: 0) {
                    detailRow("Category", value: transaction.category?.label ?? "Uncategorized")
                    Divider()
                    detailRow(
                        "Paid with",
                        value: "\(transaction.account.displayName) · \(transaction.account.identifierMask)"
                    )
                    Divider()
                    detailRow("Owner", value: ownerLabel(transaction.owner))
                    Divider()
                    detailRow("Review", value: transaction.needsReview ? "Needs review" : "No review needed")
                    Divider()
                    detailRow(
                        "Reports",
                        value: transaction.excludedFromReports ? "Excluded" : "Included"
                    )
                }

                reviewAction(for: transaction)
            }
            .padding(MoneyMonitorTheme.Spacing.large)
        }
        .accessibilityIdentifier("transaction-detail")
    }

    @ViewBuilder
    private func reviewAction(for transaction: MobileTransaction) -> some View {
        if transaction.needsReview, let category = transaction.category {
            VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.standard) {
                Text("Review")
                    .font(.headline)
                Text("Confirm the current category, or skip this review without changing any transaction details.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    isReviewConfirmationPresented = true
                } label: {
                    if reviewModel.state == .submitting {
                        ProgressView("Confirming category…")
                    } else {
                        Text("Confirm \(category.label)")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(reviewModel.state == .submitting || !environment.trustState.isLive)
                .accessibilityHint("Requires live access to your Mac and marks this item reviewed.")

                Button("Skip review") {
                    isSkipConfirmationPresented = true
                }
                .buttonStyle(.bordered)
                .disabled(reviewModel.state == .submitting || !environment.trustState.isLive)
                .accessibilityHint("Requires live access to your Mac and clears only this review flag.")

                if !environment.trustState.isLive {
                    Text("Live Mac access is required. Review changes are never queued on this iPhone.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                reviewStatusMessage
            }
            .padding(MoneyMonitorTheme.Spacing.standard)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityIdentifier("transaction-review-action")
        }
    }

    @ViewBuilder
    private var reviewStatusMessage: some View {
        switch reviewModel.state {
        case .idle, .submitting:
            EmptyView()
        case .confirmed:
            Label("Category confirmed on your Mac.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(MoneyMonitorTheme.positive)
        case .validationFailed:
            Text("The Mac could not accept this category. Refresh and try again.")
                .foregroundStyle(MoneyMonitorTheme.warning)
        case .conflict:
            Text("This review item changed on your Mac. Refresh to see its current state.")
                .foregroundStyle(MoneyMonitorTheme.warning)
        case let .failed(message):
            Text(message)
                .foregroundStyle(MoneyMonitorTheme.warning)
        }
    }

    private func submitReview(transaction: MobileTransaction, categoryID: String) async {
        let confirmed = await reviewModel.submit(
            transactionID: transaction.id,
            categoryID: categoryID,
            using: environment.resolveReview
        )
        if confirmed {
            await environment.refreshBootstrap()
            await reload()
        }
    }

    private func submitSkip(transaction: MobileTransaction) async {
        let confirmed = await reviewModel.submitSkip(
            transactionID: transaction.id,
            using: environment.skipReview
        )
        if confirmed {
            await environment.refreshBootstrap()
            await reload()
        }
    }

    private func detailRow(_ title: String, value: String) -> some View {
        LabeledContent(title, value: value)
            .padding(.vertical, MoneyMonitorTheme.Spacing.standard)
            .accessibilityElement(children: .combine)
    }

    private func ownerLabel(_ owner: MobileTransactionOwner?) -> String {
        guard let owner else { return "Unavailable" }
        switch owner.kind {
        case .member: return owner.displayName ?? "Member"
        case .shared: return "Shared"
        case .unassigned: return "Unassigned"
        case .unknown: return "Unavailable"
        }
    }

    private func statusLabel(_ status: BootstrapTransactionStatus) -> String {
        switch status {
        case .posted: "Posted"
        case .pending: "Pending"
        case .unknown: "Status unavailable"
        }
    }
}
