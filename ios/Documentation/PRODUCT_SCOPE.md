# Product scope

The canonical product definition is [`docs/ios-mockups/PRODUCT.md`](../../docs/ios-mockups/PRODUCT.md). This document translates it into implementation scope for the Xcode project.

## Product promise

Give an existing Money Monitor owner a fast, calm, and private view of their finances on iPhone without moving bank credentials, scraping, or authoritative storage off the Mac.

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
- iPhone-first layouts with iPad and landscape resilience.
- Private connection to a paired Mac over Tailscale HTTPS.
- Read-only financial experience first.
- Light and Dark Mode from semantic tokens.
- Dynamic Type, VoiceOver, Bold Text, Increased Contrast, Reduce Transparency, and Reduce Motion.
- Hebrew merchant names and mixed right-to-left content inside the otherwise localized layout.

## Deferred until explicitly specified

- Cloud-hosted data or scraper execution.
- Bank login or credential entry on iPhone.
- Offline mutation queues.
- Household permissions and multi-Mac switching.
- Push notification delivery architecture.
- App Store distribution and production bundle identity.
- Destructive or administrative desktop operations from iPhone.

## Mutation rule

The approved screens imply edits to transactions, budgets, categories, alerts, assets, accounts, and sync. Those actions are not automatically authorized by the mobile product promise. Each command needs a product decision, scoped server capability, confirmation behavior, audit event, and offline rule before implementation.

