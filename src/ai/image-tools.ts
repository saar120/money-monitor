import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import { createAgentTool } from './tool-adapter.js';
import { renderHtmlToImage, screenshotDashboard } from '../services/html-to-image.js';
import {
  renderTransactions,
  renderSpendingSummary,
  renderSpendingTrends,
  renderPeriodComparison,
  renderTopMerchants,
  renderNetWorth,
} from '../services/table-renderer.js';
import { listTransactions } from '../services/transactions.js';
import {
  getSpendingSummary as getSpendingSummaryService,
  comparePeriods as comparePeriodsService,
  getSpendingTrends as getSpendingTrendsService,
  getTopMerchants as getTopMerchantsService,
} from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';

// ── Image queue ──────────────────────────────────────────────────────────────────

const pendingImages: { buffer: Buffer; caption: string }[] = [];

/** Drain and return all pending images (called by bot.ts after chat()). */
export function drainPendingImages(): { buffer: Buffer; caption: string }[] {
  return pendingImages.splice(0);
}

// ── Dashboard chart screenshots ──────────────────────────────────────────────────

const CHART_VIEWS: Record<string, { route: string; selector: string; caption: string }> = {
  spending_chart: {
    route: '/',
    selector: '#chart-spending-by-category',
    caption: 'Spending by Category',
  },
  monthly_trend_chart: {
    route: '/',
    selector: '#chart-monthly-trend',
    caption: 'Monthly Trend',
  },
  cashflow_chart: {
    route: '/',
    selector: '#chart-cashflow',
    caption: 'Cashflow',
  },
  networth_allocation_chart: {
    route: '/net-worth',
    selector: '#chart-networth-allocation',
    caption: 'Net Worth Allocation',
  },
  networth_trend_chart: {
    route: '/net-worth',
    selector: '#chart-networth-trend',
    caption: 'Net Worth Trend',
  },
};

type ChartViewType = keyof typeof CHART_VIEWS;

// Multi-chart views: each key maps to multiple individual chart views to send separately
const MULTI_CHART_VIEWS: Record<string, ChartViewType[]> = {
  overview_charts: ['spending_chart', 'monthly_trend_chart'],
  networth_charts: ['networth_allocation_chart', 'networth_trend_chart'],
};

// ── Table view renderers ─────────────────────────────────────────────────────────

type TableViewType =
  | 'transactions'
  | 'spending_summary'
  | 'spending_trends'
  | 'period_comparison'
  | 'top_merchants'
  | 'net_worth';

function dateRangeSubtitle(startDate?: string, endDate?: string): string {
  const parts: string[] = [];
  if (startDate) parts.push(`from ${startDate}`);
  if (endDate) parts.push(`to ${endDate}`);
  return parts.length > 0 ? parts.join(' ') : 'All time';
}

async function generateTableView(args: {
  view: TableViewType;
  start_date?: string;
  end_date?: string;
  category?: string;
  account_id?: number;
  period2_start?: string;
  period2_end?: string;
  limit?: number;
}): Promise<{ html: string; caption: string }> {
  const subtitle = dateRangeSubtitle(args.start_date, args.end_date);
  const limit = Math.min(args.limit ?? 15, 50);

  switch (args.view) {
    case 'transactions': {
      const result = listTransactions(
        {
          startDate: args.start_date,
          endDate: args.end_date,
          category: args.category,
          accountId: args.account_id,
        },
        { limit, sortBy: 'date', sortOrder: 'desc' },
      );
      const html = renderTransactions(result.transactions, { subtitle });
      const caption = `Transactions (${result.pagination.total} total)`;
      return { html, caption };
    }

    case 'spending_summary': {
      const result = getSpendingSummaryService(
        { startDate: args.start_date, endDate: args.end_date, accountId: args.account_id },
        'category',
      );
      const rows = result.summary as {
        category: string;
        totalAmount: number;
        transactionCount: number;
      }[];
      const total = rows.reduce((s, r) => s + r.totalAmount, 0);
      const html = renderSpendingSummary(rows, { subtitle });
      const caption = `Spending summary: ${rows.length} categories, total ₪${Math.abs(Math.round(total)).toLocaleString()}`;
      return { html, caption };
    }

    case 'spending_trends': {
      const result = getSpendingTrendsService({
        months: args.limit ?? 6,
        category: args.category,
        accountId: args.account_id,
      });
      const html = renderSpendingTrends(result, {
        subtitle: `${result.months.length} months, trend: ${result.trend}`,
      });
      const caption = `Spending trends: ${result.trend} (avg ₪${Math.abs(Math.round(result.average)).toLocaleString()}/mo)`;
      return { html, caption };
    }

    case 'period_comparison': {
      if (!args.start_date || !args.end_date || !args.period2_start || !args.period2_end) {
        throw new Error(
          'period_comparison requires start_date, end_date, period2_start, and period2_end',
        );
      }
      const result = comparePeriodsService({
        period1Start: args.start_date,
        period1End: args.end_date,
        period2Start: args.period2_start,
        period2End: args.period2_end,
        accountId: args.account_id,
      });
      const html = renderPeriodComparison(result);
      const changePct =
        result.summary.change_percent !== null
          ? ` (${result.summary.change_percent > 0 ? '+' : ''}${result.summary.change_percent}%)`
          : '';
      const caption = `Period comparison: ₪${Math.abs(Math.round(result.summary.change_amount)).toLocaleString()} change${changePct}`;
      return { html, caption };
    }

    case 'top_merchants': {
      const result = getTopMerchantsService({
        startDate: args.start_date,
        endDate: args.end_date,
        limit,
        category: args.category,
        accountId: args.account_id,
      });
      const html = renderTopMerchants(result.top_merchants, { subtitle });
      const caption = `Top ${result.top_merchants.length} merchants (of ${result.total_merchants_found})`;
      return { html, caption };
    }

    case 'net_worth': {
      const result = await getNetWorth();
      const html = renderNetWorth(result);
      const caption = `Net worth: ₪${Math.round(result.total).toLocaleString()} (liquid: ₪${Math.round(result.liquidTotal).toLocaleString()})`;
      return { html, caption };
    }

    default:
      throw new Error(`Unknown view: ${args.view}`);
  }
}

