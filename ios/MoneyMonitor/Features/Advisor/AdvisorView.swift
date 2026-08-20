import SwiftUI

struct AdvisorView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        Group {
            if !environment.trustState.isLive {
                FeaturePlaceholderView(
                    title: "Reconnect for Advisor",
                    systemImage: "wifi.exclamationmark",
                    message: "Advisor requires a live connection to your Mac. Saved View remains available on the other financial tabs."
                )
            } else {
                FeaturePlaceholderView(
                    title: "Advisor",
                    systemImage: "sparkles",
                    message: "Advisor follows the read-only financial experience and a safe tool policy."
                )
            }
        }
        .navigationTitle("Advisor")
    }
}

