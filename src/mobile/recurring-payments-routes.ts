import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bootstrapFinancialDateSchema,
  bootstrapCurrencyCodeSchema,
  mobileFinancialDateFor,
} from './bootstrap-contract.js';
import {
  MOBILE_API_VERSION,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RESPONSE_SOURCE,
  MobileApiError,
} from './contract.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';

const money = z.number().finite().nonnegative();
const publicAccountId = z.string().regex(/^account_[A-Za-z0-9_-]{22}$/);
const recurringPaymentSchema = z
  .object({
    name: z.string().min(1).max(160),
    accountId: publicAccountId,
    merchantKey: z.string().min(1).max(160),
    accountName: z.string().min(1).max(80),
    currencyCode: bootstrapCurrencyCodeSchema,
    usualAmount: money,
    monthlyCost: money,
    annualCost: money,
    frequency: z.enum([
      'weekly',
      'biweekly',
      'monthly',
      'everyTwoMonths',
      'quarterly',
      'semiannual',
      'yearly',
    ]),
    occurrences: z.number().int().min(2),
    lastChargeDate: bootstrapFinancialDateSchema,
    nextExpectedDate: bootstrapFinancialDateSchema,
    confidence: z.enum(['likely', 'possible']),
    kind: z.enum(['subscription', 'serviceBill']),
    source: z.enum(['automatic', 'manual', 'suggestion', 'excluded']),
  })
  .strict();

const resultSchema = z
  .object({
    payments: z.array(recurringPaymentSchema).max(500),
    suggestions: z.array(recurringPaymentSchema).max(500),
    excluded: z.array(recurringPaymentSchema).max(500),
    totals: z
      .array(
        z
          .object({
            currencyCode: bootstrapCurrencyCodeSchema,
            monthlyCost: money,
            annualCost: money,
          })
          .strict(),
      )
      .max(20),
    asOfDate: bootstrapFinancialDateSchema,
    classificationPending: z.boolean().default(false),
  })
  .strict();

const detailSchema = z
  .object({
    payment: recurringPaymentSchema,
    previousAmount: money.nullable(),
    changedOnDate: bootstrapFinancialDateSchema.nullable(),
    transactions: z
      .array(
        z
          .object({
            id: z.string().regex(/^transaction_[A-Za-z0-9_-]{22}$/),
            date: bootstrapFinancialDateSchema,
            description: z.string().min(1).max(160),
            amount: money,
            inPattern: z.boolean(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();

export interface MobileRecurringPaymentsDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string; protocolVersion: typeof MOBILE_PROTOCOL_VERSION };
  provide: (asOfDate: string) => unknown | Promise<unknown>;
  detail?: (
    identity: { accountId: string; currencyCode: string; merchantKey: string },
    asOfDate: string,
  ) => unknown | Promise<unknown>;
  decide?: (
    input: {
      accountId: string;
      currencyCode: string;
      merchantKey: string;
      decision: 'include' | 'exclude' | 'auto';
    },
    asOfDate: string,
  ) => unknown | Promise<unknown>;
}

export function registerMobileRecurringPaymentsRoute(
  app: FastifyInstance,
  dependencies: MobileRecurringPaymentsDependencies,
  clock: () => Date,
): void {
  app.get(
    '/api/mobile/v1/recurring-payments',
    { onRequest: createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read') },
    async () => {
      const now = clock();
      const asOfDate = mobileFinancialDateFor(now);
      const parsed = resultSchema.safeParse(await dependencies.provide(asOfDate));
      if (!parsed.success) throw new MobileApiError('internal_server_error');
      return {
        data: parsed.data,
        meta: {
          apiVersion: MOBILE_API_VERSION,
          generatedAt: now.toISOString(),
          source: MOBILE_RESPONSE_SOURCE,
          server: dependencies.server,
        },
      };
    },
  );
  if (dependencies.detail)
    app.get(
      '/api/mobile/v1/recurring-payments/detail',
      { onRequest: createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read') },
      async (request) => {
        const query = z
          .object({
            accountId: publicAccountId,
            currencyCode: bootstrapCurrencyCodeSchema,
            merchantKey: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .safeParse(request.query);
        if (!query.success) throw new MobileApiError('validation_error');
        const now = clock();
        const detail = await dependencies.detail!(query.data, mobileFinancialDateFor(now));
        if (!detail) throw new MobileApiError('route_not_found');
        const parsed = detailSchema.safeParse(detail);
        if (!parsed.success) throw new MobileApiError('internal_server_error');
        return {
          data: parsed.data,
          meta: {
            apiVersion: MOBILE_API_VERSION,
            generatedAt: now.toISOString(),
            source: MOBILE_RESPONSE_SOURCE,
            server: dependencies.server,
          },
        };
      },
    );
  if (dependencies.decide)
    app.put(
      '/api/mobile/v1/recurring-payments/decision',
      {
        onRequest: createMobileAuthenticationHook(dependencies.authenticator, 'mobile.read'),
        bodyLimit: 4096,
      },
      async (request) => {
        const input = z
          .object({
            accountId: publicAccountId,
            currencyCode: bootstrapCurrencyCodeSchema,
            merchantKey: z.string().min(1).max(160),
            decision: z.enum(['include', 'exclude', 'auto']),
          })
          .strict()
          .safeParse(request.body);
        if (!input.success) throw new MobileApiError('validation_error');
        const now = clock();
        const asOfDate = mobileFinancialDateFor(now);
        const parsed = resultSchema.safeParse(await dependencies.decide!(input.data, asOfDate));
        if (!parsed.success) throw new MobileApiError('internal_server_error');
        return {
          data: parsed.data,
          meta: {
            apiVersion: MOBILE_API_VERSION,
            generatedAt: now.toISOString(),
            source: MOBILE_RESPONSE_SOURCE,
            server: dependencies.server,
          },
        };
      },
    );
}
