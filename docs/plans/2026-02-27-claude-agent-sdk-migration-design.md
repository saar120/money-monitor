# Claude Agent SDK Migration Design

**Date:** 2026-02-27
**Status:** Approved

## Goal

Migrate the AI layer from `@anthropic-ai/sdk` (manual tool loop) to `@anthropic-ai/claude-agent-sdk` (in-process MCP server) for better tool handling and multi-step reasoning. All external API contracts remain unchanged.

## Requirements

- Preserve `chat()` and `batchCategorize()` interfaces exactly
- Controlled API/function interface — no direct Bash/DB access by the agent
- Support OAuth tokens (`CLAUDE_CODE_OAUTH_TOKEN`) in addition to `ANTHROPIC_API_KEY`
- Tools can be redesigned; behavior must be equivalent

## Approach: Full Migration via In-Process MCP

Replace `@anthropic-ai/sdk` entirely. Define all financial tools as an in-process MCP server using `createSdkMcpServer` + `tool()`. The agent SDK's `query()` drives both `chat()` and `batchCategorize()`, replacing the manual tool loop.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Replace `@anthropic-ai/sdk` with `@anthropic-ai/claude-agent-sdk` |
| `src/ai/tools.ts` | Rewrite: `createSdkMcpServer` with 4 Zod-typed tools |
| `src/ai/agent.ts` | Rewrite: `query()` for both `chat()` and `batchCategorize()` |
| `src/ai/prompts.ts` | Minor: remove tool list injection (MCP handles it) |
| `src/config.ts` | Add optional `CLAUDE_CODE_OAUTH_TOKEN` env var |

## Tools Design (`src/ai/tools.ts`)

Exports `buildFinancialMcpServer(categoryNames: string[])` — called on every `chat()` request so categories are always fresh (Option A, no stale category risk).

**4 tools, same names, Zod schemas replace manual `input_schema` JSON:**

```
query_transactions        — filter/search transactions (Drizzle ORM, unchanged logic)
get_spending_summary      — aggregate by category/month/account (Drizzle ORM, unchanged)
categorize_transaction    — assign category to a transaction (Drizzle ORM, unchanged)
get_account_balances      — list accounts with stats (Drizzle ORM, unchanged)
```

Tool handlers return `{ content: [{ type: "text", text: JSON.stringify(result) }] }` as required by MCP.

MCP tool naming convention: `mcp__financial-tools__<tool_name>`

## Agent Design (`src/ai/agent.ts`)

### `chat(conversationHistory: ChatMessage[]): Promise<string>`

1. Fetch category names from DB
2. Call `buildFinancialMcpServer(categoryNames)` to get a fresh MCP server
3. Flatten `conversationHistory` into a single prompt string:
   ```
   Previous conversation:
   Human: <msg>
   Assistant: <msg>
   ...
   Current question: <lastMessage>
   ```
4. Call `query()`:
   ```typescript
   query({
     prompt,
     options: {
       model: config.ANTHROPIC_MODEL,
       systemPrompt: buildFinancialAdvisorPrompt(categoryNames),
       mcpServers: { "financial-tools": server },
       allowedTools: ["mcp__financial-tools__*"],
       maxTurns: 10,
     }
   })
   ```
5. Stream result messages; return `msg.result` on `subtype: "success"`, throw readable error on failure subtypes

### `batchCategorize(batchSize?, ids?): Promise<{ categorized: number }>`

Single-shot call — no tools, no multi-turn reasoning needed:

```typescript
query({
  prompt: `Categorize these transactions into one of: ${categoryList}\n\n${txnList}\n\nRespond with ONLY a JSON array: [{"id":1,"category":"food"},...]`,
  options: {
    model: config.ANTHROPIC_MODEL,
    systemPrompt: "You are a transaction categorizer. Respond with ONLY a valid JSON array, no markdown, no explanation.",
    allowedTools: [],
    maxTurns: 1,
  }
})
```

Extract text from result, strip markdown fences, parse JSON, apply DB updates (same as today).

## Authentication

The agent SDK reads environment variables automatically:

- **API key:** Set `ANTHROPIC_API_KEY` in env (current behavior)
- **OAuth:** Set `CLAUDE_CODE_OAUTH_TOKEN` in env, unset `ANTHROPIC_API_KEY`

No custom `buildSdkEnv()` function needed. Add `CLAUDE_CODE_OAUTH_TOKEN` as an optional field in `src/config.ts`.

## Error Handling

`query()` result messages have subtypes:
- `success` → return `msg.result`
- `error_max_turns` → return `"I reached the maximum number of analysis steps. Please try a more specific question."`
- `error_during_execution` → throw with message from `msg.errors`

`batchCategorize()` keeps existing `try/catch` for JSON parse failures.

## What Does NOT Change

- `ChatMessage` interface
- All Fastify API route handlers
- Drizzle ORM query logic inside tools
- `buildFinancialAdvisorPrompt()` system prompt content
- Database schema
