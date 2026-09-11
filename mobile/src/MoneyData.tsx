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
import { getFixtureRefreshDelay, getFixtureScenario, isFixtureMode } from './fixture-selection';
import { FIXTURE_REVIEW_CATEGORIES, type HomeData, type Transaction } from './fixtures';
import {
  fetchCashflowMonth,
  fetchHomeData,
  fetchReviewOptions,
  fetchTransactionDetail,
  fetchTransactions,
  updateTransaction,
  type ActivityFilter,
  type CashflowMonth,
  type TransactionUpdate,
} from './mobile-api';
import { readPairingCredential, type PairingCredential } from './security/pairing-credential-store';

type MoneyDataStatus = 'loading' | 'unpaired' | 'ready' | 'error';

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
  loadReviewOptions: () => Promise<{ categories: string[]; owners: string[] }>;
  loadCashflowHistory: () => Promise<CashflowMonth[]>;
};

const MoneyDataContext = createContext<MoneyDataContextValue | null>(null);
const LAST_VISIT_KEY = 'money-monitor-last-successful-visit';

function recentMonths(financialDate: string, count: number) {
  const [year, month] = financialDate.slice(0, 7).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function fixtureCashflowHistory(home: HomeData): CashflowMonth[] {
  const months = recentMonths(home.currentDate, 6);
  const incomeFactors = [0.91, 1.04, 0.96, 1.07, 0.98, 1];
  const spendingFactors = [0.87, 1.02, 0.94, 1.09];
  return months.map((month, index) => ({
    month,
    label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${month}-01T12:00:00Z`),
    ),
    income: Math.round(home.income * incomeFactors[index]!),
    spending:
      index === 5
        ? home.spent
        : index === 4
          ? home.previousSpent
          : Math.round(home.spent * spendingFactors[index]!),
  }));
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

  const reload = useCallback(async () => {
    if (fixture) {
      const delay = fixtureReloads.current > 0 ? getFixtureRefreshDelay() : 0;
      fixtureReloads.current += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const scenario = getFixtureScenario();
      setHome(scenario);
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
      setRevision((value) => value + 1);
      setHome((value) =>
        update.reviewed && value
          ? { ...value, reviewCount: Math.max(0, value.reviewCount - 1) }
          : value,
      );
      return next;
    },
    [credential, fixture, fixtureTransactions],
  );

  const loadReviewOptions = useCallback(async () => {
    if (fixture) {
      const scenario = getFixtureScenario();
      return {
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
      };
    }
    if (!credential) throw new Error('Pair with your Mac to review transactions.');
    return fetchReviewOptions(credential);
  }, [credential, fixture]);

  const loadCashflowHistory = useCallback(async () => {
    const currentHome = home ?? getFixtureScenario();
    if (fixture) return fixtureCashflowHistory(currentHome);
    if (!credential) throw new Error('Pair with your Mac to explore cash flow.');
    return Promise.all(
      recentMonths(currentHome.currentDate, 6).map((month) =>
        fetchCashflowMonth(credential, month),
      ),
    );
  }, [credential, fixture, home]);

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
      loadCashflowHistory,
    }),
    [
      credential,
      error,
      fixture,
      fixtureTransactions,
      home,
      loadReviewOptions,
      loadCashflowHistory,
      reload,
      revision,
      saveTransaction,
      status,
    ],
  );

  return <MoneyDataContext.Provider value={value}>{children}</MoneyDataContext.Provider>;
}

export function useMoneyData(): MoneyDataContextValue {
  const value = useContext(MoneyDataContext);
  if (!value) throw new Error('useMoneyData must be used inside MoneyDataProvider');
  return value;
}

export function useActivityTransactions(query: string, filter: ActivityFilter, category?: string) {
  const money = useMoneyData();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const requestKey = `${filter}\u0000${query.trim()}\u0000${category ?? ''}`;
  const [resultKey, setResultKey] = useState('');

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
      return matchesQuery && matchesFilter && (!category || transaction.category === category);
    });
  }, [category, filter, money.fixtureTransactions, query]);

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
    const load = () => {
      setLoading(true);
      setError(null);
      void fetchTransactions(
        money.credential as PairingCredential,
        {
          q: query,
          category,
          filter,
          startDate:
            filter === 'review'
              ? undefined
              : `${(money.home as HomeData).currentDate.slice(0, 7)}-01`,
        },
        controller.signal,
      )
        .then((page) => {
          setResultKey(requestKey);
          setTransactions(page.transactions);
          setHasMore(page.hasMore);
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
    };
  }, [
    category,
    filter,
    money.credential,
    money.home,
    money.revision,
    money.source,
    money.status,
    query,
    requestKey,
  ]);

  return {
    transactions:
      money.source === 'fixture'
        ? fixtureTransactions
        : resultKey === requestKey
          ? transactions
          : [],
    loading: money.source === 'live' && (loading || resultKey !== requestKey),
    error,
    hasMore: money.source === 'live' && hasMore,
  };
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
