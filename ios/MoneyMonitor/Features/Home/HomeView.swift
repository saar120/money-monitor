import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        List {
            Section {
                HStack(spacing: MoneyMonitorTheme.Spacing.medium) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(MoneyMonitorTheme.positive)

                    VStack(alignment: .leading, spacing: MoneyMonitorTheme.Spacing.xSmall) {
                        Text("Mac connection checked")
                            .font(.headline)
                        Text(freshnessText)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            Section("Next implementation slice") {
                Text("Load a masked, read-only Home snapshot from /api/mobile/v1/bootstrap.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Home")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
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
    }

    private var freshnessText: String {
        guard case let .connected(lastCheckedAt) = environment.connectionState else {
            return "Connection status unavailable"
        }
        return "Health response received \(lastCheckedAt.formatted(.relative(presentation: .named)))"
    }
}
