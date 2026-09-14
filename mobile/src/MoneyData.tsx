import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { activityRequestState } from './activity-request-state';
import { getFixtureRefreshDelay, getFixtureScenario, isFixtureMode } from './fixture-selection';
import { FIXTURE_REVIEW_CATEGORIES, type HomeData, type Transaction } from './fixtures';
import {
  fetchCashflowMonth,
  fetchExploreMonth,
  fetchHomeData,
  fetchReviewOptions,
  fetchTransactionDetail,
  fetchTransactionPage,
  fetchTransactions,
  updateTransaction,
  type ActivityFilter,
  type CashflowMonth,
  type ExploreMonth,
  type TransactionUpdate,
} from './mobile-api';
import { readPairingCredential, type PairingCredential } from './security/pairing-credential-store';

type MoneyDataStatus = 'loading' | 'unpaired' | 'ready' | 'error';
type ReviewOptions = { categories: string[]; owners: string[] };

type MoneyDataContextValue = {
  source: 'fixture' | 'live';
  status: MoneyDataStatus;
  home: HomeData | null;
  credential: PairingCredential | null;
  error: string | null;
  revision: number;
  reload: () => Promise<void>;
  fixtureTransactions: Transaction[];
  saveTransaction: (id: string, update: TransactionUpdate) => Promise<Transaction>;
  loadReviewOptions: () => Promise<ReviewOptions>;
  loadOverviewMonth: (month: string) => Promise<HomeData>;
  loadCashflowHistory: (endingMonth?: string) => Promise<CashflowMonth[]>;
  loadExploreHistory: (count?: number) => Promise<ExploreMonth[]>;
};

const MoneyDataContext = createContext<MoneyDataContextValue | null>(null);
const LAST_VISIT_KEY = 'money-monitor-last-successful-visit';

export type ActivityCriteria = {
  startDate?: string;
  endDate?: string;
  category?: string;
  categories?: string[];
  account?: string;
  accountId?: string;
  owner?: string;
  status?: 'posted' | 'pending';
  direction?: 'debit' | 'credit';
  needsReview?: boolean;
  inclusion?: 'all' | 'included' | 'excluded';
};
const EMPTY_ACTIVITY_CRITERIA: ActivityCriteria = {};

function recentMonths(financialDate: string, count: number) {
  const [year, month] = financialDate.slice(0, 7).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function fixtureOverview(home: HomeData, month: string): HomeData {
  if (month === home.monthKey) return home;
  const previous = home.availableMonths[1];
  const hasData = month === previous;
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const spent = hasData ? home.previousSpent : 0;
  const income = hasData ? Math.round(home.income * 0.96) : 0;
  return {
    ...home,
    currentDate: `${month}-${String(lastDay).padStart(2, '0')}`,
    monthKey: month,
    month: new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
      new Date(`${month}-01T12:00:00Z`),
    ),
    spent,
    income,
    previousSpent: hasData ? Math.round(spent * 1.04) : 0,
    spendingVsIncomePercent: income > 0 ? Math.round((spent / income) * 100) : null,
    available: home.budget === null ? null : home.budget - spent,
    categories: hasData
      ? home.categories.map((category) => ({
          ...category,
          spent: category.previous,
          previous: Math.round(category.previous * 1.04),
        }))
      : [],
    trend: hasData
      ? home.trend.map((point) => ({
          day: point.day,
          current: point.previous,
          previous: Math.round(point.previous * 1.04),
        }))
      : [],
    merchants: hasData
      ? home.merchants.map((merchant) => ({
          ...merchant,
          current: merchant.previous,
          previous: Math.round(merchant.previous * 1.04),
        }))
      : [],
    budgets: home.budgets.map((budget) => ({
      ...budget,
      spent,
      remaining: budget.limit - spent,
      usedPercent: budget.limit > 0 ? Math.round((spent / budget.limit) * 100) : 0,
      elapsedPercent: 100,
    })),
    sinceLastVisit: null,
  };
}

