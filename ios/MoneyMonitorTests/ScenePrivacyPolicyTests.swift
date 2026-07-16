import SwiftUI
import Testing
@testable import MoneyMonitor

struct ScenePrivacyPolicyTests {
    @Test
    func activeSceneDoesNotRequireProtection() {
        #expect(!ScenePrivacyPolicy.requiresProtection(for: .active))
    }

    @Test
    func inactiveSceneRequiresProtection() {
        #expect(ScenePrivacyPolicy.requiresProtection(for: .inactive))
    }

    @Test
    func backgroundSceneRequiresProtection() {
        #expect(ScenePrivacyPolicy.requiresProtection(for: .background))
    }

    @Test
    func everyKnownNonactiveSceneRequiresProtection() {
        let nonactivePhases: [ScenePhase] = [.inactive, .background]

        #expect(nonactivePhases.allSatisfy(ScenePrivacyPolicy.requiresProtection))
    }

    @Test
    @MainActor
    func privacyCoverHasStableNeutralAccessibilitySemantics() {
        #expect(ScenePrivacyCoverView.accessibilityIdentifier == "scene-privacy-cover")
        #expect(ScenePrivacyCoverView.accessibilityLabel == "Money Monitor")
    }
}
