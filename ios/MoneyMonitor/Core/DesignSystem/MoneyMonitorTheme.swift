import SwiftUI
import UIKit

enum MoneyMonitorTheme {
    static let canvas = adaptive(
        light: UIColor(red: 1, green: 1, blue: 1, alpha: 1),
        dark: UIColor(red: 8 / 255, green: 8 / 255, blue: 9 / 255, alpha: 1)
    )

    static let quietControl = adaptive(
        light: UIColor(red: 240 / 255, green: 240 / 255, blue: 242 / 255, alpha: 1),
        dark: UIColor(red: 34 / 255, green: 34 / 255, blue: 37 / 255, alpha: 1)
    )

    static let tint = adaptive(
        light: UIColor(red: 0, green: 107 / 255, blue: 214 / 255, alpha: 1),
        dark: UIColor(red: 64 / 255, green: 156 / 255, blue: 1, alpha: 1)
    )

    static let positive = adaptive(
        light: UIColor(red: 22 / 255, green: 122 / 255, blue: 50 / 255, alpha: 1),
        dark: UIColor(red: 48 / 255, green: 209 / 255, blue: 88 / 255, alpha: 1)
    )

    static let negative = adaptive(
        light: UIColor(red: 215 / 255, green: 0, blue: 21 / 255, alpha: 1),
        dark: UIColor(red: 1, green: 90 / 255, blue: 82 / 255, alpha: 1)
    )

    static let warning = adaptive(
        light: UIColor(red: 150 / 255, green: 59 / 255, blue: 0, alpha: 1),
        dark: UIColor(red: 1, green: 159 / 255, blue: 10 / 255, alpha: 1)
    )

    enum Spacing {
        static let xSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let standard: CGFloat = 16
        static let large: CGFloat = 20
        static let xLarge: CGFloat = 24
        static let xxLarge: CGFloat = 32
    }

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

extension View {
    func moneyAmountStyle() -> some View {
        font(.title2.weight(.semibold))
            .monospacedDigit()
    }
}