function fixtureExploreHistory(home: HomeData, count: number): ExploreMonth[] {
  const months = recentMonths(home.currentDate, count);
  const last = months.length - 1;
  const valueAt = (current: number, previous: number, index: number) =>
    index === last
      ? current
      : index === last - 1
        ? previous
        : Math.round(previous * (0.84 + ((index * 7) % 9) * 0.035));

  return months.map((month, index) => {
    const spending = valueAt(home.spent, home.previousSpent, index);
    const factor = home.spent > 0 ? spending / home.spent : 1;
    return {
      month,
      label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
        new Date(`${month}-01T12:00:00Z`),
      ),
      currencyCode: home.currencyCode,
      income: valueAt(home.income, Math.round(home.income * 0.98), index),
      spending,
      categories: home.categories.map((category) => ({
        ...category,
        spent: valueAt(category.spent, category.previous, index),
        previous:
          index > 0
            ? valueAt(category.spent, category.previous, index - 1)
            : Math.round(category.previous * 0.94),
      })),
      budgets: home.budgets.map((budget) => {
        const spent = Math.round(budget.spent * factor);
        const usedPercent = budget.limit > 0 ? Math.round((spent / budget.limit) * 100) : 0;
        return {
          ...budget,
          spent,
          remaining: budget.limit - spent,
          usedPercent,
          status:
            spent > budget.limit
              ? ('over_budget' as const)
              : usedPercent > budget.elapsedPercent + 10
                ? ('watch' as const)
                : ('on_track' as const),
        };
      }),
      merchants: home.merchants.map((merchant) => ({
        ...merchant,
        current: valueAt(merchant.current, merchant.previous, index),
        previous:
          index > 0
            ? valueAt(merchant.current, merchant.previous, index - 1)
            : Math.round(merchant.previous * 0.94),
      })),
    };
  });
}

