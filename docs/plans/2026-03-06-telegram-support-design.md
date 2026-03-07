# Telegram Support Design

## Summary

Add a Telegram bot interface to Money Monitor that provides the same AI chat functionality as the web UI. The bot reuses the existing `chat()` generator, session system, and shared memory file — no changes to existing code.

## Decisions

- **Library**: grammY (TypeScript-first, modern, well-maintained)
- **Access**: Allowlisted Telegram user IDs only
- **Sessions**: One persistent session per Telegram chat ID, `/new` to start fresh
- **Runtime**: Same process as Fastify (shared DB, memory, no IPC overhead)
- **Approach**: Thin adapter — no channel abstraction, direct reuse of existing primitives

## Architecture

### New Files

| File | Purpose |
|---|---|
| `src/telegram/bot.ts` | grammY bot setup, middleware, message handler, command handlers |
| `src/telegram/session-map.ts` | Maps Telegram chat IDs to session IDs (JSON file persistence) |

### Config Additions (`src/config.ts`)

- `TELEGRAM_BOT_TOKEN` — optional string; bot only starts if set
- `TELEGRAM_ALLOWED_USERS` — comma-separated Telegram user IDs

### Session Mapping

A JSON file at `data/chat/telegram-sessions.json` maps `chatId → sessionId`:

```json
{ "123456789": "a1b2c3d4-..." }
```

When a message arrives:
1. Look up `chatId` in the map
2. If found → load that session and continue the conversation
3. If not found → call `createSession()`, store the mapping

### Message Flow

```
User sends message in Telegram
  → grammY middleware: check user in TELEGRAM_ALLOWED_USERS
  → resolve session ID from chat-to-session map
  → load history via getSessionMessages(sessionId)
  → append user message via appendMessage(sessionId, 'user', text)
  → call chat([...history, { role: 'user', content: text }])
  → send "typing" action while iterating
  → collect full result text
  → append assistant message via appendMessage(sessionId, 'assistant', result)
  → split into ≤4096-char chunks → send to Telegram
```

### Commands

| Command | Behavior |
|---|---|
| `/new` | Clears the session mapping → next message starts a fresh session |
| `/memory` | Sends current `MEMORY.md` content |
| `/sessions` | Lists recent sessions with titles |
| `/switch <id>` | Switches to an existing session by ID |

### Boot Integration

In `src/index.ts`, after `startScheduler()`:

```ts
if (config.TELEGRAM_BOT_TOKEN) {
  startTelegramBot();
}
```

Graceful shutdown calls `bot.stop()`.

### What Stays Unchanged

- `src/ai/agent.ts` — `chat()` generator
- `src/ai/sessions.ts` — session CRUD
- `src/ai/memory.ts` — memory read/write
- `src/api/ai.routes.ts` — web SSE routes
- Dashboard — all Vue components

### Shared Memory

Memory is naturally shared because both web and Telegram sessions inject the same `data/chat/MEMORY.md` into system prompts. Sessions are separate per-channel (each Telegram chat has its own session, web UI has its own), but they all share the same memory file.
