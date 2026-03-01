import { z } from 'zod';
import { COMPANY_IDS } from '../shared/types.js';

// ─── Accounts ───

export const createAccountSchema = z.object({
  companyId: z.enum(COMPANY_IDS),
  displayName: z.string().min(1).max(100),
  credentials: z.record(z.string().min(1), z.string()).refine(
    obj => Object.keys(obj).length > 0,
    'At least one credential field is required'
  ),
});

export const updateAccountSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  manualLogin: z.boolean().optional(),
  showBrowser: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});

const accountTypeEnum = z.enum(['bank', 'credit_card']);

// ─── Transactions Query ───

export const transactionQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  accountType: accountTypeEnum.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  category: z.string().optional(),
  status: z.enum(['completed', 'pending']).optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sortBy: z.enum(['date', 'chargedAmount', 'description', 'processedDate']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const ignoreTransactionSchema = z.object({
  ignored: z.boolean(),
});

// ─── Summary Query ───

export const summaryQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  accountType: accountTypeEnum.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  groupBy: z.enum(['category', 'month', 'account']).default('category'),
});

// ─── AI ───

export const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(10000),
  })).min(1).max(100),
});

export const categorizeSchema = z.object({
  batchSize: z.number().int().min(1).max(500).default(50),
});

export const recategorizeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ─── Helpers ───

import { eq, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';

/** Returns a WHERE condition filtering transactions by account type, or null if no accounts match. */
export function accountTypeCondition(accountType: string): SQL | null {
  const ids = db.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountType, accountType))
    .all()
    .map(a => a.id);
  return ids.length > 0 ? inArray(transactions.accountId, ids) : null;
}

// ─── OTP ───

export const otpSubmitSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  code: z.string().min(1).max(20),
});

// ─── Scrape Logs Query ───

export const scrapeLogsQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// ─── Scrape Sessions Query ───

export const scrapeSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Categories ───

export const createCategorySchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Name must be lowercase alphanumeric, dashes, or underscores'),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

// ─── Transaction Update ───

export const updateTransactionSchema = z.object({
  category: z.string().min(1).max(50).nullable(),
});
