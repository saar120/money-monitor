<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { Doughnut, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, Title
} from 'chart.js';
import { getSummary } from '../api/client';
import { useApi } from '../composables/useApi';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

const now = new Date();
const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

const categorySummary = useApi(() => getSummary({ groupBy: 'category', startDate: thisMonthStart }));
const monthlySummary = useApi(() => getSummary({ groupBy: 'month' }));
const accountSummary = useApi(() => getSummary({ groupBy: 'account', startDate: thisMonthStart }));
const lastMonthSummary = useApi(() => getSummary({ groupBy: 'category', startDate: lastMonthStart, endDate: lastMonthEnd }));

onMounted(() => {
  categorySummary.execute();
  monthlySummary.execute();
  accountSummary.execute();
  lastMonthSummary.execute();
});

const thisMonthTotal = computed(() =>
  categorySummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);
const lastMonthTotal = computed(() =>
  lastMonthSummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);

const categoryChartData = computed(() => {
  const items = categorySummary.data.value?.summary ?? [];
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                  '#FF9F40', '#C9CBCF', '#7BC8A4', '#E7E9ED', '#F7464A',
                  '#46BFBD', '#FDB45C'];
  return {
    labels: items.map(s => s.category ?? 'uncategorized'),
    datasets: [{
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: colors.slice(0, items.length),
    }],
  };
});

const monthlyChartData = computed(() => {
  const items = (monthlySummary.data.value?.summary ?? []).slice(0, 12).reverse();
  return {
    labels: items.map(s => s.month ?? ''),
    datasets: [{
      label: 'Monthly Spending (ILS)',
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: '#36A2EB',
    }],
  };
});

function formatCurrency(amount: number): string {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
}
</script>

<template>
  <div class="overview">
    <h1>Overview</h1>

    <div class="summary-cards">
      <div class="card">
        <h3>This Month</h3>
        <p class="amount">{{ formatCurrency(thisMonthTotal) }}</p>
      </div>
      <div class="card">
        <h3>Last Month</h3>
        <p class="amount">{{ formatCurrency(lastMonthTotal) }}</p>
      </div>
      <div class="card">
        <h3>Difference</h3>
        <p class="amount" :class="thisMonthTotal > lastMonthTotal ? 'negative' : 'positive'">
          {{ formatCurrency(thisMonthTotal - lastMonthTotal) }}
        </p>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-container">
        <h3>Spending by Category</h3>
        <Doughnut v-if="categorySummary.data.value" :data="categoryChartData" />
        <p v-else-if="categorySummary.loading.value">Loading...</p>
        <p v-else>No data yet</p>
      </div>
      <div class="chart-container">
        <h3>Monthly Trend</h3>
        <Bar v-if="monthlySummary.data.value" :data="monthlyChartData" />
        <p v-else-if="monthlySummary.loading.value">Loading...</p>
        <p v-else>No data yet</p>
      </div>
    </div>

    <div class="account-summary" v-if="accountSummary.data.value">
      <h3>Per Account (This Month)</h3>
      <div class="account-cards">
        <div class="card" v-for="acc in accountSummary.data.value.summary" :key="acc.accountId">
          <h4>{{ acc.displayName }}</h4>
          <p>{{ formatCurrency(acc.totalAmount) }}</p>
          <small>{{ acc.transactionCount }} transactions</small>
        </div>
        <p v-if="accountSummary.data.value.summary.length === 0">No account data yet</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview h1 { margin-bottom: 1.5rem; }
.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}
.card {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.amount { font-size: 1.5rem; font-weight: bold; margin: 0.5rem 0; }
.positive { color: #27ae60; }
.negative { color: #e74c3c; }
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}
.chart-container {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.account-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
</style>
