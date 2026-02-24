<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getTransactions, getAccounts, type Transaction, type TransactionFilters } from '../api/client';

const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const accounts = ref<Array<{ id: number; displayName: string }>>([]);

const filters = ref<TransactionFilters>({
  offset: 0,
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
});
const search = ref('');
const selectedAccount = ref<number | undefined>();
const startDate = ref('');
const endDate = ref('');
const selectedCategory = ref('');

async function fetchTransactions() {
  loading.value = true;
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      category: selectedCategory.value || undefined,
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

onMounted(async () => {
  const accountData = await getAccounts();
  accounts.value = accountData.accounts;
  fetchTransactions();
});
</script>

<template>
  <div class="transactions-page">
    <h1>Transactions</h1>

    <div class="filters">
      <input v-model="search" placeholder="Search description..." @keyup.enter="applyFilters" />
      <select v-model="selectedAccount" @change="applyFilters">
        <option :value="undefined">All Accounts</option>
        <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.displayName }}</option>
      </select>
      <input v-model="startDate" type="date" @change="applyFilters" />
      <input v-model="endDate" type="date" @change="applyFilters" />
      <input v-model="selectedCategory" placeholder="Category" @keyup.enter="applyFilters" />
      <button @click="applyFilters">Filter</button>
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th @click="sort('date')" class="sortable">
              Date {{ filters.sortBy === 'date' ? (filters.sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th>Description</th>
            <th @click="sort('chargedAmount')" class="sortable">
              Amount {{ filters.sortBy === 'chargedAmount' ? (filters.sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th>Category</th>
            <th>Status</th>
            <th>Account</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6">Loading...</td>
          </tr>
          <tr v-else-if="transactions.length === 0">
            <td colspan="6">No transactions found</td>
          </tr>
          <tr v-for="txn in transactions" :key="txn.id">
            <td>{{ formatDate(txn.date) }}</td>
            <td>{{ txn.description }}</td>
            <td :class="txn.chargedAmount >= 0 ? 'positive' : 'negative'">
              {{ formatCurrency(txn.chargedAmount) }}
            </td>
            <td>{{ txn.category ?? '—' }}</td>
            <td><span :class="'status-' + txn.status">{{ txn.status }}</span></td>
            <td>{{ txn.accountId }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button @click="prevPage" :disabled="(filters.offset ?? 0) === 0">Previous</button>
      <span>{{ (filters.offset ?? 0) + 1 }}–{{ Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total) }} of {{ total }}</span>
      <button @click="nextPage" :disabled="(filters.offset ?? 0) + (filters.limit ?? 50) >= total">Next</button>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.filters input, .filters select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.filters button {
  padding: 0.5rem 1rem;
  background: #36A2EB;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.table-wrapper { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}
th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
th { background: #f8f9fa; font-weight: 600; }
th.sortable { cursor: pointer; }
th.sortable:hover { background: #e9ecef; }
.positive { color: #27ae60; }
.negative { color: #e74c3c; }
.status-completed { color: #27ae60; }
.status-pending { color: #f39c12; }
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
}
.pagination button {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
}
.pagination button:disabled { opacity: 0.5; cursor: default; }
</style>
