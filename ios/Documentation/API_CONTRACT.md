# Mobile API contract

This document separates the implemented mobile v1 boundary from later financial DTOs. The existing desktop API remains useful for service reuse and local development, but it is not a safe or stable Swift DTO boundary.

## Existing connectivity checkpoint

`GET /api/mobile/v1/health` is implemented on the isolated loopback mobile server and intentionally exempt from device authentication.

```json
{
  "data": { "status": "ok" },
  "meta": {
    "apiVersion": "1",
    "generatedAt": "2026-07-14T12:00:00.000Z",
    "source": "live"
  }
}
```

The Swift client decodes this response through the Money Monitor-owned Tailscale base path. The packaged Mac composition now also registers the three public pairing endpoints and authenticated bootstrap route against the allow-listed production adapter. It never registers desktop routes on this listener. Every mobile response includes `Cache-Control: no-store`, and the iOS clients use an ephemeral URLSession with request-level cache bypass so pairing and financial payloads do not enter shared HTTP caches.

## Existing desktop API inventory

| Mobile area | Existing endpoint(s)                                | Important caveat                                                                                                                                  |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts    | `GET /api/accounts`                                 | Credentials reference is removed, but the response remains database-shaped and includes account configuration fields and unmasked account number. |
| Activity    | `GET /api/transactions`                             | Rich filtering and pagination exist; rows contain internal fields that should not become Swift DTOs.                                              |
| Review      | `GET /api/transactions/needs-review/count`          | Count only; review mutations use full desktop authorization.                                                                                      |
| Spending    | `GET /api/transactions/summary`                     | Response shape changes with `groupBy`.                                                                                                            |
| Budgets     | `GET /api/budgets`, `GET /api/budgets/progress`     | List and progress shapes use different envelopes.                                                                                                 |
| Net worth   | `GET /api/net-worth`, `GET /api/net-worth/history`  | Useful service seam; needs normalized money and date types.                                                                                       |
| Assets      | `GET /api/assets`, `GET /api/assets/:id`, snapshots | Lists are bare arrays rather than a common envelope.                                                                                              |
| Liabilities | `GET /api/liabilities`                              | Bare array with calculated fields.                                                                                                                |
| Categories  | `GET /api/categories`                               | Read shape is simple; edits are not in initial mobile scope.                                                                                      |
| Alerts      | `GET /api/alerts/settings`                          | Settings exist, but there is no alert feed/history endpoint.                                                                                      |
| Advisor     | session routes and `POST /api/ai/chat` SSE          | Current Advisor tools can mutate data; a read-only allowlist or confirmation policy is required.                                                  |
| Sync        | scrape routes and logs                              | These are operational desktop commands, not a mobile-safe sync contract.                                                                          |

All protected desktop routes currently share one bearer token. That token can authorize account deletion, settings changes, scraping, and other administrative operations, so it must never be provisioned to the iPhone.

## Implemented base contract

Base path: `/api/mobile/v1`

Every JSON response uses one envelope:

```json
{
  "data": {},
  "meta": {
    "apiVersion": "1",
    "generatedAt": "2026-07-14T12:00:00Z",
    "source": "live"
  }
}
```

Errors use a stable, localizable code and a safe human-readable message:

```json
{
  "error": {
    "code": "authentication_revoked",
    "message": "This iPhone is no longer paired with the Mac."
  },
  "meta": {
    "apiVersion": "1",
    "requestId": "..."
  }
}
```

Do not send stack traces, filesystem paths, raw provider errors, or secret values.

## Read endpoints

Bootstrap plus the Phase 2B transaction list/detail slice are implemented. The other rows are accepted later read models and are not registered yet.