export function MoneyDataProvider({ children }: { children: ReactNode }) {
  const fixture = isFixtureMode();
  const [status, setStatus] = useState<MoneyDataStatus>(fixture ? 'ready' : 'loading');
  const [home, setHome] = useState<HomeData | null>(fixture ? getFixtureScenario() : null);
  const [credential, setCredential] = useState<PairingCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [fixtureTransactions, setFixtureTransactions] = useState<Transaction[]>(
    () => getFixtureScenario().transactions,
  );
  const hasHome = useRef(home !== null);
  const fixtureReloads = useRef(0);
  const reviewOptionsRequest = useRef<Promise<ReviewOptions> | null>(null);
  const overviewRequests = useRef(new Map<string, Promise<HomeData>>());

  const reload = useCallback(async () => {
    reviewOptionsRequest.current = null;
    overviewRequests.current.clear();
    if (fixture) {
      const delay = fixtureReloads.current > 0 ? getFixtureRefreshDelay() : 0;
      fixtureReloads.current += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const scenario = getFixtureScenario();
      setHome(scenario);
      overviewRequests.current.set(scenario.monthKey, Promise.resolve(scenario));
      setFixtureTransactions(scenario.transactions);
      setError(null);
      setStatus('ready');
      setRevision((value) => value + 1);
      return;
    }

    const isRefresh = hasHome.current;
    if (!isRefresh) setStatus('loading');
    setError(null);
    try {
      const stored = await readPairingCredential();
      setCredential(stored);
      if (!stored) {
        hasHome.current = false;
        setHome(null);
        setStatus('unpaired');
        return;
      }
      const lastVisit = await SecureStore.getItemAsync(LAST_VISIT_KEY);
      const nextHome = await fetchHomeData(stored, undefined, lastVisit);
      overviewRequests.current.set(nextHome.monthKey, Promise.resolve(nextHome));
      hasHome.current = true;
      setHome(nextHome);
      await SecureStore.setItemAsync(LAST_VISIT_KEY, new Date().toISOString());
      setStatus('ready');
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Money Monitor could not load your data.',
      );
      if (!isRefresh) {
        hasHome.current = false;
        setHome(null);
        setStatus('error');
      }
    }
  }, [fixture]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveTransaction = useCallback(
    async (id: string, update: TransactionUpdate) => {
      if (fixture) {
        const current = fixtureTransactions.find((transaction) => transaction.id === id);
        if (!current) throw new Error('Transaction is no longer available.');
        const next = {
          ...current,
          ...update,
          needsReview: update.reviewed ? false : current.needsReview,
        };
        delete (next as Transaction & { reviewed?: true }).reviewed;
        setFixtureTransactions((transactions) =>
          transactions.map((transaction) => (transaction.id === id ? next : transaction)),
        );
        if (update.reviewed && current.needsReview)
          setHome((value) =>
            value ? { ...value, reviewCount: Math.max(0, value.reviewCount - 1) } : value,
          );
        setRevision((value) => value + 1);
        return next;
      }
      if (!credential) throw new Error('Pair with your Mac to update transactions.');
      const next = await updateTransaction(credential, id, update);
      await reload();
      return next;
    },
    [credential, fixture, fixtureTransactions, reload],
  );

  const loadReviewOptions = useCallback(() => {
    if (reviewOptionsRequest.current) return reviewOptionsRequest.current;
    let request: Promise<ReviewOptions>;
    if (fixture) {
      const scenario = getFixtureScenario();
      request = Promise.resolve({
        categories: [
          ...new Set([
            ...FIXTURE_REVIEW_CATEGORIES,
            ...scenario.categories.map((category) => category.name),
          ]),
        ].sort(),
        owners: [
          ...new Set([
            ...scenario.transactions.map((transaction) => transaction.owner),
            'Shared',
            'Unassigned',
          ]),
        ].sort(),
      });
    } else {
      if (!credential)
        return Promise.reject(new Error('Pair with your Mac to review transactions.'));
      request = fetchReviewOptions(credential);
    }
    const cachedRequest = request.catch((caught) => {
      if (reviewOptionsRequest.current === cachedRequest) reviewOptionsRequest.current = null;
      throw caught;
    });
    reviewOptionsRequest.current = cachedRequest;
    return cachedRequest;
  }, [credential, fixture]);

  const loadOverviewMonth = useCallback(
    (month: string) => {
      if (!/^\d{4}-\d{2}$/.test(month)) return Promise.reject(new Error('Invalid month.'));
      if (home?.monthKey === month) return Promise.resolve(home);
      const cached = overviewRequests.current.get(month);
      if (cached) return cached;
      const request = fixture
        ? Promise.resolve(fixtureOverview(getFixtureScenario(), month))
        : credential
          ? fetchHomeData(credential, undefined, null, month)
          : Promise.reject(new Error('Pair with your Mac to load another month.'));
      overviewRequests.current.set(month, request);
      request.catch(() => overviewRequests.current.delete(month));
      return request;
    },
    [credential, fixture, home],
  );

  useEffect(() => {
    if (status !== 'ready') return;
    void loadReviewOptions().catch(() => undefined);
  }, [loadReviewOptions, revision, status]);

  const loadCashflowHistory = useCallback(
    async (endingMonth?: string) => {
      const currentHome = home ?? getFixtureScenario();
      const end = endingMonth ?? currentHome.monthKey;
      const selectedHome = await loadOverviewMonth(end);
      const dataMonths = selectedHome.availableMonths
        .filter((month) => month <= end)
        .slice(0, 6)
        .reverse();
      const months = dataMonths.length ? dataMonths : recentMonths(`${end}-01`, 6);
      if (fixture)
        return months.map((month) => {
          const overview = fixtureOverview(currentHome, month);
          return {
            month,
            label: overview.month.slice(0, 3),
            income: overview.income,
            spending: overview.spent,
          };
        });
      if (!credential) throw new Error('Pair with your Mac to explore cash flow.');
      return Promise.all(months.map((month) => fetchCashflowMonth(credential, month)));
    },
    [credential, fixture, home, loadOverviewMonth],
  );

  const loadExploreHistory = useCallback(
    async (count = 12) => {
      const currentHome = home ?? getFixtureScenario();
      if (fixture) return fixtureExploreHistory(currentHome, count);
      if (!credential) throw new Error('Pair with your Mac to explore cash flow.');
      const months = (
        currentHome.availableMonths.length ? currentHome.availableMonths : [currentHome.monthKey]
      )
        .slice(0, count)
        .reverse();
      return Promise.all(months.map((month) => fetchExploreMonth(credential, month)));
    },
    [credential, fixture, home],
  );

  const value = useMemo(
    () => ({
      source: fixture ? ('fixture' as const) : ('live' as const),
      status,
      home,
      credential,
      error,
      revision,
      reload,
      fixtureTransactions,
      saveTransaction,
      loadReviewOptions,
      loadOverviewMonth,
      loadCashflowHistory,
      loadExploreHistory,
    }),
    [
      credential,
      error,
      fixture,
      fixtureTransactions,
      home,
      loadReviewOptions,
      loadOverviewMonth,
      loadCashflowHistory,
      loadExploreHistory,
      reload,
      revision,
      saveTransaction,
      status,
    ],
  );

  return <MoneyDataContext.Provider value={value}>{children}</MoneyDataContext.Provider>;
}

