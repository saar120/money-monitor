# Interactions and states

## Primary flows

### Pair and enter

```text
Welcome → Connect to Mac → Mac approval → Device protection → Connected → Home
```

- QR scan is primary; manual private HTTPS address is fallback.
- Pairing failure stays in context and explains whether the Mac, Tailnet, address, approval, or version is the problem.
- System biometrics use device-passcode fallback. Saved financial data has no permanent “Not now” path.

### Find a transaction

```text
Search tab → query/suggestion → results → transaction detail
Activity → filters sheet → filtered results → transaction detail
```

- Debounce remote queries.
- Preserve query and filters when returning from detail.
- Do not store or show recent searches in the private self-use plan.

### Review money

```text
Home review prompt → review queue → inspect → resolve or skip
```

Resolution is a Phase 4 command. In read-only phases, the queue may be viewed but cannot imply a successful edit.

### Plan and wealth

```text
Plan → budget detail → optional edit sheet
Plan → Net Worth → asset detail
```

Period changes update the title, comparison label, chart, and freshness as one coherent state.

### Advisor

```text
Advisor → suggestion/new question → streaming conversation → complete/cancel/retry
```

The composer is disabled while offline. A saved conversation remains readable. Any action proposed by Advisor must disclose and confirm the exact change before execution.

## Universal remote-content states

| State | Behavior |
| --- | --- |
| Initial loading | Preserve navigation chrome; use a restrained progress or content-shaped placeholder without fake numbers. |
| Live | Show calculation/freshness context where it matters, not on every row. |
| Refreshing | Keep readable content visible; use native pull-to-refresh progress. |
| Cached | Show saved timestamp and disable unavailable actions without blocking browsing. |
| Stale | Use warning symbol + plain language + retry; explain the threshold. |
| Empty | Explain what belongs here and provide one relevant next action. |
| Partial | Render valid sections and identify unavailable sections; do not replace the whole page. |
| Timeout/unreachable | Fall back to a valid saved snapshot or the Mac unavailable screen. |
| Server error | Give safe plain language, retry, and optional diagnostics ID—not a raw error. |
| Decode/schema failure | Preserve the prior snapshot; request compatible Mac/app update. |
| Authentication revoked | Lock, clear the token and financial cache, and offer fresh pairing. An offline phone cannot discover revocation until it reconnects. |

## Lists and search

- Empty query: focus search and show useful suggestions/recent items.
- No results: echo the query, show active filters, and offer clear/reset.
- Pagination: append without losing scroll position; retry an append failure inline.
- Filtered empty: distinguish from a genuinely empty account.
- Search cancellation: returns to the prior destination without mutating filters.

## Commands

Every allowed command has these states:

```text
idle → validating → submitting → confirmed
                       ↘ rejected / conflict / unreachable → retry or cancel
```

- Disable submission while cached/offline.
- Keep user-entered values after a recoverable error.
- Use confirmation for destructive or consequential actions.
- Never optimistically present an authoritative financial change unless conflict recovery is defined.
- Do not queue offline commands in the first release.

## Sync and Mac attention

Distinguish queued, running, completed, partially failed, waiting for OTP/manual attention, cancelled, asleep/unreachable, and stale. “Sync now” means the Mac performs the scrape; the iPhone must not run institution automation.

## Face ID and privacy

- Lock on cold start and after two minutes in the background.
- Cover financial content in the app switcher.
- Handle denied, unavailable, interrupted, and lockout results.
- Respect system passcode fallback according to the accepted security policy.
- VoiceOver must not announce hidden financial values while locked.

## Sheets, navigation, and gestures

- Details use system back navigation and interactive swipe-back.
- Edits use medium/large sheets with Cancel and Done.
- Destructive actions use confirmation dialogs.
- Do not hide essential actions behind custom gestures.
- Keyboard focus, dismissal, and safe-area behavior follow native controls.
