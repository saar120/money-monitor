<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  getRecurringPaymentDetail,
  getRecurringPayments,
  saveRecurringPaymentDecision,
  type RecurringPayment,
  type RecurringPaymentDetail,
  type RecurringPayments,
} from '../api/client';
import { formatAmount } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const result = ref<RecurringPayments | null>(null);
const loading = ref(true);
const error = ref('');
const saving = ref('');
const detailOpen = ref(false);
const detail = ref<RecurringPaymentDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref(false);
const matchedCharges = computed(
  () => detail.value?.transactions.filter((row) => row.inPattern) ?? [],
);
const otherCharges = computed(
  () => detail.value?.transactions.filter((row) => !row.inPattern) ?? [],
);
let detailRequest = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let requestVersion = 0;
let disposed = false;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!result.value?.classificationPending || disposed) return;
  refreshTimer = setTimeout(async () => {
    const version = requestVersion;
    try {
      const refreshed = await getRecurringPayments();
      if (disposed || version !== requestVersion) return;
      result.value = refreshed;
      scheduleRefresh();
    } catch {
      // Review remains usable while the Mac is unavailable.
    }
  }, 5_000);
}

async function load() {
  const version = ++requestVersion;
  clearTimeout(refreshTimer);
  loading.value = true;
  error.value = '';
  try {
    const loaded = await getRecurringPayments();
    if (disposed || version !== requestVersion) return;
    result.value = loaded;
    scheduleRefresh();
  } catch {
    if (!disposed && version === requestVersion)
      error.value = 'Recurring payments could not be loaded.';
  } finally {
    if (!disposed && version === requestVersion) loading.value = false;
  }
}

async function decide(payment: RecurringPayment, decision: 'include' | 'exclude' | 'auto') {
  const version = ++requestVersion;
  clearTimeout(refreshTimer);
  saving.value = `${payment.accountId}:${payment.currencyCode}:${payment.merchantKey}`;
  error.value = '';
  try {
    const saved = await saveRecurringPaymentDecision(payment, decision);
    if (disposed || version !== requestVersion) return;
    result.value = saved;
    scheduleRefresh();
  } catch {
    if (!disposed && version === requestVersion)
      error.value = 'Could not save your choice. Try again.';
  } finally {
    if (!disposed && version === requestVersion) saving.value = '';
  }
}

