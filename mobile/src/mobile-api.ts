import { throwIfAborted } from './abort.ts';
import { createSseParser } from '../../src/shared/sse-parser.ts';
import {
  MobileRequestError,
  invalidateAuthentication,
  terminalAuthenticationError,
} from './request-error.ts';
import { t, type MessageKey } from './translations.ts';
import { currentLanguage } from './locale-state.ts';
import { currentLocale } from './locale-state.ts';
import type { HomeData, Transaction } from './fixtures';
import type { PairingQrPayload } from './pairing/parse-pairing-qr';
import type { PairingCredential } from './security/pairing-credential-store';

type JsonObject = Record<string, unknown>;

export type ActivityFilter = 'all' | 'review' | 'pending' | 'credits';
export type TransactionQuery = {
  limit?: number;
  q?: string;
  category?: string;
  categories?: string[];
  filter?: ActivityFilter;
  startDate?: string;
  endDate?: string;
  accountId?: string;
  status?: 'posted' | 'pending';
  direction?: 'debit' | 'credit';
  needsReview?: boolean;
  includeExcluded?: boolean;
  cursor?: string;
};

export type TransactionPage = {
  financialDate: string;
  transactions: Transaction[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type PairingProgress = 'requesting' | 'awaiting-approval' | 'exchanging';
export type ExploreMonth = {
  month: string;
  label: string;
  currencyCode: string;
  income: number;
  spending: number;
  categories: HomeData['categories'];
  budgets: HomeData['budgets'];
  merchants: HomeData['merchants'];
};
export type CashflowMonth = Pick<ExploreMonth, 'month' | 'label' | 'income' | 'spending'>;
export type RecurringPayment = {
  resourceVersion?: number;
  accountId: string;
  merchantKey: string;
  name: string;
  accountName: string;
  currencyCode: string;
  usualAmount: number;
  monthlyCost: number;
  annualCost: number;
  frequency: 'monthly' | 'everyTwoMonths';
  occurrences: number;
  lastChargeDate: string;
  nextExpectedDate: string;
  confidence: 'likely' | 'possible';
  kind: 'subscription' | 'serviceBill';
  source: 'automatic' | 'manual' | 'suggestion' | 'excluded';
};
export type RecurringPayments = {
  payments: RecurringPayment[];
  suggestions: RecurringPayment[];
  excluded: RecurringPayment[];
  totals: Array<{ currencyCode: string; monthlyCost: number; annualCost: number }>;
  asOfDate: string;
  classificationPending: boolean;
  classificationStatus?: 'pending' | 'complete' | 'unavailable';
};
export type RecurringPaymentDetail = {
  payment: RecurringPayment;
  previousAmount: number | null;
  changedOnDate: string | null;
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    inPattern: boolean;
  }>;
};
export type TransactionUpdate = Partial<
  Pick<Transaction, 'category' | 'owner' | 'included' | 'effectiveDate'>
> & { reviewed?: true; commandId?: string; expectedVersion?: number };

export type AdvisorChart = {
  kind: 'bar' | 'line';
  title: string;
  currencyCode: 'ILS';
  points: { label: string; value: number }[];
};
export type AdvisorMessage = {
  id?: string;
  provisional?: boolean;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  chart?: AdvisorChart;
};
export type AdvisorSession = { id: string; title: string; createdAt: string; updatedAt: string };

const advisorPath = '/api/mobile/v1/advisor/sessions';

export async function listAdvisorSessions(
  credential: PairingCredential,
): Promise<AdvisorSession[]> {
  const root = object(await authorizedGet(credential, advisorPath), 'advisor sessions');
  verifyServer(root, credential);
  const sessions = object(root.data, 'advisor sessions').sessions;
  if (!Array.isArray(sessions)) throw new Error('The Mac returned invalid advisor sessions.');
  return sessions as AdvisorSession[];
}

export async function createAdvisorSession(
  credential: PairingCredential,
  id?: string,
): Promise<AdvisorSession> {
  const root = object(
    await requestJson(`${credential.baseURL}${advisorPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'X-Money-Monitor-Server-Id': credential.serverId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id }),
    }),
    'advisor session',
  );
  verifyServer(root, credential);
  return object(object(root.data, 'advisor session').session, 'advisor session') as AdvisorSession;
}

export async function getAdvisorSession(
  credential: PairingCredential,
  id: string,
): Promise<{ meta: AdvisorSession; messages: AdvisorMessage[]; replies?: AdvisorReply[] }> {
  const root = object(
    await authorizedGet(credential, `${advisorPath}/${encodeURIComponent(id)}`),
    'advisor session',
  );
  verifyServer(root, credential);
  const session = object(object(root.data, 'advisor session').session, 'advisor session');
  if (!Array.isArray(session.messages))
    throw new Error('The Mac returned invalid advisor messages.');
  return {
    meta: object(session.meta, 'advisor session') as AdvisorSession,
    messages: session.messages as AdvisorMessage[],
    replies: Array.isArray(session.replies) ? (session.replies as AdvisorReply[]) : undefined,
  };
}

export type AdvisorReply = {
  id: string;
  sessionId: string;
  state: 'generating' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  text?: string;
  chart?: AdvisorChart;
};
export async function getAdvisorReply(
  credential: PairingCredential,
  sessionId: string,
  replyId: string,
): Promise<AdvisorReply> {
  const root = object(
    await authorizedGet(
      credential,
      `${advisorPath}/${encodeURIComponent(sessionId)}/replies/${encodeURIComponent(replyId)}`,
    ),
    'reply',
  );
  verifyServer(root, credential);
  return object(object(root.data, 'reply outcome').reply, 'reply') as AdvisorReply;
}
export function streamAdvisorReply(
  credential: PairingCredential,
  id: string,
  message: string,
  submissionId: string,
  onEvent: (event: {
    type: 'accepted' | 'text_delta' | 'status' | 'result' | 'error' | 'chart';
    text?: string;
    chart?: AdvisorChart;
    replyId?: string;
  }) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let offset = 0;
    let identityChecked = false;
    let terminal = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      xhr.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      xhr.onabort = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      xhr.abort();
      finish(new MobileRequestError('cancelled', 'Cancelled'));
    };
    if (signal?.aborted) {
      finish(new MobileRequestError('cancelled', 'Cancelled'));
      return;
    }
    const parser = createSseParser(({ event, data }) => {
      const payload = JSON.parse(data) as { text?: string; chart?: AdvisorChart; replyId?: string };
      if (['accepted', 'text_delta', 'status', 'result', 'error', 'chart'].includes(event)) {
        if (event === 'result' || event === 'error') terminal = true;
        onEvent({
          type: event as 'accepted' | 'text_delta' | 'status' | 'result' | 'error' | 'chart',
          ...payload,
        });
      }
    });
    xhr.open('POST', `${credential.baseURL}${advisorPath}/${encodeURIComponent(id)}/messages`);
    xhr.setRequestHeader('Authorization', `Bearer ${credential.token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 120_000;
    const consume = () => {
      if (settled || xhr.status < 200 || xhr.status >= 300) return;
      if (!identityChecked) {
        if (xhr.getResponseHeader('X-Money-Monitor-Server-Id') !== credential.serverId) {
          finish(
            new MobileRequestError(
              'network-unknown',
              t('theRespondingMacDoesNotMatchThePairedMac'),
            ),
          );
          xhr.abort();
          return;
        }
        identityChecked = true;
      }
      try {
        parser.push(xhr.responseText.slice(offset));
        offset = xhr.responseText.length;
      } catch (cause) {
        finish(
          new MobileRequestError(
            'network-unknown',
            'Invalid reply stream',
            undefined,
            undefined,
            cause,
          ),
        );
        xhr.abort();
      }
    };
    xhr.onprogress = consume;
    xhr.onload = () => {
      consume();
      if (settled) return;
      try {
        parser.finish();
      } catch {
        finish(new MobileRequestError('network-unknown', 'Invalid reply stream'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300)
        finish(
          terminal ? undefined : new MobileRequestError('network-unknown', 'Reply outcome unknown'),
        );
      else {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* Use a safe status error. */
        }
        const error = apiError(body, xhr.status);
        if (
          terminalAuthenticationError(error) &&
          xhr.getResponseHeader('X-Money-Monitor-Server-Id') === credential.serverId
        )
          invalidateAuthentication({
            url: `${credential.baseURL}${advisorPath}`,
            authorization: `Bearer ${credential.token}`,
            code: (error as MobileRequestError).code!,
          });
        finish(error);
      }
    };
    xhr.onerror = () =>
      finish(new MobileRequestError('network-unknown', 'The Mac connection was interrupted.'));
    xhr.ontimeout = () =>
      finish(new MobileRequestError('timeout', 'The advisor took too long to respond.'));
    xhr.onabort = () => finish(new MobileRequestError('cancelled', 'Cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(JSON.stringify({ message, submissionId }));
  });
}

const FINANCIAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      currentLanguage() === 'he' ? t('invalidDataGeneric') : t('invalidData', { field: label }),
    );
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(
      currentLanguage() === 'he' ? t('invalidValueGeneric') : t('invalidValue', { field: label }),
    );
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean')
    throw new Error(
      currentLanguage() === 'he' ? t('invalidValueGeneric') : t('invalidValue', { field: label }),
    );
  return value;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`The Mac returned invalid ${label}.`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!FINANCIAL_DATE.test(result))
    throw new Error(
      currentLanguage() === 'he' ? t('invalidValueGeneric') : t('invalidValue', { field: label }),
    );
  return result;
}

function money(value: unknown): { value: number; currencyCode: string } {
  const candidate = object(value, 'money');
  const decimal = text(candidate.value, 'money amount');
  const parsed = Number(decimal);
  if (!Number.isFinite(parsed)) throw new Error(t('theMacReturnedAnInvalidMoneyAmount'));
  return { value: parsed, currencyCode: text(candidate.currencyCode, 'currency') };
}

function apiError(body: unknown, status: number): Error {
  try {
    const error = object(object(body, 'error response').error, 'error');
    const message = text(error.message, 'error message');
    const code = typeof error.code === 'string' ? error.code : 'unknown';
    if (currentLanguage() !== 'he') return new MobileRequestError('api', message, code, status);
    const key = typeof error.code === 'string' ? MOBILE_ERROR_MESSAGES[error.code] : undefined;
    return new MobileRequestError(
      'api',
      key ? t(key) : t('macRequestFailed', { code: status }),
      code,
      status,
    );
  } catch {
    return new MobileRequestError(
      'api',
      t('macRequestFailed', { code: status }),
      'unknown',
      status,
    );
  }
}

const MOBILE_ERROR_MESSAGES: Record<string, MessageKey> = {
  invalid_request: 'mobileErrorInvalidRequest',
  validation_error: 'mobileErrorValidation',
  authentication_required: 'mobileErrorAuthenticationRequired',
  authentication_invalid: 'mobileErrorAuthenticationInvalid',
  authentication_expired: 'mobileErrorAuthenticationExpired',
  authentication_revoked: 'mobileErrorAuthenticationRevoked',
  forbidden: 'mobileErrorForbidden',
  capability_required: 'mobileErrorCapabilityRequired',
  upgrade_required: 'mobileErrorUpgradeRequired',
  pairing_invalid: 'mobileErrorPairingInvalid',
  pairing_rejected: 'mobileErrorPairingRejected',
  pairing_approval_required: 'mobileErrorPairingApprovalRequired',
  pairing_replayed: 'mobileErrorPairingReplayed',
  pairing_exchange_in_progress: 'mobileErrorPairingInProgress',
  pairing_expired: 'mobileErrorPairingExpired',
  route_not_found: 'mobileErrorRouteNotFound',
  transaction_not_found: 'mobileErrorTransactionNotFound',
  payload_too_large: 'mobileErrorPayloadTooLarge',
  rate_limited: 'mobileErrorRateLimited',
  internal_server_error: 'mobileErrorInternal',
};

async function requestJson(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let abortKind: 'timeout' | 'cancelled' | null = null;
  const abort = () => {
    if (!abortKind) {
      abortKind = 'cancelled';
      controller.abort();
    }
  };
  if (externalSignal?.aborted) abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    if (!abortKind) {
      abortKind = 'timeout';
      controller.abort();
    }
  }, 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    throwIfAborted(controller.signal);
    if (!response.ok) {
      const error = apiError(body, response.status);
      const expectedServer = new Headers(init.headers).get('X-Money-Monitor-Server-Id');
      if (terminalAuthenticationError(error)) {
        if (!expectedServer || response.headers.get('X-Money-Monitor-Server-Id') !== expectedServer)
          throw new MobileRequestError(
            'network-unknown',
            t('theRespondingMacDoesNotMatchThePairedMac'),
          );
        invalidateAuthentication({
          url,
          authorization: new Headers(init.headers).get('Authorization') ?? '',
          code: (error as MobileRequestError).code!,
        });
      }
      throw error;
    }
    return body;
  } catch (error) {
    if (abortKind)
      throw new MobileRequestError(
        abortKind,
        abortKind === 'timeout' ? t('theMacDidNotRespondInTime') : 'Cancelled',
        undefined,
        undefined,
        error,
      );
    if (error instanceof MobileRequestError) throw error;
    throw new MobileRequestError(
      'network-unknown',
      error instanceof Error ? error.message : 'Connection interrupted',
      undefined,
      undefined,
      error,
    );
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
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.token}`,
        'X-Money-Monitor-Server-Id': credential.serverId,
      },
    },
    signal,
  );
}

function verifyServer(root: JsonObject, credential: PairingCredential): void {
  const meta = object(root.meta, 'response metadata');
  const server = object(meta.server, 'server identity');
  if (text(server.id, 'server identity') !== credential.serverId) {
    throw new Error(t('theRespondingMacDoesNotMatchThePairedMac'));
  }
}

function freshnessDetail(
  status: string,
  lastSuccessfulSyncAt: unknown,
  generatedAt: string,
): { detail: string; state: 'fresh' | 'aging' | 'stale' } {
  if (status === 'never_synced') return { detail: t('neverSynced'), state: 'stale' };
  if (status === 'error') return { detail: t('connectionNeedsAttention'), state: 'stale' };
  if (typeof lastSuccessfulSyncAt !== 'string')
    return { detail: t('syncTimeUnavailable'), state: 'stale' };

  const ageMinutes = Math.max(
    0,
    Math.round((Date.parse(generatedAt) - Date.parse(lastSuccessfulSyncAt)) / 60_000),
  );
  const detail =
    ageMinutes < 2
      ? t('updatedJustNow')
      : ageMinutes < 60
        ? t('updatedMinutes', { count: ageMinutes })
        : ageMinutes < 1_440
          ? t('updatedHours', { count: Math.round(ageMinutes / 60) })
          : t('updatedDays', { count: Math.round(ageMinutes / 1_440) });
  return { detail, state: status === 'fresh' ? (ageMinutes < 180 ? 'fresh' : 'aging') : 'stale' };
}

export async function fetchHomeData(
  credential: PairingCredential,
  signal?: AbortSignal,
  since?: string | null,
  month?: string,
): Promise<HomeData> {
  const overviewParams = new URLSearchParams();
  if (since) overviewParams.set('since', since);
  if (month) overviewParams.set('month', month);
  const overviewPath = `/api/mobile/v1/overview${overviewParams.size ? `?${overviewParams}` : ''}`;
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
  const period = object(overview.period, 'overview period');
  date(meta.financialDate, 'financial date');
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
  const categoryLabels = new Map(
    (Array.isArray(overview.categories) ? overview.categories : []).map((raw) => {
      const category = object(raw, 'category');
      return [
        text(category.name, 'category name'),
        text(category.label, 'category label'),
      ] as const;
    }),
  );
  const statusLabels: Record<string, string> = {
    on_track: t('onTrack'),
    watch: t('watchSpending'),
    over_budget: t('overBudget'),
    unavailable: t('noSingleBudget'),
    unknown: t('budgetUnavailable'),
  };

  const cacheability =
    meta.cacheability && typeof meta.cacheability === 'object'
      ? object(meta.cacheability, 'cacheability')
      : {};
  const completeness =
    meta.completeness && typeof meta.completeness === 'object'
      ? object(meta.completeness, 'completeness')
      : {};
  const snapshot =
    typeof meta.snapshotId === 'string' &&
    typeof meta.calculatedAt === 'string' &&
    typeof cacheability.staleAt === 'string' &&
    typeof cacheability.deleteAfter === 'string'
      ? {
          id: meta.snapshotId,
          calculatedAt: meta.calculatedAt,
          staleAt: cacheability.staleAt,
          deleteAfter: cacheability.deleteAfter,
          complete: completeness.status === 'complete',
          cacheable: cacheability.status === 'cacheable',
        }
      : undefined;
  return {
    snapshot,
    currentDate: date(period.endDate, 'overview end date'),
    monthKey: text(period.month, 'overview month'),
    month: new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: 'UTC' }).format(
      new Date(`${text(period.month, 'overview month')}-01T12:00:00Z`),
    ),
    availableMonths: (Array.isArray(overview.availableMonths) ? overview.availableMonths : []).map(
      (value) => {
        const candidate = text(value, 'available month');
        if (!/^\d{4}-\d{2}$/.test(candidate))
          throw new Error(t('theMacReturnedAnInvalidAvailableMonth'));
        return candidate;
      },
    ),
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
      ? (statusLabels[text(primaryBudget.status, 'budget status')] ?? t('budgetUnavailable'))
      : t('noBudget'),
    budgetNote: primaryBudget ? t('calculatedOnYourMac') : t('manageBudgetsOnYourMac'),
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
        categoryNames: categoryNamesOrLegacy(budget.categoryNames),
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
      const category = text(merchant.category, 'merchant category');
      return {
        name: text(merchant.name, 'merchant name'),
        category: categoryLabels.get(category) ?? category,
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
    accounts: accounts.map((raw) => {
      const account = object(raw, 'account');
      const mask = text(account.identifierMask, 'account mask').replace(/^(?:••••|\*{4})\s*/, '');
      return {
        id: text(account.id, 'account ID'),
        label: `${text(account.displayName, 'account name')} · ${mask}`,
      };
    }),
  };
}

function parseRecurringPayment(raw: unknown): RecurringPayment {
  const frequencies: RecurringPayment['frequency'][] = ['monthly', 'everyTwoMonths'];
  const payment = object(raw, 'recurring payment');
  const frequency = text(payment.frequency, 'payment frequency');
  const confidence = text(payment.confidence, 'payment confidence');
  const kind = text(payment.kind, 'payment kind');
  const source = text(payment.source, 'payment source');
  if (
    !frequencies.includes(frequency as RecurringPayment['frequency']) ||
    (confidence !== 'likely' && confidence !== 'possible') ||
    (kind !== 'subscription' && kind !== 'serviceBill') ||
    !['automatic', 'manual', 'suggestion', 'excluded'].includes(source)
  )
    throw new Error('The Mac returned an invalid recurring payment.');
  return {
    resourceVersion:
      typeof payment.resourceVersion === 'number' &&
      Number.isSafeInteger(payment.resourceVersion) &&
      payment.resourceVersion >= 0
        ? payment.resourceVersion
        : undefined,
    accountId: text(payment.accountId, 'account ID'),
    merchantKey: text(payment.merchantKey, 'merchant key'),
    name: text(payment.name, 'payment name'),
    accountName: text(payment.accountName, 'account name'),
    currencyCode: text(payment.currencyCode, 'currency'),
    usualAmount: nonnegativeNumber(payment.usualAmount, 'usual amount'),
    monthlyCost: nonnegativeNumber(payment.monthlyCost, 'monthly cost'),
    annualCost: nonnegativeNumber(payment.annualCost, 'annual cost'),
    frequency: frequency as RecurringPayment['frequency'],
    occurrences: nonnegativeNumber(payment.occurrences, 'occurrences'),
    lastChargeDate: date(payment.lastChargeDate, 'last charge date'),
    nextExpectedDate: date(payment.nextExpectedDate, 'next expected date'),
    confidence: confidence as RecurringPayment['confidence'],
    kind: kind as RecurringPayment['kind'],
    source: source as RecurringPayment['source'],
  };
}

function parseRecurringPayments(
  rootValue: unknown,
  credential: PairingCredential,
): RecurringPayments {
  const root = object(rootValue, 'recurring payments');
  verifyServer(root, credential);
  const data = object(root.data, 'recurring payments');
  if (
    !Array.isArray(data.payments) ||
    !Array.isArray(data.suggestions) ||
    !Array.isArray(data.excluded) ||
    !Array.isArray(data.totals)
  ) {
    throw new Error('The Mac returned invalid recurring payments.');
  }
  return {
    asOfDate: date(data.asOfDate, 'recurring payment date'),
    classificationPending: boolean(data.classificationPending ?? false, 'classification state'),
    classificationStatus: ['pending', 'complete', 'unavailable'].includes(
      String(data.classificationStatus),
    )
      ? (data.classificationStatus as RecurringPayments['classificationStatus'])
      : undefined,
    payments: data.payments.map(parseRecurringPayment),
    suggestions: data.suggestions.map(parseRecurringPayment),
    excluded: data.excluded.map(parseRecurringPayment),
    totals: data.totals.map((raw) => {
      const total = object(raw, 'recurring total');
      return {
        currencyCode: text(total.currencyCode, 'currency'),
        monthlyCost: nonnegativeNumber(total.monthlyCost, 'monthly cost'),
        annualCost: nonnegativeNumber(total.annualCost, 'annual cost'),
      };
    }),
  };
}

export async function fetchRecurringPaymentDetail(
  credential: PairingCredential,
  payment: Pick<RecurringPayment, 'accountId' | 'currencyCode' | 'merchantKey'>,
): Promise<RecurringPaymentDetail> {
  const query = new URLSearchParams({
    accountId: String(payment.accountId),
    currencyCode: payment.currencyCode,
    merchantKey: payment.merchantKey,
  });
  const root = object(
    await authorizedGet(credential, `/api/mobile/v1/recurring-payments/detail?${query}`),
    'recurring payment detail',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'recurring payment detail');
  if (!Array.isArray(data.transactions)) throw new Error('The Mac returned invalid charges.');
  return {
    payment: parseRecurringPayment(data.payment),
    previousAmount:
      data.previousAmount === null
        ? null
        : nonnegativeNumber(data.previousAmount, 'previous amount'),
    changedOnDate: data.changedOnDate === null ? null : date(data.changedOnDate, 'change date'),
    transactions: data.transactions.map((raw) => {
      const item = object(raw, 'merchant charge');
      return {
        id: text(item.id, 'charge ID'),
        date: date(item.date, 'charge date'),
        description: text(item.description, 'charge description'),
        amount: nonnegativeNumber(item.amount, 'charge amount'),
        inPattern: boolean(item.inPattern, 'pattern status'),
      };
    }),
  };
}

export async function fetchRecurringPayments(
  credential: PairingCredential,
  signal?: AbortSignal,
): Promise<RecurringPayments> {
  return parseRecurringPayments(
    await authorizedGet(credential, '/api/mobile/v1/recurring-payments', signal),
    credential,
  );
}

export async function saveRecurringPaymentDecision(
  credential: PairingCredential,
  payment: RecurringPayment,
  decision: 'include' | 'exclude' | 'auto',
  commandId: string,
): Promise<{
  receipt: { commandId: string; resourceVersion: number };
  result: RecurringPayments | null;
}> {
  if (payment.resourceVersion === undefined)
    throw new MobileRequestError('api', t('mobileErrorUpgradeRequired'), 'upgrade_required', 426);
  const root = object(
    await requestJson(`${credential.baseURL}/api/mobile/v1/recurring-payments/decision`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential.token}`,
        'X-Money-Monitor-Server-Id': credential.serverId,
      },
      body: JSON.stringify({
        commandId,
        expectedVersion: payment.resourceVersion,
        accountId: payment.accountId,
        currencyCode: payment.currencyCode,
        merchantKey: payment.merchantKey,
        decision,
      }),
    }),
    'decision response',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'decision outcome');
  const receipt = object(data.receipt, 'decision receipt');
  if (
    receipt.commandId !== commandId ||
    !Number.isSafeInteger(receipt.resourceVersion) ||
    (receipt.resourceVersion as number) < 1
  )
    throw new Error('Invalid decision receipt');
  return {
    receipt: { commandId, resourceVersion: receipt.resourceVersion as number },
    result:
      data.result === null
        ? null
        : parseRecurringPayments({ data: data.result, meta: root.meta }, credential),
  };
}

