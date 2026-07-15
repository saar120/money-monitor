import XCTest

@MainActor
final class MoneyMonitorUITests: XCTestCase {
    func testLaunchShowsConnectScreen() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Connect to your Mac"].waitForExistence(timeout: 3))
    }
}

