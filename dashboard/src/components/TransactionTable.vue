<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getTransactions, getAccounts, ignoreTransaction, getCategories, updateTransactionCategory, type Transaction, type TransactionFilters, type Category, type Account } from '../api/client';
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
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle } from 'lucide-vue-next';
import { formatCurrency, formatDate, DEFAULT_CATEGORY_COLOR, getCategoryStyle, buildCategoryMap } from '@/lib/format';

const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const allAccounts = ref<Account[]>([]);
const accountTypeFilter = ref<string>('all');

const accountMap = computed(() => {
  const map = new Map<number, string>();
  for (const acc of allAccounts.value) map.set(acc.id, acc.displayName);
  return map;
});

const filteredAccounts = computed(() => {
  if (accountTypeFilter.value === 'all') return allAccounts.value;
  return allAccounts.value.filter(a => a.accountType === accountTypeFilter.value);
});

const filters = ref<TransactionFilters>({
  offset: 0,
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
});
const search = ref('');
const selectedAccount = ref<string>('all');
const startDate = ref('');
const endDate = ref('');
const selectedCategory = ref('all');

const availableCategories = ref<Category[]>([]);
const categoryMap = computed(() => buildCategoryMap(availableCategories.value));
const updatingCategoryFor = ref<number | null>(null);
const editingCategoryFor = ref<number | null>(null);

// Context menu state
const contextMenu = ref<{ x: number; y: number; txn: Transaction } | null>(null);

