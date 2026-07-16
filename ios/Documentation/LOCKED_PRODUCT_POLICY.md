# Locked product policy

Status: **Accepted baseline**
Accepted: **2026-07-16**
Audience: **the maintainer and a small trusted circle of family and friends**

This file is the canonical product-policy baseline for the native iOS plan. It intentionally optimizes for a privately operated, self-use product rather than a public financial platform. Decisions D-020 through D-026 in [the decision log](DECISIONS.md) adopt this policy and supersede earlier sole-owner delivery limits where noted.

## Product boundary

- The Mac app and its local SQLite database remain authoritative.
- Bank credentials, scraper/browser automation, provider keys, and full administration stay on the Mac.
- Each iPhone installation pairs to exactly one Mac at a time over private Tailscale HTTPS.
- One Mac may approve many phones. Every phone is individually named, authenticated, auditable, and revocable.
- Approved people are a trusted circle with the same product surface. There are no accounts, household roles, per-person account filters, invitations, or cloud identity.
- Switching Macs requires Disconnect followed by a fresh pairing. No data is merged across Macs.
- The app remains useful without cloud infrastructure, push delivery, remote analytics, or a public service.

## Device protection, offline data, and phone replacement

### App lock

- Device-owner authentication is mandatory once financial snapshots are stored.
- Use the system Face ID/Touch ID flow with device-passcode fallback; there is no app-specific PIN.
- Authenticate on cold launch, after device reboot, after protected-data loss, and after more than two minutes in the background.
- Returning within two minutes may reuse the unlocked session. The app-switcher cover remains immediate regardless of grace.
- There is no permanent “Not now” option after cached financial data is enabled.

### Snapshot and freshness policy

- Store only the latest complete, validated snapshot for the paired Mac; it is replaceable and never authoritative.
- Encrypt it with a device-only key, apply complete file protection, and exclude it from device/iCloud backups.
- Retain it for at most 30 days. After that, remove it and require a live refresh.
- A successful current request is **Live**. An unreachable Mac with a valid snapshot is **Saved**. A snapshot older than 24 hours is additionally **Stale**.
- Every saved or stale surface shows the Mac calculation timestamp. Request completion time never substitutes for calculation time.
- Partial or malformed refreshes cannot replace the last complete snapshot.

### Wipe and recovery behavior

- Explicit Disconnect wipes the paired credential, snapshot, search/navigation state, and cached Advisor transcripts.
- A confirmed server-identity change, missing encryption key, unreadable snapshot, or discovered remote revocation wipes local financial data and requires pairing again.
- Remote revocation cannot erase an offline phone. Until reconnection, the existing snapshot remains protected by device authentication; it is wiped when revocation is discovered.
- App deletion/reinstall starts clean. No token, key, cache, or app state migrates through backup.
- A replacement phone pairs as a new device. The old device is revoked separately from the Mac. No phone-to-phone transfer flow is required.

## Everyday money semantics

### Home metrics

- Home’s **Available money** uses the existing Mac `liquidTotal` definition: active bank balances plus assets explicitly marked liquid minus all active liabilities.
- Available money is expressed in ILS. Credit-card transaction totals are not treated as card debt unless the Mac models that debt as a liability.
- If a required balance, liability, or currency conversion is missing, the metric is unavailable or partial; missing values are never replaced with zero.
- Net worth remains separate: active bank balances plus converted active assets minus converted active liabilities.

### Cash flow, dates, comparisons, and signs

- Current income and spending cover calendar month-to-date through today in `Asia/Jerusalem`; future-dated installments are excluded.
- The comparison covers the same elapsed calendar days in the previous month, truncated to that month’s final day.
- Comparison means current value minus comparison value. The UI states both date ranges.
- Positive settled transactions count as income. Negative settled transactions count as spending by absolute magnitude. Ignored rows and explicit Transfer-category rows count in neither.
- Refunds remain positive credits in v1; there is no automatic refund-to-purchase matching or historical budget netting.
- ILS is the base currency. The Mac performs every conversion and returns the rate timestamp; the iPhone never converts values. Missing conversion makes the affected aggregate partial/unavailable.

