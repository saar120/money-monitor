<script setup lang="ts">
import { createActivityAutosave } from './activity-autosave';
import InlineCategory from './InlineCategory.vue';
import MerchantMark from './MerchantMark.vue';
import { Switch } from '@/components/ui/switch';
import SelectField from '@/components/ui/select/SelectField.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { Button } from '@/components/ui/button';
import { useReviewCount } from '@/composables/useReviewCount';
import { useRoute } from 'vue-router';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-vue-next';
import {
  getAccounts,
  getCategories,
  getMembers,
  getTransaction,
  saveTransactionCommand,
  ApiError,
  type TransactionPatch,
  getTransactions,
  type Account,
  type Category,
  type Member,
  type LedgerTotal,
  type OwnerType,
  type Transaction,
  type TransactionFilters,
} from '@/api/client';
import { formatAmount } from '@/lib/format';
import { language, setLanguageChoice, t } from '@/lib/language';
import { isValidMonth } from '@/lib/month';
import { normalizeMerchant } from '@/lib/merchant';

const route = useRoute();
const isPreview = computed(() => route.name === 'split-prototype');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const month = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const search = ref(typeof route.query.search === 'string' ? route.query.search : '');
const filterOpen = ref(false);
const filterCategory = ref(typeof route.query.category === 'string' ? route.query.category : 'all');
const filterAccount = ref('all');
const reviewOnly = ref(false);
const filterOwner = ref(
  typeof route.query.owner === 'string' &&
    /^(all|shared|unassigned|member:[1-9]\d*)$/.test(route.query.owner)
    ? route.query.owner
    : 'all',
);
const filterType = ref('all');
const filterStatus = ref(
  ['completed', 'pending'].includes(String(route.query.status))
    ? String(route.query.status)
    : 'all',
);
const filterDirection = ref(
  ['income', 'expense'].includes(String(route.query.direction))
    ? String(route.query.direction)
    : 'all',
);
const filterInclusion = ref(
  ['included', 'ignored'].includes(String(route.query.inclusion))
    ? String(route.query.inclusion)
    : 'all',
);
const startDate = ref(
  typeof route.query.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.startDate)
    ? route.query.startDate
    : '',
);
const endDate = ref(
  typeof route.query.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.endDate)
    ? route.query.endDate
    : '',
);
const sortBy = ref('date');
const sortOrder = ref<'asc' | 'desc'>('desc');
const draftEffectiveDate = ref('');
const { reviewCount, refresh: refreshReviewCount } = useReviewCount();
const filterElement = ref<HTMLElement | null>(null);
const filterPosition = ref<Record<string, string>>({});
function positionFilters() {
  const trigger = filterElement.value;
  if (!filterOpen.value || !trigger) return;
  const box = trigger.getBoundingClientRect(),
    width = Math.min(360, window.innerWidth - 32);
  const left = Math.min(
    Math.max(16, language.value === 'he' ? box.left : box.right - width),
    window.innerWidth - width - 16,
  );
  const top = Math.max(16, Math.min(box.bottom + 8, window.innerHeight - 160));
  filterPosition.value = {
    position: 'fixed',
    inset: 'auto',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${window.innerHeight - top - 16}px`,
  };
}
watch(filterOpen, () => {
  void nextTick(positionFilters);
});

onClickOutside(
  filterElement,
  () => {
    filterOpen.value = false;
  },
  { ignore: ['.ui-select-content'] },
);
const activeFilterCount = computed(
  () =>
    [
      reviewOnly.value,
      filterCategory.value !== 'all',
      filterAccount.value !== 'all',
      filterOwner.value !== 'all',
      filterType.value !== 'all',
      filterStatus.value !== 'all',
      filterDirection.value !== 'all',
      filterInclusion.value !== 'all',
      !!startDate.value || !!endDate.value,
    ].filter(Boolean).length,
);
function clearFilters() {
  filterCategory.value =
    filterAccount.value =
    filterOwner.value =
    filterType.value =
    filterStatus.value =
    filterDirection.value =
    filterInclusion.value =
      'all';
  reviewOnly.value = false;
  startDate.value = endDate.value = '';
}
function sort(column: string) {
  if (sortBy.value === column) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  else {
    sortBy.value = column;
    sortOrder.value = 'desc';
  }
}
async function confirmReview() {
  const row = selected.value;
  const category = draftCategory.value;
  if (!row || !category || category === 'uncategorized' || saving.value) return;
  // Edits that failed on this row go with the confirmation, which must not skip them.
  const patch: SavePatch = { ...failureFor(row.id)?.patch, resolve: category };
  if (dateChanged.value) patch.effectiveDate = draftEffectiveDate.value;
  await queueSave(row, patch);
}
const rows = ref<Transaction[]>([]);
const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const total = ref(0);
const ledgerTotals = ref<LedgerTotal[] | null>(null);
const hasMore = ref(false);
const loading = ref(true);
const error = ref('');
const loadFailed = ref(false);
const selectedId = ref<number | null>(null);
const linkedTransaction = ref<Transaction | null>(null);
const requestedTransactionId = ref(
  typeof route.query.transactionId === 'string' ? Number(route.query.transactionId) : null,
);
const draftCategory = ref('');
const draftOwner = ref('unassigned');
const draftIncluded = ref(true);
const draftMemo = ref('');
const saved = ref(false);
const saveRevision = ref(0);
const saving = computed(() => {
  void saveRevision.value;
  return autosave.entries().some((entry) => entry.work !== null);
});
const saveFailures = computed<SaveFailure[]>(() => {
  void saveRevision.value;
  return autosave
    .entries()
    .filter((entry) => entry.failure !== null)
    .map((entry) => ({
      row: entry.accepted,
      merchant: normalizeMerchant(entry.accepted.description),
      patch: displayPatch(autosave.draft(entry.accepted.id)),
    }));
});
const selectedFailure = computed(() => failureFor(selectedId.value));
// What the user last asked for on the selected row. New edits compare against this,
// not the saved row, so changing back during a slow save still counts as a change.
const intended = { category: '', owner: '', included: true, memo: '' };
const otherFailures = computed(() =>
  saveFailures.value.filter((failure) => failure.row.id !== selectedId.value),
);
const localEdits = new Map<number, Partial<Transaction>>();
let requestId = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

const copy = computed(() =>
  language.value === 'he'
    ? {
        filter: 'סינון',
        income: 'הכנסות בדוחות',
        spending: 'הוצאות בדוחות',
        details: 'פרטים',
        account: 'חשבון',
        notes: 'הערות',
        save: 'שמירה',
        saving: 'שומר…',
        onlyPreview: 'אב טיפוס · השינויים נשמרים במסך הזה בלבד',
        saved: isPreview.value ? 'השינוי מוצג באב הטיפוס' : 'התנועה נשמרה',
        sync: 'מעודכן',
        all: 'הכול',
        loadMore: 'טעינת תנועות נוספות',
        noSelection: 'בחרו תנועה כדי לראות פרטים',
        localChanges: 'תצוגה מקדימה בלבד',
        saveFailed: 'לא ניתן לשמור את התנועה. נסו שוב.',
      }
    : {
        filter: 'Filter',
        income: 'Included income',
        spending: 'Included spending',
        details: 'Details',
        account: 'Account',
        notes: 'Notes',
        save: 'Save',
        saving: 'Saving…',
        onlyPreview: 'Prototype · changes stay on this screen',
        saved: isPreview.value ? 'Change shown in prototype' : 'Transaction saved',
        sync: 'Up to date',
        all: 'All',
        loadMore: 'Load more transactions',
        noSelection: 'Select a transaction to see details',
        localChanges: 'Preview only',
        saveFailed: 'Could not save the transaction. Try again.',
      },
);

const selected = computed(
  () =>
    rows.value.find((row) => row.id === selectedId.value) ??
    (linkedTransaction.value?.id === selectedId.value ? linkedTransaction.value : null),
);
// A date moves the transaction between months, so it waits for an explicit Save:
// typing passes through valid dates on the way to the intended one.
function isCompleteDate(value: string) {
  return !value || value >= '2000-01-01';
}
const dateChanged = computed(() => {
  const row = selected.value;
  return (
    row != null &&
    isCompleteDate(draftEffectiveDate.value) &&
    draftEffectiveDate.value !== (row.effectiveDate ?? '')
  );
});
const accountMap = computed(
  () => new Map(accounts.value.map((account) => [account.id, account.displayName])),
);
const categoryMap = computed(
  () => new Map(categories.value.map((category) => [category.name, category.label])),
);
const hebrewDemoCategories: Record<string, string> = {
  Dining: 'מסעדות',
  Groceries: 'מצרכים',
  Housing: 'דיור',
  Transport: 'תחבורה',
  Travel: 'נסיעות',
  Shopping: 'קניות',
  Health: 'בריאות',
  Subscriptions: 'מנויים',
  Utilities: 'חשבונות',
  Entertainment: 'בידור',
  Education: 'חינוך',
  Personal: 'אישי',
  Gifts: 'מתנות',
  Insurance: 'ביטוח',
  Taxes: 'מסים',
  Pets: 'חיות מחמד',
  Fees: 'עמלות',
  Transfer: 'העברות',
  Income: 'הכנסות',
  Other: 'אחר',
  Clothing: 'לבוש',
};
function categoryLabel(value: string | null) {
  if (!value) return t('uncategorized');
  const label = categoryMap.value.get(value) ?? value;
  return language.value === 'he' ? (hebrewDemoCategories[label] ?? label) : label;
}
const monthLabel = computed(() =>
  new Date(`${month.value}-01T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en-US',
    {
      month: 'long',
      year: 'numeric',
    },
  ),
);
const hasDateRange = computed(() => !!startDate.value || !!endDate.value);
const searching = computed(() => search.value.trim().length > 0);
const scopeLabel = computed(() => {
  if (hasDateRange.value)
    return [startDate.value, endDate.value]
      .map((value) => (value ? dateLabel(value) : '…'))
      .join(' – ');
  return searching.value ? t('allDates') : monthLabel.value;
});
function monthEnd(value: string) {
  const [year, number] = value.split('-').map(Number) as [number, number];
  return `${value}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}
function shiftMonth(delta: number) {
  const [year, number] = month.value.split('-').map(Number) as [number, number];
  month.value = new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}
function dateLabel(value: string, compact = false) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString(language.value === 'he' ? 'he-IL' : 'en-US', {
    month: 'short',
    day: 'numeric',
    ...(compact && !searching.value && !hasDateRange.value ? {} : { year: 'numeric' as const }),
  });
}
function signedAmount(row: Transaction) {
  const sign = row.chargedAmount < 0 ? '−' : row.chargedAmount > 0 ? '+' : '';
  return `${sign}${formatAmount(row.chargedAmount, row.chargedCurrency)}`;
}
function ownerFields(owner: string) {
  return owner.startsWith('member:')
    ? { expenseOwnerType: 'member' as OwnerType, expenseOwnerMemberId: Number(owner.slice(7)) }
    : { expenseOwnerType: owner as OwnerType, expenseOwnerMemberId: null };
}
function ownerValue(row: Transaction) {
  return row.expenseOwnerType === 'member'
    ? `member:${row.expenseOwnerMemberId ?? ''}`
    : row.expenseOwnerType;
}
function selectRow(row: Transaction) {
  if (row.id === selectedId.value) return;
  // Leaving a row keeps a pending date rather than discarding it.
  saveDate();
  selectedId.value = row.id;
  // A queued or failed edit stays on screen so Retry and later edits agree with it.
  const failed = displayPatch(autosave.draft(row.id));
  intended.category = draftCategory.value = failed.category ?? row.category ?? '';
  intended.owner = draftOwner.value = failed.owner ?? ownerValue(row);
  intended.included = draftIncluded.value = failed.included ?? !row.ignored;
  intended.memo = draftMemo.value = failed.memo ?? row.memo ?? '';
  draftEffectiveDate.value = failed.effectiveDate ?? row.effectiveDate ?? '';
  saved.value = false;
}
function closeDetails() {
  saveDate();
  const id = selectedId.value;
  selectedId.value = null;
  if (id != null)
    void nextTick(() => document.getElementById(`proto-row-${id}`)?.focus({ preventScroll: true }));
}
async function load(append = false) {
  if (append && loading.value) return;
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  loadFailed.value = false;
  try {
    const filters: TransactionFilters = {
      startDate:
        startDate.value ||
        (hasDateRange.value || searching.value ? undefined : `${month.value}-01`),
      endDate:
        endDate.value ||
        (hasDateRange.value || searching.value ? undefined : monthEnd(month.value)),
      search: search.value.trim() || undefined,
      category: filterCategory.value === 'all' ? undefined : filterCategory.value,
      accountId: filterAccount.value === 'all' ? undefined : Number(filterAccount.value),
      needsReview: reviewOnly.value || undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      accountType:
        filterType.value === 'all' ? undefined : (filterType.value as 'bank' | 'credit_card'),
      status: filterStatus.value === 'all' ? undefined : filterStatus.value,
      ignored: filterInclusion.value === 'all' ? undefined : filterInclusion.value === 'ignored',
      minAmount: filterDirection.value === 'income' ? 0.01 : undefined,
      maxAmount: filterDirection.value === 'expense' ? -0.01 : undefined,
      ownerType: filterOwner.value.startsWith('member:')
        ? 'member'
        : filterOwner.value === 'all'
          ? undefined
          : (filterOwner.value as OwnerType),
      ownerMemberId: filterOwner.value.startsWith('member:')
        ? Number(filterOwner.value.slice(7))
        : undefined,
      limit: 60,
      offset: append ? rows.value.length : 0,
    };
    const result = await getTransactions(filters);
    if (id !== requestId) return;
    const next = result.transactions.map((row) =>
      isPreview.value ? { ...row, ...localEdits.get(row.id) } : row,
    );
    const seen = new Set(append ? rows.value.map((row) => row.id) : []);
    const unique = next.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
    rows.value = append ? [...rows.value, ...unique] : unique;
    total.value = result.pagination.total;
    ledgerTotals.value = result.totals ?? null;
    hasMore.value = result.pagination.hasMore && (!append || unique.length > 0);
    if (!append && !rows.value.some((row) => row.id === selectedId.value)) {
      selectedId.value = null;
      const requested =
        rows.value.find((row) => row.id === requestedTransactionId.value) ??
        (linkedTransaction.value?.id === requestedTransactionId.value
          ? linkedTransaction.value
          : null);
      if (requested) selectRow(requested);
      requestedTransactionId.value = null;
    }
  } catch {
    if (id === requestId) {
      loadFailed.value = true;
      error.value = t('couldNotLoad');
      // Rows from the previous month or filter must not pass as this one's.
      if (!append) {
        rows.value = [];
        total.value = 0;
        ledgerTotals.value = null;
        hasMore.value = false;
        selectedId.value = null;
      }
    }
  } finally {
    if (id === requestId) loading.value = false;
  }
}
type SavePatch = {
  category?: string;
  owner?: string;
  included?: boolean;
  memo?: string;
  effectiveDate?: string;
  resolve?: string;
};
type SaveFailure = { row: Transaction; merchant: string; patch: SavePatch };
function commandPatch(patch: SavePatch): TransactionPatch {
  const fields: TransactionPatch = {};
  if (patch.category !== undefined) fields.category = patch.category || null;
  if (patch.owner !== undefined) {
    const owner = ownerFields(patch.owner);
    fields.owner = { type: owner.expenseOwnerType, memberId: owner.expenseOwnerMemberId };
  }
  if (patch.included !== undefined) fields.ignored = !patch.included;
  if (patch.effectiveDate !== undefined) fields.effectiveDate = patch.effectiveDate || null;
  if (patch.resolve !== undefined) {
    fields.category = patch.resolve;
    fields.reviewed = true;
  }
  return fields;
}
function displayPatch(patch: TransactionPatch): SavePatch {
  return {
    ...(patch.category !== undefined ? { category: patch.category ?? '' } : {}),
    ...(patch.owner
      ? {
          owner:
            patch.owner.type === 'member' ? `member:${patch.owner.memberId}` : patch.owner.type,
        }
      : {}),
    ...(patch.ignored !== undefined ? { included: !patch.ignored } : {}),
    ...(patch.effectiveDate !== undefined ? { effectiveDate: patch.effectiveDate ?? '' } : {}),
    ...(patch.reviewed && patch.category ? { resolve: patch.category } : {}),
  };
}
const autosave = createActivityAutosave({
  submit: saveTransactionCommand,
  newId: () => crypto.randomUUID(),
  classify: (cause) =>
    cause instanceof ApiError && cause.status < 500
      ? {
          kind: cause.code === 'mutation_conflict' ? 'conflict' : 'rejected',
          current: cause.current,
        }
      : { kind: 'unknown' },
  changed: () => {
    saveRevision.value++;
  },
  accepted: (previous, updated, patch) => {
    rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row));
    if (linkedTransaction.value?.id === updated.id) linkedTransaction.value = updated;
    const pending = autosave.draft(updated.id);
    if (selectedId.value === updated.id) {
      if (pending.category === undefined && draftCategory.value === intended.category)
        intended.category = draftCategory.value = updated.category ?? '';
      if (!pending.owner && draftOwner.value === intended.owner)
        intended.owner = draftOwner.value = ownerValue(updated);
      if (pending.ignored === undefined && draftIncluded.value === intended.included)
        intended.included = draftIncluded.value = !updated.ignored;
      showSaved();
    }
    if (updated.needsReview !== previous.needsReview) void refreshReviewCount();
    if (
      patch.category !== undefined ||
      patch.ignored !== undefined ||
      patch.reviewed ||
      updated.reportingDate !== previous.reportingDate
    )
      void load();
  },
});
function queueSave(row: Transaction, patch: SavePatch) {
  if (isPreview.value) {
    const edit: Partial<Transaction> = {};
    if (patch.category !== undefined) edit.category = patch.category || null;
    if (patch.owner !== undefined) Object.assign(edit, ownerFields(patch.owner));
    if (patch.included !== undefined) edit.ignored = !patch.included;
    if (patch.memo !== undefined) edit.memo = patch.memo || null;
    if (patch.effectiveDate !== undefined) edit.effectiveDate = patch.effectiveDate || null;
    localEdits.set(row.id, { ...localEdits.get(row.id), ...edit });
    rows.value = rows.value.map((item) => (item.id === row.id ? { ...item, ...edit } : item));
    showSaved();
    return Promise.resolve();
  }
  return autosave.edit(row, commandPatch(patch));
}
function failureFor(rowId: number | null) {
  return saveFailures.value.find((failure) => failure.row.id === rowId);
}
function retrySave(failure: SaveFailure) {
  void autosave.retry(failure.row.id);
}
function saveDate() {
  if (selected.value && dateChanged.value)
    void queueSave(selected.value, { effectiveDate: draftEffectiveDate.value });
}
const categoryOptions = computed(() => [
  { value: '', label: t('uncategorized') },
  ...categories.value.map((item) => ({ value: item.name, label: categoryLabel(item.name) })),
]);
function changeRowCategory(row: Transaction, category: string) {
  selectRow(row);
  intended.category = draftCategory.value = category;
  void queueSave(row, { category });
}
function showSaved() {
  saved.value = true;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.value = false), 2000);
}
function closeFilters(event: KeyboardEvent) {
  if (filterElement.value?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
  event.stopPropagation();
  filterOpen.value = false;
  filterElement.value?.querySelector('button')?.focus();
}
function onKeys(event: KeyboardEvent) {
  // Portaled menus own Escape and arrow keys until they close.
  if (
    event.defaultPrevented ||
    (event.target instanceof HTMLElement && event.target.closest('[role="listbox"]')) ||
    document.querySelector('[role="combobox"][aria-expanded="true"]')
  )
    return;
  if (event.key === 'Escape') {
    if (filterOpen.value) {
      filterOpen.value = false;
      return;
    }
    // Escape cancels: a date still being typed must not move the transaction.
    draftEffectiveDate.value = selected.value?.effectiveDate ?? '';
    closeDetails();
    return;
  }
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('input, select, textarea, button, [contenteditable]')
  )
    return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const index = rows.value.findIndex((row) => row.id === selectedId.value);
  const next = Math.max(
    0,
    Math.min(rows.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
  );
  if (rows.value[next]) {
    event.preventDefault();
    selectRow(rows.value[next]);
    document
      .getElementById(`proto-row-${rows.value[next].id}`)
      ?.scrollIntoView({ block: 'nearest' });
  }
}
function toggleLanguage() {
  setLanguageChoice(language.value === 'he' ? 'en' : 'he');
}
onMounted(async () => {
  window.addEventListener('keydown', onKeys);
  window.addEventListener('resize', positionFilters);
  try {
    const [accountData, categoryData, memberData] = await Promise.all([
      getAccounts(),
      getCategories(),
      getMembers(),
    ]);
    accounts.value = accountData.accounts;
    categories.value = categoryData.categories;
    members.value = memberData.members.filter((member) => member.isActive);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  }
  if (requestedTransactionId.value) {
    try {
      const { transaction } = await getTransaction(requestedTransactionId.value);
      linkedTransaction.value = transaction;
      month.value = transaction.reportingDate.slice(0, 7);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
    }
  }
  await load();
});
onBeforeUnmount(saveDate);
onUnmounted(() => {
  requestId++;
  window.removeEventListener('keydown', onKeys);
  window.removeEventListener('resize', positionFilters);
  clearTimeout(searchTimer);
  clearTimeout(savedTimer);
});
watch(month, () => {
  saveDate();
  startDate.value = endDate.value = '';
  void load();
});
watch(
  [
    filterCategory,
    filterAccount,
    reviewOnly,
    filterOwner,
    filterType,
    filterStatus,
    filterDirection,
    filterInclusion,
    startDate,
    endDate,
    sortBy,
    sortOrder,
  ],
  () => {
    saveDate();
    void load();
  },
);
// Category, owner and inclusion save as soon as they change.
watch([draftCategory, draftOwner, draftIncluded, draftMemo], () => {
  const row = selected.value;
  if (!row) return;
  const patch: SavePatch = {};
  if (draftCategory.value !== intended.category) patch.category = draftCategory.value;
  if (draftOwner.value !== intended.owner) patch.owner = draftOwner.value;
  if (draftIncluded.value !== intended.included) patch.included = draftIncluded.value;
  if (isPreview.value && draftMemo.value !== intended.memo) patch.memo = draftMemo.value;
  if (!Object.keys(patch).length) return;
  Object.assign(intended, patch);
  void queueSave(row, patch);
});
watch(search, () => {
  saveDate();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 250);
});
</script>

<template>
  <div
    class="proto-shell"
    :aria-busy="loading"
    :class="{ embedded: !isPreview }"
    :dir="language === 'he' ? 'rtl' : 'ltr'"
  >
    <aside v-if="isPreview" class="proto-sidebar" :aria-label="t('mainNavigation')">
      <div class="proto-brand"><img src="/icon-192.png" alt="" /><span>Money Monitor</span></div>
      <nav class="proto-nav">
        <RouterLink to="/" :title="t('home')"
          ><Home :size="19" /><span>{{ t('home') }}</span></RouterLink
        >
        <RouterLink
          to="/prototype/split-view"
          class="active"
          aria-current="page"
          :title="t('activity')"
          ><Receipt :size="19" /><span>{{ t('activity') }}</span></RouterLink
        >
        <RouterLink to="/explore" :title="t('explore')"
          ><Compass :size="19" /><span>{{ t('explore') }}</span></RouterLink
        >
        <RouterLink to="/chat" :title="t('advisor')"
          ><Bot :size="19" /><span>{{ t('advisor') }}</span></RouterLink
        >
      </nav>
      <div class="proto-sidebar-footer">
        <span class="proto-sync"><i />{{ copy.sync }}</span>
        <RouterLink to="/settings" :title="t('settings')"
          ><Settings :size="17" /><span>{{ t('settings') }}</span></RouterLink
        >
        <button type="button" class="proto-language" @click="toggleLanguage">
          {{ language === 'he' ? 'EN' : 'עברית' }}
        </button>
      </div>
    </aside>

    <section class="proto-workspace">
      <Teleport defer to="#toolbar-actions" :disabled="isPreview"
        ><div class="toolbar-controls">
          <div class="proto-month">
            <button
              type="button"
              :aria-label="t('previous')"
              :disabled="searching && !hasDateRange"
              @click="shiftMonth(-1)"
            >
              <ChevronRight v-if="language === 'he'" :size="17" /><ChevronLeft v-else :size="17" />
            </button>
            <span>{{ scopeLabel }}</span>
            <button
              type="button"
              :aria-label="t('next')"
              :disabled="searching && !hasDateRange"
              @click="shiftMonth(1)"
            >
              <ChevronLeft v-if="language === 'he'" :size="17" /><ChevronRight v-else :size="17" />
            </button>
          </div>
          <SelectField
            v-model="filterOwner"
            class="ledger-select"
            :aria-label="t('owner')"
            :options="[
              { value: 'all', label: t('allOwners') },
              { value: 'shared', label: t('together') },
              { value: 'unassigned', label: t('unassigned') },
              ...members.map((member) => ({ value: `member:${member.id}`, label: member.name })),
            ]"
          /></div
      ></Teleport>
      <div class="proto-toolbar">
        <div ref="filterElement" class="proto-filter-wrap" @keydown.esc="closeFilters">
          <button
            type="button"
            class="proto-filter-button"
            :aria-expanded="filterOpen"
            @click="filterOpen = !filterOpen"
          >
            <SlidersHorizontal :size="17" />{{ copy.filter
            }}<span v-if="activeFilterCount" class="proto-filter-count">{{
              activeFilterCount
            }}</span>
          </button>
          <Transition name="filter-morph">
            <div v-if="filterOpen" class="proto-filter-popover" :style="filterPosition">
              <div class="proto-popover-head">
                <strong>{{ copy.filter }}</strong
                ><button type="button" :aria-label="t('cancel')" @click="filterOpen = false">
                  <X :size="16" />
                </button>
              </div>
              <label
                ><span>{{ t('category') }}</span
                ><SelectField
                  v-model="filterCategory"
                  :options="[
                    { value: 'all', label: t('allCategories') },
                    ...categories.map((item) => ({
                      value: item.name,
                      label: categoryLabel(item.name),
                    })),
                  ]"
              /></label>
              <label
                ><span>{{ t('account') }}</span
                ><SelectField
                  v-model="filterAccount"
                  :options="[
                    { value: 'all', label: t('allAccounts') },
                    ...accounts.map((item) => ({
                      value: String(item.id),
                      label: item.displayName,
                    })),
                  ]"
              /></label>
              <label
                ><span>{{ t('accountType') }}</span
                ><SelectField
                  v-model="filterType"
                  :options="[
                    { value: 'all', label: t('allTypes') },
                    { value: 'bank', label: t('banks') },
                    { value: 'credit_card', label: t('creditCards') },
                  ]"
              /></label>
              <label
                ><span>{{ t('owner') }}</span
                ><SelectField
                  v-model="filterOwner"
                  :options="[
                    { value: 'all', label: t('allOwners') },
                    { value: 'shared', label: t('together') },
                    { value: 'unassigned', label: t('unassigned') },
                    ...members.map((member) => ({
                      value: `member:${member.id}`,
                      label: member.name,
                    })),
                  ]"
              /></label>
              <label
                ><span>{{ t('transactionStatus') }}</span
                ><SelectField
                  v-model="filterStatus"
                  :options="[
                    { value: 'all', label: t('anyStatus') },
                    { value: 'completed', label: t('completed') },
                    { value: 'pending', label: t('pending') },
                  ]"
              /></label>
              <label
                ><span>{{ t('moneyDirection') }}</span
                ><SelectField
                  v-model="filterDirection"
                  :options="[
                    { value: 'all', label: t('inAndOut') },
                    { value: 'expense', label: t('spending') },
                    { value: 'income', label: t('income') },
                  ]"
              /></label>
              <label
                ><span>{{ t('includeInStatistics') }}</span
                ><SelectField
                  v-model="filterInclusion"
                  :options="[
                    { value: 'all', label: t('allActivity') },
                    { value: 'included', label: t('included') },
                    { value: 'ignored', label: t('excluded') },
                  ]"
              /></label>
              <label
                ><span>{{ t('startDate') }}</span
                ><input v-model="startDate" type="date" :max="endDate || undefined"
              /></label>
              <label
                ><span>{{ t('endDate') }}</span
                ><input v-model="endDate" type="date" :min="startDate || undefined"
              /></label>
              <label class="proto-check"
                ><input v-model="reviewOnly" type="checkbox" />{{ t('needsReview') }}</label
              >
              <button type="button" class="proto-clear" @click="clearFilters">
                {{ t('clear') }}
              </button>
            </div>
          </Transition>
        </div>
        <SelectField
          v-model="filterAccount"
          class="activity-quick-filter"
          :aria-label="t('account')"
          :options="[
            { value: 'all', label: t('allAccounts') },
            ...accounts.map((item) => ({ value: String(item.id), label: item.displayName })),
          ]"
        />
        <SelectField
          v-model="filterCategory"
          class="activity-quick-filter"
          :aria-label="t('category')"
          :options="[
            { value: 'all', label: t('allCategories') },
            ...categories.map((item) => ({ value: item.name, label: categoryLabel(item.name) })),
          ]"
        />
        <button
          type="button"
          class="activity-review-filter"
          :aria-pressed="reviewOnly"
          @click="reviewOnly = !reviewOnly"
        >
          <span class="pending-review-dot" />{{ reviewCount }} {{ t('toReview') }}
        </button>
        <label class="proto-search"
          ><Search :size="18" /><input
            v-model="search"
            :placeholder="t('searchActivity')"
            :aria-label="t('searchActivity')"
        /></label>
      </div>

      <section
        v-if="!loadFailed"
        class="activity-totals"
        :aria-label="language === 'he' ? 'סכומים בדוחות לפי מטבע' : 'Included totals by currency'"
      >
        <div
          v-for="entry in ledgerTotals?.length ? ledgerTotals : [null]"
          :key="entry?.currency ?? 'unknown'"
          class="activity-total-currency"
        >
          <div>
            <span>{{ copy.income }}</span
            ><strong dir="ltr">{{
              entry && !loading ? formatAmount(entry.income, entry.currency) : '—'
            }}</strong>
          </div>
          <div>
            <span>{{ copy.spending }}</span
            ><strong dir="ltr">{{
              entry && !loading ? formatAmount(entry.expense, entry.currency) : '—'
            }}</strong>
          </div>
          <div>
            <span>{{ t('netCashFlow') }}</span
            ><strong dir="ltr">{{
              entry
                ? `${entry.income - entry.expense < 0 ? '−' : ''}${formatAmount(entry.income - entry.expense, entry.currency)}`
                : '—'
            }}</strong>
          </div>
        </div>
      </section>
      <div class="proto-content">
        <div class="proto-ledger-column">
          <div v-if="isPreview" class="proto-title">
            <h1>{{ t('activity') }}</h1>
            <span v-if="!loadFailed">{{ total }} {{ t('transactions') }}</span>
          </div>
          <div v-if="loadFailed" class="proto-error" role="alert">
            {{ error }} <button type="button" @click="load()">{{ t('retry') }}</button>
          </div>
          <div
            v-for="failure in otherFailures"
            :key="failure.row.id"
            class="proto-error"
            role="alert"
          >
            <bdi dir="auto">{{ failure.merchant }}</bdi
            >: {{ copy.saveFailed }}
            <button type="button" @click="retrySave(failure)">{{ t('retry') }}</button>
          </div>
          <div class="proto-table-scroll" tabindex="0" :aria-label="t('activity')">
            <table v-if="rows.length || !loadFailed" class="proto-table">
              <colgroup>
                <col class="proto-date-col" />
                <col class="proto-merchant-col" />
                <col class="proto-category-col" />
                <col class="proto-amount-col" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    scope="col"
                    :aria-sort="
                      sortBy === 'date'
                        ? sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    "
                  >
                    <button class="table-sort" @click="sort('date')">
                      {{ t('date')
                      }}<span v-if="sortBy === 'date'" aria-hidden="true">{{
                        sortOrder === 'asc' ? '↑' : '↓'
                      }}</span>
                    </button>
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      sortBy === 'description'
                        ? sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    "
                  >
                    <button class="table-sort" @click="sort('description')">
                      {{ t('description')
                      }}<span v-if="sortBy === 'description'" aria-hidden="true">{{
                        sortOrder === 'asc' ? '↑' : '↓'
                      }}</span>
                    </button>
                  </th>
                  <th scope="col">{{ t('category') }}</th>
                  <th
                    scope="col"
                    :aria-sort="
                      sortBy === 'chargedAmount'
                        ? sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    "
                  >
                    <button class="table-sort" @click="sort('chargedAmount')">
                      {{ t('amount')
                      }}<span v-if="sortBy === 'chargedAmount'" aria-hidden="true">{{
                        sortOrder === 'asc' ? '↑' : '↓'
                      }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :id="`proto-row-${row.id}`"
                  :key="row.id"
                  :class="{ selected: selectedId === row.id }"
                  :aria-selected="selectedId === row.id"
                  tabindex="0"
                  @click="selectRow(row)"
                  @keydown.enter.self="selectRow(row)"
                  @keydown.space.self.prevent="selectRow(row)"
                >
                  <td>
                    <span class="ledger-date"
                      ><bdi dir="ltr">{{ dateLabel(row.reportingDate, true) }}</bdi
                      ><span
                        v-if="row.needsReview"
                        class="pending-review-dot"
                        role="img"
                        :aria-label="t('needsReview')"
                    /></span>
                  </td>
                  <td class="proto-merchant">
                    <button
                      type="button"
                      class="proto-row-open"
                      :title="row.description"
                      @click.stop="selectRow(row)"
                    >
                      <MerchantMark :description="row.description" /><bdi dir="auto">{{
                        normalizeMerchant(row.description)
                      }}</bdi>
                    </button>
                    <small class="proto-mobile-date"
                      ><bdi dir="ltr">{{ dateLabel(row.reportingDate) }}</bdi></small
                    >
                  </td>
                  <td class="proto-category">
                    <InlineCategory
                      :model-value="
                        autosave.draft(row.id).category ??
                        failureFor(row.id)?.patch.category ??
                        row.category ??
                        ''
                      "
                      :label="`${t('category')}: ${normalizeMerchant(row.description)}`"
                      :options="categoryOptions"
                      @update:model-value="changeRowCategory(row, $event)"
                    />
                  </td>
                  <td
                    class="proto-amount"
                    :class="row.chargedAmount >= 0 ? 'positive' : 'negative'"
                  >
                    <bdi dir="ltr">{{ signedAmount(row) }}</bdi>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="loading && !rows.length" class="proto-empty">
              {{ t('loadingTransactions') }}
            </div>
            <div v-else-if="!loading && !loadFailed && !rows.length" class="proto-empty">
              {{ t('noTransactionsFound') }}
              <button
                v-if="activeFilterCount"
                type="button"
                class="proto-clear"
                @click="clearFilters"
              >
                {{ t('clear') }}
              </button>
            </div>
            <button
              v-if="hasMore"
              type="button"
              class="proto-more"
              :disabled="loading"
              @click="load(true)"
            >
              {{ copy.loadMore }}
            </button>
            <div v-if="!loadFailed" class="activity-table-footer">
              {{ rows.length }} {{ t('of') }} {{ total }} {{ t('transactions') }}
            </div>
          </div>
        </div>

        <Transition name="detail-backdrop">
          <button
            v-if="selected"
            type="button"
            class="proto-backdrop"
            :aria-label="t('cancel')"
            @click="closeDetails"
          />
        </Transition>
        <Transition name="detail-panel">
          <aside
            v-if="selected"
            class="proto-inspector workspace-surface"
            :aria-label="copy.details"
          >
            <div class="proto-inspector-head">
              <h2 class="sr-only">{{ copy.details }}</h2>
              <button type="button" :aria-label="t('cancel')" @click="closeDetails">
                <X :size="18" />
              </button>
            </div>
            <div class="proto-inspector-content">
              <h3>
                <MerchantMark :description="selected.description" /><bdi dir="auto">{{
                  normalizeMerchant(selected.description)
                }}</bdi>
              </h3>
              <strong
                class="proto-detail-amount"
                :class="selected.chargedAmount >= 0 ? 'positive' : 'negative'"
                ><bdi dir="ltr">{{ signedAmount(selected) }}</bdi></strong
              >
              <p class="proto-detail-meta">
                <bdi dir="ltr">{{ dateLabel(selected.reportingDate) }}</bdi>
              </p>
              <p v-if="selected.needsReview" class="proto-review">
                {{ selected.reviewReason || t('needsReview') }}
              </p>
              <dl
                v-if="
                  selected.status !== 'completed' ||
                  selected.installmentTotal ||
                  selected.originalCurrency !== selected.chargedCurrency
                "
                class="transaction-facts"
              >
                <div v-if="selected.status !== 'completed'">
                  <dt>{{ t('status') }}</dt>
                  <dd>{{ t('pending') }}</dd>
                </div>
                <div v-if="selected.installmentTotal">
                  <dt>{{ t('installment') }}</dt>
                  <dd>
                    {{ selected.installmentNumber }} {{ t('of') }} {{ selected.installmentTotal }}
                  </dd>
                </div>
                <div v-if="selected.originalCurrency !== selected.chargedCurrency">
                  <dt>{{ t('originalAmount') }}</dt>
                  <dd dir="ltr">
                    {{ formatAmount(selected.originalAmount, selected.originalCurrency) }}
                  </dd>
                </div>
              </dl>
              <div class="proto-fields">
                <div class="activity-fact">
                  <span>{{ t('account') }}</span
                  ><span>{{ accountMap.get(selected.accountId) ?? copy.account }}</span>
                </div>
                <label
                  ><span>{{ t('category') }}</span
                  ><SelectField
                    v-model="draftCategory"
                    :options="[
                      { value: '', label: t('uncategorized') },
                      ...categories.map((item) => ({
                        value: item.name,
                        label: categoryLabel(item.name),
                      })),
                    ]"
                /></label>
                <div class="proto-more-details">
                  <div class="proto-secondary-fields">
                    <label
                      ><span>{{ t('owner') }}</span
                      ><SelectField
                        v-model="draftOwner"
                        :options="[
                          { value: 'shared', label: t('together') },
                          { value: 'unassigned', label: t('unassigned') },
                          ...members.map((item) => ({
                            value: `member:${item.id}`,
                            label: item.name,
                          })),
                        ]"
                    /></label>

                    <label v-if="isPreview || selected.memo"
                      ><span>{{ copy.notes }}</span
                      ><textarea v-model="draftMemo" rows="3" :readonly="!isPreview" />
                    </label>
                  </div>
                  <div class="activity-fact">
                    <span>{{ t('bankDate') }}</span
                    ><bdi dir="ltr">{{ dateLabel(selected.date) }}</bdi>
                  </div>
                  <label
                    ><span>{{ t('effectiveDate') }}</span
                    ><input v-model="draftEffectiveDate" type="date"
                  /></label>
                  <Button
                    v-if="draftEffectiveDate"
                    variant="link"
                    class="justify-start"
                    @click="draftEffectiveDate = ''"
                    >{{ language === 'he' ? 'שימוש בתאריך הבנק' : 'Use bank date' }}</Button
                  >
                </div>
                <label class="proto-include"
                  ><span>{{ t('includeInStatistics') }}</span
                  ><Switch v-model="draftIncluded" :aria-label="t('includeInStatistics')"
                /></label>
              </div>
              <details class="activity-original">
                <summary>{{ t('description') }}</summary>
                <p>
                  <bdi dir="auto">{{ selected.description }}</bdi>
                </p>
              </details>
              <p v-if="selectedFailure" class="proto-error" role="alert">
                {{ copy.saveFailed }}
                <button type="button" @click="retrySave(selectedFailure)">{{ t('retry') }}</button>
              </p>
              <p v-if="isPreview" class="proto-preview-note">{{ copy.onlyPreview }}</p>
              <p v-if="saved" class="proto-saved" role="status">{{ copy.saved }}</p>
            </div>
            <div
              v-if="(selected.needsReview && !isPreview) || dateChanged"
              class="proto-inspector-actions"
            >
              <Button
                v-if="selected.needsReview && !isPreview"
                variant="filled"
                class="w-full"
                :class="{ 'mb-2': dateChanged }"
                :disabled="saving || !draftCategory || draftCategory === 'uncategorized'"
                @click="confirmReview"
                >{{ language === 'he' ? 'אישור התנועה' : 'Confirm review' }}</Button
              >
              <button
                v-if="dateChanged"
                type="button"
                class="proto-save"
                :disabled="saving"
                @click="saveDate"
              >
                {{ saving ? copy.saving : copy.save }}
              </button>
            </div>
          </aside>
        </Transition>
      </div>
    </section>
  </div>
</template>

<style scoped>
.proto-shell {
  display: flex;
  position: relative;
  width: 100%;
  height: 100dvh;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
  font-family: var(--font-ui);
  font-size: 14px;
}
.proto-shell.embedded {
  height: 100%;
  min-height: 0;
}
.proto-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.proto-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 24px 24px 0;
  flex-shrink: 0;
}
.proto-month {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding-inline: 4px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface-muted);
  font-size: 13px;
  white-space: nowrap;
}
.proto-month button,
.proto-popover-head button,
.proto-inspector-head button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
}
.proto-month button:hover,
.proto-inspector-head button:hover {
  background: var(--row-hover);
}
.proto-month button:disabled {
  opacity: 0.35;
}
.proto-search {
  order: -3;
  display: flex;
  flex: 1 1 220px;
  gap: 9px;
  align-items: center;
  min-width: 160px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.proto-search input {
  width: 100%;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  font-size: 13px;
}
.proto-search:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
:deep(.activity-quick-filter) {
  order: -2;
  max-width: 180px;
  flex: 0 1 160px;
}
.activity-review-filter {
  order: -1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 13px;
  border-radius: 8px;
  background: var(--selection);
  color: var(--accent);
  font-size: 13px;
}
.activity-review-filter[aria-pressed='true'] {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.proto-filter-wrap {
  position: relative;
}
.proto-filter-button {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 400;
}
.proto-filter-count {
  font-size: 11px;
  color: var(--accent);
}
.proto-filter-popover {
  position: absolute;
  z-index: 12;
  inset-block-start: 44px;
  inset-inline-end: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 18px;
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 170px);
  overflow: auto;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--surface-overlay);
  box-shadow: var(--shadow-lg);
}
.proto-popover-head {
  grid-column: 1/-1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.proto-filter-popover label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.proto-filter-popover input:not([type='checkbox']) {
  height: 36px;
  width: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 13px;
}
.proto-filter-popover .proto-check {
  display: flex;
  gap: 8px;
  align-items: center;
}
.proto-clear {
  color: var(--accent);
  background: transparent;
  font-size: 13px;
}
.activity-totals {
  padding: 24px 28px;
  flex-shrink: 0;
}
.activity-total-currency {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.activity-total-currency + .activity-total-currency {
  margin-top: 16px;
}
.activity-total-currency > div {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding-inline-end: 16px;
  border-inline-end: 1px solid var(--separator);
}
.activity-total-currency > div:last-child {
  border: 0;
}
.activity-total-currency span {
  color: var(--text-secondary);
  font-size: 12px;
}
.activity-total-currency strong {
  white-space: nowrap;
  font-size: 24px;
  font-weight: 580;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}
.proto-content {
  display: flex;
  flex: 1;
  gap: 20px;
  align-items: flex-start;
  position: relative;
  min-height: 0;
  padding: 0 24px 24px;
}
.proto-ledger-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
}
.proto-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.proto-title h1 {
  font-size: 24px;
}
.proto-title span {
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-error {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface);
  color: var(--destructive);
  font-size: 13px;
}
.proto-error button {
  min-height: 36px;
  color: var(--accent);
  margin-inline-start: 8px;
}
.proto-table-scroll {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--surface);
  scroll-padding-block: 44px;
}
.proto-table {
  width: 100%;
  min-width: 590px;
  table-layout: fixed;
  border-collapse: collapse;
}
.proto-date-col {
  width: 110px;
}
.proto-merchant-col {
  width: 36%;
}
.proto-amount-col {
  width: 145px;
}
.proto-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 42px;
  padding: 0 16px;
  border-bottom: 1px solid var(--separator);
  background: var(--surface-muted);
  color: var(--text-secondary);
  text-align: start;
  font-size: 12px;
  font-weight: 500;
}
.proto-table th:last-child {
  text-align: end;
}
.proto-table td {
  height: 38px;
  padding: 0 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
  color: var(--text-primary);
  font-size: 14px;
}
.proto-table tr {
  transition: none;
}
.proto-table tr:hover {
  background: var(--row-hover);
}
.proto-table tr.selected,
.proto-table tr.selected:hover {
  background: var(--selection);
}
.proto-table tbody tr:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.ledger-date {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-size: 12px;
}
.proto-row-open {
  display: flex;
  gap: 9px;
  align-items: center;
  width: 100%;
  min-width: 0;
  padding: 0;
  text-align: start;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-primary);
  background: none;
}
.proto-row-open bdi {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proto-mobile-date {
  display: none;
}
.proto-table .proto-category {
  padding-inline: 4px;
}
.proto-amount {
  text-align: end !important;
  white-space: nowrap;
  font-weight: 450;
  font-variant-numeric: tabular-nums;
}
.positive {
  color: var(--success) !important;
}
.negative {
  color: var(--text-primary) !important;
}
.proto-empty {
  padding: 40px 20px;
  color: var(--text-secondary);
  text-align: center;
}
.proto-empty .proto-clear {
  display: block;
  margin: 12px auto 0;
}
.proto-more {
  display: block;
  margin: 14px auto;
  padding: 0 12px;
  background: var(--surface-muted);
  color: var(--accent);
}
.activity-table-footer {
  padding: 11px 16px;
  color: var(--text-secondary);
  font-size: 12px;
  border-top: 1px solid var(--separator);
  background: var(--surface-muted);
}
.proto-inspector {
  display: flex;
  flex: 0 0 344px;
  flex-direction: column;
  min-width: 0;
  max-height: 100%;
  overflow: auto;
}
.proto-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 14px 0 20px;
}
.proto-inspector-head h2 {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}
.proto-inspector-content {
  padding: 0 20px 20px;
  min-height: 0;
}
.proto-inspector-content h3 {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 14px;
  font-size: 17px;
  line-height: 1.4;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.proto-inspector-content h3 bdi {
  min-width: 0;
}
.proto-detail-amount {
  display: block;
  font-size: 30px;
  letter-spacing: -0.025em;
  line-height: 1.2;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.proto-detail-meta {
  margin: 8px 0 14px;
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-review {
  display: flex;
  align-items: start;
  gap: 8px;
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-review:before {
  content: '';
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.proto-fields {
  display: grid;
  gap: 14px;
  padding-block-start: 16px;
  border-block-start: 1px solid var(--separator);
}
.proto-fields label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-fields :deep(.ui-select-trigger) {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 400;
}
.proto-secondary-fields {
  display: grid;
  gap: 14px;
}
.proto-fields label.proto-include {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-block: 2px;
  padding-block: 14px;
  border-block: 1px solid var(--separator);
  color: var(--text-primary);
}
.proto-fields input:not([type='checkbox']),
.proto-fields textarea {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font: inherit;
}
.proto-fields textarea {
  height: auto;
}
.proto-fields small {
  font-weight: 400;
}
.transaction-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding-block: 14px;
  border-block: 1px solid var(--separator);
  margin-block: 16px;
  font-size: 12px;
}
.transaction-facts dt {
  color: var(--text-secondary);
}
.transaction-facts dd {
  margin: 4px 0 0;
}
.activity-original {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--separator);
  font-size: 12px;
}
.activity-original summary {
  color: var(--text-secondary);
  cursor: pointer;
}
.activity-original p {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.proto-saved {
  margin-block-start: 12px;
  color: var(--success);
  font-size: 12px;
}
.proto-preview-note {
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-inspector-actions {
  padding: 0 20px 20px;
}
.proto-save {
  min-height: 36px;
  width: 100%;
  border-radius: 8px;
  background: var(--accent);
  color: var(--primary-foreground);
  font-size: 13px;
}
.proto-save:disabled {
  opacity: 0.5;
}
.proto-backdrop {
  display: none;
}
.proto-sidebar {
  display: flex;
  flex: 0 0 200px;
  flex-direction: column;
  background: var(--bg-secondary);
  padding: 24px 16px;
  border-inline-end: 1px solid var(--separator);
}
.proto-brand {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 600;
}
.proto-brand img {
  width: 28px;
  height: 28px;
}
.proto-nav {
  display: grid;
  gap: 8px;
  margin-top: 30px;
}
.proto-nav a,
.proto-sidebar-footer a {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px;
  color: var(--text-primary);
}
.proto-nav .active {
  background: var(--selection);
  border-radius: 8px;
}
.proto-sidebar-footer {
  display: grid;
  gap: 12px;
  margin-top: auto;
}
.proto-sync {
  color: var(--text-secondary);
  font-size: 12px;
}
@media (max-width: 1250px) {
  .activity-total-currency > div {
    gap: 8px;
    flex-wrap: wrap;
  }
  .activity-total-currency strong {
    font-size: 21px;
  }
}
@media (max-width: 1120px) {
  .proto-backdrop {
    display: block;
    position: absolute;
    z-index: 3;
    inset: 0;
    border: 0;
    background: #0004;
  }
  .proto-inspector {
    position: absolute;
    inset-inline-end: 24px;
    inset-block: 0 24px;
    z-index: 4;
    width: 344px;
    box-shadow: var(--shadow-lg);
  }
  .proto-content {
    gap: 0;
  }
}
@media (max-width: 640px) {
  .proto-toolbar {
    padding: 16px 16px 0;
    gap: 8px;
  }
  .proto-search {
    flex-basis: 100%;
  }
  :deep(.activity-quick-filter) {
    flex: 1;
    max-width: none;
  }
  .proto-content {
    padding: 0 16px 16px;
  }
  .activity-totals {
    padding: 18px 16px;
  }
  .activity-total-currency {
    gap: 8px;
  }
  .activity-total-currency span {
    font-size: 11px;
  }
  .activity-total-currency strong {
    font-size: 18px;
  }
  .proto-inspector {
    inset-inline: 16px;
    inset-block-end: 16px;
    width: auto;
  }
  .proto-sidebar {
    display: none;
  }
}

.proto-inspector {
  position: relative;
}
.proto-inspector-head {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: 10px;
  z-index: 1;
  padding: 0;
  min-height: 0;
}
.proto-inspector-head h2 {
  margin: 0;
}
.proto-inspector-content {
  padding: 20px;
}
.proto-inspector-content h3 {
  padding-inline-end: 28px;
}
.activity-fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  min-height: 30px;
}
.activity-fact > span:first-child {
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-fields > label,
.proto-secondary-fields > label:not(.proto-include):not(:has(textarea)),
.proto-more-details > label:not(.proto-include) {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.proto-fields :deep(.ui-select-trigger) {
  border-color: transparent;
  background: transparent;
  padding-inline: 0;
}
.proto-fields :deep(.ui-select-trigger[data-state='open']) {
  border-color: var(--accent);
  background: var(--surface-muted);
}
.proto-more-details {
  display: grid;
  gap: 10px;
}
.proto-secondary-fields {
  gap: 8px;
}
.proto-fields {
  gap: 8px;
}
.proto-fields label.proto-include {
  margin-block-start: 8px;
}
.proto-fields small {
  grid-column: 1/-1;
}
@media (max-width: 1120px) {
  .proto-inspector {
    position: absolute;
  }
}

.activity-table-footer {
  position: sticky;
  bottom: 0;
}
.activity-original {
  border-top: 0;
  padding-top: 0;
}
</style>