export async function fetchExploreMonth(
  credential: PairingCredential,
  month: string,
  signal?: AbortSignal,
): Promise<ExploreMonth> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(t('invalidOverviewMonth'));
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
  const budgets = Array.isArray(overview.budgets) ? overview.budgets : [];
  const categoryLabels = new Map(
    (Array.isArray(overview.categories) ? overview.categories : []).map((raw) => {
      const category = object(raw, 'category');
      return [
        text(category.name, 'category name'),
        text(category.label, 'category label'),
      ] as const;
    }),
  );
  return {
    month: text(period.month, 'overview month'),
    label: text(period.label, 'overview month label').slice(0, 3),
    currencyCode: text(overview.currencyCode, 'primary currency'),
    income: money(cashflow.income).value,
    spending: money(cashflow.spending).value,
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
    budgets: budgets.map((raw) => {
      const budget = object(raw, 'budget');
      return {
        name: text(budget.name, 'budget name'),
        categoryNames: categoryNamesOrLegacy(budget.categoryNames),
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
      const category = text(merchant.category, 'merchant category');
      return {
        name: text(merchant.name, 'merchant name'),
        category: categoryLabels.get(category) ?? category,
        current: money(merchant.current).value,
        previous: money(merchant.previous).value,
        count: Number(merchant.transactionCount),
      };
    }),
  };
}

