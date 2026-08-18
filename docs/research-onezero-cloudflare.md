# Research: OneZero `identity.tfd-bank.com` Cloudflare 403

**Date:** 2026-08-18
**Status:** Investigation complete
**Scope:** A local Electron/Node scraper; no third party should receive the bank credentials.

## Finding

The visible `Unexpected token '<'` is a secondary error. The OneZero scraper's
`fetchPost()` parses every response as JSON, so a Cloudflare HTML 403 becomes a
JSON parse exception. The underlying failure is the POST to
`https://identity.tfd-bank.com/v1/devices/token`, before the scraper can obtain a
device token. This is the exact failure documented in [upstream issue #1144](https://github.com/eshaham/israeli-bank-scrapers/issues/1144).

The upstream issue's controlled comparison is important: on its author's public
IP, curl and `node:https` returned JSON while Node's built-in fetch/Undici
returned Cloudflare HTML. That supports trying a scoped `node:https` transport,
as suggested in issue #1144. [PR #1128](https://github.com/eshaham/israeli-bank-scrapers/pull/1128)
and the [Spent patch](https://github.com/galongin/Spent/commit/78f9dcb461187269cc5c08af6ce092de22c6cb6e)
instead use Undici with a mobile TLS profile.
However, this project's local diagnostics (reported in the task) receive the
same 403 HTML from Undici, native HTTPS, curl, and Chromium. That makes a
source-IP/egress or Cloudflare policy decision more likely here than a single
Node header or TLS-cipher bug. This is an inference from the transport matrix,
not a claim that the bank has published its rule.

Additional credential-free probes on 2026-08-18 produced the same hard-block
page with current Chrome and iOS Safari fingerprints through `curl_cffi`. The
page contained no challenge-platform markers, so there was no interactive
challenge to solve. An unauthenticated request to the transaction GraphQL edge
(`mobile.tfd-bank.com`) was also denied with `403 text/html`, ruling out session
reuse as a practical fallback on this egress.

A second network test changed the Mac from a fixed-line Israeli ISP to a
Pelephone mobile hotspot. Plain curl, the app's Android-style Undici profile,
and an iOS Safari fingerprint all still received `403 text/html`. This rules
out that particular egress change as a solution; it does not prove that every
trusted VPN or exit IP will be denied.

### Proxyman differential: likely mutual TLS

A redacted Proxyman capture from the official iPhone app added a stronger
signal. The app succeeds with Tailscale enabled, which preserves end-to-end
TLS, but receives the same Cloudflare 403 when Proxyman intercepts and
recreates the upstream TLS connection. The captured GraphQL request's
`User-Agent` explicitly ends in `MTLS`, and the request includes OneZero app,
version, channel, device, and PSU metadata headers that the scraper does not
send. A credential-free request through macOS's native `URLSession` still
received 403.

This is high-confidence evidence that the current official app connection uses
mutual TLS or another app-bound TLS credential. It is not cryptographic proof:
the HAR contains no certificate metadata, and TLS 1.3 protects later handshake
messages from passive inspection. Still, it explains the complete matrix:
Tailscale works because it does not terminate TLS, while Proxyman, Node,
Undici, curl, Chromium, browser impersonation, and macOS `URLSession` cannot
present the app's client-side TLS identity.

The current package still uses the private mobile identity endpoints in
[`one-zero.ts`](https://github.com/eshaham/israeli-bank-scrapers/blob/master/packages/core/src/scrapers/one-zero.ts),
and the shared helper still calls global `fetch()` and blindly calls
`response.json()` in [`fetch.ts`](https://github.com/eshaham/israeli-bank-scrapers/blob/master/packages/core/src/helpers/fetch.ts).

## Ranked options

### 1. Verify and use an allowed, user-controlled egress (conditional)

Run the credential-free device-token probe from a different network first
(for example, a phone hotspot or a personal VPN exit). Keep the request body
exactly the same and record status, content type, and Cloudflare Ray ID. If the
probe changes to JSON, route only the OneZero identity requests through that
trusted egress.

For a local Electron implementation, the options are:

- A device-level VPN/tunnel, which requires no application code and keeps the
  scraper's normal TLS connection end-to-end.
- A user-supplied HTTP(S)/SOCKS proxy. Undici's official [`ProxyAgent`](https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md)
  supports per-request dispatchers and HTTPS `CONNECT` tunnels; its
  [`EnvHttpProxyAgent`](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)
  reads `HTTPS_PROXY`/`NO_PROXY`. Electron's [`net`](https://www.electronjs.org/docs/latest/api/net/)
  uses Chromium's network stack and supports system proxy/PAC settings, while
  [`session.setProxy`](https://www.electronjs.org/docs/latest/api/session)
  configures a BrowserWindow session.

Use only a proxy the user controls or explicitly trusts. Node's current
documentation warns that a proxy can observe connection metadata and can read
content if it terminates/intercepts TLS; HTTPS `CONNECT` is not an anonymity
boundary. Do not hard-code a free/public proxy or send bank credentials to a
scraping provider.

**Why this is first:** it directly tests the egress hypothesis and is the only
option that can help when every local client is denied. **Blocker:** an allowed
exit/VPN/proxy is external configuration and must be available to the user.
The tested Pelephone hotspot was not accepted, so do not implement application
proxy support until a different trusted exit passes the credential-free probe.

### 2. Ask OneZero/its API owner to allow the legitimate client (best durable fix)

Cloudflare documents that its bot score and JA3 signals can distinguish
automated clients, and recommends explicit exceptions for legitimate API and
mobile traffic (including a narrowly scoped JA3 or API-path rule) in
[Bot Management guidance](https://developers.cloudflare.com/waf/custom-rules/use-cases/challenge-bad-bots/).
Cloudflare also documents that WAF/IP/country blocks commonly return 403
pages in its [error-page reference](https://developers.cloudflare.com/rules/custom-errors/reference/error-page-types/).

The bank or its Cloudflare operator—not this desktop app—must make that change.
Open an upstream issue with the transport matrix, timestamp, Ray ID, and a
credential-free reproduction. The OneZero [official Open Banking developer
portal](https://www.onezerobank.com/lp/one_zero_dev_portal/) advertises API
documentation/support at `ozopenbanking@onezerobank.com`; ask whether a
registered Open Banking integration is available for this use case.

### 3. Migrate to OneZero Open Banking APIs (best product direction)

The official developer portal is a standards-facing integration path rather
than reverse-engineering the private mobile API. It should use consent/token
flows instead of storing a bank password in the scraper. This is a larger
integration (registration, consent UX, token lifecycle, and account/transaction
mapping), but avoids dependence on `tfd-bank.com`'s mobile app fingerprint and
Cloudflare rules. Treat availability and terms as unknown until OneZero grants
access.

### 4. Use Chromium/Electron `net.fetch` or a real browser challenge (conditional)

Electron documents that `net.fetch()` uses Chromium's network stack rather than
Node's HTTP stack, and Cloudflare documents that challenge pages execute in a
browser and issue a clearance cookie. A browser-based flow could work if the
request receives a solvable challenge and the subsequent API call reuses the
same session and IP. See [How Challenges work](https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/)
and [Challenge Pages compatibility](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/).

This is not a reliable fix for the current report: the local Chromium probe was
also blocked, and Cloudflare says a challenge solve from a different IP is
invalid. It is worth a short test only after trying an alternate egress.

### 5. TLS/client-fingerprint impersonation (not recommended)

Changing ciphers, signature algorithms, HTTP/2 settings, or using a
curl-impersonate-style client may reproduce the mobile app's fingerprint and
could explain the upstream issue's native-HTTPS-vs-Undici difference. It cannot
fix an IP/country/WAF block, is brittle across Cloudflare changes, and adds a
native binary plus security/update burden to Electron. Do not invest in this
until an alternate egress proves that only the client fingerprint differs.

The Proxyman differential further reduces this option's value: fingerprint
impersonation cannot supply an app-bound mutual-TLS private key. Extracting or
shipping a bank application's private client credential would be unsafe and is
not an acceptable application patch.

## What should change in the app next

1. Keep the existing scoped OneZero transport patch, but add a structured error
   path that reports HTTP status/content type/Ray ID instead of only
   `Unexpected token '<'`. This improves diagnosis but does not bypass a 403.
2. Add an opt-in `ONEZERO_PROXY_URL` (or an equivalent OS/VPN setup) only after
   a credential-free probe succeeds through that egress. Use Undici's
   `ProxyAgent` for the OneZero requests and leave other banks direct.
3. Do not log request bodies, OTPs, cookies, authorization headers, or proxy
   credentials. Never route bank login traffic through an unknown hosted
   scraper.
4. In parallel, contact OneZero about an allowlist or an official Open Banking
   integration. That is the durable fix if the bank is intentionally blocking
   this class of automation.

## Verification plan (safe, no credentials)

From each candidate network, send only:

```sh
curl -sS -D - -o /tmp/onezero-response.html \
  -X POST 'https://identity.tfd-bank.com/v1/devices/token' \
  -H 'Content-Type: application/json' \
  --data '{"extClientId":"mobile","os":"Android"}'
```

Record status, `content-type`, `server`, and `cf-ray`; discard the response
body. A successful path should return `200` with JSON containing
`resultData.deviceToken`, as described in issue #1144. Only then test the full
Electron flow with the user's credentials.

## Conclusion

The Spent/PR transport workaround was a valid scoped fix for the earlier
Undici-specific fingerprint rejection, but it is not sufficient for the
current all-client 403. The official iPhone/Proxyman comparison now points to
an app-bound mutual-TLS requirement rather than a general egress issue. The
desktop app should not attempt to extract or redistribute that credential; the
safe durable paths are a bank-provided client integration/allowlist or the
official Open Banking API.
