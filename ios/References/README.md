# Canonical references

This directory is an index, not a copy. Keeping the approved design assets in one canonical location prevents the Xcode implementation and the mockup package from drifting apart.

## Approved product and design source

- [Mockup package overview](../../docs/ios-mockups/README.md)
- [Product and trust boundary](../../docs/ios-mockups/PRODUCT.md)
- [Visual design system](../../docs/ios-mockups/DESIGN.md)
- [Editable mockup deck](../../docs/ios-mockups/index.html)
- [Editable styles](../../docs/ios-mockups/styles.css)
- [Editable screen content and board mapping](../../docs/ios-mockups/mockups.js)
- [Packaged handoff archive](../../docs/Money-Monitor-iOS-Mockups.zip)

## Overview boards

- [Setup and trust](../../docs/ios-mockups/rendered/boards/setup.png)
- [Everyday money](../../docs/ios-mockups/rendered/boards/everyday.png)
- [Planning and wealth](../../docs/ios-mockups/rendered/boards/planning.png)
- [Advisor and connected data](../../docs/ios-mockups/rendered/boards/control.png)
- [Settings, resilience, and appearance](../../docs/ios-mockups/rendered/boards/system.png)

Every individual screen is available under [`docs/ios-mockups/rendered/screens`](../../docs/ios-mockups/rendered/screens/). The exact implementation mapping is in [Screen map](../Documentation/SCREEN_MAP.md).

## Apple implementation references

- [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
- [Liquid Glass material guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Applying Liquid Glass to custom SwiftUI views](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views)
- [`TabRole.search`](https://developer.apple.com/documentation/swiftui/tabrole/search)
- [SwiftUI accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Creating an Xcode project](https://developer.apple.com/documentation/xcode/creating-an-xcode-project-for-an-app)
- [Simulator versus physical-device testing](https://developer.apple.com/documentation/xcode/testing-in-simulator-versus-testing-on-hardware-devices)
- [Apple developer membership comparison](https://developer.apple.com/support/compare-memberships/)

## Existing application truth

- [Fastify server and trust boundary](../../src/server.ts)
- [API route modules](../../src/api)
- [Database schema](../../src/db/schema.ts)
- [Electron process and packaged server lifecycle](../../electron/main.ts)
- [Desktop dashboard behavior](../../dashboard/src)
- [App icon master](../../electron/icons/icon-master.png)

When a mockup and live product behavior disagree, log the decision in [Decisions](../Documentation/DECISIONS.md) before changing either implementation.
