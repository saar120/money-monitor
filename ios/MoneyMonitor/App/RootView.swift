import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environment: AppEnvironment
    private let scannerFactory: PairingScannerViewFactory

    init(scannerFactory: PairingScannerViewFactory = .integrationPending) {
        self.scannerFactory = scannerFactory
    }

    var body: some View {
        Group {
            switch environment.connectionState {
            case .connected:
                MainTabView()
            case .notConfigured, .connecting, .failed:
                NavigationStack {
                    ConnectMacView(scannerFactory: scannerFactory)
                }
            }
        }
        .task {
            await environment.restoreSavedConnection()
        }
    }
}

private struct MainTabView: View {
    @State private var selection: AppTab = .home
    @State private var searchText = ""

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house", value: .home) {
                NavigationStack {
                    HomeView()
                }
            }

            Tab("Activity", systemImage: "list.bullet.rectangle", value: .activity) {
                NavigationStack {
                    ActivityView()
                }
            }

            Tab("Plan", systemImage: "chart.pie", value: .plan) {
                NavigationStack {
                    PlanView()
                }
            }

            Tab("Advisor", systemImage: "sparkles", value: .advisor) {
                NavigationStack {
                    AdvisorView()
                }
            }

            Tab(
                "Search",
                systemImage: "magnifyingglass",
                value: .search,
                role: .search
            ) {
                NavigationStack {
                    TransactionSearchView(query: $searchText)
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search transactions")
    }
}
