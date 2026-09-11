import type { HomeData, Transaction } from './fixtures';
import type { PairingQrPayload } from './pairing/parse-pairing-qr';
import type { PairingCredential } from './security/pairing-credential-store';

type JsonObject = Record<string, unknown>;

export type ActivityFilter = 'all' | 'review' | 'pending' | 'credits';

export type TransactionPage = {
  financialDate: string;
  transactions: Transaction[];
  hasMore: boolean;
};

export type PairingProgress = 'requesting' | 'awaiting-approval' | 'exchanging';
export type CashflowMonth = {
  month: string;
  label: string;
  income: number;
  spending: number;
};
export type TransactionUpdate = Partial<
  Pick<Transaction, 'category' | 'owner' | 'included' | 'effectiveDate'>
> & { reviewed?: true };

const FINANCIAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The Mac returned invalid ${label} data.`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`The Mac returned invalid ${label}.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`The Mac returned invalid ${label}.`);
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!FINANCIAL_DATE.test(result)) throw new Error(`The Mac returned invalid ${label}.`);
  return result;
}

function money(value: unknown): { value: number; currencyCode: string } {
  const candidate = object(value, 'money');
  const decimal = text(candidate.value, 'money amount');
  const parsed = Number(decimal);
  if (!Number.isFinite(parsed)) throw new Error('The Mac returned an invalid money amount.');
  return { value: parsed, currencyCode: text(candidate.currencyCode, 'currency') };
}

function apiError(body: unknown, status: number): Error {
  try {
    const error = object(object(body, 'error response').error, 'error');
    return new Error(text(error.message, 'error message'));
  } catch {
    return new Error(`The Mac request failed (${status}).`);
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw apiError(body, response.status);
    return body;
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error('The Mac did not respond in time.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function authorizedGet(credential: PairingCredential, path: string, signal?: AbortSignal) {
  return requestJson(
    `${credential.baseURL}${path}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${credential.token}` },
    },
    signal,
  );
}

function verifyServer(root: JsonObject, credential: PairingCredential): void {
  const meta = object(root.meta, 'response metadata');
  const server = object(meta.server, 'server identity');
  if (text(server.id, 'server identity') !== credential.serverId) {
    throw new Error('The responding Mac does not match the paired Mac.');
  }
}

function freshnessDetail(
  status: string,
  lastSuccessfulSyncAt: unknown,
  generatedAt: string,
): { detail: string; state: 'fresh' | 'aging' | 'stale' } {
  if (status === 'never_synced') return { detail: 'Never synced', state: 'stale' };
  if (status === 'error') return { detail: 'Connection needs attention', state: 'stale' };
  if (typeof lastSuccessfulSyncAt !== 'string')
    return { detail: 'Sync time unavailable', state: 'stale' };

  const ageMinutes = Math.max(
    0,
    Math.round((Date.parse(generatedAt) - Date.parse(lastSuccessfulSyncAt)) / 60_000),
  );
  const detail =
    ageMinutes < 2
      ? 'Updated just now'
      : ageMinutes < 60
        ? `Updated ${ageMinutes} min ago`
        : ageMinutes < 1_440
          ? `Updated ${Math.round(ageMinutes / 60)} hr ago`
          : `Last updated ${Math.round(ageMinutes / 1_440)} days ago`;
  return { detail, state: status === 'fresh' ? (ageMinutes < 180 ? 'fresh' : 'aging') : 'stale' };
}

