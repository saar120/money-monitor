import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import * as budgetService from '../services/budgets.js';
import { createAgentTool } from './tool-adapter.js';

// ── Read tool builders ──────────────────────────────────────────────────────────

export function buildGetBudgetProgressTool() {
  return createAgentTool({
    name: 'get_budget_progress',
    description:
      'Get budget progress — how much has been spent vs. the budget limit. Returns spending amount, percentage used, remaining amount, and over-budget status. If budget_id is provided, returns progress for that single budget. Otherwise returns all active budgets. For yearly budgets, set monthly_view to true to get a per-month breakdown. Use reference_date to look at past periods (e.g. "2026-03-01" for last month, "2025-06-15" for 2025 yearly budgets).',
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
      reference_date: Type.Optional(
        Type.String({
          description:
            'ISO date (e.g. "2026-03-01") to view a past period. For monthly budgets, returns that month. For yearly, returns that year. Defaults to today (current period).',
        }),
      ),
    }),
    execute: async (args) => getBudgetProgress(args),
  });
}

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
    execute: async (args) => manageBudget(args),
  });
}

// ── Handler functions ───────────────────────────────────────────────────────────

export async function getBudgetProgress(input: {
  budget_id?: number;
  monthly_view?: boolean;
  reference_date?: string;
}): Promise<string> {
  const monthlyView = input.monthly_view ?? false;

  if (input.budget_id !== undefined) {
    const result = budgetService.getBudgetProgress(
      input.budget_id,
      monthlyView,
      input.reference_date,
    );
    if (!result) return JSON.stringify({ error: 'Budget not found' });
    return JSON.stringify(result);
  }

  return JSON.stringify(budgetService.getAllBudgetProgress(monthlyView, input.reference_date));
}

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
    return JSON.stringify(result.budget);
  }

  if (input.action === 'update') {
    if (!input.budget_id)
      return JSON.stringify({
        error: 'Missing required field: budget_id for update',
      });

    const result = budgetService.updateBudget(input.budget_id, {
      name: input.name,
      amount: input.amount,
      period: input.period,
      categoryNames: input.category_names,
      alertThreshold: input.alert_threshold,
      alertEnabled: input.alert_enabled,
      color: input.color,
      isActive: input.is_active,
    });
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
