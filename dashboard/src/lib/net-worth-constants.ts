// Asset type colors — consistent across all net worth pages
export const ASSET_TYPE_COLORS: Record<string, string> = {
  brokerage: '#8b5cf6',
  pension: '#06b6d4',
  keren_hishtalmut: '#14b8a6',
  crypto: '#f59e0b',
  fund: '#6366f1',
  real_estate: '#ec4899',
  banks: '#34d399',
};

// Human-readable labels
export const ASSET_TYPE_LABELS: Record<string, string> = {
  brokerage: 'Brokerage',
  pension: 'Pension',
  keren_hishtalmut: 'Keren Hishtalmut',
  crypto: 'Crypto',
  fund: 'Fund',
  real_estate: 'Real Estate',
};

export const HOLDING_TYPE_LABELS: Record<string, string> = {
  stock: 'Stock',
  etf: 'ETF',
  cash: 'Cash',
  fund_units: 'Fund Units',
  crypto: 'Crypto',
  balance: 'Balance',
};

export const LIQUIDITY_LABELS: Record<string, string> = {
  liquid: 'Liquid',
  restricted: 'Restricted',
  locked: 'Locked',
};

export const LIABILITY_TYPE_LABELS: Record<string, string> = {
  loan: 'Loan',
  mortgage: 'Mortgage',
  credit_line: 'Credit Line',
  other: 'Other',
};

// Liquidity badge styles
export const LIQUIDITY_STYLES: Record<string, string> = {
  liquid: 'bg-success/10 text-success',
  restricted: 'bg-amber-500/10 text-amber-500',
  locked: 'bg-destructive/10 text-destructive',
};
