# Budget LLM Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose budget create/update/delete and progress queries as LLM tools in the chat agent.

**Architecture:** Two tools (`get_budget_progress` read + `manage_budget` write) in a new `src/ai/budget-tools.ts` file, following the `asset-tools.ts` pattern. Handlers delegate to the existing `src/services/budgets.ts` service layer. Tools are registered in `src/ai/agent.ts`.

**Tech Stack:** TypeBox (parameter schemas), `@mariozechner/pi-ai` StringEnum, Vitest (tests)

---

## File Map

| Action | File                                    | Responsibility                                          |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| Create | `src/ai/budget-tools.ts`                | Tool builders + handler functions                       |
| Create | `src/ai/budget-tools.test.ts`           | Tests for both tools                                    |
| Modify | `src/ai/agent.ts:35-46,113-139,208-234` | Import builders, add to TOOL_STATUS, add to tools array |

---

## Chunk 1: Budget Tools

### Task 1: Create `budget-tools.ts` with `get_budget_progress` tool

**Files:**

- Create: `src/ai/budget-tools.ts`
- Create: `src/ai/budget-tools.test.ts`

- [ ] **Step 1: Write the test file scaffold and first test**

Create `src/ai/budget-tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));

const { getBudgetProgressHandler, manageBudget } = await import('./budget-tools.js');

function insertBudget(overrides: Partial<typeof schema.budgets.$inferInsert> = {}) {
  return testDb.db
    .insert(schema.budgets)
    .values({
      name: 'Test Budget',
      amount: 1000,
      period: 'monthly',
      categoryNames: JSON.stringify(['food']),
      alertThreshold: 80,
      alertEnabled: true,
      ...overrides,
    })
    .returning()
    .get();
}

describe('getBudgetProgressHandler', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('returns all active budgets with progress when no budget_id given', () => {
    insertBudget({ name: 'Food Budget' });
    insertBudget({ name: 'Inactive', isActive: false });

    const result = JSON.parse(await getBudgetProgressHandler({}));
    expect(result).toHaveLength(1);
    expect(result[0].budget.name).toBe('Food Budget');
    expect(result[0]).toHaveProperty('spent');
    expect(result[0]).toHaveProperty('percentage');
    expect(result[0]).toHaveProperty('remaining');
  });

  it('returns single budget progress when budget_id given', () => {
    const budget = insertBudget({ name: 'Transport' });

    const result = JSON.parse(await getBudgetProgressHandler({ budget_id: budget.id }));
    expect(result.budget.name).toBe('Transport');
    expect(result.spent).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.remaining).toBe(1000);
  });

  it('returns error for non-existent budget_id', () => {
    const result = JSON.parse(await getBudgetProgressHandler({ budget_id: 999 }));
    expect(result).toEqual({ error: 'Budget not found' });
  });

  it('returns monthly breakdown for yearly budget with monthly_view', () => {
    const account = insertAccount(testDb.db);
    const budget = insertBudget({
      name: 'Annual Food',
      amount: 12000,
      period: 'yearly',
      categoryNames: JSON.stringify(['food']),
    });

    // Insert a food expense in January
    insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      chargedAmount: -200,
      category: 'food',
    });

    const result = JSON.parse(
      await getBudgetProgressHandler({ budget_id: budget.id, monthly_view: true }),
    );
    expect(result.budget.name).toBe('Annual Food');
    expect(result.spent).toBe(200);
    expect(result.monthlyView).toBeDefined();
    expect(result.monthlyView.monthlyBudget).toBe(1000);
    expect(result.monthlyView.breakdown).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Create `budget-tools.ts` with the read tool + exported handler**

Create `src/ai/budget-tools.ts`:

```ts
import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import * as budgetService from '../services/budgets.js';
import { createAgentTool } from './tool-adapter.js';

// ── Read tool builders ──────────────────────────────────────────────────────────

export function buildGetBudgetProgressTool() {
  return createAgentTool({
    name: 'get_budget_progress',
    description:
      'Get budget progress — how much has been spent vs. the budget limit. Returns spending amount, percentage used, remaining amount, and over-budget status. If budget_id is provided, returns progress for that single budget. Otherwise returns all active budgets. For yearly budgets, set monthly_view to true to get a per-month breakdown.',
    label: 'Checking budget progress',
    parameters: Type.Object({
      budget_id: Type.Optional(
        Type.Number({
          description:
            'If provided, return progress for a single budget. Otherwise return all active budgets.',
        }),
      ),
      monthly_view: Type.Optional(
        Type.Boolean({
          description:
            'For yearly budgets, include per-month breakdown. Default false. Prefer using with budget_id to avoid large payloads.',
        }),
      ),
    }),
    execute: (args) => getBudgetProgressHandler(args),
  });
}

