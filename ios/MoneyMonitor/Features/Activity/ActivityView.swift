import SwiftUI

struct ActivityView: View {
    var body: some View {
        FeaturePlaceholderView(
            title: "Activity",
            systemImage: "list.bullet.rectangle",
            message: "Read-only transactions, filters, and details arrive in Phase 2."
        )
        .navigationTitle("Activity")
    }
}