### Transfers and transaction browsing

- A transfer is a transaction explicitly categorized as `Transfer`; the app does not infer or link transfer pairs.
- Transfer rows remain separate in Activity because the current database has no durable pair identity.
- Transfer rows are excluded from income, spending, comparisons, and budgets, but remain searchable and visible.
- Full Phase 2 adds multi-select category and owner filters plus `All / Exclude transfers / Transfers only`.
- Hide the owner filter when only one owner value exists.
- Newest-first remains the only transaction sort.
- Search recents are out of scope; queries and filters are not persisted across relaunch.

## Planning, wealth, accounts, and sync

### Budgets

- Support the existing monthly and yearly category budgets only.
- The active period runs through today; completed historical periods use their full month or year.
- Spending is settled negative, non-ignored, non-transfer activity in the budget’s categories. Positive credits do not reduce budget spend in v1.
- Exactly at the limit is **At limit**; only values above the limit are **Over budget**.
- Monthly pace uses elapsed days. Yearly pace uses completed/current months against the annual amount.
- Overlapping budgets remain independent and may count the same transaction. Do not add them into one “total remaining” metric; Home shows a single pulse only when one unambiguous active budget exists.

### Wealth and currency

- ILS is the base currency. The Mac owns valuation and exchange-rate retrieval.
- Net-worth detail offers 3M, 6M, 1Y, and All, with 1Y as default; the server chooses safe point granularity.
- Historical values that reuse current liabilities or rates are labeled **Estimated** until historical snapshots exist.
- Detail preserves original currency/value and the conversion timestamp.
- A rate older than 72 hours is visibly stale but may still be shown. A missing rate makes the affected aggregate partial; it never converts to zero.
- Liquidity and linked-liability relationships come only from explicit Mac fields. Net equity is asset value minus an explicitly linked liability.

### Accounts and sync

- Account identity is institution, account type/display name, and server-masked last four characters. Full account numbers never enter the mobile DTO.
- Bank accounts may show **Balance**. Credit-card accounts show identity and freshness only until the Mac has a trustworthy amount-due model; the phone does not derive debt from transaction rows.
- Public sync states are `neverRun`, `queued`, `running`, `completed`, `partial`, `attentionNeeded`, `cancelled`, and `failed`.
- Raw provider errors, selectors, paths, credentials, OTPs, and manual-login controls remain Mac-only.

## Mobile commands

Commands are a later live-only phase, but their scope is no longer a product blocker. Every approved trusted device receives the same accepted command surface; there is no role editor.

### Accepted command allowlist

- Resolve or skip one review item.
- Change a transaction’s category, owner, or report-exclusion state.
- Create, update, or delete a budget.
- Create, rename, reorder, or delete categories after the category schema below exists.
- Change supported Mac-owned Telegram alert preferences.
- Request a single-account or all-account sync on the Mac.

### Command rules

- Commands require a live Mac connection and never queue offline.
- Each verb has its own capability, allowlisted payload, idempotency key, expected-version/conflict behavior, and redacted Mac audit event.
- Reversible edits use explicit Save without an extra warning. Budget/category deletion requires destructive confirmation.
- A timeout after submission is an unknown outcome; retrying the same idempotency key reconciles rather than executing twice.
- Sync duplicate-start returns **Already running**. Sync cancellation is out of scope for v1. OTP/manual attention is completed on the Mac.

### Category identity

- Categories use an immutable opaque ID and an editable display label.
- Labels are case-insensitively unique and have explicit user-controlled order.
- An unused category may be deleted directly. A used category requires choosing a replacement; transactions are never orphaned or silently reclassified.

### Commands that remain Mac-only

- Add/delete bank accounts, credential or OTP entry, provider settings, and destructive maintenance.
- Asset, holding, movement, or liability edits.
- Household administration, AI keys, transaction notes, and recurring flags.
- Offline command queues.

## Advisor