async function fetchTransactions() {
  loading.value = true;
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value !== 'all' ? Number(selectedAccount.value) : undefined,
      accountType: accountTypeFilter.value !== 'all' ? accountTypeFilter.value as 'bank' | 'credit_card' : undefined,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      category: selectedCategory.value !== 'all' ? selectedCategory.value : undefined,
    };
    const result = await getTransactions(params);
    transactions.value = result.transactions;
    total.value = result.pagination.total;
  } catch (err) {
    console.error('Failed to fetch transactions:', err);
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

const currentPage = () => Math.floor((filters.value.offset ?? 0) / (filters.value.limit ?? 50)) + 1;
const totalPages = () => Math.ceil(total.value / (filters.value.limit ?? 50));

function openContextMenu(event: MouseEvent, txn: Transaction) {
  event.preventDefault();
  contextMenu.value = { x: event.clientX, y: event.clientY, txn };
}

function closeContextMenu() {
  contextMenu.value = null;
}

async function updateCategory(txn: Transaction, newCategory: string | null) {
  updatingCategoryFor.value = txn.id;
  try {
    const result = await updateTransactionCategory(txn.id, newCategory);
    const idx = transactions.value.findIndex(t => t.id === txn.id);
    if (idx !== -1) transactions.value[idx] = result.transaction;
  } catch (err) {
    console.error('Failed to update category:', err);
  } finally {
    updatingCategoryFor.value = null;
  }
}

async function toggleIgnore() {
  if (!contextMenu.value) return;
  const { txn } = contextMenu.value;
  closeContextMenu();
  try {
    const result = await ignoreTransaction(txn.id, !txn.ignored);
    // Update in-place so the row reacts immediately without a full refetch
    const idx = transactions.value.findIndex(t => t.id === txn.id);
    if (idx !== -1) transactions.value[idx] = result.transaction;
  } catch (err) {
    console.error('Failed to update transaction:', err);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeContextMenu();
}

onMounted(async () => {
  const [accountData, catData] = await Promise.all([getAccounts(), getCategories()]);
  allAccounts.value = accountData.accounts;
  availableCategories.value = catData.categories;
  fetchTransactions();
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
    <h1 class="text-[22px] font-semibold text-text-primary flex-shrink-0 mb-4">Transactions</h1>

    <!-- Filters -->
    <div class="flex-shrink-0 mb-4">
        <div class="flex flex-wrap gap-2">
          <Input
            v-model="search"
            placeholder="Search description..."
            class="w-48"
            @keyup.enter="applyFilters"
          />

          <Select v-model="accountTypeFilter" @update:model-value="() => { selectedAccount = 'all'; applyFilters(); }">
            <SelectTrigger class="w-40">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="bank">Banks</SelectItem>
              <SelectItem value="credit_card">Credit Cards</SelectItem>
            </SelectContent>
          </Select>

          <Select v-model="selectedAccount" @update:model-value="applyFilters">
            <SelectTrigger class="w-44">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              <SelectItem
                v-for="acc in filteredAccounts"
                :key="acc.id"
                :value="String(acc.id)"
              >
                {{ acc.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Input
            v-model="startDate"
            type="date"
            class="w-36"
            @change="applyFilters"
          />
          <Input
            v-model="endDate"
            type="date"
            class="w-36"
            @change="applyFilters"
          />

          <Select v-model="selectedCategory" @update:model-value="applyFilters">
            <SelectTrigger class="w-36">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem v-for="cat in availableCategories" :key="cat.name" :value="cat.name">
                {{ cat.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Button @click="applyFilters" variant="default" size="sm">Filter</Button>
        </div>
    </div>

    <!-- Table -->
    <Card class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader class="pb-2 flex-shrink-0">
        <CardTitle class="text-[15px]">
          {{ total }} transaction{{ total !== 1 ? 's' : '' }}
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0 flex-1 min-h-0">
        <div class="overflow-auto h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  class="cursor-pointer select-none"
                  @click="sort('date')"
                >
                  <span class="flex items-center gap-1">
                    Date
                    <ChevronUp v-if="filters.sortBy === 'date' && filters.sortOrder === 'asc'" class="h-3 w-3" />
                    <ChevronDown v-else-if="filters.sortBy === 'date' && filters.sortOrder === 'desc'" class="h-3 w-3" />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </span>
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead
                  class="cursor-pointer select-none text-right"
                  @click="sort('chargedAmount')"
                >
                  <span class="flex items-center justify-end gap-1">
                    Amount
                    <ChevronUp v-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'asc'" class="h-3 w-3" />
                    <ChevronDown v-else-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'desc'" class="h-3 w-3" />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </span>
                </TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="loading">
                <TableRow v-for="i in 8" :key="i">
                  <TableCell><Skeleton class="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-48" /></TableCell>
                  <TableCell class="text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-12" /></TableCell>
                </TableRow>
              </template>
              <TableRow v-else-if="transactions.length === 0">
                <TableCell colspan="6" class="text-center text-text-secondary py-12">
                  No transactions found
                </TableCell>
              </TableRow>
              <TableRow
                v-else
                v-for="txn in transactions"
                :key="txn.id"
                :class="txn.ignored ? 'opacity-40' : ''"
                class="cursor-context-menu"
                @contextmenu="openContextMenu($event, txn)"
              >
                <TableCell class="text-[13px] text-text-secondary whitespace-nowrap">
                  {{ formatDate(txn.date) }}
                </TableCell>
                <TableCell class="max-w-xs truncate">
                  <span class="flex items-center gap-1.5">
                    <AlertCircle v-if="txn.needsReview" class="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
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
                    @update:model-value="(val) => { editingCategoryFor = null; updateCategory(txn, val === '__none__' || val == null ? null : String(val)); }"
                  >
                    <SelectTrigger class="h-7 text-[11px] w-36 border-0 bg-transparent hover:bg-bg-tertiary px-1" :class="updatingCategoryFor === txn.id ? 'opacity-50' : ''">
                      <SelectValue>
                        <Badge
                          v-if="txn.category"
                          variant="secondary"
                          class="text-[11px]"
                          :style="getCategoryStyle(categoryMap.get(txn.category)?.color)"
                        >
                          {{ categoryMap.get(txn.category)?.label ?? txn.category }}
                        </Badge>
                        <span v-else class="text-text-secondary">—</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent @close-auto-focus="editingCategoryFor = null">
                      <SelectItem value="__none__">
                        <span class="text-text-secondary">None</span>
                      </SelectItem>
                      <SelectItem
                        v-for="cat in availableCategories"
                        :key="cat.name"
                        :value="cat.name"
                      >
                        <div class="flex items-center gap-2">
                          <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: cat.color ?? DEFAULT_CATEGORY_COLOR }" />
                          {{ cat.label }}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <!-- Lightweight clickable display for all other rows -->
                  <button
                    v-else
                    class="h-7 text-[11px] w-36 flex items-center px-1 rounded-md hover:bg-bg-tertiary transition-colors"
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
                    <span v-else class="text-text-secondary">—</span>
                  </button>
                </TableCell>
                <TableCell>
                  <Badge
                    :variant="txn.status === 'completed' ? 'default' : 'secondary'"
                    class="text-[11px]"
                    :class="txn.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : ''"
                  >
                    {{ txn.status }}
                  </Badge>
                </TableCell>
                <TableCell class="text-[13px] text-text-secondary">{{ accountMap.get(txn.accountId) ?? txn.accountId }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div class="flex items-center justify-between flex-shrink-0 pt-4">
      <p class="text-[13px] text-text-secondary">
        Page {{ currentPage() }} of {{ totalPages() || 1 }}
        &nbsp;·&nbsp;
        {{ (filters.offset ?? 0) + 1 }}–{{ Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total) }}
        of {{ total }}
      </p>
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="(filters.offset ?? 0) === 0"
          @click="prevPage"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="(filters.offset ?? 0) + (filters.limit ?? 50) >= total"
          @click="nextPage"
        >
          Next
        </Button>
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 min-w-[140px] border bg-bg-primary text-text-primary border-separator shadow-[0_4px_16px_rgba(0,0,0,0.12)] rounded-xl py-1"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button
          class="w-full px-3 py-1.5 text-[13px] text-left hover:bg-bg-tertiary hover:text-text-primary transition-colors"
          @click="toggleIgnore"
        >
          {{ contextMenu.txn.ignored ? 'Unignore transaction' : 'Ignore transaction' }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
