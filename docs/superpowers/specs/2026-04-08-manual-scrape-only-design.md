# Manual Scrape Only — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Problem

Some accounts fail in headless scraping mode and can only be scraped manually via the browser UI. Currently, the scheduled scraper picks up all active accounts indiscriminately, causing repeated failures for these accounts. Users need a way to exclude specific accounts from automated scraping while still being reminded when those accounts become stale.

## Solution

Add a `manualScrapeOnly` flag and a per-account `stalenessDays` threshold to each account. The scheduled scraper skips manual-only accounts. After each scrape session, the post-scrape alert system checks manual-only accounts for staleness and includes reminders in the Telegram alert when any exceed their threshold.

## Data Layer

Two new columns on the `accounts` table:

| Column             | SQLite column        | Type              | Default | Notes                                          |
| ------------------ | -------------------- | ----------------- | ------- | ---------------------------------------------- |
| `manualScrapeOnly` | `manual_scrape_only` | integer (boolean) | `false` | Scheduled scrapes skip this account            |
| `stalenessDays`    | `staleness_days`     | integer           | `null`  | Days before staleness alert. `null` = no alert |

Migration: standard drizzle-kit generated migration adding both columns with defaults.

### Constraints

- `stalenessDays` must be >= 1 when set (enforced in API validation, not DB constraint)
- `manualScrapeOnly` and `isActive` are independent: a manual-only account is still "active" (visible in UI, can be scraped manually). Setting `isActive = false` disables everything including staleness alerts.

## Scheduler Changes

**File:** `src/scraper/session-manager.ts` — `getUniqueActiveAccounts()`

Add a second WHERE clause:

```
WHERE is_active = true AND manual_scrape_only = false
```

This affects both the cron-triggered scrape and the missed-scrape catch-up. Single-account scrapes via the API are unaffected (they bypass `getUniqueActiveAccounts()` entirely).

## Post-Scrape Staleness Check

**File:** `src/telegram/alerts.ts` — called from `runPostScrapeAlerts()`

After each scheduled or manual scrape session completes:

1. Query all accounts where `manualScrapeOnly = true` AND `stalenessDays IS NOT NULL` AND `isActive = true`
2. For each, compute days since `lastScrapedAt` (accounts never scraped are treated as infinitely stale)
3. Filter to those where elapsed days > `stalenessDays`
4. Pass the stale accounts list into `buildPostScrapeUserMessage()` as a new `<stale-manual-accounts>` section

Example section in the user message to the alert agent:

```xml
<stale-manual-accounts>
The following accounts are marked "manual scrape only" and have exceeded their staleness threshold:
- "Isracard" (id: 5) — last scraped 12 days ago (threshold: 7 days)
- "Amex" (id: 8) — never scraped (threshold: 7 days)

Remind the user to manually scrape these accounts.
</stale-manual-accounts>
```

If no accounts are stale, this section reads `none`.

### Disabling staleness alerts

- Setting `stalenessDays` to `null` (clearing the input) disables alerts for that specific account
- The user can also disable all post-scrape alerts via the existing `enabled` master switch in AlertSettings

## API Changes

**File:** `src/api/validation.ts` — `updateAccountSchema`

Add to the accepted fields:

- `manualScrapeOnly`: optional boolean
- `stalenessDays`: optional, either a positive integer (min 1) or `null`

**File:** `src/api/accounts.routes.ts` — `PUT /api/accounts/:id`

Include the new fields in the partial update set (same pattern as existing `isActive`, `manualLogin`, `showBrowser`).

## Frontend Changes

### Account Interface

**File:** `dashboard/src/api/client.ts` — `Account` interface

Add:

```ts
manualScrapeOnly: boolean;
stalenessDays: number | null;
```

### Account Card UI

**File:** `dashboard/src/components/AccountManager.vue`

On each account card, add:

1. A **"Manual scrape only"** `Switch` toggle — always visible, follows the same pattern as the existing `manualLogin` toggle
2. When `manualScrapeOnly` is `true`, show a **staleness threshold** row below it with a number `Input` (placeholder: "No alert", min 1). Clearing the input sets `stalenessDays = null`.

Both controls call `patchAccount()` on change, same as existing toggles.

## What stays unchanged

- Single-account manual scrape ("scrape now" button) works for manual-only accounts — no change
- `isActive = false` completely disables an account (no scraping, no staleness alerts, no visibility in scrape selection)
- `manualLogin` flag (show browser for interactive login) is a separate concern and unrelated
- Alert settings (`alert-settings.json`) are not modified — staleness is per-account, not global
- Monthly summary is unaffected

## Edge Cases

- **Account toggled to manual-only mid-session:** If a scrape session is already running when the flag is set, the account continues scraping in that session. The flag only affects future session account selection.
- **Never-scraped manual-only account:** `lastScrapedAt` is null, treated as infinitely stale. If `stalenessDays` is set, the alert fires immediately on the next post-scrape check.
- **All accounts are manual-only:** Scheduled scrape runs with zero accounts, session completes immediately, post-scrape alerts still fire (checking staleness).
