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
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next';

const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const allAccounts = ref<Account[]>([]);
const accountTypeFilter = ref<string>('');

const filteredAccounts = computed(() => {
  if (!accountTypeFilter.value) return allAccounts.value;
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
const updatingCategoryFor = ref<number | null>(null);

// Context menu state
const contextMenu = ref<{ x: number; y: number; txn: Transaction } | null>(null);

async function fetchTransactions() {
  loading.value = true;
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value !== 'all' ? Number(selectedAccount.value) : undefined,
      accountType: accountTypeFilter.value ? accountTypeFilter.value as 'bank' | 'credit_card' : undefined,
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
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

onMounted(async () => {
  const [accountData, catData] = await Promise.all([getAccounts(), getCategories()]);
  allAccounts.value = accountData.accounts;
  availableCategories.value = catData.categories;
  fetchTransactions();
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold tracking-tight">Transactions</h1>

    <!-- Filters -->
    <Card>
      <CardContent class="pt-4">
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
              <SelectItem value="">All Types</SelectItem>
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
      </CardContent>
    </Card>

    <!-- Table -->
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-base">
          {{ total }} transaction{{ total !== 1 ? 's' : '' }}
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
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
              <TableRow v-if="loading">
                <TableCell colspan="6" class="py-8">
                  <div class="space-y-2">
                    <Skeleton v-for="i in 5" :key="i" class="h-8 w-full" />
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-else-if="transactions.length === 0">
                <TableCell colspan="6" class="text-center text-muted-foreground py-12">
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
                <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
                  {{ formatDate(txn.date) }}
                </TableCell>
                <TableCell class="max-w-xs truncate">{{ txn.description }}</TableCell>
                <TableCell
                  class="text-right font-medium tabular-nums"
                  :class="txn.chargedAmount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'"
                >
                  {{ formatCurrency(txn.chargedAmount) }}
                </TableCell>
                <TableCell @click.stop>
                  <Select
                    :model-value="txn.category ?? ''"
                    :disabled="updatingCategoryFor === txn.id"
                    @update:model-value="(val) => updateCategory(txn, val === '__none__' || val == null ? null : String(val))"
                  >
                    <SelectTrigger class="h-7 text-xs w-36 border-0 bg-transparent hover:bg-accent px-1" :class="updatingCategoryFor === txn.id ? 'opacity-50' : ''">
                      <SelectValue>
                        <Badge
                          v-if="txn.category"
                          variant="secondary"
                          class="text-xs"
                          :style="{ backgroundColor: (availableCategories.find(c => c.name === txn.category)?.color ?? '#94a3b8') + '33', color: availableCategories.find(c => c.name === txn.category)?.color ?? undefined }"
                        >
                          {{ availableCategories.find(c => c.name === txn.category)?.label ?? txn.category }}
                        </Badge>
                        <span v-else class="text-muted-foreground">—</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span class="text-muted-foreground">None</span>
                      </SelectItem>
                      <SelectItem
                        v-for="cat in availableCategories"
                        :key="cat.name"
                        :value="cat.name"
                      >
                        <div class="flex items-center gap-2">
                          <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: cat.color ?? '#94a3b8' }" />
                          {{ cat.label }}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge
                    :variant="txn.status === 'completed' ? 'default' : 'secondary'"
                    class="text-xs"
                    :class="txn.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''"
                  >
                    {{ txn.status }}
                  </Badge>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ txn.accountId }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
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
        class="fixed z-50 min-w-[140px] rounded-md border bg-popover text-popover-foreground shadow-md py-1"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
          @click="toggleIgnore"
        >
          {{ contextMenu.txn.ignored ? 'Unignore transaction' : 'Ignore transaction' }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
