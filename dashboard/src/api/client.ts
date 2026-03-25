const BASE_URL = '/api';

const API_TOKEN_KEY = 'money_monitor_api_token';

// In Electron, the auth token is provided via the preload bridge.
// In standalone mode, fall back to localStorage.
const electronToken = (window as any).electronAPI?.getAuthToken?.() as string | undefined;

export function getApiToken(): string | null {
  if (electronToken) return electronToken;
  return localStorage.getItem(API_TOKEN_KEY);
}

export function setApiToken(token: string): void {
  localStorage.setItem(API_TOKEN_KEY, token);
}

export function clearApiToken(): void {
  localStorage.removeItem(API_TOKEN_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers as Record<string, string>),
  };

  const token = getApiToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error: string }).error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Accounts ───

export interface Account {
  id: number;
  companyId: string;
  displayName: string;
  accountNumber: string | null;
  accountType: 'bank' | 'credit_card';
  balance: number | null;
  manualLogin: boolean;
  showBrowser: boolean;
  isActive: boolean;
  lastScrapedAt: string | null;
  createdAt: string;
}

export function getAccounts() {
  return request<{ accounts: Account[] }>('/accounts');
}

export function createAccount(data: {
  companyId: string;
  displayName: string;
  credentials: Record<string, string>;
}) {
  return request<{ account: Account }>('/accounts', { method: 'POST', body: JSON.stringify(data) });
}

export function updateAccount(
  id: number,
  data: {
    displayName?: string;
    isActive?: boolean;
    manualLogin?: boolean;
    showBrowser?: boolean;
    credentials?: Record<string, string>;
  },
) {
  return request<{ account: Account }>(`/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteAccount(id: number, deleteTransactions = false) {
  return request<{ deleted: boolean }>(`/accounts/${id}?deleteTransactions=${deleteTransactions}`, {
    method: 'DELETE',
  });
}

// ─── Transactions ───

export interface Transaction {
  id: number;
  accountId: number;
  identifier: number | null;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  category: string | null;
  ignored: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  confidence: number | null;
  hash: string;
  createdAt: string;
}

export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface TransactionFilters {
  accountId?: number;
  accountType?: 'bank' | 'credit_card';
  startDate?: string;
  endDate?: string;
  category?: string;
  status?: string;
  needsReview?: boolean;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function getTransactions(filters: TransactionFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<{ transactions: Transaction[]; pagination: Pagination }>(
    `/transactions?${params}`,
  );
}

export function ignoreTransaction(id: number, ignored: boolean) {
  return request<{ transaction: Transaction }>(`/transactions/${id}/ignore`, {
    method: 'PATCH',
    body: JSON.stringify({ ignored }),
  });
}

export function resolveTransaction(id: number, category: string) {
  return request<{ transaction: Transaction }>(`/transactions/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  });
}

export function getNeedsReviewCount() {
  return request<{ count: number }>('/transactions/needs-review/count');
}

// ─── Summary ───

export interface SummaryItem {
  category?: string;
  month?: string;
  accountId?: number;
  displayName?: string;
  totalAmount: number;
  transactionCount: number;
}

export interface CashflowItem {
  month: string;
  income: number;
  expense: number;
}

export interface SummaryFilters {
  groupBy?: 'category' | 'month' | 'account' | 'cashflow' | 'cashflow-detail';
  accountId?: number;
  accountType?: 'bank' | 'credit_card';
  startDate?: string;
  endDate?: string;
  expensesOnly?: boolean;
}

export function getSummary(params: SummaryFilters = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ groupBy: string; summary: SummaryItem[] }>(`/transactions/summary?${query}`);
}

export function getCashflowSummary(params: Omit<SummaryFilters, 'groupBy'> = {}) {
  const query = new URLSearchParams({ groupBy: 'cashflow' });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ groupBy: 'cashflow'; summary: CashflowItem[] }>(
    `/transactions/summary?${query}`,
  );
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface CashflowDetailData {
  income: CategoryAmount[];
  expenses: CategoryAmount[];
  totalIncome: number;
  totalExpenses: number;
  surplus: number;
}

export function getCashflowDetail(params: Omit<SummaryFilters, 'groupBy'> = {}) {
  const query = new URLSearchParams({ groupBy: 'cashflow-detail' });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ groupBy: 'cashflow-detail'; summary: CashflowDetailData }>(
    `/transactions/summary?${query}`,
  );
}