// ── Tool builder ─────────────────────────────────────────────────────────────────

const ALL_VIEWS = [
  // Chart views (screenshot from dashboard) — individual
  'spending_chart',
  'monthly_trend_chart',
  'cashflow_chart',
  'networth_allocation_chart',
  'networth_trend_chart',
  // Multi-chart views (sends each chart as a separate image)
  'overview_charts',
  'networth_charts',
  // Table views (server-rendered HTML)
  'transactions',
  'spending_summary',
  'spending_trends',
  'period_comparison',
  'top_merchants',
  'net_worth',
] as const;

export function buildGenerateTableImageTool() {
  return createAgentTool({
    name: 'generate_table_image',
    description:
      'Generate a styled PNG image of financial data and send it via Telegram. ' +
      'Use this when the user asks to "show me", "send a chart/table/image", or wants a visual summary. ' +
      'Chart views (spending_chart, monthly_trend_chart, overview_charts, cashflow_chart, networth_*) ' +
      'capture the actual dashboard charts (ECharts). Table views (transactions, spending_summary, etc.) ' +
      'render styled data tables. The image is automatically delivered to the chat.',
    label: 'Generating table image',
    parameters: Type.Object({
      view: StringEnum([...ALL_VIEWS] as unknown as string[], {
        description:
          'Which view to render. Chart views: spending_chart (donut), monthly_trend_chart (bar), ' +
          'overview_charts (both), cashflow_chart (sankey), networth_allocation_chart, networth_trend_chart, ' +
          'networth_charts (both). Table views: transactions, spending_summary, spending_trends, ' +
          'period_comparison, top_merchants, net_worth.',
      }),
      start_date: Type.Optional(
        Type.String({ description: 'Start date (ISO string, e.g. "2026-01-01")' }),
      ),
      end_date: Type.Optional(
        Type.String({ description: 'End date (ISO string, e.g. "2026-01-31")' }),
      ),
      category: Type.Optional(Type.String({ description: 'Filter by category name' })),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
      period2_start: Type.Optional(
        Type.String({ description: 'Second period start date (for period_comparison only)' }),
      ),
      period2_end: Type.Optional(
        Type.String({ description: 'Second period end date (for period_comparison only)' }),
      ),
      limit: Type.Optional(
        Type.Number({
          description:
            'Max rows to show (default 15, max 50). For spending_trends, this is the number of months.',
        }),
      ),
    }),
    execute: async (args) => {
      const view = args.view as string;

      // Multi-chart views — send each chart as a separate image
      if (view in MULTI_CHART_VIEWS) {
        const chartKeys = MULTI_CHART_VIEWS[view];
        const captions: string[] = [];
        for (const key of chartKeys) {
          const chartDef = CHART_VIEWS[key];
          const buffer = await screenshotDashboard(chartDef.route, chartDef.selector);
          pendingImages.push({ buffer, caption: chartDef.caption });
          captions.push(chartDef.caption);
        }
        return `${captions.length} images generated: ${captions.join(', ')}`;
      }

      // Single chart views — screenshot the live dashboard
      if (view in CHART_VIEWS) {
        const chartDef = CHART_VIEWS[view as ChartViewType];
        const buffer = await screenshotDashboard(chartDef.route, chartDef.selector);
        pendingImages.push({ buffer, caption: chartDef.caption });
        return `Image generated and queued for delivery: ${chartDef.caption}`;
      }

      // Table views — server-rendered HTML
      const { html, caption } = await generateTableView(
        args as Parameters<typeof generateTableView>[0],
      );
      const buffer = await renderHtmlToImage(html);
      pendingImages.push({ buffer, caption });
      return `Image generated and queued for delivery: ${caption}`;
    },
  });
}
