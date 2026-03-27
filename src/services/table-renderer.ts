// ── HTML table templates for server-side image generation ──────────────────────

const MAX_ROWS = 25;

// ── Shared helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-₪${formatted}` : `₪${formatted}`;
}

function amountClass(amount: number): string {
  return amount < 0 ? 'negative' : amount > 0 ? 'positive' : '';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function truncatedFooter(total: number, shown: number): string {
  if (total <= shown) return '';
  return `<div class="footer">... and ${total - shown} more</div>`;
}

function baseHtml(title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e; color: #e0e0e0; padding: 0; margin: 0;
  }
  #content { padding: 28px 32px; display: inline-block; min-width: 700px; max-width: 800px; }
  .title { font-size: 18px; font-weight: 600; margin-bottom: 4px; color: #f0f0f0; }
  .subtitle { font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th {
    background: #16213e; color: #94a3b8; text-transform: uppercase;
    font-size: 11px; letter-spacing: 0.5px; padding: 10px 12px; text-align: left;
    border-bottom: 2px solid #2a2a4a;
  }
  th.right, td.right { text-align: right; }
  td {
    padding: 10px 12px; border-bottom: 1px solid #2a2a4a;
    font-size: 13px; font-variant-numeric: tabular-nums;
  }
  tr:last-child td { border-bottom: none; }
  .negative { color: #f87171; }
  .positive { color: #4ade80; }
  .muted { color: #94a3b8; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 500; background: #16213e; color: #94a3b8;
  }
  .bar-cell { position: relative; }
  .bar {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: rgba(99, 102, 241, 0.15); border-radius: 0 4px 4px 0;
  }
  .bar-text { position: relative; z-index: 1; }
  .summary-row td {
    font-weight: 600; border-top: 2px solid #3b3b5c;
    padding-top: 12px; font-size: 14px;
  }
  .section-header td {
    font-weight: 600; font-size: 14px; color: #94a3b8;
    padding-top: 16px; padding-bottom: 6px; border-bottom: 1px solid #3b3b5c;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .footer { font-size: 12px; color: #64748b; padding-top: 12px; text-align: center; }
  .total-row td {
    font-weight: 700; font-size: 16px; border-top: 2px solid #6366f1;
    padding-top: 14px;
  }
  .trend-up::before { content: '↑ '; color: #f87171; }
  .trend-down::before { content: '↓ '; color: #4ade80; }
</style>
</head>
<body>
  <div id="content">
    <div class="title">${esc(title)}</div>
    <div class="subtitle">${esc(subtitle)}</div>
    ${body}
  </div>
</body>
</html>`;
}

// ── Transactions ──────────────────────────────────────────────────────────────────

interface TransactionRow {
  date: string;
  description: string;
  chargedAmount: number;
  category: string | null;
}

export function renderTransactions(
  rows: TransactionRow[],
  opts: { title?: string; subtitle?: string } = {},
): string {
  const shown = rows.slice(0, MAX_ROWS);
  const tableRows = shown
    .map(
      (r) => `<tr>
      <td>${formatDate(r.date)}</td>
      <td dir="auto">${esc(r.description)}</td>
      <td class="right ${amountClass(r.chargedAmount)}">${formatCurrency(r.chargedAmount)}</td>
      <td><span class="badge">${esc(r.category ?? 'uncategorized')}</span></td>
    </tr>`,
    )
    .join('\n');

  const body = `<table>
    <thead><tr>
      <th style="width:110px">Date</th>
      <th>Description</th>
      <th class="right" style="width:110px">Amount</th>
      <th style="width:130px">Category</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncatedFooter(rows.length, shown.length)}`;

  return baseHtml(
    opts.title ?? 'Transactions',
    opts.subtitle ?? `${rows.length} transactions`,
    body,
  );
}

// ── Spending Summary ─────────────────────────────────────────────────────────────

interface SpendingSummaryRow {
  category: string;
  totalAmount: number;
  transactionCount: number;
}

export function renderSpendingSummary(
  rows: SpendingSummaryRow[],
  opts: { title?: string; subtitle?: string } = {},
): string {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.totalAmount)), 1);
  const total = rows.reduce((s, r) => s + r.totalAmount, 0);
  const shown = rows.slice(0, MAX_ROWS);

  const tableRows = shown
    .map((r) => {
      const pct = Math.round((Math.abs(r.totalAmount) / maxAbs) * 100);
      return `<tr>
      <td dir="auto">${esc(r.category)}</td>
      <td class="bar-cell right">
        <div class="bar" style="width:${pct}%"></div>
        <span class="bar-text ${amountClass(r.totalAmount)}">${formatCurrency(r.totalAmount)}</span>
      </td>
      <td class="right muted">${r.transactionCount}</td>
    </tr>`;
    })
    .join('\n');

  const body = `<table>
    <thead><tr>
      <th>Category</th>
      <th class="right" style="width:160px">Amount</th>
      <th class="right" style="width:60px">Txns</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
    <tbody><tr class="summary-row">
      <td>Total</td>
      <td class="right ${amountClass(total)}">${formatCurrency(total)}</td>
      <td class="right muted">${rows.reduce((s, r) => s + r.transactionCount, 0)}</td>
    </tr></tbody>
  </table>
  ${truncatedFooter(rows.length, shown.length)}`;

  return baseHtml(
    opts.title ?? 'Spending Summary',
    opts.subtitle ?? `${rows.length} categories`,
    body,
  );
}

// ── Spending Trends ──────────────────────────────────────────────────────────────

interface SpendingTrendsData {
  months: { month: string; totalAmount: number; count: number }[];
  trend: 'increasing' | 'decreasing' | 'stable' | 'no_data';
  average: number;
}

export function renderSpendingTrends(
  data: SpendingTrendsData,
  opts: { title?: string; subtitle?: string } = {},
): string {
  const { months, trend, average } = data;
  const trendLabel =
    trend === 'increasing'
      ? '↑ Increasing'
      : trend === 'decreasing'
        ? '↓ Decreasing'
        : trend === 'stable'
          ? '→ Stable'
          : 'No data';
  const trendColor =
    trend === 'increasing' ? '#f87171' : trend === 'decreasing' ? '#4ade80' : '#94a3b8';

  const tableRows = months
    .map((r, i) => {
      const prev = i > 0 ? months[i - 1].totalAmount : null;
      let changeHtml = '<td class="right muted">—</td>';
      if (prev !== null && prev !== 0) {
        const changePct = ((r.totalAmount - prev) / Math.abs(prev)) * 100;
        const cls = changePct > 0 ? 'trend-up' : changePct < 0 ? 'trend-down' : '';
        changeHtml = `<td class="right ${cls}">${Math.abs(Math.round(changePct))}%</td>`;
      }
      return `<tr>
      <td>${formatMonth(r.month)}</td>
      <td class="right ${amountClass(r.totalAmount)}">${formatCurrency(r.totalAmount)}</td>
      <td class="right muted">${r.count}</td>
      ${changeHtml}
    </tr>`;
    })
    .join('\n');

  const body = `<table>
    <thead><tr>
      <th>Month</th>
      <th class="right" style="width:120px">Total</th>
      <th class="right" style="width:60px">Txns</th>
      <th class="right" style="width:80px">Change</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
    <tbody><tr class="summary-row">
      <td>Average</td>
      <td class="right">${formatCurrency(average)}</td>
      <td colspan="2" class="right" style="color:${trendColor}">${trendLabel}</td>
    </tr></tbody>
  </table>`;

  return baseHtml(
    opts.title ?? 'Spending Trends',
    opts.subtitle ?? `${months.length} months`,
    body,
  );
}

// ── Period Comparison ────────────────────────────────────────────────────────────

interface PeriodComparisonData {
  comparison: {
    category: string;
    period1_total: number;
    period2_total: number;
    change_amount: number;
    change_percent: number | null;
  }[];
  summary: {
    period1: { start: string; end: string; total: number };
    period2: { start: string; end: string; total: number };
    change_amount: number;
    change_percent: number | null;
  };
}

export function renderPeriodComparison(
  data: PeriodComparisonData,
  opts: { title?: string; subtitle?: string } = {},
): string {
  const { comparison, summary } = data;
  const p1Label = `${formatDate(summary.period1.start)} – ${formatDate(summary.period1.end)}`;
  const p2Label = `${formatDate(summary.period2.start)} – ${formatDate(summary.period2.end)}`;
  const shown = comparison.slice(0, MAX_ROWS);

  const tableRows = shown
    .map((r) => {
      const changePct =
        r.change_percent !== null ? `${r.change_percent > 0 ? '+' : ''}${r.change_percent}%` : '—';
      const changeClass =
        r.change_amount > 0 ? 'trend-up' : r.change_amount < 0 ? 'trend-down' : '';
      return `<tr>
      <td dir="auto">${esc(r.category)}</td>
      <td class="right ${amountClass(r.period1_total)}">${formatCurrency(r.period1_total)}</td>
      <td class="right ${amountClass(r.period2_total)}">${formatCurrency(r.period2_total)}</td>
      <td class="right ${changeClass}">${changePct}</td>
    </tr>`;
    })
    .join('\n');

  const overallChangePct =
    summary.change_percent !== null
      ? `${summary.change_percent > 0 ? '+' : ''}${summary.change_percent}%`
      : '—';
  const overallChangeClass =
    summary.change_amount > 0 ? 'trend-up' : summary.change_amount < 0 ? 'trend-down' : '';

  const body = `<table>
    <thead><tr>
      <th>Category</th>
      <th class="right" style="width:120px">Period 1</th>
      <th class="right" style="width:120px">Period 2</th>
      <th class="right" style="width:80px">Change</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
    <tbody><tr class="summary-row">
      <td>Total</td>
      <td class="right ${amountClass(summary.period1.total)}">${formatCurrency(summary.period1.total)}</td>
      <td class="right ${amountClass(summary.period2.total)}">${formatCurrency(summary.period2.total)}</td>
      <td class="right ${overallChangeClass}">${overallChangePct}</td>
    </tr></tbody>
  </table>
  ${truncatedFooter(comparison.length, shown.length)}`;

  return baseHtml(
    opts.title ?? 'Period Comparison',
    opts.subtitle ?? `${p1Label}  vs  ${p2Label}`,
    body,
  );
}

// ── Top Merchants ────────────────────────────────────────────────────────────────

interface TopMerchantRow {
  merchant: string;
  total_amount: number;
  transaction_count: number;
  avg_amount: number;
  category: string;
}

export function renderTopMerchants(
  rows: TopMerchantRow[],
  opts: { title?: string; subtitle?: string } = {},
): string {
  const shown = rows.slice(0, MAX_ROWS);

  const tableRows = shown
    .map(
      (r, i) => `<tr>
      <td class="muted">${i + 1}</td>
      <td dir="auto">${esc(r.merchant)}</td>
      <td class="right ${amountClass(r.total_amount)}">${formatCurrency(r.total_amount)}</td>
      <td class="right muted">${r.transaction_count}</td>
      <td class="right ${amountClass(r.avg_amount)}">${formatCurrency(r.avg_amount)}</td>
    </tr>`,
    )
    .join('\n');

  const body = `<table>
    <thead><tr>
      <th style="width:30px">#</th>
      <th>Merchant</th>
      <th class="right" style="width:110px">Total</th>
      <th class="right" style="width:60px">Txns</th>
      <th class="right" style="width:100px">Average</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncatedFooter(rows.length, shown.length)}`;

  return baseHtml(opts.title ?? 'Top Merchants', opts.subtitle ?? `${rows.length} merchants`, body);
}

// ── Net Worth ────────────────────────────────────────────────────────────────────

interface NetWorthData {
  total: number;
  liquidTotal: number;
  banks: { name: string; balanceIls: number }[];
  banksTotal: number;
  assets: { name: string; type: string; totalValueIls: number }[];
  assetsTotal: number;
  liabilities: { name: string; currentBalanceIls: number }[];
  liabilitiesTotal: number;
}

export function renderNetWorth(
  data: NetWorthData,
  opts: { title?: string; subtitle?: string } = {},
): string {
  const bankRows = data.banks
    .map(
      (b) => `<tr>
      <td dir="auto">${esc(b.name)}</td>
      <td class="right positive">${formatCurrency(b.balanceIls)}</td>
    </tr>`,
    )
    .join('\n');

  const assetRows = data.assets
    .map(
      (a) => `<tr>
      <td dir="auto">${esc(a.name)}</td>
      <td class="right positive">${formatCurrency(a.totalValueIls)}</td>
    </tr>`,
    )
    .join('\n');

  const liabilityRows = data.liabilities
    .map(
      (l) => `<tr>
      <td dir="auto">${esc(l.name)}</td>
      <td class="right negative">${formatCurrency(l.currentBalanceIls)}</td>
    </tr>`,
    )
    .join('\n');

  const body = `<table>
    <thead><tr>
      <th>Item</th>
      <th class="right" style="width:140px">Value (ILS)</th>
    </tr></thead>

    <tbody>
      <tr class="section-header"><td colspan="2">Bank Accounts</td></tr>
      ${bankRows}
      <tr class="summary-row"><td>Banks Subtotal</td><td class="right positive">${formatCurrency(data.banksTotal)}</td></tr>
    </tbody>

    <tbody>
      <tr class="section-header"><td colspan="2">Assets</td></tr>
      ${assetRows}
      <tr class="summary-row"><td>Assets Subtotal</td><td class="right positive">${formatCurrency(data.assetsTotal)}</td></tr>
    </tbody>

    <tbody>
      <tr class="section-header"><td colspan="2">Liabilities</td></tr>
      ${liabilityRows.length > 0 ? liabilityRows : '<tr><td colspan="2" class="muted">None</td></tr>'}
      <tr class="summary-row"><td>Liabilities Subtotal</td><td class="right negative">${formatCurrency(data.liabilitiesTotal)}</td></tr>
    </tbody>

    <tbody>
      <tr class="total-row">
        <td>Net Worth</td>
        <td class="right ${amountClass(data.total)}">${formatCurrency(data.total)}</td>
      </tr>
      <tr>
        <td class="muted">Liquid Net Worth</td>
        <td class="right muted">${formatCurrency(data.liquidTotal)}</td>
      </tr>
    </tbody>
  </table>`;

  return baseHtml(
    opts.title ?? 'Net Worth',
    opts.subtitle ??
      new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    body,
  );
}
