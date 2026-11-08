import { AppState } from 'react-native';
import { savedViewIdentity, savedViewStore } from './security/saved-view-storage';
import { savedViewState } from './saved-view-store';
import { randomUUID } from 'expo-crypto';
import { MobileRequestError } from './request-error';
import { fixtureCategoryName, t } from './translations';
import { currentLocale } from './locale-state';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { createHistoryCache } from './history-cache';
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
import { observeAuthenticationInvalidation, terminalAuthenticationError } from './request-error';
import {
  invalidatePairingCredential,
  observePairingCredential,
  readPairingCredential,
  type PairingCredential,
} from './security/pairing-credential-store';

type MoneyDataStatus = 'loading' | 'unpaired' | 'ready' | 'error';
type Availability =
  | {
      kind: 'booting' | 'unpaired' | 'connecting' | 'unavailable';
      home: null;
      error: string | null;
    }
  | { kind: 'fixture'; home: HomeData; error: null }
  | {
      kind: 'live' | 'refreshing-live';
      home: HomeData;
      credential: PairingCredential;
      error: string | null;
    }
  | { kind: 'saved-view' | 'stale-saved-view'; home: HomeData; error: string | null };

type ReviewOptions = { categories: string[]; owners: string[] };

type MoneyDataContextValue = {
  source: 'fixture' | 'live';
  status: MoneyDataStatus;
  availability: Availability['kind'];
  canMutate: boolean;
  home: HomeData | null;
  credential: PairingCredential | null;
  error: string | null;
  revision: number;
  reload: () => Promise<void>;
  fixtureTransactions: Transaction[];
  saveTransaction: (
    id: string,
    update: TransactionUpdate,
    expectedVersion?: number,
  ) => Promise<Transaction>;
  loadReviewOptions: () => Promise<ReviewOptions>;
  loadOverviewMonth: (month: string) => Promise<HomeData>;
  loadCashflowHistory: (endingMonth?: string) => Promise<CashflowMonth[]>;
  exploreHistory: ReturnType<typeof createHistoryCache<ExploreMonth>>;
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
    month: new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: 'UTC' }).format(
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
      label: new Intl.DateTimeFormat(currentLocale(), { month: 'short', timeZone: 'UTC' }).format(
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
  const [availability, setAvailability] = useState<Availability>(
    fixture
      ? { kind: 'fixture', home: getFixtureScenario(), error: null }
      : { kind: 'booting', home: null, error: null },
  );
  const home = availability.home;
  const credential =
    availability.kind === 'live' || availability.kind === 'refreshing-live'
      ? availability.credential
      : null;
  const error = availability.error;
  const status: MoneyDataStatus = home
    ? 'ready'
    : availability.kind === 'unpaired'
      ? 'unpaired'
      : availability.kind === 'unavailable'
        ? 'error'
        : 'loading';
  const canMutate =
    fixture || availability.kind === 'live' || availability.kind === 'refreshing-live';
  const [revision, setRevision] = useState(0);
  const [fixtureTransactions, setFixtureTransactions] = useState<Transaction[]>(
    () => getFixtureScenario().transactions,
  );
  const generation = useRef(0);
  const activeCredential = useRef<PairingCredential | null>(null);
  const blockedCredential = useRef<string | null>(null);
  const current = useRef(availability);
  current.current = availability;
  const fixtureReloads = useRef(0);
  const reviewOptionsRequest = useRef<Promise<ReviewOptions> | null>(null);
  const overviewRequests = useRef(new Map<string, Promise<HomeData>>());
  const pendingMutations = useRef(
    new Map<string, { commandId: string; expectedVersion: number; patch: TransactionUpdate }>(),
  );

  const reload = useCallback(async () => {
    const attempt = ++generation.current;
    reviewOptionsRequest.current = null;
    overviewRequests.current.clear();
    if (fixture) {
      const delay = fixtureReloads.current++ > 0 ? getFixtureRefreshDelay() : 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (attempt !== generation.current) return;
      const scenario = getFixtureScenario();
      setAvailability({ kind: 'fixture', home: scenario, error: null });
      overviewRequests.current.set(scenario.monthKey, Promise.resolve(scenario));
      setFixtureTransactions(scenario.transactions);
      setRevision((v) => v + 1);
      return;
    }
    let stored: PairingCredential | null = null;
    try {
      stored = await readPairingCredential();
      if (attempt !== generation.current) return;
      if (stored?.token === blockedCredential.current) {
        await invalidatePairingCredential(stored).catch(() => {});
        await savedViewStore.purge().catch(() => {});
        return;
      }
      const changed = activeCredential.current?.token !== stored?.token;
      activeCredential.current = stored;
      if (!stored) {
        pendingMutations.current.clear();
        setAvailability({ kind: 'unpaired', home: null, error: null });
        await savedViewStore.purge();
        return;
      }
      const identity = await savedViewIdentity(stored);
      if (attempt !== generation.current) return;
      const previous = !changed ? current.current.home : null;
      const saved =
        previous &&
        savedViewState(previous, Date.now(), Date.parse(previous.snapshot?.calculatedAt ?? ''))
          ? {
              home: previous,
              status: savedViewState(
                previous,
                Date.now(),
                Date.parse(previous.snapshot!.calculatedAt),
              )!,
            }
          : await savedViewStore.load(identity);
      if (attempt !== generation.current) return;
      if (previous && current.current.kind === 'live')
        setAvailability({
          kind: 'refreshing-live',
          home: previous,
          credential: stored,
          error: null,
        });
      else if (saved) setAvailability({ kind: saved.status, home: saved.home, error: null });
      else setAvailability({ kind: 'connecting', home: null, error: null });
      const lastVisit = await SecureStore.getItemAsync(LAST_VISIT_KEY);
      const nextHome = await fetchHomeData(stored, undefined, lastVisit);
      if (attempt !== generation.current || stored.token === blockedCredential.current) return;
      if (
        saved?.home.snapshot &&
        nextHome.snapshot &&
        nextHome.snapshot.calculatedAt < saved.home.snapshot.calculatedAt
      )
        throw new Error('An older snapshot cannot replace Saved View');
      overviewRequests.current.set(nextHome.monthKey, Promise.resolve(nextHome));
      setAvailability({ kind: 'live', home: nextHome, credential: stored, error: null });
      setRevision((v) => v + 1);
      void SecureStore.setItemAsync(LAST_VISIT_KEY, new Date().toISOString()).catch(() => {});
      if (nextHome.snapshot?.complete && nextHome.snapshot.cacheable)
        void savedViewStore.save(identity, nextHome).catch(() => {});
    } catch (caught) {
      if (attempt !== generation.current) return;
      if (terminalAuthenticationError(caught)) {
        if (stored) {
          blockedCredential.current = stored.token;
          void invalidatePairingCredential(stored).catch(() => {});
        }
        void savedViewStore.purge().catch(() => {});
        setAvailability({ kind: 'unpaired', home: null, error: null });
        return;
      }
      const message =
        caught instanceof Error ? caught.message : t('moneyMonitorCouldNotLoadYourData');
      const saved = stored
        ? await savedViewStore.load(await savedViewIdentity(stored)).catch(() => null)
        : null;
      if (attempt !== generation.current) return;
      setAvailability(
        saved
          ? { kind: saved.status, home: saved.home, error: message }
          : { kind: 'unavailable', home: null, error: message },
      );
    }
  }, [fixture]);

  useEffect(() => {
    const stopCredential = observePairingCredential(() => {
      generation.current++;
      activeCredential.current = null;
      overviewRequests.current.clear();
      reviewOptionsRequest.current = null;
      pendingMutations.current.clear();
      setAvailability({ kind: 'unpaired', home: null, error: null });
      void reload();
    });
    const stopInvalidation = observeAuthenticationInvalidation((event) => {
      const credential = activeCredential.current;
      if (
        !credential ||
        event.authorization !== `Bearer ${credential.token}` ||
        !event.url.startsWith(credential.baseURL + '/')
      )
        return;
      generation.current++;
      blockedCredential.current = credential.token;
      activeCredential.current = null;
      overviewRequests.current.clear();
      reviewOptionsRequest.current = null;
      pendingMutations.current.clear();
      setAvailability({ kind: 'unpaired', home: null, error: null });
      setRevision((v) => v + 1);
      void invalidatePairingCredential(credential).catch(() => {});
      void savedViewStore.purge().catch(() => {});
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    void reload();
    return () => {
      generation.current++;
      stopCredential();
      stopInvalidation();
      foreground.remove();
    };
  }, [reload]);

  useEffect(() => {
    if (
      !home?.snapshot ||
      fixture ||
      (availability.kind !== 'saved-view' && availability.kind !== 'stale-saved-view')
    )
      return;
    let highestObserved = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const now = Date.now();
      const state = savedViewState(home, now, highestObserved);
      highestObserved = Math.max(now, highestObserved);
      if (!state) {
        setAvailability({ kind: 'unavailable', home: null, error: null });
        void savedViewStore.purge().catch(() => {});
        return;
      }
      setAvailability((value) =>
        value.home === home && (value.kind === 'saved-view' || value.kind === 'stale-saved-view')
          ? { ...value, kind: state }
          : value,
      );
      const boundary = Date.parse(
        state === 'saved-view' ? home.snapshot!.staleAt : home.snapshot!.deleteAfter,
      );
      timer = setTimeout(refresh, Math.min(60_000, Math.max(1, boundary - now)));
    };
    refresh();
    return () => clearTimeout(timer);
  }, [fixture, home, availability.kind]);

  const saveTransaction = useCallback(
    async (id: string, update: TransactionUpdate, expectedVersion?: number) => {
      if (fixture) {
        const current = fixtureTransactions.find((transaction) => transaction.id === id);
        if (!current) throw new Error(t('transactionIsNoLongerAvailable'));
        const next = {
          ...current,
          ...update,
          resourceVersion: (current.resourceVersion ?? 1) + 1,
          needsReview: update.reviewed ? false : current.needsReview,
        };
        delete (next as Transaction & { reviewed?: true }).reviewed;
        setFixtureTransactions((transactions) =>
          transactions.map((transaction) => (transaction.id === id ? next : transaction)),
        );
        if (update.reviewed && current.needsReview)
          setAvailability((value) =>
            value.home
              ? {
                  ...value,
                  home: { ...value.home, reviewCount: Math.max(0, value.home.reviewCount - 1) },
                }
              : value,
          );
        setRevision((value) => value + 1);
        return next;
      }
      if (!canMutate || !credential) throw new Error(t('pairWithYourMacToUpdateTransactions'));
      const token = credential.token;
      let command = pendingMutations.current.get(id);
      if (command && JSON.stringify(command.patch) !== JSON.stringify(update)) {
        let reconciled: Transaction;
        try {
          reconciled = await updateTransaction(credential, id, {
            ...command.patch,
            commandId: command.commandId,
            expectedVersion: command.expectedVersion,
          });
        } catch (cause) {
          if (
            cause instanceof MobileRequestError &&
            cause.kind === 'api' &&
            (cause.status ?? 500) < 500
          ) {
            pendingMutations.current.delete(id);
            if (cause.code === 'mutation_conflict') {
              cause.current = await fetchTransactionDetail(credential, id).catch(() => undefined);
              void reload();
            }
          }
          throw cause;
        }
        if (activeCredential.current?.token !== token || blockedCredential.current === token)
          throw new Error('Retired pairing');
        pendingMutations.current.delete(id);
        command = undefined;
        expectedVersion = reconciled.resourceVersion;
      }
      if (!command) {
        if (!expectedVersion) throw new Error(t('mobileErrorUpgradeRequired'));
        command = { commandId: randomUUID(), expectedVersion, patch: update };
        pendingMutations.current.set(id, command);
      }
      let next: Transaction;
      try {
        next = await updateTransaction(credential, id, {
          ...command.patch,
          commandId: command.commandId,
          expectedVersion: command.expectedVersion,
        });
      } catch (cause) {
        if (
          cause instanceof MobileRequestError &&
          cause.kind === 'api' &&
          (cause.status ?? 500) < 500
        ) {
          pendingMutations.current.delete(id);
          if (cause.code === 'mutation_conflict') {
            cause.current = await fetchTransactionDetail(credential, id).catch(() => undefined);
            void reload();
          }
        }
        throw cause;
      }
      if (activeCredential.current?.token !== token || blockedCredential.current === token)
        throw new Error('Retired pairing');
      pendingMutations.current.delete(id);
      void reload();
      return next;
    },
    [canMutate, credential, fixture, fixtureTransactions, reload],
  );

  const loadReviewOptions = useCallback(() => {
    if (reviewOptionsRequest.current) return reviewOptionsRequest.current;
    let request: Promise<ReviewOptions>;
    if (fixture) {
      const scenario = getFixtureScenario();
      request = Promise.resolve({
        categories: [
          ...new Set([
            ...FIXTURE_REVIEW_CATEGORIES.map(fixtureCategoryName),
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
      if (!credential) return Promise.reject(new Error(t('pairWithYourMacToReviewTransactions')));
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
      if (!/^\d{4}-\d{2}$/.test(month)) return Promise.reject(new Error(t('invalidMonth')));
      if (home?.monthKey === month) return Promise.resolve(home);
      const cached = overviewRequests.current.get(month);
      if (cached) return cached;
      const request = fixture
        ? Promise.resolve(fixtureOverview(getFixtureScenario(), month))
        : credential
          ? fetchHomeData(credential, undefined, null, month)
          : Promise.reject(new Error(t('pairWithYourMacToLoadAnotherMonth')));
      overviewRequests.current.set(month, request);
      while (overviewRequests.current.size > 24)
        overviewRequests.current.delete(overviewRequests.current.keys().next().value!);
      request.catch(() => {
        if (overviewRequests.current.get(month) === request) overviewRequests.current.delete(month);
      });
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
      if (!credential) throw new Error(t('pairWithYourMacToExploreCashFlow'));
      return Promise.all(months.map((month) => fetchCashflowMonth(credential, month)));
    },
    [credential, fixture, home, loadOverviewMonth],
  );

  const loadExploreHistory = useCallback(
    async (count = 12) => {
      const currentHome = home ?? getFixtureScenario();
      if (fixture) return fixtureExploreHistory(currentHome, count);
      if (!credential) throw new Error(t('pairWithYourMacToExploreCashFlow'));
      const months = (
        currentHome.availableMonths.length ? currentHome.availableMonths : [currentHome.monthKey]
      )
        .slice(0, count)
        .reverse();
      return Promise.all(months.map((month) => fetchExploreMonth(credential, month)));
    },
    [credential, fixture, home],
  );

  const exploreHistory = useMemo(
    () => createHistoryCache(loadExploreHistory),
    [loadExploreHistory, revision],
  );
  useEffect(() => {
    if (status === 'ready') void exploreHistory.load().catch(() => undefined);
  }, [exploreHistory, status]);

  const value = useMemo(
    () => ({
      source: fixture ? ('fixture' as const) : ('live' as const),
      status,
      availability: availability.kind,
      canMutate,
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
      exploreHistory,
    }),
    [
      credential,
      availability.kind,
      canMutate,
      error,
      fixture,
      fixtureTransactions,
      home,
      loadReviewOptions,
      loadOverviewMonth,
      loadCashflowHistory,
      exploreHistory,
      reload,
      revision,
      saveTransaction,
      status,
    ],
  );

  return (
    <MoneyDataContext.Provider value={value}>
      <Fragment
        key={
          fixture ? 'fixture' : (credential?.token ?? activeCredential.current?.token ?? 'unpaired')
        }
      >
        {children}
      </Fragment>
    </MoneyDataContext.Provider>
  );
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
      .catch(() => {
        if (current) setError(t('thisMonthCouldNotBeLoaded'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [money.home, money.loadOverviewMonth, money.status, month]);

  return {
    overview: overview?.monthKey === month ? overview : null,
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
  const { exploreHistory, status } = useMoneyData();
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState(() => ({
    cache: exploreHistory,
    count,
    months: exploreHistory.peek(count),
    error: null as string | null,
  }));
  const owned = result.cache === exploreHistory && result.count === count;
  const months = owned ? result.months : exploreHistory.peek(count);
  useEffect(() => {
    if (status !== 'ready') return;
    let current = true;
    void exploreHistory.load(count).then(
      (months) => {
        if (current) setResult({ cache: exploreHistory, count, months, error: null });
      },
      (cause) => {
        if (current)
          setResult({
            cache: exploreHistory,
            count,
            months: exploreHistory.peek(count),
            error: cause instanceof Error ? cause.message : t('couldnTLoadYourFinances'),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [count, exploreHistory, status, retryCount]);
  return {
    months: months ?? [],
    loading: months === undefined && !(owned && result.error),
    error: owned ? result.error : null,
    retry: () => {
      setResult({ cache: exploreHistory, count, months: exploreHistory.peek(count), error: null });
      setRetryCount((value) => value + 1);
    },
  };
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
  const requestKey = JSON.stringify([
    filter,
    query.trim().normalize('NFKC'),
    criteria,
    money.revision,
    money.credential?.serverId,
  ]);
  const [resultKey, setResultKey] = useState('');
  const activeRequestKey = useRef(requestKey);
  const moreRequest = useRef<AbortController | null>(null);
  const visitedCursors = useRef(new Set<string>());
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
    visitedCursors.current.clear();
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
          if (controller.signal.aborted || activeRequestKey.current !== requestKey) return;
          setResultKey(requestKey);
          setTransactions(filterActivityPage(page.transactions, criteria));
          setNextCursor(page.nextCursor);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError(t('transactionsCouldNotBeLoaded'));
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
    if (visitedCursors.current.has(nextCursor)) {
      setError(t('moreTransactionsCouldNotLoad'));
      setNextCursor(null);
      return;
    }
    visitedCursors.current.add(nextCursor);
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
        if (controller.signal.aborted || activeRequestKey.current !== key) return;
        setTransactions((current) => [
          ...new Map([...current, ...page.transactions].map((row) => [row.id, row])).values(),
        ]);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted && activeRequestKey.current === key) {
          visitedCursors.current.delete(nextCursor);
          setError(t('moreTransactionsCouldNotLoad'));
        }
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
    loading: Boolean(money.credential) && requestState === 'loading',
    loadingMore: money.source === 'live' && loadingMore,
    error:
      money.source === 'live' && !money.credential && money.home
        ? t('savedViewUnavailable')
        : error,
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
  const visited = new Set<string>();
  while (true) {
    if (cursor) {
      if (visited.has(cursor)) throw new Error('Repeated transaction cursor');
      visited.add(cursor);
    }
    const page = await fetchTransactionPage(credential, { ...query, cursor }, signal);
    if (page.nextCursor && visited.has(page.nextCursor))
      throw new Error('Repeated transaction cursor');
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
      .then((value) => {
        if (!controller.signal.aborted) setTransaction(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(t('transactionCouldNotBeLoaded'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, money.credential, money.revision, money.source, money.status]);

  return {
    transaction:
      money.source === 'fixture'
        ? fixtureTransaction
        : money.credential && transaction?.id === id
          ? transaction
          : null,
    loading: money.source === 'live' && loading,
    error: money.source === 'live' && !money.credential ? t('savedViewUnavailable') : error,
  };
}
