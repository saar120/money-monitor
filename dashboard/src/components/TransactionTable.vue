<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  getTransactions,
  getTransaction,
  getAccounts,
  ignoreTransaction,
  getCategories,
  getMembers,
  resolveTransaction,
  updateTransactionCategory,
  updateTransactionEffectiveDate,
  updateTransactionOwner,
  type Transaction,
  type TransactionFilters,
  type Category,
  type Account,
  type Member,
  type OwnerType,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle, Receipt } from 'lucide-vue-next';
import {
  formatCurrency,
  formatAmount,
  formatDate,
  DEFAULT_CATEGORY_COLOR,
  getCategoryStyle,
  buildCategoryMap,
} from '@/lib/format';
import { isValidMonth } from '@/lib/month';
import { t } from '@/lib/language';

const route = useRoute();
const initialMonth = isValidMonth(route.query.month) ? route.query.month : '';
function endOfMonth(month: string) {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}
const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const loadError = ref('');
const allAccounts = ref<Account[]>([]);
const members = ref<Member[]>([]);
const accountTypeFilter = ref<string>('all');

const accountMap = computed(() => {
  const map = new Map<number, string>();
  for (const acc of allAccounts.value) map.set(acc.id, acc.displayName);
  return map;
});

const filteredAccounts = computed(() => {
  if (accountTypeFilter.value === 'all') return allAccounts.value;
  return allAccounts.value.filter((a) => a.accountType === accountTypeFilter.value);
});

const filters = ref<TransactionFilters>({
  offset: 0,
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
});
const search = ref(typeof route.query.search === 'string' ? route.query.search : '');
const selectedAccount = ref<string>('all');
const startDate = ref(initialMonth ? `${initialMonth}-01` : '');
const endDate = ref(initialMonth ? endOfMonth(initialMonth) : '');
const selectedCategory = ref(
  typeof route.query.category === 'string' ? route.query.category : 'all',
);
const selectedOwner = ref('all');
const selectedStatus = ref('all');
const reviewOnly = ref(false);
const inclusion = ref('all');
const direction = ref('all');

const availableCategories = ref<Category[]>([]);
const categoryMap = computed(() => buildCategoryMap(availableCategories.value));
const updatingCategoryFor = ref<number | null>(null);
const editingCategoryFor = ref<number | null>(null);
const updatingOwnerFor = ref<number | null>(null);
const detailOpen = ref(false);
const selectedTxnId = ref<number | null>(null);
const focusedTxn = ref<Transaction | null>(null);
const selectedTxn = computed(
  () => transactions.value.find((txn) => txn.id === selectedTxnId.value) ?? focusedTxn.value,
);
const detailSaving = ref(false);
function openDetail(txn: Transaction) {
  selectedTxnId.value = txn.id;
  focusedTxn.value = txn;
  detailOpen.value = true;
}
async function openLinkedTransaction(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return;
  try {
    const { transaction } = await getTransaction(Number(value));
    openDetail(transaction);
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : 'Transaction could not be loaded.';
  }
}

// Context menu state
const contextMenu = ref<{ x: number; y: number; txn: Transaction } | null>(null);
const effectiveDateTxn = ref<Transaction | null>(null);
const effectiveDateValue = ref('');
const effectiveDateSaving = ref(false);
const effectiveDateError = ref('');

async function fetchTransactions() {
  loading.value = true;
  loadError.value = '';
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value !== 'all' ? Number(selectedAccount.value) : undefined,
      accountType:
        accountTypeFilter.value !== 'all'
          ? (accountTypeFilter.value as 'bank' | 'credit_card')
          : undefined,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      category: selectedCategory.value !== 'all' ? selectedCategory.value : undefined,
      status: selectedStatus.value !== 'all' ? selectedStatus.value : undefined,
      needsReview: reviewOnly.value ? true : undefined,
      ignored: inclusion.value === 'all' ? undefined : inclusion.value === 'ignored',
      minAmount: direction.value === 'income' ? 0.01 : undefined,
      maxAmount: direction.value === 'expense' ? -0.01 : undefined,
      ownerType: selectedOwner.value.startsWith('member:')
        ? 'member'
        : selectedOwner.value !== 'all'
          ? (selectedOwner.value as OwnerType)
          : undefined,
      ownerMemberId: selectedOwner.value.startsWith('member:')
        ? Number(selectedOwner.value.slice('member:'.length))
        : undefined,
    };
    const result = await getTransactions(params);
    if ((filters.value.offset ?? 0) > 0 && (filters.value.offset ?? 0) >= result.pagination.total) {
      filters.value.offset =
        Math.floor((Math.max(result.pagination.total, 1) - 1) / (filters.value.limit ?? 50)) *
        (filters.value.limit ?? 50);
      await fetchTransactions();
      return;
    }
    transactions.value = result.transactions;
    total.value = result.pagination.total;
    if (selectedTxnId.value !== null) {
      focusedTxn.value =
        result.transactions.find((txn) => txn.id === selectedTxnId.value) ?? focusedTxn.value;
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load activity.';
  } finally {
    loading.value = false;
  }
}

