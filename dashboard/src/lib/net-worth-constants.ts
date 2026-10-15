// Asset type colors — consistent across all net worth pages
export const ASSET_TYPE_COLORS: Record<string, string> = {
  brokerage: '#5b7890',
  pension: '#547e83',
  keren_hishtalmut: '#64826c',
  crypto: '#a77b42',
  fund: '#738099',
  real_estate: '#947968',
  banks: '#7b8b70',
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

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  fee: 'Fee',
  adjustment: 'Adjustment',
  contribution: 'Contribution',
  rent_income: 'Rent Income',
};

// Liquidity badge styles
export const LIQUIDITY_STYLES: Record<string, string> = {
  liquid: 'bg-success/10 text-success',
  restricted: 'bg-amber-500/10 text-amber-500',
  locked: 'bg-destructive/10 text-destructive',
};
