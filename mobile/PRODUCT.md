# Money Monitor for iPhone

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Stack

Expo, React Native, TypeScript, and Expo Router. The application is optimized only for iPhone in this foundation.

## Users

The primary user is the owner of a private personal-finance system. They use the iPhone for frequent, glanceable awareness and transaction review while the Mac remains the trusted machine that owns data and administration.

## Product Purpose

Money Monitor makes the user's current financial state understandable in five seconds, turns transaction cleanup into a fast inbox-zero workflow, and lets curiosity flow from a change to its cause and then to the underlying transactions.

## Product Model

- **At a glance — Home:** spending, income, pace, budget health, and only the changes or problems that deserve attention.
- **Review — focused workflow:** one transaction at a time, with quick category, owner, inclusion, and confirmation actions. Review is launched from Home or Activity rather than occupying a permanent tab.
- **Explore — answer why:** period comparison → category change → merchant contribution → actual transactions, plus explorable net worth when the Mac has supporting history.

The root navigation is Home, Activity, and Explore. The future advisor is contextual rather than a permanent destination.

## Positioning

The iPhone is a deliberately thin, private client of the owner's Mac: financial data, calculations, scraping, AI, credentials, and machine administration remain authoritative on the Mac and are exposed only through its existing Tailscale Serve HTTPS boundary.

## Operating Context

- Frequent iPhone checks of current-month finances and transaction activity.
- Mixed Hebrew and English merchant data, mixed text direction, credits and debits, pending items, and transactions needing review.
- A separate, occasional physical-iPhone pairing/connectivity flow with a Mac on the same Tailnet.
- Fast deterministic regression checks must run without a Mac, Tailnet, credentials, or internet.

## Capabilities and Constraints

- Three root tabs: Home, Activity, and Explore.
- Home leads with comparative financial state, not a grid of permanent dashboard cards.
- Activity includes search, useful filters, transaction detail, and entry into Review.
- Review supports narrowly scoped mobile writes while the Mac remains authoritative.
- Explore progressively discloses spending pace, category/merchant explanations, transactions, and net-worth history.
- Device authentication gates financial content where supported.
- Pairing credentials use iOS-appropriate secure storage.
- Sensitive app-switcher snapshots are protected as reliably as Expo permits.
- The QR scanner checks health, completes the existing approval/exchange protocol, and stores the resulting device credential.
- The iPhone never manages Tailscale, changes the Mac binding, weakens TLS, or invents a pairing protocol.
- Fixture and live-Mac modes exercise the same screen logic over authenticated private HTTPS.

## Brand Commitments

- Product name: Money Monitor.
- Voice: calm, direct, private, and precise.
- Financial information density and scanability outrank decorative dashboard chrome.
- Native iPhone conventions, dark mode, and accessible interaction are required.
- Green is reserved for positive state and interaction; amber and red appear only when attention is warranted.

## Evidence on Hand

- The reference branch `saar120/saa-17-rebaseline-the-accepted-phase-zero-foundation` contains the accepted Mac mobile-access implementation.
- The Mac's pairing QR is a versioned JSON payload with `kind: money-monitor-pairing` and a private HTTPS `baseURL`.
- The existing health route is `GET /api/mobile/v1/health` beneath the Tailscale Serve base URL.
- No production mobile API data is required for deterministic fixture tests.

## Product Principles

- Keep the Mac authoritative and the iPhone understandable as a client.
- Prefer production-quality feature code over reusable machinery for hypothetical features.
- Show financial hierarchy through typography, spacing, and restrained grouping.
- Keep fixture-driven product tests deterministic and independent of private networking.
- Preserve the direct upgrade path from fixtures to real APIs and from QR health check to pairing.

## Accessibility & Inclusion

Support iOS Dynamic Type and VoiceOver semantics, 44-point touch targets, dark mode, reduced-motion expectations, and mixed Hebrew/English content without assuming one text direction for every merchant or label.