async function openDetail(payment: RecurringPayment) {
  const request = ++detailRequest;
  detailOpen.value = true;
  detail.value = null;
  detailLoading.value = true;
  detailError.value = false;
  try {
    const loaded = await getRecurringPaymentDetail(payment);
    if (request === detailRequest && detailOpen.value) detail.value = loaded;
  } catch {
    if (request === detailRequest && detailOpen.value) detailError.value = true;
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function frequencyLabel(value: string) {
  if (value === 'everyTwoMonths') return 'Every 2 months';
  return 'Monthly';
}

onMounted(load);
onUnmounted(() => {
  disposed = true;
  requestVersion++;
  clearTimeout(refreshTimer);
  detailRequest++;
});
</script>

<template>
  <section class="w-full max-w-5xl mx-auto space-y-7" aria-label="Subscriptions and services">
    <header>
      <h1 class="text-[24px] font-semibold tracking-tight text-text-primary">
        Subscriptions & services
      </h1>
      <p class="mt-1 text-[13px] text-text-secondary">
        Repeating charges for subscriptions and service bills. Check uncertain matches below.
      </p>
    </header>

    <div v-if="loading" class="space-y-3" aria-label="Loading recurring payments">
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-60 w-full" />
    </div>
    <div v-else-if="error && !result" class="rounded-xl border border-separator p-6 text-center">
      <p class="text-sm text-text-secondary">{{ error }}</p>
      <Button class="mt-4" variant="secondary" @click="load">Try again</Button>
    </div>
    <template v-else-if="result">
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <div v-if="result.totals.length" class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="total in result.totals"
          :key="total.currencyCode"
          class="rounded-xl border border-separator/60 bg-bg-secondary px-5 py-4"
        >
          <p class="text-[12px] text-text-secondary">
            Estimated monthly · {{ total.currencyCode }}
          </p>
          <p class="mt-1 text-[28px] font-semibold tabular-nums text-text-primary">
            {{ formatAmount(total.monthlyCost, total.currencyCode) }}
          </p>
          <p class="mt-1 text-[12px] text-text-secondary">
            {{ formatAmount(total.annualCost, total.currencyCode) }} a year
          </p>
        </div>
      </div>

      <div
        v-if="!result.payments.length && !result.suggestions.length"
        class="rounded-xl border border-separator/60 px-6 py-12 text-center"
      >
        <p class="font-medium text-text-primary">No subscriptions or services found yet</p>
        <p class="mt-1 text-sm text-text-secondary">
          Confirm a suggestion below or wait for more matching charges.
        </p>
      </div>
      <div
        v-else-if="result.payments.length"
        class="overflow-x-auto rounded-xl border border-separator/60 bg-bg-primary"
      >
        <table class="w-full text-left text-[13px]">
          <thead class="bg-bg-secondary text-[12px] text-text-secondary">
            <tr>
              <th scope="col" class="px-5 py-3 font-medium">Payment</th>
              <th scope="col" class="px-4 py-3 font-medium">Pattern</th>
              <th scope="col" class="px-4 py-3 font-medium text-right">Usual charge</th>
              <th scope="col" class="px-4 py-3 font-medium">Last charged</th>
              <th scope="col" class="px-5 py-3 font-medium">Next expected</th>
              <th scope="col" class="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(payment, index) in result.payments"
              :key="`${payment.accountName}-${payment.name}-${index}`"
              class="border-t border-separator/60"
            >
              <td class="px-5 py-3.5">
                <button
                  type="button"
                  class="font-medium text-text-primary hover:text-accent text-left"
                  dir="auto"
                  @click="openDetail(payment)"
                >
                  {{ payment.name }}
                </button>
                <p class="mt-0.5 text-[12px] text-text-secondary" dir="auto">
                  {{ payment.accountName }}
                </p>
              </td>
              <td class="px-4 py-3.5 text-text-secondary">
                <span>{{ frequencyLabel(payment.frequency) }}</span>
                <span class="ml-2 text-[11px]">{{ payment.occurrences }} charges</span>
              </td>
              <td class="px-4 py-3.5 text-right tabular-nums font-medium text-text-primary">
                {{ formatAmount(payment.usualAmount, payment.currencyCode) }}
              </td>
              <td class="px-4 py-3.5 whitespace-nowrap text-text-secondary">
                {{ shortDate(payment.lastChargeDate) }}
              </td>
              <td class="px-5 py-3.5 whitespace-nowrap text-text-secondary">
                Around {{ shortDate(payment.nextExpectedDate) }}
              </td>
              <td class="px-5 py-3.5">
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="!!saving"
                  @click="decide(payment, 'exclude')"
                  >Exclude</Button
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="result.suggestions.length" aria-label="Review recurring payments">
        <h2 class="mb-2 text-lg font-semibold text-text-primary">Review recurring payments</h2>
        <p class="mb-3 text-sm text-text-secondary">
          These repeat, but may be ordinary purchases. They are not in your estimate.
        </p>
        <div
          class="divide-y divide-separator/60 rounded-xl border border-separator/60 bg-bg-primary"
        >
          <div
            v-for="payment in result.suggestions"
            :key="`${payment.accountId}:${payment.currencyCode}:${payment.merchantKey}`"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          >
            <div>
              <button
                type="button"
                class="font-medium text-text-primary hover:text-accent text-left"
                dir="auto"
                @click="openDetail(payment)"
              >
                {{ payment.name }}
              </button>
              <p class="text-xs text-text-secondary">
                {{ payment.accountName }} · {{ frequencyLabel(payment.frequency) }} ·
                {{ payment.occurrences }} charges ·
                {{ formatAmount(payment.usualAmount, payment.currencyCode) }}
              </p>
            </div>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                :disabled="!!saving"
                @click="decide(payment, 'exclude')"
                >Not recurring</Button
              >
              <Button size="sm" :disabled="!!saving" @click="decide(payment, 'include')"
                >Include</Button
              >
            </div>
          </div>
        </div>
      </section>
      <section v-if="result.excluded.length" aria-label="Excluded recurring payments">
        <h2 class="mb-2 text-sm font-medium text-text-secondary">Excluded</h2>
        <div
          class="divide-y divide-separator/60 rounded-xl border border-separator/60 bg-bg-primary"
        >
          <div
            v-for="payment in result.excluded"
            :key="`${payment.accountId}:${payment.currencyCode}:${payment.merchantKey}`"
            class="flex items-center justify-between gap-3 px-5 py-2"
          >
            <button
              type="button"
              class="text-sm text-text-secondary hover:text-accent text-left"
              dir="auto"
              @click="openDetail(payment)"
            >
              {{ payment.name }}
            </button>
            <Button size="sm" variant="ghost" :disabled="!!saving" @click="decide(payment, 'auto')"
              >Undo</Button
            >
          </div>
        </div>
      </section>
    </template>
    <Dialog v-model:open="detailOpen">
      <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle dir="auto">{{ detail?.payment.name ?? 'Payment details' }}</DialogTitle>
        </DialogHeader>
        <Skeleton v-if="detailLoading" class="h-40 w-full" />
        <p v-else-if="detailError" role="alert" class="text-sm text-destructive">
          Payment details could not be loaded.
        </p>
        <template v-else-if="detail">
          <p class="text-sm text-text-secondary" dir="auto">
            {{ detail.payment.accountName }} · {{ frequencyLabel(detail.payment.frequency) }}
          </p>
          <div class="grid grid-cols-2 gap-3 rounded-xl bg-bg-secondary p-4">
            <div>
              <p class="text-xs text-text-secondary">Usual charge</p>
              <p class="text-lg font-semibold tabular-nums text-text-primary">
                {{ formatAmount(detail.payment.usualAmount, detail.payment.currencyCode) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Estimated per year</p>
              <p class="text-lg font-semibold tabular-nums text-text-primary">
                {{ formatAmount(detail.payment.annualCost, detail.payment.currencyCode) }}
              </p>
            </div>
          </div>
          <p v-if="detail.previousAmount !== null" class="text-sm text-text-secondary">
            Recent charge changed from
            {{ formatAmount(detail.previousAmount, detail.payment.currencyCode) }} to
            {{ formatAmount(detail.payment.usualAmount, detail.payment.currencyCode) }} on
            {{ shortDate(detail.changedOnDate!) }}. The estimate uses the newer amount.
          </p>
          <p class="text-xs text-text-secondary">
            Next expected around {{ shortDate(detail.payment.nextExpectedDate) }} · An estimate, not
            a billing schedule.
          </p>
          <section>
            <h3 class="mb-2 text-sm font-semibold text-text-primary">Charges in this pattern</h3>
            <div class="divide-y divide-separator/60 rounded-xl border border-separator/60">
              <div
                v-for="row in matchedCharges"
                :key="row.id"
                class="flex justify-between gap-4 px-4 py-3 text-sm"
              >
                <div>
                  <p class="text-text-primary" dir="auto">{{ row.description }}</p>
                  <p class="text-xs text-text-secondary">{{ shortDate(row.date) }}</p>
                </div>
                <span class="tabular-nums text-text-primary whitespace-nowrap">{{
                  formatAmount(row.amount, detail.payment.currencyCode)
                }}</span>
              </div>
            </div>
          </section>
          <details v-if="otherCharges.length" class="text-sm">
            <summary class="cursor-pointer font-medium text-text-secondary">
              Other charges from this merchant ({{ otherCharges.length }})
            </summary>
            <div class="mt-2 divide-y divide-separator/60 rounded-xl border border-separator/60">
              <div
                v-for="row in otherCharges"
                :key="row.id"
                class="flex justify-between gap-4 px-4 py-3"
              >
                <div>
                  <p class="text-text-primary" dir="auto">{{ row.description }}</p>
                  <p class="text-xs text-text-secondary">{{ shortDate(row.date) }}</p>
                </div>
                <span class="tabular-nums text-text-primary whitespace-nowrap">{{
                  formatAmount(row.amount, detail.payment.currencyCode)
                }}</span>
              </div>
            </div>
          </details>
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