export async function fetchHomeData(
  credential: PairingCredential,
  signal?: AbortSignal,
  since?: string | null,
): Promise<HomeData> {
  const overviewPath = since
    ? `/api/mobile/v1/overview?since=${encodeURIComponent(since)}`
    : '/api/mobile/v1/overview';
  const [bootstrapValue, overviewValue] = await Promise.all([
    authorizedGet(credential, '/api/mobile/v1/bootstrap', signal),
    authorizedGet(credential, overviewPath, signal),
  ]);
  const root = object(bootstrapValue, 'bootstrap');
  const overviewRoot = object(overviewValue, 'overview');
  verifyServer(root, credential);
  verifyServer(overviewRoot, credential);
  const data = object(root.data, 'bootstrap');
  const meta = object(root.meta, 'response metadata');
  const overview = object(overviewRoot.data, 'overview');
  const financialDate = date(meta.financialDate, 'financial date');
  const generatedAt = text(meta.generatedAt, 'generation time');
  const primaryCurrencyCode = text(overview.currencyCode, 'primary currency');
  const cashflow = object(overview.cashflow, 'cashflow');
  const spending = money(cashflow.spending);
  const income = money(cashflow.income);
  const previousSpending = money(cashflow.previousSpending);
  const overviewNetWorth = object(overview.netWorth, 'net worth');
  const netWorth = money(overviewNetWorth.total);
  const budgets = Array.isArray(overview.budgets) ? overview.budgets : [];
  const primaryBudget = budgets[0] ? object(budgets[0], 'budget') : null;
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const month = new Intl.DateTimeFormat('en', { month: 'long' }).format(
    new Date(`${financialDate}T12:00:00Z`),
  );
  const statusLabels: Record<string, string> = {
    on_track: 'On track',
    watch: 'Watch spending',
    over_budget: 'Over budget',
    unavailable: 'No single budget',
    unknown: 'Budget unavailable',
  };

  return {
    currentDate: financialDate,
    month,
    currencyCode: primaryCurrencyCode,
    spent: spending.value,
    income: income.value,
    previousSpent: previousSpending.value,
    spendingVsIncomePercent:
      typeof cashflow.spendingVsIncomePercent === 'number'
        ? cashflow.spendingVsIncomePercent
        : null,
    available: primaryBudget ? money(primaryBudget.remaining).value : null,
    budget: primaryBudget ? money(primaryBudget.limit).value : null,
    budgetStatus: primaryBudget
      ? (statusLabels[text(primaryBudget.status, 'budget status')] ?? 'Budget unavailable')
      : 'No budget',
    budgetNote: primaryBudget ? 'Calculated on your Mac' : 'Manage budgets on your Mac',
    netWorth: netWorth.value,
    netWorthChange: overviewNetWorth.change === null ? null : money(overviewNetWorth.change).value,
    assets: overviewNetWorth.assets === null ? null : money(overviewNetWorth.assets).value,
    liabilities:
      overviewNetWorth.liabilities === null ? null : money(overviewNetWorth.liabilities).value,
    categories: (Array.isArray(overview.categories) ? overview.categories : []).map((raw) => {
      const category = object(raw, 'category');
      return {
        name: text(category.label, 'category label'),
        spent: money(category.current).value,
        previous: money(category.previous).value,
        budget: null,
        color: typeof category.color === 'string' ? category.color : '#52799A',
      };
    }),
    trend: (Array.isArray(overview.daily) ? overview.daily : []).map((raw) => {
      const point = object(raw, 'daily spending');
      return {
        day: Number(point.day),
        current: money(point.current).value,
        previous: money(point.previous).value,
      };
    }),
    budgets: budgets.map((raw) => {
      const budget = object(raw, 'budget');
      return {
        name: text(budget.name, 'budget name'),
        spent: money(budget.spent).value,
        limit: money(budget.limit).value,
        remaining: money(budget.remaining).value,
        usedPercent: Number(budget.usedPercent),
        elapsedPercent: Number(budget.elapsedPercent),
        status: text(budget.status, 'budget status') as HomeData['budgets'][number]['status'],
      };
    }),
    merchants: (Array.isArray(overview.merchants) ? overview.merchants : []).map((raw) => {
      const merchant = object(raw, 'merchant');
      return {
        name: text(merchant.name, 'merchant name'),
        category: text(merchant.category, 'merchant category'),
        current: money(merchant.current).value,
        previous: money(merchant.previous).value,
        count: Number(merchant.transactionCount),
      };
    }),
    reviewCount: Number(overview.reviewCount),
    sinceLastVisit:
      overview.sinceLastVisit === null
        ? null
        : (() => {
            const since = object(overview.sinceLastVisit, 'last visit');
            return { transactions: Number(since.transactions), spent: money(since.spent).value };
          })(),
    netWorthHistory: (Array.isArray(overviewNetWorth.history) ? overviewNetWorth.history : []).map(
      (raw) => {
        const point = object(raw, 'net worth history');
        return { date: date(point.date, 'net worth date'), total: money(point.total).value };
      },
    ),
    freshness: accounts.map((raw) => {
      const account = object(raw, 'account');
      const freshness = object(account.freshness, 'account freshness');
      const state = freshnessDetail(
        text(freshness.status, 'freshness status'),
        freshness.lastSuccessfulSyncAt,
        generatedAt,
      );
      const mask = text(account.identifierMask, 'account mask').replace(/^(?:••••|\*{4})\s*/, '');
      return {
        account: `${text(account.displayName, 'account name')} · ${mask}`,
        ...state,
      };
    }),
  };
}

