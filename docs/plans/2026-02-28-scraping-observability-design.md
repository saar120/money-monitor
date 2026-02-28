# Scraping Observability & Management

## Problem

Scrapes run without visibility — no way to see what's running, what finished, or cancel a stuck scrape. The logs page should become the central hub for scrape management and observability.

## Design

### Database Changes

**New `scrapeSessions` table:**

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | Auto-increment |
| trigger | text | `manual` / `scheduled` / `single` |
| status | text | `running` / `completed` / `cancelled` / `error` |
| accountIds | text | JSON array of target account IDs |
| startedAt | text | ISO timestamp |
| completedAt | text | ISO timestamp, null while running |

**`scrapeLogs` table additions:**

| Column | Type | Notes |
|--------|------|-------|
| sessionId | integer FK | References `scrapeSessions.id` |
| transactionsNew | integer | New (non-duplicate) transactions inserted |
| durationMs | integer | Scrape duration in milliseconds |

### Backend — Background Scrapes + Cancel

- `POST /api/scrape/all` and `POST /api/scrape/:accountId` return immediately with `{ sessionId }` (202 Accepted)
- Scraping runs as a background Promise (IO-bound, no need for worker threads)
- Active sessions tracked in `Map<sessionId, { abortController, session }>` in memory
- `POST /api/scrape/cancel/:sessionId` — sets status to `cancelled`, aborts the scraper
- Scheduler creates sessions with trigger `scheduled`

### SSE Events (Enhanced)

| Event | Payload |
|-------|---------|
| `session-started` | `{ sessionId, accountIds, trigger }` |
| `account-scrape-started` | `{ sessionId, accountId }` |
| `account-scrape-done` | `{ sessionId, accountId, transactionsFound, transactionsNew, durationMs }` |
| `account-scrape-error` | `{ sessionId, accountId, error, errorType }` |
| `session-completed` | `{ sessionId, status, summary }` |
| `otp-required` | existing + `sessionId` |
| `manual-action-required` | existing + `sessionId` |

### New API Endpoints

- `GET /api/scrape/sessions` — list sessions with pagination (newest first)
- `GET /api/scrape/sessions/:id` — session detail with per-account logs
- `POST /api/scrape/cancel/:sessionId` — cancel active session

### Frontend — `/scraping` Route

**Page layout:**
1. Header with "Scrape All" button + per-account scrape dropdown
2. Active session banner (live via SSE) — per-account status indicators, elapsed time, Cancel button
3. Session history list — expandable rows with trigger type, timestamp, success/error summary, per-account details

**Per-account status indicators:** queued / scraping / done / failed with transaction counts and duration.
