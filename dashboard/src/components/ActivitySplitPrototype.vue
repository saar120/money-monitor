<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
  getTransactions,
  ignoreTransaction,
  updateTransactionCategory,
  updateTransactionOwner,
  type Account,
  type Category,
  type Member,
  type OwnerType,
  type Transaction,
  type TransactionFilters,
} from '@/api/client';
import { formatAmount } from '@/lib/format';
import { language, setLanguageChoice, t } from '@/lib/language';
import { isValidMonth } from '@/lib/month';

const route = useRoute();
const isPreview = computed(() => route.name === 'split-prototype');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const month = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const search = ref(typeof route.query.search === 'string' ? route.query.search : '');
const filterOpen = ref(false);
const filterCategory = ref(typeof route.query.category === 'string' ? route.query.category : 'all');
const filterAccount = ref('all');
const reviewOnly = ref(false);
const rows = ref<Transaction[]>([]);
const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(true);
const error = ref('');
const selectedId = ref<number | null>(null);
const requestedTransactionId = ref(
  typeof route.query.transactionId === 'string' ? Number(route.query.transactionId) : null,
);
const draftCategory = ref('');
const draftOwner = ref('unassigned');
const draftIncluded = ref(true);
const draftMemo = ref('');
const saved = ref(false);
const saving = ref(false);
const localEdits = new Map<number, Partial<Transaction>>();
let requestId = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const copy = computed(() =>
  language.value === 'he'
    ? {
        filter: 'סינון',
        details: 'פרטים',
        account: 'חשבון',
        notes: 'הערות',
        save: 'שמירה',
        onlyPreview: 'אב טיפוס · השינויים נשמרים במסך הזה בלבד',
        saved: isPreview.value ? 'השינוי מוצג באב הטיפוס' : 'העסקה נשמרה',
        sync: 'מעודכן',
        all: 'הכל',
        loadMore: 'טעינת עסקאות נוספות',
        noSelection: 'בחרו עסקה כדי לראות פרטים',
        localChanges: 'תצוגה מקדימה בלבד',
        advanced: 'טבלה מתקדמת',
        saveFailed: 'לא ניתן לשמור את העסקה. נסו שוב.',
      }
    : {
        filter: 'Filter',
        details: 'Details',
        account: 'Account',
        notes: 'Notes',
        save: 'Save',
        onlyPreview: 'Prototype · changes stay on this screen',
        saved: isPreview.value ? 'Change shown in prototype' : 'Transaction saved',
        sync: 'Up to date',
        all: 'All',
        loadMore: 'Load more transactions',
        noSelection: 'Select a transaction to see details',
        localChanges: 'Preview only',
        advanced: 'Advanced table',
        saveFailed: 'Could not save the transaction. Try again.',
      },
);

