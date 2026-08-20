import Foundation
import Testing
@testable import MoneyMonitor

private final class HomeOverviewFixtureBundleToken: NSObject {}

struct HomeOverviewPresentationTests {
    @Test
    func canonicalEnvelopeBuildsAccessiblePresentationAndPreservesMissingValues() throws {
        let envelope = try CanonicalHomeOverviewDecoder.decode(Data(#"""
        {
          "data": {
            "financialDate": "2026-08-20",
            "calculatedAt": "2026-08-20T10:00:00.000Z",
            "baseCurrencyCode": "ILS",
            "availableMoney": null,
            "spending": {
              "current": { "amount": { "value": "1200.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-08-01", "endDate": "2026-08-20" } },
              "comparison": { "amount": { "value": "900.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-07-01", "endDate": "2026-07-20" } },
              "change": { "value": "300.00", "currencyCode": "ILS" }
            },
            "budget": null,
            "netWorth": { "total": null, "liquid": null },
            "categories": [{
              "label": "Food",
              "amount": { "value": "1200.00", "currencyCode": "ILS" },
              "share": 1,
              "transactionCount": 2,
              "textSummary": "Food: ₪1,200.00 (100% of spending), 2 transactions",
              "drillDown": { "category": "Food", "startDate": "2026-08-01", "endDate": "2026-08-20" }
            }],
            "cashFlow": [{
              "period": { "startDate": "2026-08-01", "endDate": "2026-08-20" },
              "income": { "value": "5000.00", "currencyCode": "ILS" },
              "expenses": { "value": "1200.00", "currencyCode": "ILS" },
              "net": { "value": "3800.00", "currencyCode": "ILS" },
              "textSummary": "Aug 2026: income ₪5,000.00, expenses ₪1,200.00, net ₪3,800.00",
              "drillDown": { "category": null, "startDate": "2026-08-01", "endDate": "2026-08-20" }
            }],
            "accountFreshness": [{ "displayName": "Checking", "status": "stale", "lastSuccessfulSyncAt": "2026-08-19T10:00:00.000Z" }],
            "isEmpty": false
          },
          "meta": {
            "apiVersion": "1",
            "generatedAt": "2026-08-20T10:00:00.000Z",
            "source": "mac-authoritative",
            "calculationVersion": "home-overview-1",
            "completeness": "partial",
            "estimated": false,
            "missingSections": ["availableMoney", "netWorth"]
          }
        }
        """#.utf8))

        let presentation = try HomeOverviewPresentationBuilder(
            locale: Locale(identifier: "en_US")
        ).makePresentation(from: envelope)

        #expect(presentation.availableMoney == nil)
        #expect(presentation.netWorth.total == nil)
        #expect(presentation.currentSpending.value == Decimal(string: "1200.00"))
        #expect(presentation.categories.first?.textSummary.contains("Food") == true)
        #expect(presentation.categories.first?.amount.value == Decimal(string: "1200.00"))
        #expect(presentation.categories.first?.drillDown.startDate == "2026-08-01")
        #expect(presentation.cashFlow.first?.textSummary.contains("income") == true)
        #expect(presentation.cashFlow.first?.net.value == Decimal(string: "3800.00"))
        #expect(presentation.accountFreshness.first?.status == "stale")
        #expect(presentation.completeness == "partial")
    }

    @Test
    func acceptedHomeProjectionSurvivesSavedViewSnapshotEncoding() throws {
        let envelope = try CanonicalHomeOverviewDecoder.decode(Data(#"""
        {
          "data": {
            "financialDate": "2026-08-20", "calculatedAt": "2026-08-20T10:00:00Z", "baseCurrencyCode": "ILS",
            "availableMoney": { "value": "8200.00", "currencyCode": "ILS" },
            "spending": {
              "current": { "amount": { "value": "1200.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-08-01", "endDate": "2026-08-20" } },
              "comparison": { "amount": { "value": "900.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-07-01", "endDate": "2026-07-20" } },
              "change": { "value": "300.00", "currencyCode": "ILS" }
            },
            "budget": null, "netWorth": { "total": null, "liquid": null }, "categories": [], "cashFlow": [], "accountFreshness": [], "isEmpty": false
          },
          "meta": { "apiVersion": "1", "generatedAt": "2026-08-20T10:00:00Z", "source": "mac-authoritative", "calculationVersion": "home-overview-1", "completeness": "complete", "estimated": false, "missingSections": [] }
        }
        """#.utf8))
        let bootstrapURL = Bundle(for: HomeOverviewFixtureBundleToken.self).url(
            forResource: "bootstrap-complete", withExtension: "json", subdirectory: "MobileBootstrap"
        )!
        let bootstrap = try BootstrapPayloadDecoder().decodeSuccess(from: Data(contentsOf: bootstrapURL))

        let encoder = JSONEncoder()
        let snapshot = BootstrapSnapshot(
            bootstrap: bootstrap,
            homeOverview: envelope,
            savedAt: Date(timeIntervalSince1970: 1_755_672_000)
        )
        let restored = try JSONDecoder().decode(BootstrapSnapshot.self, from: encoder.encode(snapshot))
        #expect(restored.homeOverview == envelope)
        #expect(restored.bootstrap.meta.server.id == bootstrap.meta.server.id)

        var legacyObject = try #require(
            JSONSerialization.jsonObject(with: encoder.encode(snapshot)) as? [String: Any]
        )
        legacyObject.removeValue(forKey: "homeOverview")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)
        let legacySnapshot = try JSONDecoder().decode(BootstrapSnapshot.self, from: legacyData)
        #expect(legacySnapshot.homeOverview == nil)
    }
}

func acceptedHomeOverviewFixture() throws -> CanonicalHomeOverviewEnvelope {
    try CanonicalHomeOverviewDecoder.decode(Data(#"""
    {
      "data": {
        "financialDate": "2026-08-20", "calculatedAt": "2026-08-20T10:00:00Z", "baseCurrencyCode": "ILS",
        "availableMoney": { "value": "8200.00", "currencyCode": "ILS" },
        "spending": {
          "current": { "amount": { "value": "1200.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-08-01", "endDate": "2026-08-20" } },
          "comparison": { "amount": { "value": "900.00", "currencyCode": "ILS" }, "period": { "startDate": "2026-07-01", "endDate": "2026-07-20" } },
          "change": { "value": "300.00", "currencyCode": "ILS" }
        },
        "budget": null, "netWorth": { "total": null, "liquid": null }, "categories": [], "cashFlow": [], "accountFreshness": [], "isEmpty": false
      },
      "meta": { "apiVersion": "1", "generatedAt": "2026-08-20T10:00:00Z", "source": "mac-authoritative", "calculationVersion": "home-overview-1", "completeness": "complete", "estimated": false, "missingSections": [] }
    }
    """#.utf8))
}

func alternateHomeOverviewFixture() throws -> CanonicalHomeOverviewEnvelope {
    let original = try acceptedHomeOverviewFixture()
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let encoded = try encoder.encode(original)
    let shifted = String(decoding: encoded, as: UTF8.self)
        .replacingOccurrences(of: "2026-08-20", with: "2026-08-21")
        .replacingOccurrences(of: "10:00:00.000Z", with: "11:00:00.000Z")
    return try CanonicalHomeOverviewDecoder.decode(Data(shifted.utf8))
}
