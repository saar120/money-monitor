import SwiftUI

struct TransactionSearchView: View {
    @Binding var query: String

    var body: some View {
        Group {
            if query.isEmpty {
                FeaturePlaceholderView(
                    title: "Search transactions",
                    systemImage: "magnifyingglass",
                    message: "Search will use the private mobile transaction endpoint in Phase 2."
                )
            } else {
                ContentUnavailableView.search(text: query)
            }
        }
        .navigationTitle("Search")
    }
}