| Endpoint                        | Status      | Purpose                                                                                                                                         |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /bootstrap`                | Implemented | App/server version, compatibility, freshness, safe accounts, Home summary, recent activity, budget status, review count, and latest sync state. |
| `GET /accounts`                 | Planned     | Masked account cards and freshness only.                                                                                                        |
| `GET /transactions`             | Implemented | Searchable, filterable, cursor-paginated activity.                                                                                              |
| `GET /transactions/:id`         | Implemented | Mobile-safe transaction detail.                                                                                                                 |
| `GET /spending/summary`         | Planned     | One normalized response shape per requested grouping.                                                                                           |
| `GET /budgets/progress`         | Planned     | Budget cards and detail progress.                                                                                                               |
| `GET /net-worth`                | Planned     | Current totals, composition, and freshness.                                                                                                     |
| `GET /net-worth/history`        | Planned     | Chart series with explicit period and currency.                                                                                                 |
| `GET /assets` and `/assets/:id` | Planned     | Safe asset summaries and history.                                                                                                               |
| `GET /liabilities`              | Planned     | Safe liability summaries.                                                                                                                       |
| `GET /categories`               | Planned     | Category labels, symbols, and semantic colors.                                                                                                  |
| `GET /alert-settings`           | Planned     | Read-only Mac-owned Telegram alert preferences.                                                                                                 |
| `GET /sync-history`             | Planned     | Human-readable account freshness and recent Mac scrape outcomes.                                                                                |

`/bootstrap` is the first feature endpoint because the desktop Home screen currently assembles several requests. A coherent snapshot reduces latency, avoids mixed timestamps, and makes offline replacement atomic.

### Bootstrap success and compatibility

A successful bootstrap extends the base metadata with:

- one opaque snapshot ID;
- one `calculatedAt` point shared by Home, budget, and review calculations;
- one explicit `financialDate` derived from `calculatedAt` in `Asia/Jerusalem` and used to bound aggregate periods and recent transactions;
- a later `generatedAt` serialization time;
- the Mac's stable UUID, protocol/API/schema versions, and `mobile.read` capability;
- explicit completeness and cacheability metadata.

Partial results are never cacheable. Duplicate section failures and a failed budget section carrying normal budget values are invalid. A successful production response reports client app-version compatibility as `not_evaluated` because bootstrap does not yet receive a client marketing version; protocol/API/schema compatibility is still enforced independently. The canonical success, empty, partial, mixed-language, mixed-currency, incompatible, and redaction fixtures live in [`ios/Fixtures/MobileBootstrap`](../Fixtures/MobileBootstrap/). The generated Draft 2020-12 artifact is [`bootstrap.schema.json`](../Fixtures/MobileBootstrap/bootstrap.schema.json); `npm run mobile:bootstrap-schema:check` deterministically detects drift from the executable Zod contract.

Incompatibility is not a successful bootstrap. It returns HTTP `426` with the standard safe error envelope and no feature `data`, so the iPhone can classify the recovery state without decoding or caching an unsupported schema:

```json
{
  "error": {
    "code": "upgrade_required",
    "message": "Update Money Monitor on this iPhone and Mac to continue."
  },
  "meta": {
    "apiVersion": "1",
    "requestId": "..."
  }
}
```

## Data conventions

- Money is a decimal string plus ISO 4217 currency code, never a binary floating-point contract.
- Recent transactions use the persisted settlement (`charged`) currency; provider currency is retained during ingestion and ambiguous older converted values fall back to ILS.
- Financial dates use `YYYY-MM-DD`; instants use ISO 8601 UTC timestamps.
- IDs are opaque strings at the mobile boundary, even if SQLite currently uses integers.
- Account identifiers are masked server-side before serialization.
- Enums include a safe `unknown` path in Swift for forward compatibility.
- Pagination uses an opaque cursor and `hasMore`, not a database offset in the public contract.
- Every financial aggregate states its date range, comparison range, and calculation timestamp.

Example money value:

```json
{
  "value": "12843.27",
  "currencyCode": "ILS"
}
```

## Pairing and authorization

1. The Mac displays a short-lived QR payload with route, nonce, stable server UUID, and protocol version.
2. `POST /pairing/start` consumes that proof and returns a separate 256-bit claimant secret only to the successful scanner.
3. `POST /pairing/status` requires the pairing ID and claimant secret while the Mac asks the user to approve or reject the named device. The Mac hides the consumed QR as soon as the request appears.
4. `POST /pairing/exchange` requires the same claimant secret. Approval mints one revocable `mobile.read` token; a lost response or Keychain failure can retry delivery until pairing expiry without minting again. For explicit re-pair, the trusted Mac binds an active device ID only inside the server-side session; approval atomically rotates that device's digest and token version while preserving its identity, and retry returns the same newly rotated credential.
5. The Mac persists only the token digest. The raw token is stored with `WhenUnlockedThisDeviceOnly` in iOS Keychain; a validated re-pair may replace only a profile with both the same server UUID and the same device identity. A fresh pairing for another identity requires the old profile to be removed after authoritative revocation or expiry.
6. Bootstrap sends the token as a bearer credential only to the paired path-scoped HTTPS base URL. Revocation returns `401 authentication_revoked`; protocol incompatibility returns `426 upgrade_required`.

The QR must not contain the desktop bearer token, bank credentials, encryption keys, device token, claimant secret, or re-pair target. Pairing IDs, nonces, claimant secrets, and device tokens are excluded from logs and human-readable error descriptions. The canonical QR, start, status, exchange, expiry, rejection, replay, and upgrade fixtures live in [`ios/Fixtures/MobilePairing`](../Fixtures/MobilePairing/).

## Mutations and Advisor

The D-024 command policy is accepted, but commands remain later, narrow endpoints rather than the full desktop CRUD API. Only review, transaction category/owner/exclusion, budget, schema-safe category, Telegram preference, and Mac-sync verbs may enter the accepted allowlist.

Advisor remains separate from the read-only financial seam. Under D-025, the first mobile Advisor uses only a read-tool allowlist, cannot write AI memory, and can only propose a future Phase 4 command for confirmation by ordinary UI.

## Contract verification

- Maintain canonical JSON fixtures for every response and error.
- Regenerate and drift-check the bootstrap JSON Schema whenever the executable contract changes.
- Decode the same bootstrap and pairing fixtures in Swift tests.
- Keep compatibility tests for the current mobile schema version and explicit mismatch behavior; private installs make no previous-version support promise.
- Reject unknown required schema versions before replacing the offline snapshot.
