# ADR-001 — Isolated mobile server behind Tailscale Serve

Status: **Accepted**  
Date: **2026-07-15**  
Owners: Mac, backend, security

## Context

The packaged Electron app starts the desktop Fastify server on a random loopback port and creates a process-scoped bearer token with authority over the complete desktop API. Pointing a private proxy directly at that server would make dashboard assets and desktop endpoints network-addressable and would force the global desktop authentication hook to understand mobile exceptions.

The mobile client needs a stable private URL, a distinct authorization domain, and a route surface limited to explicitly designed mobile contracts. The desktop app must continue to work when Tailscale is missing, logged out, or misconfigured.

## Decision

Money Monitor will run a second, mobile-only Fastify instance inside the Mac process.

- It binds only to `127.0.0.1` and may use an ephemeral local port.
- It registers only `/api/mobile/v1` health, pairing, and explicitly approved mobile routes.
- It does not register the dashboard, desktop API routes, desktop bearer-token hook, scheduler, Telegram bot, scraper commands, settings administration, or Advisor.
- Mobile DTO adapters call shared service/data seams directly; they do not call desktop HTTP endpoints or serialize database rows wholesale.
- It owns independent device authentication, safe error envelopes, redacted logging, and capability classification.

Electron owns the transport lifecycle:

1. The normal desktop server starts unchanged.
2. When Mobile Access is enabled, the mobile server starts and reports its loopback port.
3. A coordinator inspects Tailscale Serve state and reconciles a dedicated Money Monitor HTTPS listener to `http://127.0.0.1:<mobile-port>`.
4. On Mac/app restart or wake, the coordinator verifies and updates that owned mapping.
5. Disabling Mobile Access removes only the Money Monitor-owned listener and stops the mobile server.
6. Missing Tailscale, login/permission requirements, or route conflicts become Mobile Access states and never abort desktop startup.

The initial owned listener is HTTPS port `8443`. It is stable and explicit. If another Serve target already owns that listener, Money Monitor fails closed with a conflict state rather than replacing it or choosing a silent alternate URL. The listener may become configurable through Mac settings later without changing the mobile contract.

The coordinator uses an injected `execFile`-style process adapter, passes arguments without a shell, inspects structured status where available, never runs a global Serve reset, and redacts diagnostic output.

## Why not expose the existing desktop server

- The desktop token has broader authority than any mobile device should receive.
- A routing or authentication regression would expose a much larger surface.
- The desktop server includes static assets, SSE exceptions, scrapers, settings, and AI routes that mobile does not need.
- Encapsulation is easier to prove when forbidden routes are not registered at all.

## Consequences

Positive:

- Mobile and desktop authorization cannot be confused by route ordering.
- Negative tests can prove desktop routes are physically absent.
- Tailscale targets only a least-surface server while SQLite and services remain Mac-local.
- Future transport changes can keep the same `/api/mobile/v1` contract.

Costs:

- Electron manages two local Fastify lifecycles.
- Shared services must remain free of assumptions that only the desktop HTTP server calls them.
- Mobile access needs explicit startup, shutdown, resume, and diagnostic coordination.

## Failure behavior

| Condition | Required result |
| --- | --- |
| Tailscale missing/logged out | Desktop launches; Mobile Access reports recovery state. |
| HTTPS listener already owned by another target | Fail closed; preserve existing configuration. |
| Mobile server port changes | Reconcile owned listener before reporting ready. |
| Reconciliation fails after wake | Retain pairing/device records; report unavailable; bounded retry. |
| Mobile Access disabled | Remove only owned listener and stop mobile server. |
| Desktop server fails | Existing fatal startup handling remains authoritative. |

## Verification

- Mobile server health succeeds while representative desktop routes return `404`.
- Fastify listeners remain loopback-only.
- Two restarts with different local mobile ports retain the same private URL.
- Tailscale-unavailable startup leaves the desktop app usable.
- Disabling Mobile Access preserves unrelated Serve configuration.
- A valid mobile device token cannot reach the desktop listener through the mobile transport.

## Implementation reference

The coordinator follows the current Tailscale Serve CLI contract for `--bg`, `--https`, `--set-path`, `status --json`, and exact-route `off` operations. The upstream command reference was rechecked on 2026-07-15: <https://tailscale.com/docs/reference/tailscale-cli/serve>.
