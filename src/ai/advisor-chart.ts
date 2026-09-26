import { z } from 'zod';

export const advisorChartSchema = z.object({
  kind: z.enum(['bar', 'line']),
  title: z.string().min(1).max(100),
  currencyCode: z.literal('ILS'),
  points: z
    .array(z.object({ label: z.string().min(1).max(60), value: z.number().finite() }))
    .min(1)
    .max(24),
});
export type AdvisorChart = z.infer<typeof advisorChartSchema>;