export function useOverviewMonth(initialMonth?: string) {
  const money = useMoneyData();
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [overview, setOverview] = useState<HomeData | null>(money.home);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const month = selectedMonth ?? money.home?.monthKey ?? '';

  useEffect(() => {
    if (!month || money.status !== 'ready') return;
    if (money.home?.monthKey === month) {
      setOverview(money.home);
      setError(null);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    void money
      .loadOverviewMonth(month)
      .then((value) => {
        if (current) setOverview(value);
      })
      .catch((caught) => {
        if (current)
          setError(caught instanceof Error ? caught.message : 'This month could not be loaded.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [money.home, money.loadOverviewMonth, money.status, month]);

  return {
    overview,
    month,
    months: money.home?.availableMonths ?? [],
    selectMonth: setSelectedMonth,
    loading,
    error,
  };
}

export function useMoneyData(): MoneyDataContextValue {
  const value = useContext(MoneyDataContext);
  if (!value) throw new Error('useMoneyData must be used inside MoneyDataProvider');
  return value;
}

export function useExploreHistory(count = 12) {
  const money = useMoneyData();
  const [months, setMonths] = useState<ExploreMonth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (money.status !== 'ready' || !money.home) return;
    let current = true;
    setLoading(true);
    void money
      .loadExploreHistory(count)
      .then((value) => {
        if (current) setMonths(value);
      })
      .catch(() => {
        if (current) setMonths([]);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [count, money]);

  return { months, loading };
}

export function useActivityTransactions(
  query: string,
  filter: ActivityFilter = 'all',
  criteria: ActivityCriteria = EMPTY_ACTIVITY_CRITERIA,
  paginate = false,
) {
  const money = useMoneyData();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestKey = `${filter}\u0000${query.trim()}\u0000${JSON.stringify(criteria)}`;
  const [resultKey, setResultKey] = useState('');
  const activeRequestKey = useRef(requestKey);
  const moreRequest = useRef<AbortController | null>(null);
  activeRequestKey.current = requestKey;

  const fixtureTransactions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return money.fixtureTransactions.filter((transaction) => {
      const matchesQuery =
        !normalized ||
        [transaction.merchant, transaction.description, transaction.category, transaction.account]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalized));
      const matchesFilter =
        filter === 'all' ||
        (filter === 'review' && transaction.needsReview) ||
        (filter === 'pending' && transaction.pending) ||
        (filter === 'credits' && transaction.amount > 0);
      const date = transaction.effectiveDate || transaction.occurredAt.slice(0, 10);
      const matchesCriteria =
        (!criteria.startDate || date >= criteria.startDate) &&
        (!criteria.endDate || date <= criteria.endDate) &&
        (!criteria.category || transaction.category === criteria.category) &&
        (!criteria.categories?.length || criteria.categories.includes(transaction.category)) &&
        (!criteria.account || transaction.account === criteria.account) &&
        (!criteria.owner || transaction.owner === criteria.owner) &&
        (!criteria.status || (criteria.status === 'pending') === Boolean(transaction.pending)) &&
        (!criteria.direction ||
          (criteria.direction === 'credit' ? transaction.amount > 0 : transaction.amount < 0)) &&
        (criteria.needsReview === undefined ||
          Boolean(transaction.needsReview) === criteria.needsReview) &&
        (!criteria.inclusion ||
          criteria.inclusion === 'all' ||
          transaction.included === (criteria.inclusion === 'included'));
      return matchesQuery && matchesFilter && matchesCriteria;
    });
  }, [criteria, filter, money.fixtureTransactions, query]);

  useEffect(() => {
    if (
      money.source === 'fixture' ||
      money.status !== 'ready' ||
      !money.credential ||
      !money.home
    ) {
      return;
    }
    const controller = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = null;
    setNextCursor(null);
    setLoadingMore(false);
    const load = () => {
      setLoading(true);
      setError(null);
      const transactionQuery = activityTransactionQuery(query, filter, criteria);
      const request = paginate
        ? fetchVisibleTransactionPage(
            money.credential as PairingCredential,
            transactionQuery,
            criteria,
            controller.signal,
          )
        : fetchTransactions(
            money.credential as PairingCredential,
            transactionQuery,
            controller.signal,
          );
      void request
        .then((page) => {
          setResultKey(requestKey);
          setTransactions(filterActivityPage(page.transactions, criteria));
          setNextCursor(page.nextCursor);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setError(
              caught instanceof Error ? caught.message : 'Transactions could not be loaded.',
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    const timer = query.trim() ? setTimeout(load, 250) : null;
    if (!timer) load();
    return () => {
      if (timer) clearTimeout(timer);
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [
    criteria,
    filter,
    money.credential,
    money.home,
    money.revision,
    money.source,
    money.status,
    paginate,
    query,
    requestKey,
  ]);

  const loadMore = useCallback(() => {
    if (
      !paginate ||
      !nextCursor ||
      loadingMore ||
      moreRequest.current ||
      money.source !== 'live' ||
      !money.credential
    )
      return;
    const key = requestKey;
    const controller = new AbortController();
    moreRequest.current = controller;
    setError(null);
    setLoadingMore(true);
    void fetchVisibleTransactionPage(
      money.credential,
      { ...activityTransactionQuery(query, filter, criteria), cursor: nextCursor },
      criteria,
      controller.signal,
    )
      .then((page) => {
        if (activeRequestKey.current !== key) return;
        setTransactions((current) => [...current, ...page.transactions]);
        setNextCursor(page.nextCursor);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && activeRequestKey.current === key)
          setError(caught instanceof Error ? caught.message : 'More transactions could not load.');
      })
      .finally(() => {
        if (moreRequest.current === controller) moreRequest.current = null;
        if (!controller.signal.aborted && activeRequestKey.current === key) {
          setLoadingMore(false);
        }
      });
  }, [
    criteria,
    filter,
    loadingMore,
    money.credential,
    money.source,
    nextCursor,
    paginate,
    query,
    requestKey,
  ]);

  const requestState = activityRequestState({
    source: money.source,
    loading,
    resultKey,
    requestKey,
    error,
  });

  return {
    transactions:
      money.source === 'fixture'
        ? fixtureTransactions
        : resultKey === requestKey
          ? transactions
          : [],
    loading: requestState === 'loading',
    loadingMore: money.source === 'live' && loadingMore,
    error,
    hasMore: money.source === 'live' && nextCursor !== null,
    loadMore,
  };
}

function activityTransactionQuery(
  query: string,
  filter: ActivityFilter,
  criteria: ActivityCriteria,
) {
  return {
    limit: 50,
    q: query,
    category: criteria.category,
    categories: criteria.categories,
    filter,
    startDate: criteria.startDate,
    endDate: criteria.endDate,
    accountId: criteria.accountId,
    status: criteria.status,
    direction: criteria.direction,
    needsReview: criteria.needsReview,
    includeExcluded: criteria.inclusion === 'all' || criteria.inclusion === 'excluded',
  };
}

function filterActivityPage(transactions: Transaction[], criteria: ActivityCriteria) {
  return transactions.filter(
    (transaction) =>
      (!criteria.owner || transaction.owner === criteria.owner) &&
      (!criteria.account || transaction.account === criteria.account) &&
      (criteria.needsReview === undefined ||
        Boolean(transaction.needsReview) === criteria.needsReview) &&
      (!criteria.inclusion ||
        criteria.inclusion === 'all' ||
        transaction.included === (criteria.inclusion === 'included')),
  );
}

async function fetchVisibleTransactionPage(
  credential: PairingCredential,
  query: ReturnType<typeof activityTransactionQuery> & { cursor?: string },
  criteria: ActivityCriteria,
  signal: AbortSignal,
) {
  let cursor = query.cursor;
  while (true) {
    const page = await fetchTransactionPage(credential, { ...query, cursor }, signal);
    const transactions = filterActivityPage(page.transactions, criteria);
    if (transactions.length || !page.nextCursor) return { ...page, transactions };
    cursor = page.nextCursor;
  }
}

export function useTransaction(id: string | undefined) {
  const money = useMoneyData();
  const fixtureTransaction = money.fixtureTransactions.find((item) => item.id === id) ?? null;
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (money.source === 'fixture' || money.status !== 'ready' || !money.credential || !id) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTransactionDetail(money.credential, id, controller.signal)
      .then(setTransaction)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Transaction could not be loaded.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, money.credential, money.revision, money.source, money.status]);

  return {
    transaction: money.source === 'fixture' ? fixtureTransaction : transaction,
    loading: money.source === 'live' && loading,
    error,
  };
}