export async function fetchCashflowMonth(
  credential: PairingCredential,
  month: string,
  signal?: AbortSignal,
): Promise<CashflowMonth> {
  const snapshot = await fetchExploreMonth(credential, month, signal);
  return {
    month: snapshot.month,
    label: snapshot.label,
    income: snapshot.income,
    spending: snapshot.spending,
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
    resourceVersion:
      typeof item.resourceVersion === 'number' &&
      Number.isSafeInteger(item.resourceVersion) &&
      item.resourceVersion > 0
        ? item.resourceVersion
        : undefined,
    occurredAt: `${occurredOn}T12:00:00Z`,
    merchant: text(item.displayName, 'transaction name'),
    amount: signedAmount,
    currencyCode: amount.currencyCode,
    category: category ? text(category.label, 'transaction category') : 'Uncategorized',
    accountId: text(account.id, 'transaction account ID'),
    account: `${text(account.displayName, 'account name')} · ${text(account.identifierMask, 'account mask').replace(/^(?:••••|\*{4})\s*/, '')}`,
    pending: status === 'pending',
    needsReview: boolean(item.needsReview, 'review state'),
    owner,
    included: !boolean(item.excludedFromReports, 'inclusion state'),
    effectiveDate:
      typeof item.effectiveOn === 'string' ? date(item.effectiveOn, 'effective date') : occurredOn,
  };
}

