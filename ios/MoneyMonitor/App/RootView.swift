import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environment: AppEnvironment
    private let scannerFactory: PairingScannerViewFactory

    init(scannerFactory: PairingScannerViewFactory = .integrationPending) {
        self.scannerFactory = scannerFactory
    }

    var body: some View {
        Group {
            if environment.pairingState == .restoring {
                RestoringConnectionView()
            } else {
                switch environment.connectionState {
                case .connected:
                    MainTabView(scannerFactory: scannerFactory)
                case .notConfigured, .connecting, .failed:
                    NavigationStack {
                        ConnectMacView(scannerFactory: scannerFactory)
                    }
                }
            }
        }
        .task {
            await environment.restoreSavedConnection()
        }
    }
}

private struct RestoringConnectionView: View {
    var body: some View {
        VStack(spacing: MoneyMonitorTheme.Spacing.medium) {
            ProgressView()
                .controlSize(.large)

            Text("Checking saved connection…")
                .font(.headline)

            Text("Verifying secure access to your Mac.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(MoneyMonitorTheme.Spacing.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Checking saved connection")
        .accessibilityIdentifier("restoring-saved-connection")
    }
}

private struct MainTabView: View {
    @State private var selection: AppTab = .home
    @State private var searchText = ""
    let scannerFactory: PairingScannerViewFactory

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house", value: .home) {
                NavigationStack {
                    HomeView(scannerFactory: scannerFactory)
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
