# Product scope

The canonical product definition is [`docs/ios-mockups/PRODUCT.md`](../../docs/ios-mockups/PRODUCT.md). This document translates it into implementation scope for the Xcode project.

## Product promise

Give the maintainer and a small trusted circle of family and friends a fast, calm, and private iPhone view without moving bank credentials, scraping, or authoritative storage off the Mac.

The app succeeds when a person can:

- understand their current financial position in seconds;
- find a transaction in under a minute;
- see whether information is live, cached, stale, or unavailable;
- review a budget or net-worth movement without opening the Mac;
- ask a focused Advisor question when the Mac and AI provider are available.

## Primary jobs

1. Check the daily financial picture.
2. Find and understand recent activity.
3. Review budgets and net worth.
4. See account freshness and sync status.
5. Use Advisor with clear data-freshness and action boundaries.

## Trust boundary

| Mac owns | iPhone may hold |
| --- | --- |
| Bank and institution credentials | A revocable, device-scoped API token in Keychain |
| Scraper and browser automation | A private Tailscale HTTPS address |
| Authoritative SQLite database | An encrypted, timestamped read-model snapshot |
| Credential encryption keys | Face ID preference and non-sensitive UI preferences |
| Full desktop administration API | Mobile-safe DTOs and explicitly allowed commands |

## Initial scope

- Native SwiftUI app for iOS 18 and later.
- iPhone-only, portrait-first layouts with functional landscape.
- Private connection to a paired Mac over Tailscale HTTPS.
- One paired Mac per phone; many individually approved and revocable phones per Mac, with no roles or cloud accounts.
- Read-only financial experience first.
- Light and Dark Mode from semantic tokens.
- Dynamic Type, VoiceOver, Bold Text, Increased Contrast, Reduce Transparency, and Reduce Motion.
- Hebrew merchant names and mixed-direction financial content inside the English UI.

## Explicitly out of scope for the self-use plan

- Cloud-hosted data or scraper execution.
- Bank login or credential entry on iPhone.
- Offline mutation queues.
- Household permissions and simultaneous multi-Mac profiles.
- APNs/native iPhone notifications; existing Telegram alerts remain Mac-owned.
- App Store distribution, iPad optimization, and full UI localization.
- Destructive or administrative desktop operations from iPhone.

The production identity and private distribution lane are now locked in [Locked product policy](LOCKED_PRODUCT_POLICY.md): direct Xcode development, private TestFlight for family/friends, and no App Store. Reintroducing any out-of-scope item requires a superseding product decision.

## Mutation rule

The approved screens imply edits to transactions, budgets, categories, alerts, assets, accounts, and sync. Those actions are not automatically authorized by the mobile product promise. Each command needs a product decision, scoped server capability, confirmation behavior, audit event, and offline rule before implementation.
