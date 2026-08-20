import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.scenePhase) private var scenePhase
    private let scannerFactory: PairingScannerViewFactory

    init(scannerFactory: PairingScannerViewFactory = .integrationPending) {
        self.scannerFactory = scannerFactory
    }

    var body: some View {
        Group {
            if environment.trustState == .revoked {
                GlobalTrustRecoveryView(
                    state: environment.trustState,
                    scannerFactory: scannerFactory
                )
            } else if environment.isFinancialContentLocked, scenePhase == .active {
                // The active lock screen replaces the privacy cover. Stacking
                // both views makes the cover's branding overlap the unlock UI.
                FinancialContentLockView()
            } else {
                ScenePrivacyProtectionContainer(
                    isContentAuthorized: !environment.isFinancialContentLocked
                ) {
                    appContent
                }
            }
        }
        .task {
            await environment.restoreSavedConnection()
        }
        .onChange(of: scenePhase) { _, newPhase in
            environment.scenePhaseChanged(isActive: newPhase == .active)
        }
    }

    @ViewBuilder
    private var appContent: some View {
        if shouldShowRecovery {
            GlobalTrustRecoveryView(
                state: environment.trustState,
                scannerFactory: scannerFactory
            )
        } else if environment.pairingState == .restoring {
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

    private var shouldShowRecovery: Bool {
        switch environment.trustState {
        case .noSnapshot, .incompatible, .revoked:
            true
        case .checking:
            // A paired retry can begin from `.noSnapshot` while the root
            // connection state is still not configured. Keep the recovery
            // surface mounted until that one request resolves instead of
            // falling through to onboarding.
            if environment.pairingState == .restoring {
                false
            } else if case .connected = environment.connectionState {
                false
            } else {
                true
            }
        case .failed(.secureStorageUnavailable):
            true
        case .disconnected, .live, .partial, .savedView, .staleSavedView,
             .failed:
            false
        }
    }
}

private struct FinancialContentLockView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        VStack(spacing: MoneyMonitorTheme.Spacing.large) {
            Image(systemName: "lock.fill")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(MoneyMonitorTheme.tint)
                .accessibilityHidden(true)

            Text("Money Monitor is locked")
                .font(.headline)

            Text("Unlock with your device passcode or biometrics to view saved financial data.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Unlock Money Monitor") {
                Task { await environment.unlockFinancialContent() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(environment.financialContentLockState == .authenticating)
            .accessibilityIdentifier("unlock-financial-content")
        }
        .padding(MoneyMonitorTheme.Spacing.large)
        .frame(maxWidth: 420, maxHeight: .infinity)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MoneyMonitorTheme.canvas.ignoresSafeArea())
        .accessibilityElement(children: .contain)
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
                .globalTrustStatusInset()
            }

            Tab("Activity", systemImage: "list.bullet.rectangle", value: .activity) {
                NavigationStack {
                    ActivityView()
                }
                .globalTrustStatusInset()
            }

            Tab("Plan", systemImage: "chart.pie", value: .plan) {
                NavigationStack {
                    PlanView()
                }
                .globalTrustStatusInset()
            }

            Tab("Advisor", systemImage: "sparkles", value: .advisor) {
                NavigationStack {
                    AdvisorView()
                }
                .globalTrustStatusInset()
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
                .searchable(text: $searchText, prompt: "Search transactions")
            }
        }
    }
}