export async function fetchCashflowMonth(
  credential: PairingCredential,
  month: string,
  signal?: AbortSignal,
): Promise<CashflowMonth> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid cash-flow month.');
  const value = await authorizedGet(
    credential,
    `/api/mobile/v1/overview?month=${encodeURIComponent(month)}`,
    signal,
  );
  const root = object(value, 'overview');
  verifyServer(root, credential);
  const overview = object(root.data, 'overview');
  const period = object(overview.period, 'overview period');
  const cashflow = object(overview.cashflow, 'cashflow');
  return {
    month: text(period.month, 'overview month'),
    label: text(period.label, 'overview month label').slice(0, 3),
    income: money(cashflow.income).value,
    spending: money(cashflow.spending).value,
  };
}

function mapTransaction(value: unknown): Transaction {
  const item = object(value, 'transaction');
  const amount = money(item.amount);
  const direction = text(item.direction, 'transaction direction');
  const status = text(item.status, 'transaction status');
  const account = object(item.account, 'transaction account');
  const category = item.category === null ? null : object(item.category, 'transaction category');
  const occurredOn = date(item.occurredOn, 'transaction date');
  let owner = 'Unknown';
  if (item.owner !== undefined) {
    const ownerValue = object(item.owner, 'transaction owner');
    const kind = text(ownerValue.kind, 'transaction owner');
    owner =
      kind === 'member' && typeof ownerValue.displayName === 'string'
        ? ownerValue.displayName
        : kind === 'shared'
          ? 'Shared'
          : kind === 'unassigned'
            ? 'Unassigned'
            : 'Unknown';
  }
  const signedAmount =
    direction === 'debit'
      ? -Math.abs(amount.value)
      : direction === 'credit'
        ? Math.abs(amount.value)
        : amount.value;
  return {
    id: text(item.id, 'transaction ID'),
    occurredAt: `${occurredOn}T12:00:00Z`,
    merchant: text(item.displayName, 'transaction name'),
    amount: signedAmount,
    currencyCode: amount.currencyCode,
    category: category ? text(category.label, 'transaction category') : 'Uncategorized',
    account: `${text(account.displayName, 'account name')} · ${text(account.identifierMask, 'account mask').replace(/^(?:••••|\*{4})\s*/, '')}`,
    pending: status === 'pending',
    needsReview: boolean(item.needsReview, 'review state'),
    owner,
    included: !boolean(item.excludedFromReports, 'inclusion state'),
    effectiveDate:
      typeof item.effectiveOn === 'string' ? date(item.effectiveOn, 'effective date') : occurredOn,
  };
}

export async function fetchTransactions(
  credential: PairingCredential,
  query: { q?: string; category?: string; filter: ActivityFilter; startDate?: string },
  signal?: AbortSignal,
): Promise<TransactionPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.category?.trim()) params.set('category', query.category.trim());
  if (query.filter === 'review') params.set('needsReview', 'true');
  if (query.filter === 'review') params.set('includeExcluded', 'true');
  if (query.filter === 'pending') params.set('status', 'pending');
  if (query.filter === 'credits') params.set('direction', 'credit');
  const transactions: Transaction[] = [];
  const seenCursors = new Set<string>();
  let financialDate: string;
  let cursor: string | null = null;

  do {
    if (cursor) params.set('cursor', cursor);
    const root = object(
      await authorizedGet(credential, `/api/mobile/v1/transactions?${params.toString()}`, signal),
      'transactions',
    );
    verifyServer(root, credential);
    const data = object(root.data, 'transactions');
    const page = object(data.page, 'transaction page');
    if (!Array.isArray(data.transactions))
      throw new Error('The Mac returned invalid transactions.');
    const hasMore = boolean(page.hasMore, 'transaction page');
    const nextCursor =
      page.nextCursor === null || page.nextCursor === undefined
        ? null
        : text(page.nextCursor, 'transaction cursor');
    if (hasMore !== (nextCursor !== null))
      throw new Error('The Mac returned invalid transaction paging data.');
    if (nextCursor && seenCursors.has(nextCursor))
      throw new Error('The Mac returned repeated transaction paging data.');
    if (nextCursor) seenCursors.add(nextCursor);
    financialDate = date(data.financialDate, 'financial date');
    transactions.push(...data.transactions.map((item) => mapTransaction(item)));
    cursor = nextCursor;
  } while (cursor);

  return { financialDate, transactions, hasMore: false };
}

