# Budget LLM Tools — Design Spec

## Goal

Expose budget create/update/delete and progress queries as LLM tools in the chat agent, following the established `asset-tools.ts` pattern.

## Scope

- **2 new tools**: `get_budget_progress` (read) + `manage_budget` (write)
- **1 new file**: `src/ai/budget-tools.ts`
- **Registration** in `src/ai/agent.ts` (imports, tools array, TOOL_STATUS map)
- Chat agent only — no changes to the alert agent

## Tool Definitions

### `get_budget_progress` (read)

Returns spending progress against budget targets.

**Description for LLM:**

```
Get budget progress — how much has been spent vs. the budget limit.
Returns spending amount, percentage used, remaining amount, and over-budget status.
If budget_id is provided, returns progress for that single budget. Otherwise returns all active budgets.
For yearly budgets, set monthly_view to true to get a per-month breakdown.
```

**Parameters (all optional):**

| Parameter      | Type    | Description                                                                                                            |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `budget_id`    | number  | If provided, return progress for a single budget. Otherwise return all active budgets.                                 |
| `monthly_view` | boolean | For yearly budgets, include per-month breakdown. Default false. Prefer using with `budget_id` to avoid large payloads. |

**Execution logic:**

- If `budget_id` is provided → `budgetService.getBudgetProgress(budget_id, monthly_view)`
- Otherwise → `budgetService.getAllBudgetProgress(monthly_view)`
- Returns `JSON.stringify(result)` or `JSON.stringify({ error })` if budget not found

**Note:** Service functions are synchronous (Drizzle's `.all()`/`.get()`/`.run()`). The handler wraps them in an `async` function to satisfy `createAgentTool`'s `execute: Promise<string>` type, but no `await` is needed on service calls.

**Label:** `'Checking budget progress...'`

### `manage_budget` (write)

Create, update, or delete budgets.

**Parameters:**

| Parameter         | Type                                         | Required for   | Description                         |
| ----------------- | -------------------------------------------- | -------------- | ----------------------------------- |
| `action`          | `StringEnum(['create', 'update', 'delete'])` | always         | The action to perform               |
| `budget_id`       | number                                       | update, delete | Budget ID                           |
| `name`            | string                                       | create         | Budget name                         |
| `amount`          | number                                       | create         | Budget cap amount                   |
| `period`          | `StringEnum(['monthly', 'yearly'])`          | —              | Budget period (default 'monthly')   |
| `category_names`  | `Type.Array(Type.String())`                  | create         | Categories to track (at least one)  |
| `alert_threshold` | number                                       | —              | Alert percentage 0-100 (default 80) |
| `alert_enabled`   | boolean                                      | —              | Enable alerts (default true)        |
| `color`           | string                                       | —              | Hex color string                    |
| `is_active`       | boolean                                      | —              | Soft deactivation (update only)     |

**Execution logic by action:**

- **create**: Validate `name`, `amount`, `category_names` are present and `category_names` has at least one entry (service layer accepts empty arrays via DB default, but a budget with no categories is meaningless — enforce at tool level). Call `budgetService.createBudget(...)`. Defaults for `period`, `alertThreshold`, `alertEnabled` are applied by the service layer — do not duplicate.
- **update**: Validate `budget_id` is present. Build partial update from provided fields using this snake→camelCase mapping:
  - `name` → `name` (no change)
  - `amount` → `amount` (no change)
  - `period` → `period` (no change)
  - `category_names` → `categoryNames`
  - `alert_threshold` → `alertThreshold`
  - `alert_enabled` → `alertEnabled`
  - `color` → `color` (no change)
  - `is_active` → `isActive`
  - Do NOT pass `action` or `budget_id` into the update data.
    Call `budgetService.updateBudget(budget_id, data)`. Return the updated budget.
- **delete**: Validate `budget_id` is present. Call `budgetService.deleteBudget(budget_id)`. Service returns `{ ok: true }` — return `JSON.stringify({ success: true, message: 'Budget deleted' })` to match the `manageLiability` deactivate pattern.

All actions return `JSON.stringify(result)` on success, `JSON.stringify({ error })` on validation/service failure.

**Label:** `'Updating budget...'`

**Description for LLM:**

```
Create, update, or delete spending budgets.
- "create": Create a budget to track spending against a limit for specific categories
- "update": Update budget details (name, amount, categories, alerts, etc.)
- "delete": Permanently remove a budget
Before calling, confirm the details with the user if there is any ambiguity.
```

## File Structure

### `src/ai/budget-tools.ts`

```
imports: Type, StringEnum, createAgentTool, budgetService

export buildGetBudgetProgressTool()   → createAgentTool({...})
export buildManageBudgetTool()        → createAgentTool({...})

// Internal handler functions
async function getBudgetProgressHandler(args) → string
async function manageBudget(args)             → string
```

Handlers delegate to the service layer (`src/services/budgets.ts`), which already provides:

- `getAllBudgetProgress(monthlyView)` — returns array of progress objects
- `getBudgetProgress(id, monthlyView)` — returns single progress object or null
- `createBudget(data)` — returns `{ ok: true, budget }` or `{ ok: false, error }`
- `updateBudget(id, data)` — returns `{ ok: true, budget }` or `{ ok: false, error, status }`
- `deleteBudget(id)` — returns `{ ok: true }` or `{ ok: false, error, status }`

### `src/ai/agent.ts` changes

1. Add imports: `buildGetBudgetProgressTool`, `buildManageBudgetTool` from `./budget-tools.js`
2. Add to `tools` array (after liability tools, before alert tools)
3. Add to `TOOL_STATUS`:
   - `get_budget_progress: 'Checking budget progress...'`
   - `manage_budget: 'Updating budget...'`

## Error Handling

Follows the existing pattern:

- Parameter validation errors return `JSON.stringify({ error: 'Missing required field: ...' })` inline
- Service errors bubble up via the `{ ok: false, error }` pattern
- The `createAgentTool` wrapper catches thrown exceptions and returns them as error text to the LLM

## Not in Scope

- Alert agent integration (budget alerts already handled via scrape-time alertThreshold checks)
- Image/chart generation for budgets
- System prompt changes (the LLM will discover budget tools from the tool definitions)
- MCP server exports (can be added later if needed; current scope is chat agent only)
