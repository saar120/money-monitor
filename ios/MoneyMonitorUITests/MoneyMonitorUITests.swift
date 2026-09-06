import XCTest

@MainActor
final class MoneyMonitorUITests: XCTestCase {
    private func transactionRow(_ id: Int) -> String {
        "transaction-row-transaction_\(String(format: "%022d", id))"
    }

    func testLaunchShowsConnectScreen() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Connect to your Mac"].waitForExistence(timeout: 3))
    }

    func testActivityBrowsePaginationRetrySearchAndSavedEmptyState() {
        let app = XCUIApplication()
        let activityRunID = UUID().uuidString
        app.launchEnvironment["UITEST_ACTIVITY_RUN_ID"] = activityRunID
        app.launchArguments.append("--ui-testing-activity")
        app.launch()

        app.tabBars.buttons["Activity"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["transaction-list"].waitForExistence(timeout: 3))

        let retry = app.descendants(matching: .any)["transaction-append-retry"]
        for _ in 0 ..< 12 where !retry.exists {
            app.swipeUp()
        }
        XCTAssertTrue(retry.waitForExistence(timeout: 3))
        app.buttons["Retry loading more"].tap()
        let finalRow = app.descendants(matching: .any)[transactionRow(1)]
        for _ in 0 ..< 5 where !finalRow.exists {
            app.swipeUp()
        }
        XCTAssertTrue(finalRow.waitForExistence(timeout: 3))

        app.tabBars.buttons["Search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("Coffee")
        XCTAssertTrue(app.descendants(matching: .any)[transactionRow(100)].waitForExistence(timeout: 3))

        search.buttons["Clear text"].tap()
        search.typeText("No Match")
        XCTAssertTrue(app.staticTexts["No results"].waitForExistence(timeout: 3))

        app.terminate()
        app.launchArguments = ["--ui-testing-saved-activity"]
        app.launch()
        let unlock = app.buttons["unlock-financial-content"]
        XCTAssertTrue(unlock.waitForExistence(timeout: 5))
        unlock.tap()
        app.tabBars.buttons["Activity"].tap()
        XCTAssertTrue(app.descendants(matching: .any)[transactionRow(100)].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@",
            "Older history requires Live"
        )).firstMatch.exists)

        app.tabBars.buttons["Search"].tap()
        let savedSearch = app.searchFields.firstMatch
        XCTAssertTrue(savedSearch.waitForExistence(timeout: 3))
        savedSearch.tap()
        savedSearch.typeText("No Match")
        XCTAssertTrue(app.staticTexts["No results"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@",
            "Saved results"
        )).firstMatch.exists)
    }
}