function preserveRowWidth(element: globalThis.Element) {
  const row = element as HTMLElement;
  const widths = Array.from(row.children, (cell) => cell.getBoundingClientRect().width);
  row.style.width = `${row.getBoundingClientRect().width}px`;
  Array.from(row.children).forEach((cell, index) => {
    (cell as HTMLElement).style.width = `${widths[index]}px`;
  });
}
const selected = computed(() => rows.value.find((row) => row.id === selectedId.value) ?? null);
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
  Subscriptions: 'מינויים',
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
function monthEnd(value: string) {
  const [year, number] = value.split('-').map(Number) as [number, number];
  return `${value}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}
function shiftMonth(delta: number) {
  const [year, number] = month.value.split('-').map(Number) as [number, number];
  month.value = new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}
function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString(language.value === 'he' ? 'he-IL' : 'en-GB');
}
function signedAmount(row: Transaction) {
  const sign = row.chargedAmount < 0 ? '−' : row.chargedAmount > 0 ? '+' : '';
  return `${sign}${formatAmount(row.chargedAmount, row.chargedCurrency)}`;
}
function ownerValue(row: Transaction) {
  return row.expenseOwnerType === 'member'
    ? `member:${row.expenseOwnerMemberId ?? ''}`
    : row.expenseOwnerType;
}
function selectRow(row: Transaction) {
  selectedId.value = row.id;
  draftCategory.value = row.category ?? '';
  draftOwner.value = ownerValue(row);
  draftIncluded.value = !row.ignored;
  draftMemo.value = row.memo ?? '';
  saved.value = false;
}
function closeDetails() {
  selectedId.value = null;
}
async function load(append = false) {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const filters: TransactionFilters = {
      startDate: `${month.value}-01`,
      endDate: monthEnd(month.value),
      search: search.value || undefined,
      category: filterCategory.value === 'all' ? undefined : filterCategory.value,
      accountId: filterAccount.value === 'all' ? undefined : Number(filterAccount.value),
      needsReview: reviewOnly.value || undefined,
      sortBy: 'date',
      sortOrder: 'desc',
      limit: 60,
      offset: append ? rows.value.length : 0,
    };
    const result = await getTransactions(filters);
    if (id !== requestId) return;
    const next = result.transactions.map((row) =>
      isPreview.value ? { ...row, ...localEdits.get(row.id) } : row,
    );
    rows.value = append ? [...rows.value, ...next] : next;
    total.value = result.pagination.total;
    hasMore.value = result.pagination.hasMore;
    if (!append && !rows.value.some((row) => row.id === selectedId.value)) {
      selectedId.value = null;
      const requested = rows.value.find((row) => row.id === requestedTransactionId.value);
      if (requested) selectRow(requested);
      else if (rows.value[0] && window.innerWidth > 1120) selectRow(rows.value[0]);
      requestedTransactionId.value = null;
    }
  } catch (cause) {
    if (id === requestId) error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function saveTransaction() {
  const row = selected.value;
  if (!row) return;
  const [ownerType, memberId] = draftOwner.value.startsWith('member:')
    ? (['member', Number(draftOwner.value.slice(7))] as const)
    : ([draftOwner.value as OwnerType, null] as const);
  saving.value = true;
  error.value = '';
  try {
    if (isPreview.value) {
      const edit: Partial<Transaction> = {
        category: draftCategory.value || null,
        expenseOwnerType: ownerType,
        expenseOwnerMemberId: memberId,
        ignored: !draftIncluded.value,
        memo: draftMemo.value || null,
      };
      localEdits.set(row.id, edit);
      rows.value = rows.value.map((item) => (item.id === row.id ? { ...item, ...edit } : item));
    } else {
      let updated = row;
      if (draftCategory.value !== (row.category ?? '')) {
        updated = (await updateTransactionCategory(row.id, draftCategory.value || null))
          .transaction;
      }
      if (draftOwner.value !== ownerValue(updated)) {
        updated = (await updateTransactionOwner(row.id, { ownerType, ownerMemberId: memberId }))
          .transaction;
      }
      if (draftIncluded.value === updated.ignored) {
        updated = (await ignoreTransaction(row.id, !draftIncluded.value)).transaction;
      }
      rows.value = rows.value.map((item) => (item.id === row.id ? updated : item));
    }
    saved.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.saveFailed;
  } finally {
    saving.value = false;
  }
}
function onKeys(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('input, select, textarea, button, [contenteditable]')
  )
    return;
  if (event.key === 'Escape') {
    filterOpen.value = false;
    closeDetails();
    return;
  }
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
  await load();
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeys);
  clearTimeout(searchTimer);
});
watch(month, () => void load());
watch([filterCategory, filterAccount, reviewOnly], () => void load());
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 250);
});
</script>

<template>
  <div
    class="proto-shell"
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
      <div class="proto-toolbar">
        <div class="proto-month">
          <button type="button" :aria-label="t('previous')" @click="shiftMonth(-1)">
            <ChevronRight v-if="language === 'he'" :size="17" /><ChevronLeft v-else :size="17" />
          </button>
          <span>{{ monthLabel }}</span>
          <button type="button" :aria-label="t('next')" @click="shiftMonth(1)">
            <ChevronLeft v-if="language === 'he'" :size="17" /><ChevronRight v-else :size="17" />
          </button>
        </div>
        <div class="proto-filter-wrap">
          <button
            type="button"
            class="proto-filter-button"
            :aria-expanded="filterOpen"
            @click="filterOpen = !filterOpen"
          >
            <SlidersHorizontal :size="17" />{{ copy.filter
            }}<span
              v-if="reviewOnly || filterCategory !== 'all' || filterAccount !== 'all'"
              class="proto-filter-dot"
            />
          </button>
          <Transition name="filter-morph">
            <div v-if="filterOpen" class="proto-filter-popover">
              <div class="proto-popover-head">
                <strong>{{ copy.filter }}</strong
                ><button type="button" :aria-label="t('cancel')" @click="filterOpen = false">
                  <X :size="16" />
                </button>
              </div>
              <label
                ><span>{{ t('category') }}</span
                ><select v-model="filterCategory">
                  <option value="all">{{ t('allCategories') }}</option>
                  <option v-for="item in categories" :key="item.name" :value="item.name">
                    {{ categoryLabel(item.name) }}
                  </option>
                </select></label
              >
              <label
                ><span>{{ t('account') }}</span
                ><select v-model="filterAccount">
                  <option value="all">{{ t('allAccounts') }}</option>
                  <option v-for="item in accounts" :key="item.id" :value="String(item.id)">
                    {{ item.displayName }}
                  </option>
                </select></label
              >
              <label class="proto-check"
                ><input v-model="reviewOnly" type="checkbox" />{{ t('needsReview') }}</label
              >
              <button
                type="button"
                class="proto-clear"
                @click="
                  filterCategory = 'all';
                  filterAccount = 'all';
                  reviewOnly = false;
                "
              >
                {{ t('clear') }}
              </button>
            </div>
          </Transition>
        </div>
        <RouterLink v-if="!isPreview" to="/transactions/advanced" class="proto-advanced">{{
          copy.advanced
        }}</RouterLink>
        <label class="proto-search"
          ><Search :size="18" /><input
            v-model="search"
            :placeholder="t('searchActivity')"
            :aria-label="t('searchActivity')"
        /></label>
      </div>

      <div class="proto-content">
        <div class="proto-title">
          <h1 class="sr-only">{{ t('activity') }}</h1>
          <span>{{ total }} {{ t('transactions') }}</span>
        </div>
        <div v-if="error" class="proto-error" role="alert">
          {{ error }} <button type="button" @click="load()">{{ t('retry') }}</button>
        </div>
        <div class="proto-table-scroll" tabindex="0" :aria-label="t('activity')">
          <table class="proto-table">
            <colgroup>
              <col class="proto-date-col" />
              <col class="proto-merchant-col" />
              <col class="proto-category-col" />
              <col class="proto-amount-col" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{{ t('date') }}</th>
                <th scope="col">{{ t('description') }}</th>
                <th scope="col">{{ t('category') }}</th>
                <th scope="col">{{ t('amount') }}</th>
              </tr>
            </thead>
            <TransitionGroup tag="tbody" name="ledger-reflow" @before-leave="preserveRowWidth">
              <tr
                v-for="row in rows"
                :id="`proto-row-${row.id}`"
                :key="row.id"
                :class="{ selected: selectedId === row.id }"
                :aria-selected="selectedId === row.id"
                tabindex="0"
                @click="selectRow(row)"
                @keydown.enter="selectRow(row)"
              >
                <td>
                  <bdi dir="ltr">{{ dateLabel(row.reportingDate) }}</bdi>
                </td>
                <td class="proto-merchant">
                  <span dir="auto">{{ row.description }}</span
                  ><small v-if="row.needsReview">{{ t('needsReview') }}</small>
                  <small class="proto-mobile-date"
                    ><bdi dir="ltr">{{ dateLabel(row.reportingDate) }}</bdi></small
                  >
                </td>
                <td class="proto-category">
                  {{ categoryLabel(row.category) }}
                </td>
                <td class="proto-amount" :class="row.chargedAmount >= 0 ? 'positive' : 'negative'">
                  <bdi dir="ltr">{{ signedAmount(row) }}</bdi>
                </td>
              </tr>
            </TransitionGroup>
          </table>
          <div v-if="loading && !rows.length" class="proto-empty">
            {{ t('loadingTransactions') }}
          </div>
          <div v-else-if="!loading && !rows.length" class="proto-empty">
            {{ t('noTransactionsFound') }}
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
        </div>
      </div>
    </section>

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
      <aside v-if="selected" class="proto-inspector" :aria-label="copy.details">
        <div class="proto-inspector-head">
          <h2>{{ copy.details }}</h2>
          <button type="button" :aria-label="t('cancel')" @click="closeDetails">
            <X :size="18" />
          </button>
        </div>
        <div class="proto-inspector-content">
          <span v-if="selected.needsReview" class="proto-review">{{ t('needsReview') }}</span>
          <strong
            class="proto-detail-amount"
            :class="selected.chargedAmount >= 0 ? 'positive' : 'negative'"
            ><bdi dir="ltr">{{ signedAmount(selected) }}</bdi></strong
          >
          <h3>{{ selected.description }}</h3>
          <p class="proto-detail-meta">
            {{ accountMap.get(selected.accountId) ?? copy.account }} ·
            <bdi dir="ltr">{{ dateLabel(selected.reportingDate) }}</bdi>
          </p>
          <div class="proto-fields">
            <label
              ><span>{{ t('category') }}</span
              ><select v-model="draftCategory">
                <option value="">{{ t('uncategorized') }}</option>
                <option v-for="item in categories" :key="item.name" :value="item.name">
                  {{ categoryLabel(item.name) }}
                </option>
              </select></label
            >
            <label
              ><span>{{ t('account') }}</span
              ><input :value="accountMap.get(selected.accountId) ?? ''" readonly
            /></label>
            <label
              ><span>{{ t('owner') }}</span
              ><select v-model="draftOwner">
                <option value="shared">{{ t('together') }}</option>
                <option value="unassigned">{{ t('unassigned') }}</option>
                <option v-for="item in members" :key="item.id" :value="`member:${item.id}`">
                  {{ item.name }}
                </option>
              </select></label
            >
            <label class="proto-include"
              ><input v-model="draftIncluded" type="checkbox" /><span>{{
                t('includeInStatistics')
              }}</span></label
            >
            <label v-if="isPreview || selected.memo"
              ><span>{{ copy.notes }}</span
              ><textarea v-model="draftMemo" rows="3" :readonly="!isPreview" />
            </label>
          </div>
          <p v-if="isPreview" class="proto-preview-note">{{ copy.onlyPreview }}</p>
          <p v-if="saved" class="proto-saved" role="status">{{ copy.saved }}</p>
        </div>
        <div class="proto-inspector-actions">
          <button type="button" class="proto-save" :disabled="saving" @click="saveTransaction">
            {{ copy.save }}
          </button>
        </div>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.proto-shell {
  display: flex;
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
  font:
    14px/1.45 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
.proto-shell.embedded {
  height: 100%;
  min-height: 0;
}
.proto-shell * {
  box-sizing: border-box;
}
.proto-sidebar {
  display: flex;
  flex: 0 0 200px;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-secondary);
  border-inline-end: 1px solid var(--separator);
}
.proto-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 82px;
  padding-inline: 18px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
}
.proto-brand img {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}
.proto-nav {
  display: grid;
  gap: 5px;
  padding: 14px 10px;
}
.proto-nav a,
.proto-sidebar-footer a {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 42px;
  padding: 0 13px;
  border-radius: 10px;
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 600;
}
.proto-nav a:hover,
.proto-sidebar-footer a:hover {
  background: var(--bg-tertiary);
}
.proto-nav a.active {
  color: var(--accent);
  background: var(--accent-15);
}
.proto-nav svg,
.proto-sidebar-footer svg {
  flex: none;
}
.proto-sidebar-footer {
  display: grid;
  gap: 5px;
  margin-top: auto;
  padding: 12px 10px 16px;
  border-top: 1px solid var(--separator);
}
.proto-sync {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.proto-sync i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0aa779;
}
.proto-language {
  justify-self: start;
  margin-inline-start: 12px;
  padding: 4px 7px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.proto-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-primary);
}
.proto-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 25px;
  border-bottom: 1px solid var(--separator);
}
.proto-month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 190px;
  padding: 6px 8px;
  border: 1px solid var(--separator);
  border-radius: 12px;
  background: var(--bg-secondary);
  font-weight: 650;
  white-space: nowrap;
}
.proto-month button,
.proto-popover-head button,
.proto-inspector-head button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.proto-month button:hover,
.proto-inspector-head button:hover {
  background: var(--bg-tertiary);
}
.proto-filter-wrap {
  position: relative;
}
.proto-filter-button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 39px;
  padding: 0 13px;
  border: 1px solid var(--separator);
  border-radius: 11px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 650;
  cursor: pointer;
}
.proto-filter-button:hover {
  background: var(--bg-tertiary);
}
.proto-advanced {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.proto-advanced:hover {
  color: var(--accent);
  text-decoration: underline;
}
.proto-filter-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.proto-filter-popover {
  position: absolute;
  inset-block-start: 47px;
  inset-inline-start: 0;
  z-index: 5;
  display: grid;
  gap: 14px;
  width: 285px;
  padding: 17px;
  border: 1px solid var(--separator);
  border-radius: 14px;
  background: var(--bg-primary);
  box-shadow: 0 16px 40px #24365425;
}
.proto-filter-popover {
  transform-origin: 24px -24px;
}
[dir='rtl'] .proto-filter-popover {
  transform-origin: calc(100% - 24px) -24px;
}
.filter-morph-enter-active {
  transition:
    transform 420ms cubic-bezier(0.18, 1.18, 0.3, 1),
    opacity 150ms ease-out;
}
.filter-morph-leave-active {
  transition:
    transform 200ms ease-in,
    opacity 150ms ease-in;
  pointer-events: none;
}
.filter-morph-enter-from,
.filter-morph-leave-to {
  transform: translateY(-14px) scale(0.28, 0.12);
  opacity: 0;
}
.filter-morph-enter-active > label,
.filter-morph-enter-active > .proto-clear {
  animation: filter-controls-in 360ms 90ms both;
}
@keyframes filter-controls-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .filter-morph-enter-from,
  .filter-morph-leave-to {
    transform: none;
  }
}
.proto-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.proto-filter-popover label,
.proto-fields label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.proto-filter-popover select,
.proto-fields select,
.proto-fields input:not([type='checkbox']),
.proto-fields textarea {
  width: 100%;
  min-height: 35px;
  padding: 6px 10px;
  border: 1px solid var(--separator);
  border-radius: 9px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font:
    14px -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
.proto-filter-popover .proto-check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 13px;
}
.proto-clear {
  justify-self: start;
  border: 0;
  background: none;
  color: var(--accent);
  font-weight: 650;
  cursor: pointer;
}
.proto-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(310px, 30vw);
  min-height: 39px;
  margin-inline-start: auto;
  padding: 0 12px;
  border: 1px solid var(--separator);
  border-radius: 11px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}
.proto-search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
}
.proto-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent) 18;
}
.proto-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  max-width: 1120px;
  margin-inline: auto;
  padding: 20px 25px 0;
}
.proto-title {
  padding-block-end: 12px;
}
.proto-title span {
  color: var(--text-tertiary);
  font-size: 13px;
}
.proto-error {
  margin-block-end: 12px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--destructive) 12%, var(--bg-primary));
  color: var(--destructive);
}
.proto-error button {
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.proto-table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  padding-inline-end: 16px;
  margin-inline-end: -16px;
  outline: none;
}
.proto-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.proto-merchant-col {
  width: 43%;
}
.proto-category-col {
  width: 23%;
}
.proto-date-col {
  width: 17%;
}
.proto-amount-col {
  width: 17%;
}
.proto-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 39px;
  padding-inline: 12px;
  border-bottom: 1px solid var(--separator);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-align: start;
}
.proto-table thead th:last-child {
  text-align: end;
}
.proto-table td {
  height: 60px;
  padding: 10px 12px;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
  color: var(--text-primary);
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proto-table tr {
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.proto-table tbody tr[tabindex]:hover {
  background: color-mix(in srgb, var(--text-primary) 4%, transparent);
}
.proto-table tbody tr.selected {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.proto-table tbody tr:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.proto-table td:first-child {
  font-size: 12px;
  color: var(--text-tertiary);
}
.proto-merchant {
  font-size: 14px;
  color: var(--text-primary) !important;
  font-weight: 500;
}
.proto-merchant span {
  display: inline-block;
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.proto-merchant small {
  margin-inline-start: 8px;
  color: var(--destructive);
  font-size: 11px;
}
.proto-mobile-date {
  display: none;
}
.proto-category {
  font-size: 12px;
  color: var(--text-secondary) !important;
}
.proto-amount {
  text-align: end !important;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.proto-amount.negative {
  color: var(--text-primary) !important;
}
.proto-detail-amount.negative {
  color: var(--destructive) !important;
}
.proto-amount.positive,
.proto-detail-amount.positive {
  color: var(--success) !important;
}
.proto-empty {
  padding: 70px 20px;
  color: var(--text-tertiary);
  text-align: center;
}
.proto-more {
  display: block;
  margin: 22px auto;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--accent);
  cursor: pointer;
}
.proto-inspector {
  display: flex;
  flex: 0 0 330px;
  flex-direction: column;
  min-width: 0;
  border-inline-start: 1px solid var(--separator);
  background: var(--bg-secondary);
}
.proto-backdrop {
  display: none;
}
.proto-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 82px;
  padding: 0 21px;
  border-bottom: 1px solid var(--separator);
}
.proto-inspector-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.proto-inspector-content {
  flex: 1;
  overflow: auto;
  padding: 21px;
}
.proto-review {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--destructive) 12%, var(--bg-primary));
  color: var(--destructive);
  font-size: 12px;
  font-weight: 700;
}
.proto-detail-amount {
  display: block;
  margin-top: 17px;
  font-size: 34px;
  line-height: 1.1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
}
.proto-inspector-content h3 {
  margin: 11px 0 4px;
  font-size: 18px;
  line-height: 1.35;
}
.proto-detail-meta {
  margin: 0 0 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--separator);
  color: var(--text-secondary);
  font-size: 12px;
}
.proto-fields {
  display: grid;
  gap: 15px;
}
.proto-fields label:not(.proto-include) {
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
}
.proto-fields label:not(.proto-include) > span {
  grid-column: 1;
}
.proto-fields label:not(.proto-include) > :last-child {
  grid-column: 2;
}
.proto-fields label.proto-include {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-primary);
  font-size: 13px;
}
.proto-fields input[type='checkbox'],
.proto-filter-popover input[type='checkbox'] {
  accent-color: var(--accent);
}
.proto-fields textarea {
  resize: vertical;
}
.proto-preview-note {
  margin-top: 17px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.proto-saved {
  color: var(--success);
  font-size: 12px;
  font-weight: 650;
}
.proto-inspector-actions {
  padding: 18px 21px;
  border-top: 1px solid var(--separator);
}
.proto-save {
  width: 100%;
  min-height: 40px;
  border: 0;
  border-radius: 9px;
  background: var(--accent);
  color: var(--primary-foreground);
  font:
    700 14px -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  cursor: pointer;
}
.proto-save:hover {
  background: var(--accent-hover);
}
.proto-save:disabled {
  opacity: 0.6;
  cursor: wait;
}
@media (max-width: 1120px) {
  .proto-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 3;
    width: 100%;
    border: 0;
    background: #12223d2b;
    cursor: pointer;
  }
  .proto-inspector {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 4;
    width: 330px;
    box-shadow: 0 8px 36px #162b4833;
  }
  .proto-content {
    max-width: 1000px;
  }
}
@media (max-width: 900px) {
  .proto-sidebar {
    flex-basis: 69px;
  }
  .proto-brand {
    justify-content: center;
    padding: 0;
  }
  .proto-brand span,
  .proto-nav span,
  .proto-sidebar-footer a span,
  .proto-sync,
  .proto-language {
    display: none;
  }
  .proto-nav {
    padding-inline: 8px;
  }
  .proto-nav a,
  .proto-sidebar-footer a {
    justify-content: center;
    padding: 0;
  }
  .proto-toolbar {
    padding-inline: 17px;
  }
  .proto-content {
    padding-inline: 17px;
  }
  .proto-inspector {
    width: min(330px, 80vw);
  }
}
@media (max-width: 720px) {
  .proto-filter-popover {
    position: fixed;
    inset-block-start: 112px;
    inset-inline: 12px;
    width: auto;
    max-height: calc(100dvh - 140px);
    overflow-y: auto;
    transform-origin: top center;
  }
  [dir='rtl'] .proto-filter-popover {
    transform-origin: top center;
  }

  .proto-advanced {
    display: none;
  }
  .proto-date-col {
    display: none;
  }
  .proto-merchant .proto-mobile-date {
    display: block;
    margin: 3px 0 0;
    color: var(--text-tertiary);
  }
  .proto-table thead th:first-child,
  .proto-table td:first-child {
    display: none;
  }
  .proto-merchant-col {
    width: 48%;
  }
  .proto-category-col {
    width: 25%;
  }
  .proto-amount-col {
    width: 27%;
  }
  .proto-month {
    min-width: 135px;
  }
  .proto-search {
    width: 150px;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .proto-table tr.ledger-reflow-move,
  .proto-table tr.ledger-reflow-enter-active,
  .proto-table tr.ledger-reflow-leave-active {
    transition:
      transform 460ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 260ms,
      background-color 150ms;
  }
}
@media (prefers-reduced-motion: reduce) {
  .proto-table tr,
  .proto-inspector {
    transition: none;
    animation: none;
  }
}
</style>
