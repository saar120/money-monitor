/**
 * Tool definitions for the financial analysis agent.
 *
 * These tools give Claude read-only access to the transaction database
 * so it can answer questions about spending, savings, and trends.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { TransactionRepository } from '../storage/repositories/transactions.js';
import type { AccountRepository } from '../storage/repositories/accounts.js';

/** The JSON-schema tool definitions sent to the Claude API */
export const ANALYSIS_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'list_accounts',
    description:
      'List all configured financial accounts (banks, credit cards). Returns account ID, name, provider, and last scrape time.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'query_transactions',
    description:
      'Query transactions with flexible filters. Returns up to `limit` transactions matching the criteria, ordered by date descending.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Filter by account ID',
        },
        startDate: {
          type: 'string',
          description: 'Start date (ISO format, e.g. 2025-01-01)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO format)',
        },
        category: {
          type: 'string',
          description: 'Filter by category name',
        },
        description: {
          type: 'string',
          description: 'Search in transaction description (substring match)',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum charged amount',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum charged amount',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_summary',
    description:
      'Get an aggregated financial summary: total income, total expenses, net, breakdowns by category, currency, and month. Supports the same date/account/category filters as query_transactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        category: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'get_monthly_totals',
    description:
      'Get a time series of monthly income vs expenses across all accounts. Useful for spotting trends over time.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_top_expenses',
    description:
      'Get the largest individual expenses in a date range. Useful for finding where the big money is going.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: {
          type: 'string',
          description: 'Start of date range (ISO format)',
        },
        endDate: {
          type: 'string',
          description: 'End of date range (ISO format)',
        },
        limit: {
          type: 'number',
          description: 'How many top expenses to return (default 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_categories',
    description: 'List all transaction categories currently in use.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_transaction_category',
    description:
      'Set or update the category of a single transaction by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transactionId: { type: 'string', description: 'Transaction ID' },
        category: { type: 'string', description: 'Category to assign' },
      },
      required: ['transactionId', 'category'],
    },
  },
  {
    name: 'bulk_categorize',
    description:
      'Assign a category to all transactions whose description contains a given substring. Returns the count of updated transactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'Substring to match in transaction descriptions',
        },
        category: {
          type: 'string',
          description: 'Category to assign to matching transactions',
        },
      },
      required: ['description', 'category'],
    },
  },
];

/** Execute a tool call and return the result as a string */
export function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  accountRepo: AccountRepository,
  transactionRepo: TransactionRepository,
): string {
  switch (toolName) {
    case 'list_accounts': {
      const accounts = accountRepo.findAll();
      return JSON.stringify(accounts, null, 2);
    }

    case 'query_transactions': {
      const txns = transactionRepo.findAll({
        accountId: toolInput.accountId as string | undefined,
        startDate: toolInput.startDate as string | undefined,
        endDate: toolInput.endDate as string | undefined,
        category: toolInput.category as string | undefined,
        description: toolInput.description as string | undefined,
        minAmount: toolInput.minAmount as number | undefined,
        maxAmount: toolInput.maxAmount as number | undefined,
        limit: (toolInput.limit as number | undefined) ?? 100,
      });
      return JSON.stringify(txns, null, 2);
    }

    case 'get_summary': {
      const summary = transactionRepo.getSummary({
        accountId: toolInput.accountId as string | undefined,
        startDate: toolInput.startDate as string | undefined,
        endDate: toolInput.endDate as string | undefined,
        category: toolInput.category as string | undefined,
      });
      return JSON.stringify(summary, null, 2);
    }

    case 'get_monthly_totals': {
      const monthly = transactionRepo.getMonthlyTotals();
      return JSON.stringify(monthly, null, 2);
    }

    case 'get_top_expenses': {
      const startDate =
        (toolInput.startDate as string) ??
        new Date(Date.now() - 30 * 86400000).toISOString();
      const endDate =
        (toolInput.endDate as string) ?? new Date().toISOString();
      const limit = (toolInput.limit as number) ?? 20;
      const top = transactionRepo.getTopExpenses(startDate, endDate, limit);
      return JSON.stringify(top, null, 2);
    }

    case 'get_categories': {
      const cats = transactionRepo.getCategories();
      return JSON.stringify(cats);
    }

    case 'set_transaction_category': {
      const ok = transactionRepo.updateCategory(
        toolInput.transactionId as string,
        toolInput.category as string,
      );
      return ok ? 'Category updated.' : 'Transaction not found.';
    }

    case 'bulk_categorize': {
      const count = transactionRepo.bulkUpdateCategory(
        { description: toolInput.description as string },
        toolInput.category as string,
      );
      return `Updated ${count} transactions.`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
