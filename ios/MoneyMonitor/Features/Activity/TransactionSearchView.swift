import SwiftUI

enum TransactionSearchPolicy {
    static let debounce: Duration = .milliseconds(300)
}

struct TransactionSearchView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Binding var query: String
    @StateObject private var model = TransactionListModel()
    @State private var filters = TransactionFilters()
    @State private var isFilterPresented = false

    var body: some View {
        Group {
            if normalizedQuery.isEmpty, filters.isDefault {
                ContentUnavailableView(
                    "Search transactions",
                    systemImage: "magnifyingglass",
                    description: Text("Search merchant names in English or Hebrew, or apply filters.")
                )
            } else {
                TransactionListResults(
                    model: model,
                    desiredQuery: request,
                    emptyTitle: "No results",
                    emptyDescription: "Try another search or reset the filters.",
                    reload: reload,
                    loadNextPage: loadNextPage
                )
                .refreshable {
                    await model.refresh(query: request, using: environment.transactions)
                }
            }
        }
        .navigationTitle("Search")
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
                .accessibilityIdentifier("search-filters")
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
        .task(id: taskKey) {
            guard !normalizedQuery.isEmpty || !filters.isDefault else {
                model.reset()
                return
            }
            await model.replace(
                with: request,
                debounce: normalizedQuery.isEmpty ? nil : TransactionSearchPolicy.debounce,
                using: environment.transactions
            )
        }
        .onChange(of: query) { _, newValue in
            let bounded = MobileTransactionQuery.boundedRawSearchInput(newValue)
            if bounded != newValue { query = bounded }
        }
    }

    private var normalizedQuery: String {
        MobileTransactionQuery.canonicalSearchText(query) ?? ""
    }

    private var request: MobileTransactionQuery {
        filters.makeQuery(searchText: normalizedQuery)
    }

    private var taskKey: SearchTaskKey {
        SearchTaskKey(query: normalizedQuery, filters: filters)
    }

    private func loadNextPage() async {
        await model.append(using: environment.transactions)
    }

    private func reload() async {
        await model.refresh(query: request, using: environment.transactions)
    }
}

private struct SearchTaskKey: Hashable {
    let query: String
    let filters: TransactionFilters
}
