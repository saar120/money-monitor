import { z } from 'zod';
import {
  bootstrapFinancialDateSchema,
  bootstrapInstantSchema,
  bootstrapMoneySchema,
  findBootstrapRedactionViolations,
} from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';

/** Fixed, bounded chart ranges. The labels intentionally match the iOS control. */
export const mobileNetWorthHistoryRangeSchema = z.enum(['3M', '6M', '1Y', 'All']);
export type MobileNetWorthHistoryRange = z.infer<typeof mobileNetWorthHistoryRangeSchema>;

export const mobileNetWorthHistoryQuerySchema = z
  .object({ range: mobileNetWorthHistoryRangeSchema })
  .strict();
export type MobileNetWorthHistoryQuery = z.infer<typeof mobileNetWorthHistoryQuerySchema>;

const ilsMoney = bootstrapMoneySchema.extend({ currencyCode: z.literal('ILS') }).strict();

const pointSchema = z
  .object({
    date: bootstrapFinancialDateSchema,
    total: ilsMoney,
    assetsTotal: ilsMoney,
    liabilitiesTotal: ilsMoney,
    bankBalancesTotal: ilsMoney,
  })
  .strict();

export const mobileNetWorthHistoryEnvelopeSchema = z
  .object({
    data: z
      .object({
        financialDate: bootstrapFinancialDateSchema,
        range: mobileNetWorthHistoryRangeSchema,
        period: z.object({ startDate: bootstrapFinancialDateSchema, endDate: bootstrapFinancialDateSchema }).strict(),
        baseCurrencyCode: z.literal('ILS'),
        // Historical account balances and asset snapshots are filled forward;
        // liabilities have no dated balance table. Do not present this as an
        // audited historical ledger on iPhone.
        estimatedHistory: z.literal(true),
        estimationMethod: z.literal('latest_known_values_carried_forward'),
        points: z.array(pointSchema).max(1_000),
      })
      .strict()
      .superRefine((data, context) => {
        if (data.period.endDate !== data.financialDate) {
          context.addIssue({ code: 'custom', path: ['period', 'endDate'], message: 'History must end on the financial date' });
        }
        let previous: string | undefined;
        data.points.forEach((point, index) => {
          if (point.date < data.period.startDate || point.date > data.period.endDate) {
            context.addIssue({ code: 'custom', path: ['points', index, 'date'], message: 'Point is outside the selected period' });
          }
          if (previous && point.date <= previous) {
            context.addIssue({ code: 'custom', path: ['points', index, 'date'], message: 'Points must be strictly chronological' });
          }
          previous = point.date;
        });
      }),
    meta: z
      .object({
        apiVersion: z.literal(MOBILE_API_VERSION),
        generatedAt: bootstrapInstantSchema,
        source: z.literal(MOBILE_RESPONSE_SOURCE),
        server: z.object({ id: z.string().uuid(), protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION) }).strict(),
      })
      .strict(),
  })
  .strict();

export type MobileNetWorthHistory = z.infer<typeof mobileNetWorthHistoryEnvelopeSchema>['data'];
export type MobileNetWorthHistoryEnvelope = z.infer<typeof mobileNetWorthHistoryEnvelopeSchema>;

export function validateMobileNetWorthHistoryEnvelope(input: unknown): { success: true; data: MobileNetWorthHistoryEnvelope } | { success: false } {
  if (findBootstrapRedactionViolations(input).length > 0) return { success: false };
  const parsed = mobileNetWorthHistoryEnvelopeSchema.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