// ─── Scraping ───

export function triggerScrape(accountId: number) {
  return request<{ sessionId: number }>(`/scrape/${accountId}`, { method: 'POST' });
}

export function triggerScrapeAll() {
  return request<{ sessionId: number }>('/scrape/all', { method: 'POST' });
}

export function createScrapeEventSource(): EventSource {
  const token = getApiToken();
  const url = token
    ? `${BASE_URL}/scrape/events?token=${encodeURIComponent(token)}`
    : `${BASE_URL}/scrape/events`;
  return new EventSource(url);
}

export function submitOtp(accountId: number, code: string) {
  return request<{ success: boolean }>('/scrape/otp', {
    method: 'POST',
    body: JSON.stringify({ accountId, code }),
  });
}

export function confirmManualLogin(accountId: number) {
  return request<{ success: boolean }>(`/scrape/manual-confirm/${accountId}`, { method: 'POST' });
}

// ─── Scrape Sessions ───

export interface ScrapeLogEntry {
  id: number;
  accountId: number;
  sessionId: number | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  transactionsFound: number;
  transactionsNew: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  accountName: string;
  companyId: string;
}

export interface ScrapeSession {
  id: number;
  trigger: string;
  status: string;
  accountIds: string; // JSON array
  startedAt: string;
  completedAt: string | null;
  logs: ScrapeLogEntry[];
}

export function getScrapeSessions(params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ sessions: ScrapeSession[]; activeSessions: ScrapeSession[] }>(
    `/scrape/sessions?${query}`,
  );
}

export function cancelScrapeSession(sessionId: number) {
  return request<{ success: boolean }>(`/scrape/cancel/${sessionId}`, { method: 'POST' });
}

// ─── Categories ───

export interface Category {
  id: number;
  name: string;
  label: string;
  color: string | null;
  rules: string | null;
  ignoredFromStats: boolean;
  createdAt: string;
}

export function getCategories() {
  return request<{ categories: Category[] }>('/categories');
}

export function createCategory(data: {
  name: string;
  label: string;
  color?: string;
  rules?: string;
}) {
  return request<{ category: Category }>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCategory(
  id: number,
  data: { label?: string; color?: string; rules?: string | null; ignoredFromStats?: boolean },
) {
  return request<{ category: Category }>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteCategory(id: number) {
  return request<{ deleted: boolean }>(`/categories/${id}`, { method: 'DELETE' });
}

export function updateTransactionCategory(id: number, category: string | null) {
  return request<{ transaction: Transaction }>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  });
}

// ─── Chat Sessions ───

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: SessionMessage[];
}

export function getChatSessions() {
  return request<{ sessions: SessionMeta[] }>('/ai/sessions');
}

export function createChatSession() {
  return request<{ session: SessionMeta }>('/ai/sessions', { method: 'POST' });
}

export function getChatSession(id: string) {
  return request<{ session: SessionData }>(`/ai/sessions/${id}`);
}

export function deleteChatSession(id: string) {
  return request<{ deleted: boolean }>(`/ai/sessions/${id}`, { method: 'DELETE' });
}

// ─── AI ───

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'status' | 'result' | 'error';
  text: string;
}

export async function* aiChatStream(
  sessionId: string,
  message: string,
): AsyncGenerator<ChatStreamEvent> {
  const token = getApiToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/ai/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok || !res.body) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error: string }).error || res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ') && currentEvent) {
          const data = JSON.parse(line.slice(6)) as { text: string };
          yield { type: currentEvent as ChatStreamEvent['type'], text: data.text };
          currentEvent = '';
        }
      }
    }
  } finally {
    reader.cancel();
  }
}

// ─── Assets ───

export interface Holding {
  id: number;
  name: string;
  type: string;
  currency: string;
  quantity: number;
  costBasis: number;
  lastPrice: number | null;
  lastPriceDate: string | null;
  currentValue: number;
  currentValueIls: number;
  gainLoss: number | null;
  gainLossPercent: number | null;
  stale: boolean;
  notes: string | null;
}

export interface Asset {
  id: number;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  liquidity: string;
  linkedAccountId: number | null;
  linkedAccountName: string | null;
  isActive: boolean;
  notes: string | null;
  holdings: Holding[];
  totalValueIls: number;
  totalInvestedIls: number | null;
  totalReturnIls: number | null;
  totalRentEarned: number | null;
}