export async function fetchTransactionPage(
  credential: PairingCredential,
  query: TransactionQuery,
  signal?: AbortSignal,
): Promise<TransactionPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.endDate) params.set('endDate', query.endDate);
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.limit) params.set('limit', String(query.limit));
  if (query.category?.trim()) params.set('category', query.category.trim());
  for (const category of query.categories ?? []) {
    if (category.trim()) params.append('categories', category.trim());
  }
  if (query.accountId) params.set('accountId', query.accountId);
  if (query.status) params.set('status', query.status);
  if (query.direction) params.set('direction', query.direction);
  if (query.needsReview !== undefined) params.set('needsReview', String(query.needsReview));
  if (query.includeExcluded) params.set('includeExcluded', 'true');
  if (query.filter === 'review') params.set('needsReview', 'true');
  if (query.filter === 'review') params.set('includeExcluded', 'true');
  if (query.filter === 'pending') params.set('status', 'pending');
  if (query.filter === 'credits') params.set('direction', 'credit');
  if (query.cursor) params.set('cursor', query.cursor);
  const root = object(
    await authorizedGet(credential, `/api/mobile/v1/transactions?${params.toString()}`, signal),
    'transactions',
  );
  verifyServer(root, credential);
  const data = object(root.data, 'transactions');
  const page = object(data.page, 'transaction page');
  if (!Array.isArray(data.transactions)) throw new Error(t('theMacReturnedInvalidTransactions'));
  const hasMore = boolean(page.hasMore, 'transaction page');
  const nextCursor =
    page.nextCursor === null || page.nextCursor === undefined
      ? null
      : text(page.nextCursor, 'transaction cursor');
  if (hasMore !== (nextCursor !== null))
    throw new Error(t('theMacReturnedInvalidTransactionPagingData'));
  return {
    financialDate: date(data.financialDate, 'financial date'),
    transactions: data.transactions.map((item) => mapTransaction(item)),
    hasMore,
    nextCursor,
  };
}