// ── Handler functions ───────────────────────────────────────────────────────────

export async function getBudgetProgressHandler(input: {
  budget_id?: number;
  monthly_view?: boolean;
}): Promise<string> {
  const monthlyView = input.monthly_view ?? false;

  if (input.budget_id !== undefined) {
    const result = budgetService.getBudgetProgress(input.budget_id, monthlyView);
    if (!result) return JSON.stringify({ error: 'Budget not found' });
    return JSON.stringify(result);
  }

  return JSON.stringify(budgetService.getAllBudgetProgress(monthlyView));
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/ai/budget-tools.test.ts`
Expected: 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/ai/budget-tools.ts src/ai/budget-tools.test.ts
git commit -m "feat: add get_budget_progress LLM tool"
```

---

### Task 2: Add `manage_budget` tool

**Files:**

- Modify: `src/ai/budget-tools.ts`
- Modify: `src/ai/budget-tools.test.ts`

- [ ] **Step 1: Add manage_budget tests**

Append to `src/ai/budget-tools.test.ts`:

```ts
describe('manageBudget', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── create ──

  it('creates a budget with required fields', () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Food',
        amount: 500,
        category_names: ['food', 'groceries'],
      }),
    );
    expect(result.name).toBe('Food');
    expect(result.amount).toBe(500);
    expect(result.categoryNames).toEqual(['food', 'groceries']);
    expect(result.period).toBe('monthly');
    expect(result.alertThreshold).toBe(80);
  });

  it('returns error when create is missing required fields', () => {
    const result = JSON.parse(await manageBudget({ action: 'create', name: 'Food' }));
    expect(result.error).toContain('amount');
  });

  it('creates a budget with optional fields', () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Yearly Transport',
        amount: 6000,
        category_names: ['transport'],
        period: 'yearly',
        alert_threshold: 90,
        alert_enabled: false,
        color: '#FF5733',
      }),
    );
    expect(result.period).toBe('yearly');
    expect(result.alertThreshold).toBe(90);
    expect(result.alertEnabled).toBe(false);
    expect(result.color).toBe('#FF5733');
  });

  it('returns error when create has empty category_names', () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Food',
        amount: 500,
        category_names: [],
      }),
    );
    expect(result.error).toContain('category');
  });

  // ── update ──

  it('updates a budget', () => {
    const budget = insertBudget({ name: 'Old Name' });

    const result = JSON.parse(
      await manageBudget({
        action: 'update',
        budget_id: budget.id,
        name: 'New Name',
        amount: 2000,
      }),
    );
    expect(result.name).toBe('New Name');
    expect(result.amount).toBe(2000);
  });

  it('returns error when update is missing budget_id', () => {
    const result = JSON.parse(await manageBudget({ action: 'update', name: 'New Name' }));
    expect(result.error).toContain('budget_id');
  });

  it('returns error when updating non-existent budget', () => {
    const result = JSON.parse(await manageBudget({ action: 'update', budget_id: 999, name: 'X' }));
    expect(result.error).toContain('not found');
  });

  // ── delete ──

  it('deletes a budget', () => {
    const budget = insertBudget();

    const result = JSON.parse(await manageBudget({ action: 'delete', budget_id: budget.id }));
    expect(result.success).toBe(true);
  });

  it('returns error when delete is missing budget_id', () => {
    const result = JSON.parse(await manageBudget({ action: 'delete' }));
    expect(result.error).toContain('budget_id');
  });

  it('returns error when deleting non-existent budget', () => {
    const result = JSON.parse(await manageBudget({ action: 'delete', budget_id: 999 }));
    expect(result.error).toContain('not found');
  });

  // ── unknown action ──

  it('returns error for unknown action', () => {
    const result = JSON.parse(await manageBudget({ action: 'archive' } as any));
    expect(result.error).toContain('Unknown action');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ai/budget-tools.test.ts`
Expected: New `manageBudget` tests fail (function not yet implemented)

- [ ] **Step 3: Add `manage_budget` tool builder and handler to `budget-tools.ts`**

Add to `src/ai/budget-tools.ts` after the read tool builder (`StringEnum` is already imported at the top of the file from Task 1):

```ts
// ── Write tool builders ─────────────────────────────────────────────────────────

export function buildManageBudgetTool() {
  return createAgentTool({
    name: 'manage_budget',
    description: `Create, update, or delete spending budgets.
- "create": Create a budget to track spending against a limit for specific categories
- "update": Update budget details (name, amount, categories, alerts, etc.)
- "delete": Permanently remove a budget
Before calling, confirm the details with the user if there is any ambiguity.`,
    label: 'Updating budget',
    parameters: Type.Object({
      action: StringEnum(['create', 'update', 'delete'], {
        description: 'The action to perform',
      }),
      budget_id: Type.Optional(
        Type.Number({
          description: 'Budget ID (required for update/delete)',
        }),
      ),
      name: Type.Optional(Type.String({ description: 'Budget name (required for create)' })),
      amount: Type.Optional(
        Type.Number({ description: 'Budget cap amount (required for create)' }),
      ),
      period: Type.Optional(
        StringEnum(['monthly', 'yearly'], {
          description: "Budget period (default 'monthly')",
        }),
      ),
      category_names: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Category names to track spending for (required for create, at least one)',
        }),
      ),
      alert_threshold: Type.Optional(
        Type.Number({
          description: 'Alert percentage 0-100 (default 80)',
        }),
      ),
      alert_enabled: Type.Optional(Type.Boolean({ description: 'Enable alerts (default true)' })),
      color: Type.Optional(Type.String({ description: 'Hex color string (e.g. "#FF5733")' })),
      is_active: Type.Optional(
        Type.Boolean({
          description: 'Soft deactivation flag (update only)',
        }),
      ),
    }),
    execute: (args) => manageBudget(args),
  });
}
```

Add the handler function:

```ts
export async function manageBudget(input: {
  action: string;
  budget_id?: number;
  name?: string;
  amount?: number;
  period?: string;
  category_names?: string[];
  alert_threshold?: number;
  alert_enabled?: boolean;
  color?: string;
  is_active?: boolean;
}): Promise<string> {
  if (input.action === 'create') {
    if (!input.name) return JSON.stringify({ error: 'Missing required field: name' });
    if (input.amount === undefined)
      return JSON.stringify({ error: 'Missing required field: amount' });
    if (!input.category_names || input.category_names.length === 0)
      return JSON.stringify({
        error: 'Missing required field: category_names (must have at least one)',
      });

    const result = budgetService.createBudget({
      name: input.name,
      amount: input.amount,
      period: input.period,
      categoryNames: input.category_names,
      alertThreshold: input.alert_threshold,
      alertEnabled: input.alert_enabled,
      color: input.color,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.budget);
  }

  if (input.action === 'update') {
    if (!input.budget_id)
      return JSON.stringify({
        error: 'Missing required field: budget_id for update',
      });

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.period !== undefined) data.period = input.period;
    if (input.category_names !== undefined) data.categoryNames = input.category_names;
    if (input.alert_threshold !== undefined) data.alertThreshold = input.alert_threshold;
    if (input.alert_enabled !== undefined) data.alertEnabled = input.alert_enabled;
    if (input.color !== undefined) data.color = input.color;
    if (input.is_active !== undefined) data.isActive = input.is_active;

    const result = budgetService.updateBudget(input.budget_id, data);
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.budget);
  }

  if (input.action === 'delete') {
    if (!input.budget_id)
      return JSON.stringify({
        error: 'Missing required field: budget_id for delete',
      });

    const result = budgetService.deleteBudget(input.budget_id);
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify({ success: true, message: 'Budget deleted' });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/ai/budget-tools.test.ts`
Expected: All tests pass (both `getBudgetProgressHandler` and `manageBudget` suites)

- [ ] **Step 5: Commit**

```bash
git add src/ai/budget-tools.ts src/ai/budget-tools.test.ts
git commit -m "feat: add manage_budget LLM tool"
```

---

### Task 3: Register tools in agent.ts

**Files:**

- Modify: `src/ai/agent.ts:45-46` (imports)
- Modify: `src/ai/agent.ts:113-139` (TOOL_STATUS)
- Modify: `src/ai/agent.ts:208-234` (tools array)

- [ ] **Step 1: Add import**

In `src/ai/agent.ts`, after the `alert-tools.js` import (line 45), add:

```ts
import { buildGetBudgetProgressTool, buildManageBudgetTool } from './budget-tools.js';
```

- [ ] **Step 2: Add TOOL_STATUS entries**

In the `TOOL_STATUS` map, after the `manage_liability` entry (line 134), add:

```ts
  get_budget_progress: 'Checking budget progress...',
  manage_budget: 'Updating budget...',
```

- [ ] **Step 3: Add tools to the array**

In the `tools` array, after `buildManageLiabilityTool()` (line 229), add:

```ts
    buildGetBudgetProgressTool(),
    buildManageBudgetTool(),
```

- [ ] **Step 4: Run full test suite to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing + new tests pass

- [ ] **Step 5: Commit**

```bash
git add src/ai/agent.ts
git commit -m "feat: register budget tools in chat agent"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint**

Run: `npx eslint src/ai/budget-tools.ts src/ai/budget-tools.test.ts src/ai/agent.ts`
Expected: No lint errors
