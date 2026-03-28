import { z } from 'zod';
import {
  COMPANY_IDS,
  ASSET_TYPES,
  LIQUIDITY_TYPES,
  HOLDING_TYPES,
  LIABILITY_TYPES,
  MOVEMENT_TYPES,
} from '../shared/types.js';

// ─── Accounts ───

export const createAccountSchema = z.object({
  companyId: z.enum(COMPANY_IDS),
  displayName: z.string().min(1).max(100),
  credentials: z
    .record(z.string().min(1), z.string())
    .refine((obj) => Object.keys(obj).length > 0, 'At least one credential field is required'),
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
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  category: z.string().optional(),
  status: z.enum(['completed', 'pending']).optional(),
  needsReview: z.coerce.boolean().optional(),
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
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  groupBy: z
    .enum(['category', 'month', 'account', 'cashflow', 'cashflow-detail'])
    .default('category'),
  expensesOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ─── AI ───

export const sessionChatSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

export const categorizeSchema = z.object({
  batchSize: z.number().int().min(1).max(500).default(50),
});

export const recategorizeSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

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
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'Name must be lowercase alphanumeric, dashes, or underscores'),
  label: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  rules: z.string().max(500).optional(),
});

export const updateCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  rules: z.string().max(500).nullable().optional(),
  ignoredFromStats: z.boolean().optional(),
});

// ─── Transaction Update ───

export const updateTransactionSchema = z.object({
  category: z.string().min(1).max(50).nullable(),
});

export const resolveReviewSchema = z.object({
  category: z.string().min(1).max(50),
});

// ─── Assets ───

export const createAssetSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(ASSET_TYPES),
  institution: z.string().max(100).optional(),
  currency: z.string().min(1).max(10).default('ILS'),
  liquidity: z.enum(LIQUIDITY_TYPES).default('liquid'),
  linkedAccountId: z.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
  initialValue: z.number().min(0).optional(),
  initialCostBasis: z.number().min(0).optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(ASSET_TYPES).optional(),
  institution: z.string().max(100).nullable().optional(),
  currency: z.string().min(1).max(10).optional(),
  liquidity: z.enum(LIQUIDITY_TYPES).optional(),
  linkedAccountId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const createHoldingSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(HOLDING_TYPES),
  currency: z.string().min(1).max(10),
  quantity: z.number().min(0),
  costBasis: z.number().min(0).default(0),
  lastPrice: z.number().optional(),
  notes: z.string().max(500).optional(),
});

export const updateHoldingSchema = z.object({
  quantity: z.number().min(0).optional(),
  costBasis: z.number().min(0).optional(),
  lastPrice: z.number().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const assetsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});

export const snapshotsQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const updateAssetValueSchema = z.object({
  currentValue: z.number().min(0),
  contribution: z.number().min(0).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().max(500).optional(),
});

export const recordRentSchema = z.object({
  amount: z.number().positive(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().max(500).optional(),
});

// ─── Liabilities ───

export const createLiabilitySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(LIABILITY_TYPES),
  currency: z.string().min(1).max(10).default('ILS'),
  originalAmount: z.number().positive(),
  currentBalance: z.number().min(0),
  interestRate: z.number().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().max(500).optional(),
});

export const updateLiabilitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(LIABILITY_TYPES).optional(),
  currency: z.string().min(1).max(10).optional(),
  originalAmount: z.number().positive().optional(),
  currentBalance: z.number().min(0).optional(),
  interestRate: z.number().nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const liabilitiesQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});

// ─── Net Worth ───

export const netWorthHistoryQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

// ─── Budgets ───

export const createBudgetSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().positive(),
  period: z.enum(['monthly', 'yearly']).default('monthly'),
  categoryNames: z.array(z.string().min(1)).min(1),
  alertThreshold: z.number().int().min(0).max(100).default(80),
  alertEnabled: z.boolean().default(true),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const updateBudgetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  amount: z.number().positive().optional(),
  period: z.enum(['monthly', 'yearly']).optional(),
  categoryNames: z.array(z.string().min(1)).min(1).optional(),
  alertThreshold: z.number().int().min(0).max(100).optional(),
  alertEnabled: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});

export const budgetProgressQuerySchema = z.object({
  monthlyView: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ─── Movements ───

export const createMovementSchema = z.object({
  holdingId: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number(),
  currency: z.string().min(1).max(10),
  pricePerUnit: z.number().positive().optional(),
  sourceAmount: z.number().positive().optional(),
  sourceCurrency: z.string().min(1).max(10).optional(),
  notes: z.string().max(500).optional(),
});

export const movementQuerySchema = z.object({
  holdingId: z.coerce.number().int().positive().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
