const BASE_URL = '/api';

const API_TOKEN_KEY = 'money_monitor_api_token';

export function getApiToken(): string | null {
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
    ...options?.headers as Record<string, string>,
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
  isActive: boolean;
  lastScrapedAt: string | null;
  createdAt: string;
}

export function getAccounts() {
  return request<{ accounts: Account[] }>('/accounts');
}

export function createAccount(data: { companyId: string; displayName: string; credentials: Record<string, string> }) {
  return request<{ account: Account }>('/accounts', { method: 'POST', body: JSON.stringify(data) });
}

export function updateAccount(id: number, data: { displayName?: string; isActive?: boolean; credentials?: Record<string, string> }) {
  return request<{ account: Account }>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteAccount(id: number, deleteTransactions = false) {
  return request<{ deleted: boolean }>(`/accounts/${id}?deleteTransactions=${deleteTransactions}`, { method: 'DELETE' });
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
  return request<{ transactions: Transaction[]; pagination: Pagination }>(`/transactions?${params}`);
}

export function ignoreTransaction(id: number, ignored: boolean) {
  return request<{ transaction: Transaction }>(`/transactions/${id}/ignore`, {
    method: 'PATCH',
    body: JSON.stringify({ ignored }),
  });
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

export interface SummaryFilters {
  groupBy?: string;
  accountId?: number;
  accountType?: 'bank' | 'credit_card';
  startDate?: string;
  endDate?: string;
}

export function getSummary(params: SummaryFilters = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ groupBy: string; summary: SummaryItem[] }>(`/transactions/summary?${query}`);
}

// ─── Scraping ───

export function triggerScrape(accountId: number) {
  return request<{ success: boolean; transactionsFound: number; transactionsNew: number }>(`/scrape/${accountId}`, { method: 'POST' });
}

export function triggerScrapeAll() {
  return request<{ results: Array<{ success: boolean; accountId: number }> }>('/scrape/all', { method: 'POST' });
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

export function getScrapeLogs(params: { accountId?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ logs: Array<Record<string, unknown>> }>(`/scrape/logs?${query}`);
}

// ─── Categories ───

export interface Category {
  id: number;
  name: string;
  label: string;
  color: string | null;
  createdAt: string;
}

export function getCategories() {
  return request<{ categories: Category[] }>('/categories');
}

export function createCategory(data: { name: string; label: string; color?: string }) {
  return request<{ category: Category }>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCategory(id: number, data: { label?: string; color?: string }) {
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

// ─── AI ───

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function aiChat(messages: ChatMessage[]) {
  return request<{ response: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) });
}

export function aiCategorize(batchSize = 50) {
  return request<{ categorized: number }>('/ai/categorize', { method: 'POST', body: JSON.stringify({ batchSize }) });
}

export function aiRecategorize(startDate?: string, endDate?: string) {
  return request<{ categorized: number }>('/ai/recategorize', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate }),
  });
}
