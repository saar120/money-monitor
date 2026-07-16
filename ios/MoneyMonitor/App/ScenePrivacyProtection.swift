import SwiftUI

enum ScenePrivacyPolicy {
    static func requiresProtection(for scenePhase: ScenePhase) -> Bool {
        switch scenePhase {
        case .active:
            false
        case .inactive, .background:
            true
        @unknown default:
            true
        }
    }
}

struct ScenePrivacyProtectionContainer<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        let requiresProtection = ScenePrivacyPolicy.requiresProtection(for: scenePhase)

        ZStack {
            content
                .opacity(requiresProtection ? 0 : 1)
                .allowsHitTesting(!requiresProtection)
                .accessibilityHidden(requiresProtection)

            if requiresProtection {
                ScenePrivacyCoverView()
            }
        }
        .animation(nil, value: requiresProtection)
    }
}

struct ScenePrivacyCoverView: View {
    static let accessibilityIdentifier = "scene-privacy-cover"
    static let accessibilityLabel = "Money Monitor"

    var body: some View {
        ZStack {
            MoneyMonitorTheme.canvas
                .ignoresSafeArea()

            VStack(spacing: MoneyMonitorTheme.Spacing.small) {
                Image(systemName: "circle.grid.2x2.fill")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(MoneyMonitorTheme.tint)

                Text("Money Monitor")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.accessibilityLabel)
            .accessibilityIdentifier(Self.accessibilityIdentifier)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