export interface AssetSnapshot {
  date: string;
  totalValue: number | null;
  totalValueIls: number;
}

export function getAssets(includeInactive = false) {
  const params = includeInactive ? '?includeInactive=true' : '';
  return request<Asset[]>(`/assets${params}`);
}

export function getAsset(id: number) {
  return request<Asset>(`/assets/${id}`);
}

export function createAsset(data: {
  name: string;
  type: string;
  currency?: string;
  institution?: string;
  liquidity?: string;
  linkedAccountId?: number;
  notes?: string;
  initialValue?: number;
  initialCostBasis?: number;
}) {
  return request<Asset>('/assets', { method: 'POST', body: JSON.stringify(data) });
}

export function updateAsset(
  id: number,
  data: {
    name?: string;
    type?: string;
    currency?: string;
    institution?: string | null;
    liquidity?: string;
    linkedAccountId?: number | null;
    notes?: string | null;
  },
) {
  return request<Asset>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteAsset(id: number) {
  return request<void>(`/assets/${id}`, { method: 'DELETE' });
}

export function updateAssetValue(
  assetId: number,
  data: { currentValue: number; contribution?: number; date?: string; notes?: string },
): Promise<Asset> {
  return request<Asset>(`/assets/${assetId}/value`, { method: 'PUT', body: JSON.stringify(data) });
}

export function recordRentIncome(
  assetId: number,
  data: { amount: number; date?: string; notes?: string },
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/assets/${assetId}/rent`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getExchangeRates() {
  return request<{ rates: Record<string, number>; source: string; fetchedAt: string }>(
    '/exchange-rates',
  );
}

export function createHolding(
  assetId: number,
  data: {
    name: string;
    type: string;
    currency: string;
    quantity: number;
    costBasis?: number;
    lastPrice?: number;
    notes?: string;
  },
) {
  return request<Holding>(`/assets/${assetId}/holdings`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateHolding(
  id: number,
  data: { quantity?: number; costBasis?: number; lastPrice?: number | null; notes?: string | null },
) {
  return request<Holding>(`/holdings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHolding(id: number) {
  return request<void>(`/holdings/${id}`, { method: 'DELETE' });
}

export function getAssetSnapshots(id: number, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  const qs = params.toString();
  return request<{ snapshots: AssetSnapshot[] }>(`/assets/${id}/snapshots${qs ? `?${qs}` : ''}`);
}

// ─── Movements ───

export interface Movement {
  id: number;
  assetId: number;
  holdingId: number | null;
  holdingName: string | null;
  date: string;
  type: string;
  quantity: number;
  currency: string;
  pricePerUnit: number | null;
  sourceAmount: number | null;
  sourceCurrency: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MovementFilters {
  holdingId?: number;
  type?: string;
  startDate?: string;
  endDate?: string;
  offset?: number;
  limit?: number;
}

export function getMovements(assetId: number, filters: MovementFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  const qs = params.toString();
  return request<{ movements: Movement[]; total: number }>(
    `/assets/${assetId}/movements${qs ? `?${qs}` : ''}`,
  );
}

export function createMovement(
  assetId: number,
  data: {
    holdingId?: number;
    date: string;
    type: string;
    quantity: number;
    currency: string;
    pricePerUnit?: number;
    sourceAmount?: number;
    sourceCurrency?: string;
    notes?: string;
  },
) {
  return request<Movement>(`/assets/${assetId}/movements`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteMovement(id: number) {
  return request<void>(`/movements/${id}`, { method: 'DELETE' });
}

// ─── Liabilities ───

export interface Liability {
  id: number;
  name: string;
  type: string;
  currency: string;
  originalAmount: number;
  currentBalance: number;
  interestRate: number | null;
  startDate: string | null;
  notes: string | null;
  isActive: boolean;
  currentBalanceIls: number;
}

export function getLiabilities(includeInactive = false) {
  const params = includeInactive ? '?includeInactive=true' : '';
  return request<Liability[]>(`/liabilities${params}`);
}

export function createLiability(data: {
  name: string;
  type: string;
  currency?: string;
  originalAmount: number;
  currentBalance: number;
  interestRate?: number;
  startDate?: string;
  notes?: string;
}) {
  return request<Liability>('/liabilities', { method: 'POST', body: JSON.stringify(data) });
}

export function updateLiability(
  id: number,
  data: {
    name?: string;
    type?: string;
    currency?: string;
    originalAmount?: number;
    currentBalance?: number;
    interestRate?: number | null;
    startDate?: string | null;
    notes?: string | null;
  },
) {
  return request<Liability>(`/liabilities/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteLiability(id: number) {
  return request<void>(`/liabilities/${id}`, { method: 'DELETE' });
}

// ─── Net Worth ───

export interface NetWorthBank {
  id: number;
  name: string;
  balance: number;
  balanceIls: number;
}

export interface NetWorthAssetHolding {
  name: string;
  currency: string;
  valueIls: number;
}

export interface NetWorthAsset {
  id: number;
  name: string;
  type: string;
  currency: string;
  liquidity: string;
  totalValueIls: number;
  holdings: NetWorthAssetHolding[];
}

export interface NetWorthLiability {
  id: number;
  name: string;
  currentBalanceIls: number;
}

export interface NetWorth {
  total: number;
  liquidTotal: number;
  banks: NetWorthBank[];
  banksTotal: number;
  assets: NetWorthAsset[];
  assetsTotal: number;
  liabilities: NetWorthLiability[];
  liabilitiesTotal: number;
  exchangeRates: Record<string, number>;
  ratesStale?: boolean;
  calculatedAt: string;
}

export interface NetWorthHistoryPoint {
  date: string;
  total: number;
  liquidTotal: number;
  banks: number;
  assets: number;
  liabilities: number;
}

export interface NetWorthHistory {
  series: NetWorthHistoryPoint[];
}

export function getNetWorth() {
  return request<NetWorth>('/net-worth');
}

export function getNetWorthHistory(params?: {
  startDate?: string;
  endDate?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
  }
  const qs = query.toString();
  return request<NetWorthHistory>(`/net-worth/history${qs ? `?${qs}` : ''}`);
}

// ─── AI ───

export function aiCategorize(batchSize = 50) {
  return request<{ categorized: number }>('/ai/categorize', {
    method: 'POST',
    body: JSON.stringify({ batchSize }),
  });
}

export function aiRecategorize(startDate?: string, endDate?: string) {
  return request<{ categorized: number }>('/ai/recategorize', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate }),
  });
}

// ─── Settings ───

export interface SettingsResponse {
  needsSetup: boolean;
  isElectron: boolean;
  settings: Record<string, string | number | boolean>;
  dataDir: string;
  oauth: { anthropic: boolean };
  demoMode: boolean;
}

export function getSettings() {
  return request<SettingsResponse>('/settings');
}

export interface AIProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  models: AIProviderModel[];
  authTypes: string[];
  apiKeyField: string;
  hasKey: boolean;
}

export function getAIProviders() {
  return request<{ providers: AIProvider[] }>('/ai/providers');
}

export function updateSettings(settings: Record<string, string | number | boolean>) {
  return request<{ success: boolean }>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

// ─── OAuth ───

export function startAnthropicOAuth() {
  return request<{ url: string }>('/settings/oauth/anthropic/start', { method: 'POST' });
}

export function completeAnthropicOAuth(code: string) {
  return request<{ success: boolean }>('/settings/oauth/anthropic/complete', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function cancelAnthropicOAuth() {
  return request<{ success: boolean }>('/settings/oauth/anthropic/cancel', { method: 'POST' });
}

export function getOAuthStatus() {
  return request<{ anthropic: boolean }>('/settings/oauth/status');
}

// ─── Demo Mode ───

export function toggleDemoMode(enabled: boolean) {
  return request<{ success: boolean; demoMode: boolean }>('/demo/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

// ─── Alert Settings ───

export interface AlertSettings {
  enabled: boolean;
  largeChargeThreshold: number;
  unusualSpendingPercent: number;
  monthlySummary: {
    enabled: boolean;
    dayOfMonth: number;
  };
  reportScrapeErrors: boolean;
}

export function getAlertSettings() {
  return request<AlertSettings>('/alerts/settings');
}

export function updateAlertSettings(settings: Partial<AlertSettings>) {
  return request<AlertSettings>('/alerts/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export function resetAlertSettings() {
  return request<AlertSettings>('/alerts/settings/reset', { method: 'POST' });
}

export function sendTestAlert() {
  return request<{ success: boolean; message: string }>('/alerts/test', { method: 'POST' });
}