function sort(column: string) {
  if (filters.value.sortBy === column) {
    filters.value.sortOrder = filters.value.sortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    filters.value.sortBy = column;
    filters.value.sortOrder = 'desc';
  }
  filters.value.offset = 0;
  fetchTransactions();
}

function nextPage() {
  const offset = (filters.value.offset ?? 0) + (filters.value.limit ?? 50);
  if (offset < total.value) {
    filters.value.offset = offset;
    fetchTransactions();
  }
}

function prevPage() {
  const offset = Math.max(0, (filters.value.offset ?? 0) - (filters.value.limit ?? 50));
  filters.value.offset = offset;
  fetchTransactions();
}

function applyFilters() {
  filters.value.offset = 0;
  fetchTransactions();
}

function resetFilters() {
  search.value = '';
  accountTypeFilter.value = 'all';
  selectedAccount.value = 'all';
  selectedCategory.value = 'all';
  selectedOwner.value = 'all';
  selectedStatus.value = 'all';
  reviewOnly.value = false;
  inclusion.value = 'all';
  direction.value = 'all';
  startDate.value = '';
  endDate.value = '';
  applyFilters();
}

watch(
  () => [route.query.month, route.query.category, route.query.search],
  ([month, category, querySearch]) => {
    const key = isValidMonth(month) ? month : '';
    startDate.value = key ? `${key}-01` : '';
    endDate.value = key ? endOfMonth(key) : '';
    selectedCategory.value = typeof category === 'string' ? category : 'all';
    search.value = typeof querySearch === 'string' ? querySearch : '';
    applyFilters();
  },
);
watch(() => route.query.transactionId, openLinkedTransaction);

const currentPage = () => Math.floor((filters.value.offset ?? 0) / (filters.value.limit ?? 50)) + 1;
const totalPages = () => Math.ceil(total.value / (filters.value.limit ?? 50));

function openContextMenu(event: globalThis.MouseEvent, txn: Transaction) {
  event.preventDefault();
  contextMenu.value = { x: event.clientX, y: event.clientY, txn };
}

function closeContextMenu() {
  contextMenu.value = null;
}

async function updateCategory(txn: Transaction, newCategory: string | null) {
  updatingCategoryFor.value = txn.id;
  try {
    const { transaction } = await updateTransactionCategory(txn.id, newCategory);
    focusedTxn.value = transaction;
    await fetchTransactions();
  } catch (err) {
    console.error('Failed to update category:', err);
  } finally {
    updatingCategoryFor.value = null;
  }
}

function ownerLabel(txn: Transaction): string {
  if (txn.expenseOwnerType === 'shared') return t('together');
  if (txn.expenseOwnerType === 'unassigned') return t('unassigned');
  return members.value.find((m) => m.id === txn.expenseOwnerMemberId)?.name ?? t('unknownMember');
}

function ownerSelectValue(txn: Transaction): string {
  if (txn.expenseOwnerType === 'member' && txn.expenseOwnerMemberId != null) {
    return `member:${txn.expenseOwnerMemberId}`;
  }
  return txn.expenseOwnerType;
}

async function updateOwner(txn: Transaction, value: string) {
  updatingOwnerFor.value = txn.id;
  try {
    const ownerType: OwnerType = value.startsWith('member:') ? 'member' : (value as OwnerType);
    const ownerMemberId = value.startsWith('member:')
      ? Number(value.slice('member:'.length))
      : null;
    const { transaction } = await updateTransactionOwner(txn.id, { ownerType, ownerMemberId });
    focusedTxn.value = transaction;
    await fetchTransactions();
  } catch (err) {
    console.error('Failed to update owner:', err);
  } finally {
    updatingOwnerFor.value = null;
  }
}

