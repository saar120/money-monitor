import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFixtureScenario, isFixtureMode } from './fixture-selection';
import type { HomeData, Transaction } from './fixtures';
import {
  fetchHomeData,
  fetchTransactionDetail,
  fetchTransactions,
  type ActivityFilter,
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
};

const MoneyDataContext = createContext<MoneyDataContextValue | null>(null);

export function MoneyDataProvider({ children }: { children: ReactNode }) {
  const fixture = isFixtureMode();
  const [status, setStatus] = useState<MoneyDataStatus>(fixture ? 'ready' : 'loading');
  const [home, setHome] = useState<HomeData | null>(fixture ? getFixtureScenario() : null);
  const [credential, setCredential] = useState<PairingCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(async () => {
    if (fixture) {
      setHome(getFixtureScenario());
      setStatus('ready');
      setRevision((value) => value + 1);
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const stored = await readPairingCredential();
      setCredential(stored);
      if (!stored) {
        setHome(null);
        setStatus('unpaired');
        return;
      }
      setHome(await fetchHomeData(stored));
      setStatus('ready');
      setRevision((value) => value + 1);
    } catch (caught) {
      setHome(null);
      setStatus('error');
      setError(
        caught instanceof Error ? caught.message : 'Money Monitor could not load your data.',
      );
    }
  }, [fixture]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      source: fixture ? ('fixture' as const) : ('live' as const),
      status,
      home,
      credential,
      error,
      revision,
      reload,
    }),
    [credential, error, fixture, home, reload, revision, status],
  );

  return <MoneyDataContext.Provider value={value}>{children}</MoneyDataContext.Provider>;
}

export function useMoneyData(): MoneyDataContextValue {
  const value = useContext(MoneyDataContext);
  if (!value) throw new Error('useMoneyData must be used inside MoneyDataProvider');
  return value;
}

export function useActivityTransactions(query: string, filter: ActivityFilter) {
  const money = useMoneyData();
  const fixture = getFixtureScenario();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fixtureTransactions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return fixture.transactions.filter((transaction) => {
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
      return matchesQuery && matchesFilter;
    });
  }, [filter, fixture.transactions, query]);

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
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchTransactions(
        money.credential as PairingCredential,
        {
          q: query,
          filter,
          startDate: `${(money.home as HomeData).currentDate.slice(0, 7)}-01`,
        },
        controller.signal,
      )
        .then((page) => {
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
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filter, money.credential, money.home, money.revision, money.source, money.status, query]);

  return {
    transactions: money.source === 'fixture' ? fixtureTransactions : transactions,
    loading: money.source === 'live' && loading,
    error,
    hasMore: money.source === 'live' && hasMore,
  };
}

export function useTransaction(id: string | undefined) {
  const money = useMoneyData();
  const fixtureTransaction =
    getFixtureScenario().transactions.find((item) => item.id === id) ?? null;
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