export async function fetchTransactionDetail(
  credential: PairingCredential,
  id: string,
  signal?: AbortSignal,
): Promise<Transaction> {
  const root = object(
    await authorizedGet(
      credential,
      `/api/mobile/v1/transactions/${encodeURIComponent(id)}`,
      signal,
    ),
    'transaction',
  );
  verifyServer(root, credential);
  return mapTransaction(object(root.data, 'transaction').transaction);
}

export async function fetchReviewOptions(credential: PairingCredential, signal?: AbortSignal) {
  const root = object(
    await authorizedGet(credential, '/api/mobile/v1/transactions/review-options', signal),
    'review options',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'review options');
  if (!Array.isArray(data.categories) || !Array.isArray(data.owners))
    throw new Error('The Mac returned invalid review options.');
  return {
    categories: data.categories.map((value) => text(value, 'category')),
    owners: data.owners.map((value) => text(value, 'owner')),
  };
}

export async function updateTransaction(
  credential: PairingCredential,
  id: string,
  update: TransactionUpdate,
  signal?: AbortSignal,
): Promise<Transaction> {
  const root = object(
    await requestJson(
      `${credential.baseURL}/api/mobile/v1/transactions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.token}`,
        },
        body: JSON.stringify(update),
      },
      signal,
    ),
    'transaction',
  );
  verifyServer(root, credential);
  return mapTransaction(object(root.data, 'transaction').transaction);
}

function post(baseURL: string, path: string, body: JsonObject, signal?: AbortSignal) {
  return requestJson(
    `${baseURL}${path}`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    signal,
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Pairing was cancelled.'));
    };
    if (signal?.aborted) {
      reject(new Error('Pairing was cancelled.'));
      return;
    }
    const timeout = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function completePairing(
  pairing: PairingQrPayload,
  deviceName: string,
  onProgress: (progress: PairingProgress) => void,
  signal?: AbortSignal,
  pollDelayMs?: number,
): Promise<PairingCredential> {
  if (Date.parse(pairing.expiresAt) <= Date.now()) {
    throw new Error('This pairing code has expired. Create a new one on your Mac.');
  }
  onProgress('requesting');
  const startRoot = object(
    await post(
      pairing.baseURL,
      '/api/mobile/v1/pairing/start',
      {
        pairingId: pairing.pairingId,
        nonce: pairing.nonce,
        serverId: pairing.serverId,
        protocolVersion: pairing.protocolVersion,
        deviceName: deviceName.trim() || 'iPhone',
      },
      signal,
    ),
    'pairing response',
  );
  const start = object(startRoot.data, 'pairing response');
  const claimantSecret = text(start.claimantSecret, 'pairing claimant');
  const serverDelay =
    typeof start.pollAfterSeconds === 'number' ? start.pollAfterSeconds * 1_000 : 1_000;
  onProgress('awaiting-approval');

  while (true) {
    if (Date.parse(pairing.expiresAt) <= Date.now()) {
      throw new Error('Pairing expired before it was approved.');
    }
    await wait(pollDelayMs ?? serverDelay, signal);
    const statusRoot = object(
      await post(
        pairing.baseURL,
        '/api/mobile/v1/pairing/status',
        { pairingId: pairing.pairingId, claimantSecret },
        signal,
      ),
      'pairing status',
    );
    const status = text(object(statusRoot.data, 'pairing status').status, 'pairing status');
    if (status === 'approved') break;
    if (status !== 'pending_approval')
      throw new Error('The Mac returned an invalid pairing state.');
  }

  onProgress('exchanging');
  const exchangeRoot = object(
    await post(
      pairing.baseURL,
      '/api/mobile/v1/pairing/exchange',
      { pairingId: pairing.pairingId, claimantSecret },
      signal,
    ),
    'pairing exchange',
  );
  const exchange = object(exchangeRoot.data, 'pairing exchange');
  if (exchange.status !== 'claimed') throw new Error('The Mac did not issue a pairing credential.');
  const credential = object(exchange.credential, 'pairing credential');
  const token = text(credential.token, 'pairing credential');
  if (!TOKEN.test(token)) throw new Error('The Mac returned an invalid pairing credential.');
  return { serverId: pairing.serverId, baseURL: pairing.baseURL, token };
}