- Mobile Advisor v1 is strictly read-only and uses a deny-by-default read-tool registry.
- It may read transaction summaries/search, recurring patterns, masked account freshness, categories, budgets, net worth/assets/liabilities, Telegram alert settings, and safe sync summaries.
- It cannot write financial data, settings, files, or AI memory.
- The Mac owns the configured AI provider and provider credential. Before first use on each phone, disclose that relevant financial context is sent from the Mac to that configured provider.
- Never send bank credentials, full account identifiers, provider keys, scraper internals, or arbitrary database rows.
- Each answer states the source calculation time and relevant period/sample when meaningful.
- Conversations are private to the device that created them. The Mac is authoritative; the phone may retain an encrypted 30-day transcript cache that is wiped on Disconnect.
- Offline transcripts are readable, but the composer is disabled.
- A future Advisor may propose a structured Phase 4 command; the ordinary command UI performs confirmation. The model never receives direct write authority.

## Distribution, identity, and compatibility

- Development uses direct Xcode installation. Family and friends receive private email invitations through TestFlight when an Apple Developer Program distribution account is available.
- App Store publication is out of scope.
- Apple team: `CVP2NVLKL4`.
- Organization identifier: `com.saaramrani`.
- Production bundle identifier: `com.saaramrani.moneymonitor`.
- Display name: `Money Monitor`.
- CI owns monotonically increasing build numbers; marketing versions are set per private release.
- Minimum iOS version is iOS 18. The product is iPhone-only and portrait-first; landscape must remain functional. iPad optimization is out of scope.
- UI ships in English with correct mixed Hebrew/English and bidirectional financial content. Full Hebrew UI localization is out of scope for the private release.
- Support only the current pairing/mobile API contract. On mismatch, return the explicit upgrade screen and update the older Mac or iPhone app; there is no previous-version compatibility promise or migration matrix for private use.
- Preserve Keychain pairing and compatible snapshots across ordinary app updates. A breaking contract/cache change may require a documented re-pair; it must never silently decode incompatible data.
- The first private TestFlight feature set is the read-only product through Phase 3. Commands and Advisor ship later as independently tested additions.

## Privacy and support operations

- Keep the app-switcher cover. Intentional screenshots are allowed; no custom screenshot-prevention system is required.
- Money Monitor sends no native iPhone push notifications. Telegram alerts stay Mac-owned.
- No cloud analytics or third-party crash/telemetry SDK is required. Apple/TestFlight aggregate crash diagnostics may be used for the private beta.
- Diagnostic export is explicit, local, previewable, and redacted; it excludes financial payloads, search/Advisor content, tokens, private URLs, paths, and account numbers.
- Clipboard use requires an explicit user action.
- Private testers contact the maintainer directly; a public support site, public privacy policy, store metadata, and public rollback program are out of scope until an App Store decision supersedes this policy.

## Explicitly out of scope

- Cloud-hosted Money Monitor data, scraping, identity, or transport.
- Household roles, invitations, per-person permissions, or account sharing rules.
- Simultaneous multi-Mac profiles or data merging on one phone.
- APNs/native push delivery.
- Offline mutations.
- App Store distribution, iPad optimization, and full UI localization.
- Bank login, credentials, OTP, or scraper controls on iPhone.

These exclusions are decisions, not unresolved questions. Reintroducing one requires a superseding decision with a concrete use case.

## Delivery order

### Now

- Record Phase 2B as accepted from the completed physical validation.
- Resume Phase 1 with the locked app-lock, cache, freshness, wipe, and replacement-phone policies.

### Next

- Complete full Phase 2 finance semantics, transfer exclusion, category/owner filters, and offline repositories.
- Build Phase 3 read-only budgets, wealth, accounts, and sync history.
- Harden the read-only product for private TestFlight family/friend testing.

### Later

- Add the accepted Phase 4 command allowlist.
- Add the read-only Phase 5 Advisor.

### Won't build under this plan

- Roles, cloud, push, multi-Mac profiles, App Store, iPad, full localization, or offline writes.