async function toggleIgnore() {
  if (!contextMenu.value) return;
  const { txn } = contextMenu.value;
  closeContextMenu();
  await setIncluded(txn, txn.ignored);
}

async function setIncluded(txn: Transaction, included: boolean) {
  detailSaving.value = true;
  try {
    await ignoreTransaction(txn.id, !included);
    if (selectedTxnId.value === txn.id) detailOpen.value = false;
    await fetchTransactions();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not update the transaction.';
  } finally {
    detailSaving.value = false;
  }
}

async function confirmReview(txn: Transaction) {
  if (!txn.category) return;
  detailSaving.value = true;
  try {
    await resolveTransaction(txn.id, txn.category);
    if (selectedTxnId.value === txn.id) detailOpen.value = false;
    await fetchTransactions();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not confirm the category.';
  } finally {
    detailSaving.value = false;
  }
}

function openEffectiveDateDialog() {
  if (!contextMenu.value) return;
  effectiveDateTxn.value = contextMenu.value.txn;
  effectiveDateValue.value = contextMenu.value.txn.effectiveDate ?? contextMenu.value.txn.date;
  effectiveDateError.value = '';
  closeContextMenu();
}

async function saveEffectiveDate(effectiveDate: string | null) {
  if (!effectiveDateTxn.value) return;
  effectiveDateSaving.value = true;
  effectiveDateError.value = '';
  try {
    await updateTransactionEffectiveDate(effectiveDateTxn.value.id, effectiveDate);
    effectiveDateTxn.value = null;
    await fetchTransactions();
  } catch (err) {
    effectiveDateError.value =
      err instanceof Error ? err.message : 'Could not update the effective date.';
  } finally {
    effectiveDateSaving.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeContextMenu();
}

onMounted(async () => {
  const [accountData, catData, memberData] = await Promise.all([
    getAccounts(),
    getCategories(),
    getMembers(),
  ]);
  allAccounts.value = accountData.accounts;
  availableCategories.value = catData.categories;
  members.value = memberData.members.filter((m) => m.isActive);
  fetchTransactions();
  void openLinkedTransaction(route.query.transactionId);
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <!-- Filters -->
    <div class="flex-shrink-0 mb-4 space-y-3 activity-filters">
      <div class="flex flex-wrap items-center gap-2.5">
        <Input
          v-model="search"
          :placeholder="t('searchActivity')"
          :aria-label="t('searchActivity')"
          class="w-60"
          @keyup.enter="applyFilters"
        />

        <Select
          v-model="accountTypeFilter"
          @update:model-value="
            () => {
              selectedAccount = 'all';
              applyFilters();
            }
          "
        >
          <SelectTrigger class="w-40">
            <SelectValue :placeholder="t('allTypes')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('allTypes') }}</SelectItem>
            <SelectItem value="bank">{{ t('banks') }}</SelectItem>
            <SelectItem value="credit_card">{{ t('creditCards') }}</SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="selectedAccount" @update:model-value="applyFilters">
          <SelectTrigger class="w-44">
            <SelectValue :placeholder="t('allAccounts')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('allAccounts') }}</SelectItem>
            <SelectItem v-for="acc in filteredAccounts" :key="acc.id" :value="String(acc.id)">
              {{ acc.displayName }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="selectedCategory" @update:model-value="applyFilters">
          <SelectTrigger class="w-40">
            <SelectValue :placeholder="t('allCategories')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('allCategories') }}</SelectItem>
            <SelectItem value="uncategorized">{{ t('uncategorized') }}</SelectItem>
            <SelectItem v-for="cat in availableCategories" :key="cat.name" :value="cat.name">
              {{ cat.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="selectedOwner" @update:model-value="applyFilters">
          <SelectTrigger class="w-40">
            <SelectValue :placeholder="t('allOwners')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('allOwners') }}</SelectItem>
            <SelectItem value="shared">{{ t('together') }}</SelectItem>
            <SelectItem v-for="member in members" :key="member.id" :value="`member:${member.id}`">
              {{ member.name }}
            </SelectItem>
            <SelectItem value="unassigned">{{ t('unassigned') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-wrap items-center gap-2.5">
        <Input
          v-model="startDate"
          type="date"
          class="w-36"
          :aria-label="t('startDate')"
          @change="applyFilters"
        />
        <span class="text-[12px] text-text-tertiary">{{ t('to') }}</span>
        <Input
          v-model="endDate"
          type="date"
          class="w-36"
          :aria-label="t('endDate')"
          @change="applyFilters"
        />
        <select
          v-model="selectedStatus"
          :aria-label="t('transactionStatus')"
          class="ledger-select"
          @change="applyFilters"
        >
          <option value="all">{{ t('anyStatus') }}</option>
          <option value="completed">{{ t('completed') }}</option>
          <option value="pending">{{ t('pending') }}</option>
        </select>
        <select
          v-model="direction"
          :aria-label="t('moneyDirection')"
          class="ledger-select"
          @change="applyFilters"
        >
          <option value="all">{{ t('inAndOut') }}</option>
          <option value="expense">{{ t('spending') }}</option>
          <option value="income">{{ t('income') }}</option>
        </select>
        <select
          v-model="inclusion"
          :aria-label="t('includeInStatistics')"
          class="ledger-select"
          @change="applyFilters"
        >
          <option value="all">{{ t('allActivity') }}</option>
          <option value="included">{{ t('included') }}</option>
          <option value="ignored">{{ t('excluded') }}</option>
        </select>
        <label class="activity-review-toggle"
          ><input v-model="reviewOnly" type="checkbox" @change="applyFilters" />
          {{ t('needsReview') }}</label
        >
        <Button variant="secondary" size="sm" @click="resetFilters">{{ t('clear') }}</Button>
      </div>
    </div>
    <div v-if="loadError" class="ledger-notice" role="alert">
      {{ loadError }} <button @click="fetchTransactions">{{ t('retry') }}</button>
    </div>

    <!-- Table -->
    <Card class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader class="pb-2 flex-shrink-0">
        <CardTitle class="text-[15px]"> {{ total }} {{ t('transactions') }} </CardTitle>
      </CardHeader>
      <CardContent class="p-0 flex-1 min-h-0">
        <div class="overflow-auto h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  :aria-sort="
                    filters.sortBy === 'date'
                      ? filters.sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  "
                >
                  <button type="button" class="flex items-center gap-1" @click="sort('date')">
                    {{ t('reportingDate') }}
                    <ChevronUp
                      v-if="filters.sortBy === 'date' && filters.sortOrder === 'asc'"
                      class="h-3 w-3"
                    />
                    <ChevronDown
                      v-else-if="filters.sortBy === 'date' && filters.sortOrder === 'desc'"
                      class="h-3 w-3"
                    />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </button>
                </TableHead>
                <TableHead>{{ t('description') }}</TableHead>
                <TableHead
                  class="text-right"
                  :aria-sort="
                    filters.sortBy === 'chargedAmount'
                      ? filters.sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  "
                >
                  <button
                    type="button"
                    class="flex items-center justify-end gap-1 ml-auto"
                    @click="sort('chargedAmount')"
                  >
                    {{ t('amount') }}
                    <ChevronUp
                      v-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'asc'"
                      class="h-3 w-3"
                    />
                    <ChevronDown
                      v-else-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'desc'"
                      class="h-3 w-3"
                    />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </button>
                </TableHead>
                <TableHead>{{ t('category') }}</TableHead>
                <TableHead>{{ t('owner') }}</TableHead>
                <TableHead>{{ t('status') }}</TableHead>
                <TableHead>{{ t('account') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="loading">
                <TableRow v-for="i in 8" :key="i">
                  <TableCell><Skeleton class="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-48" /></TableCell>
                  <TableCell class="text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-12" /></TableCell>
                </TableRow>
              </template>
              <TableRow v-else-if="transactions.length === 0">
                <TableCell colspan="7" class="text-center py-16">
                  <div class="flex flex-col items-center">
                    <Receipt class="h-10 w-10 text-text-tertiary mb-3" />
                    <p class="text-text-primary text-[14px] font-medium mb-1">
                      {{ t('noTransactionsFound') }}
                    </p>
                    <p class="text-text-secondary text-[13px]">{{ t('adjustFilters') }}</p>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow
                v-for="txn in transactions"
                v-else
                :key="txn.id"
                :class="txn.ignored ? 'opacity-40' : ''"
                class="cursor-pointer activity-transaction-row"
                tabindex="0"
                :aria-label="`View details for ${txn.description}`"
                @click="openDetail(txn)"
                @keydown.enter.self="openDetail(txn)"
                @keydown.space.self.prevent="openDetail(txn)"
                @contextmenu="openContextMenu($event, txn)"
              >
                <TableCell class="text-[13px] text-text-secondary whitespace-nowrap">
                  <div class="text-text-primary">{{ formatDate(txn.reportingDate) }}</div>
                  <div v-if="txn.effectiveDate" class="text-[11px] text-text-secondary">
                    {{ t('bankDate') }} {{ formatDate(txn.date) }}
                  </div>
                </TableCell>
                <TableCell class="max-w-xs truncate">
                  <span class="flex items-center gap-1.5">
                    <AlertCircle
                      v-if="txn.needsReview"
                      class="h-3.5 w-3.5 text-[var(--warning)] flex-shrink-0"
                    />
                    {{ txn.description }}
                  </span>
                </TableCell>
                <TableCell
                  class="text-right font-medium tabular-nums"
                  :class="txn.chargedAmount >= 0 ? 'text-success' : 'text-destructive'"
                >
                  {{ formatCurrency(txn.chargedAmount) }}
                </TableCell>
                <TableCell @click.stop>
                  <!-- Inline Select only for the row being edited -->
                  <Select
                    v-if="editingCategoryFor === txn.id"
                    :model-value="txn.category ?? ''"
                    :disabled="updatingCategoryFor === txn.id"
                    :default-open="true"
                    @update:model-value="
                      (val) => {
                        editingCategoryFor = null;
                        updateCategory(txn, val === '__none__' || val == null ? null : String(val));
                      }
                    "
                  >
                    <SelectTrigger
                      class="h-7 text-[11px] w-36 border-0 bg-transparent hover:bg-bg-tertiary px-1"
                      :class="updatingCategoryFor === txn.id ? 'opacity-50' : ''"
                    >
                      <SelectValue>
                        <Badge
                          v-if="txn.category"
                          variant="secondary"
                          class="text-[11px]"
                          :style="getCategoryStyle(categoryMap.get(txn.category)?.color)"
                        >
                          {{ categoryMap.get(txn.category)?.label ?? txn.category }}
                        </Badge>
                        <span v-else class="text-text-tertiary">—</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent @close-auto-focus="editingCategoryFor = null">
                      <SelectItem value="__none__">
                        <span class="text-text-secondary">{{ t('none') }}</span>
                      </SelectItem>
                      <SelectItem
                        v-for="cat in availableCategories"
                        :key="cat.name"
                        :value="cat.name"
                      >
                        <div class="flex items-center gap-2">
                          <div
                            class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            :style="{ backgroundColor: cat.color ?? DEFAULT_CATEGORY_COLOR }"
                          />
                          {{ cat.label }}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <!-- Lightweight clickable display for all other rows -->
                  <button
                    v-else
                    class="h-7 text-[11px] w-36 flex items-center px-1 rounded-lg hover:bg-bg-tertiary transition-colors duration-150"
                    :class="updatingCategoryFor === txn.id ? 'opacity-50 pointer-events-none' : ''"
                    @click="editingCategoryFor = txn.id"
                  >
                    <Badge
                      v-if="txn.category"
                      variant="secondary"
                      class="text-[11px]"
                      :style="getCategoryStyle(categoryMap.get(txn.category)?.color)"
                    >
                      {{ categoryMap.get(txn.category)?.label ?? txn.category }}
                    </Badge>
                    <span v-else class="text-text-tertiary">—</span>
                  </button>
                </TableCell>
                <TableCell @click.stop>
                  <Select
                    :model-value="ownerSelectValue(txn)"
                    :disabled="updatingOwnerFor === txn.id"
                    @update:model-value="(val) => updateOwner(txn, String(val))"
                  >
                    <SelectTrigger
                      class="h-7 text-[11px] w-36 border-0 bg-transparent hover:bg-bg-tertiary px-1"
                      :class="updatingOwnerFor === txn.id ? 'opacity-50' : ''"
                    >
                      <SelectValue>
                        <Badge variant="secondary" class="text-[11px]">
                          {{ ownerLabel(txn) }}
                        </Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shared">{{ t('together') }}</SelectItem>
                      <SelectItem
                        v-for="member in members"
                        :key="member.id"
                        :value="`member:${member.id}`"
                      >
                        {{ member.name }}
                      </SelectItem>
                      <SelectItem value="unassigned">{{ t('unassigned') }}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge
                    :variant="txn.status === 'completed' ? 'default' : 'secondary'"
                    class="text-[11px]"
                    :class="
                      txn.status === 'pending' ? 'bg-[var(--warning)]/10 text-[var(--warning)]' : ''
                    "
                  >
                    {{ txn.status === 'completed' ? t('completed') : t('pending') }}
                  </Badge>
                </TableCell>
                <TableCell class="text-[13px] text-text-secondary">{{
                  accountMap.get(txn.accountId) ?? txn.accountId
                }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div
      class="flex items-center justify-between flex-shrink-0 pt-3 mt-1 border-t border-separator/40"
    >
      <p class="text-[13px] text-text-secondary">
        {{ t('page') }} {{ currentPage() }} {{ t('of') }} {{ totalPages() || 1 }}
        &nbsp;·&nbsp;
        {{ total ? (filters.offset ?? 0) + 1 : 0 }}–{{
          Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total)
        }}
        {{ t('of') }} {{ total }}
      </p>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          :disabled="(filters.offset ?? 0) === 0"
          @click="prevPage"
        >
          {{ t('previous') }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :disabled="(filters.offset ?? 0) + (filters.limit ?? 50) >= total"
          @click="nextPage"
        >
          {{ t('next') }}
        </Button>
      </div>
    </div>

    <Dialog v-model:open="detailOpen">
      <DialogContent v-if="selectedTxn" class="max-w-xl">
        <DialogHeader>
          <DialogTitle dir="auto" class="text-[21px]">{{ selectedTxn.description }}</DialogTitle>
          <DialogDescription
            >{{ accountMap.get(selectedTxn.accountId) ?? t('account') }} ·
            {{ formatDate(selectedTxn.reportingDate) }}</DialogDescription
          >
        </DialogHeader>
        <div class="activity-detail">
          <div
            class="activity-detail-amount"
            :class="selectedTxn.chargedAmount >= 0 ? 'is-positive' : ''"
          >
            {{ selectedTxn.chargedAmount < 0 ? '−' : '+'
            }}{{ formatAmount(selectedTxn.chargedAmount, selectedTxn.chargedCurrency) }}
          </div>
          <p
            v-if="selectedTxn.originalCurrency !== selectedTxn.chargedCurrency"
            class="activity-detail-original"
          >
            {{ t('originalAmount') }}:
            {{ formatAmount(selectedTxn.originalAmount, selectedTxn.originalCurrency) }}
          </p>
          <div class="activity-detail-grid">
            <div>
              <span>{{ t('category') }}</span>
              <Select
                :model-value="selectedTxn.category ?? '__none__'"
                :disabled="updatingCategoryFor === selectedTxn.id"
                @update:model-value="
                  (value) =>
                    updateCategory(
                      selectedTxn!,
                      String(value) === '__none__' ? null : String(value),
                    )
                "
              >
                <SelectTrigger class="w-full"
                  ><SelectValue :placeholder="t('uncategorized')"
                /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{{ t('uncategorized') }}</SelectItem>
                  <SelectItem
                    v-for="category in availableCategories"
                    :key="category.name"
                    :value="category.name"
                    >{{ category.label }}</SelectItem
                  >
                </SelectContent>
              </Select>
            </div>
            <div>
              <span>{{ t('owner') }}</span>
              <Select
                :model-value="ownerSelectValue(selectedTxn)"
                :disabled="updatingOwnerFor === selectedTxn.id"
                @update:model-value="(value) => updateOwner(selectedTxn!, String(value))"
              >
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">{{ t('together') }}</SelectItem>
                  <SelectItem
                    v-for="member in members"
                    :key="member.id"
                    :value="`member:${member.id}`"
                    >{{ member.name }}</SelectItem
                  >
                  <SelectItem value="unassigned">{{ t('unassigned') }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <span>{{ t('status') }}</span
              ><strong>{{
                selectedTxn.status === 'completed' ? t('completed') : t('pending')
              }}</strong>
            </div>
            <div>
              <span>{{ t('bankDate') }}</span
              ><strong>{{ formatDate(selectedTxn.date) }}</strong>
            </div>
            <div v-if="selectedTxn.installmentTotal">
              <span>{{ t('installment') }}</span
              ><strong
                >{{ selectedTxn.installmentNumber }} {{ t('of') }}
                {{ selectedTxn.installmentTotal }}</strong
              >
            </div>
            <div v-if="selectedTxn.type">
              <span>{{ t('type') }}</span
              ><strong>{{ selectedTxn.type }}</strong>
            </div>
          </div>
          <p v-if="selectedTxn.memo" class="activity-detail-note" dir="auto">
            {{ selectedTxn.memo }}
          </p>
          <p v-if="selectedTxn.needsReview" class="activity-detail-review">
            <AlertCircle :size="16" />{{ selectedTxn.reviewReason ?? t('transactionNeedsReview') }}
          </p>
          <div class="activity-detail-actions">
            <Button
              variant="secondary"
              :disabled="detailSaving"
              @click="setIncluded(selectedTxn!, selectedTxn!.ignored)"
            >
              {{ selectedTxn.ignored ? t('includeInStatistics') : t('excludeFromStatistics') }}
            </Button>
            <Button
              v-if="selectedTxn.needsReview && selectedTxn.category"
              :disabled="detailSaving"
              @click="confirmReview(selectedTxn!)"
            >
              {{ t('confirmCategory') }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 min-w-[160px] border border-separator/50 bg-bg-primary text-text-primary shadow-[var(--shadow-lg)] rounded-xl py-1 animate-scale-in backdrop-blur-xl"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button
          class="w-full px-3.5 py-2 text-[13px] text-left hover:bg-primary/10 hover:text-primary rounded-lg mx-0.5 transition-colors duration-150"
          style="width: calc(100% - 4px)"
          @click="openEffectiveDateDialog"
        >
          {{ t('setEffectiveDate') }}
        </button>
        <button
          class="w-full px-3.5 py-2 text-[13px] text-left hover:bg-primary/10 hover:text-primary rounded-lg mx-0.5 transition-colors duration-150"
          style="width: calc(100% - 4px)"
          @click="toggleIgnore"
        >
          {{ contextMenu.txn.ignored ? t('includeInStatistics') : t('excludeFromStatistics') }}
        </button>
      </div>
    </Teleport>

    <Dialog
      :open="effectiveDateTxn !== null"
      @update:open="(open) => !open && (effectiveDateTxn = null)"
    >
      <DialogContent class="max-w-sm">
        <form @submit.prevent="saveEffectiveDate(effectiveDateValue)">
          <DialogHeader>
            <DialogTitle>{{ t('setEffectiveDate') }}</DialogTitle>
            <DialogDescription>
              {{ t('effectiveDateExplanation') }}
            </DialogDescription>
          </DialogHeader>

          <div class="py-5 space-y-2">
            <label for="effective-date" class="block text-[12px] font-medium text-text-secondary">
              {{ t('effectiveDate') }}
            </label>
            <Input
              id="effective-date"
              v-model="effectiveDateValue"
              type="date"
              required
              :disabled="effectiveDateSaving"
            />
            <p v-if="effectiveDateTxn" class="text-[12px] text-text-secondary">
              {{ t('bankDate') }}: {{ formatDate(effectiveDateTxn.date) }}
            </p>
            <p v-if="effectiveDateError" role="alert" class="text-[12px] text-destructive">
              {{ effectiveDateError }}
            </p>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              :disabled="effectiveDateSaving || !effectiveDateTxn?.effectiveDate"
              @click="saveEffectiveDate(null)"
            >
              {{ t('useBankDate') }}
            </Button>
            <Button
              type="submit"
              variant="filled"
              :disabled="effectiveDateSaving || !effectiveDateValue"
            >
              {{ effectiveDateSaving ? t('saving') : t('save') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
