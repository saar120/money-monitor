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
      throw new Error('The Mac did not respond in time.');
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
): Promise<HomeData> {
  const root = object(
    await authorizedGet(credential, '/api/mobile/v1/bootstrap', signal),
    'bootstrap',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'bootstrap');
  const meta = object(root.meta, 'response metadata');
  const financialDate = date(meta.financialDate, 'financial date');
  const generatedAt = text(meta.generatedAt, 'generation time');
  const home = object(data.home, 'Home');
  const primaryCurrencyCode = text(home.primaryCurrencyCode, 'primary currency');
  const aggregates = object(home.aggregates, 'Home aggregates');
  const spending = money(object(aggregates.spending, 'spending').amount);
  const netWorth = money(object(aggregates.netWorth, 'net worth').amount);
  const pulse = object(data.budgetPulse, 'budget');
  const pulseStatus = text(pulse.status, 'budget status');
  const hasBudget = pulseStatus !== 'unavailable';
  const budget = hasBudget ? money(pulse.limit) : null;
  const available = hasBudget ? money(pulse.remaining) : null;
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const day = Number(financialDate.slice(8, 10));
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
    available: available?.value ?? null,
    budget: budget?.value ?? null,
    budgetStatus: statusLabels[pulseStatus] ?? 'Budget unavailable',
    budgetNote: hasBudget ? 'Calculated on your Mac' : 'Manage budgets on your Mac',
    netWorth: netWorth.value,
    netWorthChange: null,
    assets: null,
    liabilities: null,
    categories: [],
    trend: [],
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

function mapTransaction(value: unknown, detail = false): Transaction {
  const item = object(value, 'transaction');
  const amount = money(item.amount);
  const direction = text(item.direction, 'transaction direction');
  const status = text(item.status, 'transaction status');
  const account = object(item.account, 'transaction account');
  const category = item.category === null ? null : object(item.category, 'transaction category');
  const occurredOn = date(item.occurredOn, 'transaction date');
  let owner = 'Unknown';
  if (detail) {
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
    effectiveDate: occurredOn,
  };
}

export async function fetchTransactions(
  credential: PairingCredential,
  query: { q?: string; filter: ActivityFilter; startDate: string },
  signal?: AbortSignal,
): Promise<TransactionPage> {
  const params = new URLSearchParams({ limit: '50', startDate: query.startDate });
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.filter === 'review') params.set('needsReview', 'true');
  if (query.filter === 'pending') params.set('status', 'pending');
  if (query.filter === 'credits') params.set('direction', 'credit');
  const root = object(
    await authorizedGet(credential, `/api/mobile/v1/transactions?${params.toString()}`, signal),
    'transactions',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'transactions');
  const page = object(data.page, 'transaction page');
  if (!Array.isArray(data.transactions)) throw new Error('The Mac returned invalid transactions.');
  return {
    financialDate: date(data.financialDate, 'financial date'),
    transactions: data.transactions.map((item) => mapTransaction(item)),
    hasMore: boolean(page.hasMore, 'transaction page'),
  };
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
  return mapTransaction(object(root.data, 'transaction').transaction, true);
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
    let timeout: ReturnType<typeof setTimeout>;
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
    timeout = setTimeout(finish, ms);
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