function categoryNamesOrLegacy(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error(t('theMacReturnedInvalidBudgetCategories'));
  return value.map((category) => text(category, 'budget category'));
}

export async function fetchTransactions(
  credential: PairingCredential,
  query: TransactionQuery,
  signal?: AbortSignal,
): Promise<TransactionPage> {
  const transactions: Transaction[] = [];
  const seenCursors = new Set<string>();
  let financialDate: string;
  let cursor: string | null = query.cursor ?? null;

  do {
    const page = await fetchTransactionPage(
      credential,
      { ...query, cursor: cursor ?? undefined },
      signal,
    );
    if (page.nextCursor && seenCursors.has(page.nextCursor))
      throw new Error(t('theMacReturnedRepeatedTransactionPagingData'));
    if (page.nextCursor) seenCursors.add(page.nextCursor);
    financialDate = page.financialDate;
    transactions.push(...page.transactions);
    cursor = page.nextCursor;
  } while (cursor);

  return { financialDate, transactions, hasMore: false, nextCursor: null };
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
    throw new Error(t('theMacReturnedInvalidReviewOptions'));
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
          'X-Money-Monitor-Server-Id': credential.serverId,
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
      reject(new Error(t('pairingWasCancelled')));
    };
    if (signal?.aborted) {
      reject(new Error(t('pairingWasCancelled')));
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
    throw new Error(t('thisPairingCodeHasExpiredCreateANewOneOnYourMac'));
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
      throw new Error(t('pairingExpiredBeforeItWasApproved'));
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
    if (status !== 'pending_approval') throw new Error(t('theMacReturnedAnInvalidPairingState'));
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
  if (exchange.status !== 'claimed') throw new Error(t('theMacDidNotIssueAPairingCredential'));
  const credential = object(exchange.credential, 'pairing credential');
  const token = text(credential.token, 'pairing credential');
  if (!TOKEN.test(token)) throw new Error(t('theMacReturnedAnInvalidPairingCredential'));
  return { serverId: pairing.serverId, baseURL: pairing.baseURL, token };
}
