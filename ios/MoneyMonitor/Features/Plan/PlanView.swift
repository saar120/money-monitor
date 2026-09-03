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
                Section("Categories") {
                    NavigationLink("Manage categories") { CategoryManagerView() }
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

private struct CategoryManagerView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var categories: [CanonicalCategory] = []
    @State private var ownerMembers: [CategoryOwnerMember] = []
    @State private var error: String?
    @State private var showingCreate = false

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(.red) } }
            ForEach(categories, id: \.id) { category in
                NavigationLink {
                    CategoryEditorView(
                        category: category,
                        ownerMembers: ownerMembers
                    ) { await load() }
                } label: {
                    HStack {
                        Circle().fill(Color(hex: category.color ?? "#94A3B8")).frame(width: 14, height: 14)
                        VStack(alignment: .leading) {
                            Text(category.label)
                            Text(category.name).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if category.ignoredFromStats { Text("Ignored").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        }
        .overlay { if categories.isEmpty && error == nil { ProgressView("Loading categories…") } }
        .navigationTitle("Categories")
        .toolbar { Button("Add", systemImage: "plus") { showingCreate = true } }
        .sheet(isPresented: $showingCreate) {
            NavigationStack {
                CategoryCreateView(ownerMembers: ownerMembers) {
                    showingCreate = false; await load()
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let catalog = try await environment.categoryCatalog()
            categories = catalog.categories
            ownerMembers = catalog.ownerMembers
            error = nil
        }
        catch { self.error = "Reconnect to your Mac and try again." }
    }
}

private struct CategoryCreateView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var label = ""
    @State private var color = "#3B82F6"
    @State private var rules = ""
    @State private var ignored = false
    @State private var owner = "unassigned"
    @State private var saving = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString
    @State private var attemptedPayload = ""
    let ownerMembers: [CategoryOwnerMember]
    let saved: () async -> Void

    var body: some View {
        Form {
            TextField("Name (slug)", text: $name).textInputAutocapitalization(.never)
            TextField("Label", text: $label)
            TextField("Color (#RRGGBB)", text: $color).textInputAutocapitalization(.never)
            TextField("Categorization rules", text: $rules, axis: .vertical)
            Picker("Default owner", selection: $owner) {
                Text("Account member").tag("unassigned")
                Text("Together").tag("shared")
                ForEach(ownerMembers) { member in
                    Text(member.name).tag("member:\(member.id)")
                }
            }
            Toggle("Ignore from statistics", isOn: $ignored)
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("New Category")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }.disabled(saving || name.isEmpty || label.isEmpty)
            }
        }
    }

    private func save() async {
        saving = true; defer { saving = false }
        let payload = [name, label, color, rules, owner, String(ignored)].joined(separator: "\u{1F}")
        if attemptedPayload != payload {
            idempotencyKey = UUID().uuidString
            attemptedPayload = payload
        }
        do {
            _ = try await environment.createCategory(.init(
                idempotencyKey: idempotencyKey, name: name, label: label,
                color: color, rules: rules.isEmpty ? nil : rules,
                defaultOwnerType: owner.hasPrefix("member:") ? .member : owner == "shared" ? .shared : .unassigned,
                defaultOwnerMemberId: selectedCategoryMemberID(owner),
                ignoredFromStats: ignored
            ))
            await saved(); dismiss()
        } catch {
            if isCategoryUnknownOutcome(error),
               let authoritative = try? await environment.categories(),
               authoritative.contains(where: {
                   $0.name == name && $0.label == label && $0.color == color
                       && $0.rules == (rules.isEmpty ? nil : rules)
                       && categoryOwnerValue($0) == owner && $0.ignoredFromStats == ignored
               }) {
                await environment.refreshCategoryProjections()
                await saved(); dismiss()
            } else {
                self.error = "Could not create this category. Try again to reuse the same receipt."
            }
        }
    }
}

private struct CategoryEditorView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.dismiss) private var dismiss
    let category: CanonicalCategory
    let ownerMembers: [CategoryOwnerMember]
    let saved: () async -> Void
    @State private var label: String
    @State private var color: String
    @State private var originalColor: String?
    @State private var rules: String
    @State private var ignored: Bool
    @State private var owner: String
    @State private var expectedVersion: Int
    @State private var needsReapply = false
    @State private var needsDeleteReapply = false
    @State private var confirmDelete = false
    @State private var error: String?

    init(
        category: CanonicalCategory,
        ownerMembers: [CategoryOwnerMember],
        saved: @escaping () async -> Void
    ) {
        self.category = category; self.saved = saved
        self.ownerMembers = ownerMembers
        _label = State(initialValue: category.label)
        _color = State(initialValue: category.color ?? "#94A3B8")
        _originalColor = State(initialValue: category.color)
        _rules = State(initialValue: category.rules ?? "")
        _ignored = State(initialValue: category.ignoredFromStats)
        _owner = State(initialValue: categoryOwnerValue(category))
        _expectedVersion = State(initialValue: category.resourceVersion)
    }

    var body: some View {
        Form {
            TextField("Label", text: $label)
            TextField("Color (#RRGGBB)", text: $color).textInputAutocapitalization(.never)
            TextField("Categorization rules", text: $rules, axis: .vertical)
            Picker("Default owner", selection: $owner) {
                Text("Account member").tag("unassigned")
                Text("Together").tag("shared")
                ForEach(ownerMembers) { member in
                    Text(member.name).tag("member:\(member.id)")
                }
            }
            Toggle("Ignore from statistics", isOn: $ignored)
            if let error { Text(error).foregroundStyle(.red) }
            if needsReapply {
                Button("Reapply to latest version") { Task { await saveChanges() } }
            }
            if needsDeleteReapply {
                Button("Delete latest version", role: .destructive) { confirmDelete = true }
            }
            Button("Delete Category", role: .destructive) { confirmDelete = true }
        }
        .navigationTitle(category.label)
        .toolbar { Button("Save") { Task { await saveChanges() } } }
        .confirmationDialog("Delete \(category.label)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await remove() } }
        } message: { Text("Transactions keep their existing label, but the category will no longer be selectable.") }
    }

    private func saveChanges() async {
        do {
            _ = try await environment.updateCategory(id: category.id, request: .init(
                label: label, color: intendedCategoryColor(original: originalColor, draft: color), rules: rules.isEmpty ? nil : rules,
                defaultOwnerType: owner == "shared" ? .shared : owner == "unassigned" ? .unassigned : .member,
                defaultOwnerMemberId: selectedCategoryMemberID(owner),
                ignoredFromStats: ignored, expectedVersion: expectedVersion
            ))
            await saved(); dismiss()
        } catch {
            let code = categoryErrorCode(error)
            if code == "resource_conflict" || isCategoryUnknownOutcome(error) {
                await recoverAuthoritativeState(afterUnknownOutcome: isCategoryUnknownOutcome(error))
            } else {
                self.error = "Could not save this category."
            }
        }
    }

    private func remove() async {
        do {
            try await environment.deleteCategory(id: category.id, expectedVersion: expectedVersion)
            await saved(); dismiss()
        } catch {
            let code = categoryErrorCode(error)
            guard code == "resource_conflict" || isCategoryUnknownOutcome(error) else {
                self.error = "Could not delete this category."
                return
            }
            let current: [CanonicalCategory]
            do {
                current = try await environment.categories()
            } catch {
                self.error = "Could not confirm deletion. Reconnect before trying again."
                return
            }
            guard let authoritative = current.first(where: { $0.id == category.id }) else {
                await environment.refreshCategoryProjections()
                await saved(); dismiss()
                return
            }
            expectedVersion = authoritative.resourceVersion
            needsDeleteReapply = true
            self.error = "This category changed. Confirm again to delete the latest version."
        }
    }

    private func recoverAuthoritativeState(afterUnknownOutcome: Bool) async {
        let categories: [CanonicalCategory]
        do {
            categories = try await environment.categories()
        } catch {
            self.error = "Could not confirm the result. Reconnect, then reapply your draft."
            return
        }
        guard let authoritative = categories.first(where: { $0.id == category.id }) else {
            error = "The category no longer exists."
            return
        }
        if afterUnknownOutcome,
           authoritative.label == label,
           authoritative.color == intendedCategoryColor(original: originalColor, draft: color),
           authoritative.rules == (rules.isEmpty ? nil : rules),
           authoritative.ignoredFromStats == ignored,
           categoryOwnerValue(authoritative) == owner
        {
            await environment.refreshCategoryProjections()
            await saved(); dismiss()
            return
        }
        expectedVersion = authoritative.resourceVersion
        needsReapply = true
        error = "The category changed on another client. Review your draft, then reapply it."
    }
}

func intendedCategoryColor(original: String?, draft: String) -> String? {
    original == nil && draft == "#94A3B8" ? nil : draft
}

private func selectedCategoryMemberID(_ value: String) -> Int? {
    guard value.hasPrefix("member:") else { return nil }
    return Int(value.dropFirst("member:".count))
}

private func categoryOwnerValue(_ category: CanonicalCategory) -> String {
    if category.defaultOwnerType == .member, let memberID = category.defaultOwnerMemberId {
        return "member:\(memberID)"
    }
    return category.defaultOwnerType == .shared ? "shared" : "unassigned"
}

private func categoryErrorCode(_ error: Error) -> String? {
    guard case let CanonicalAPIError.coded(code, _, _) = error else { return nil }
    return code
}

private func isCategoryUnknownOutcome(_ error: Error) -> Bool {
    if categoryErrorCode(error) == "unknown_outcome" { return true }
    guard let mobileError = error as? MobileClientError else { return false }
    if case .transport = mobileError { return true }
    return false
}

private extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x94A3B8
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
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
