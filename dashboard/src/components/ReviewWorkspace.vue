<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, X, ChevronRight } from 'lucide-vue-next';
import {
  getCategories,
  getMembers,
  getTransactions,
  ignoreTransaction,
  resolveTransaction,
  updateTransactionOwner,
  type Category,
  type Member,
  type OwnerType,
  type Transaction,
} from '@/api/client';
import { formatAmount } from '@/lib/format';
import { language, t } from '@/lib/language';
import { useReviewCount } from '@/composables/useReviewCount';

const items = ref<Transaction[]>([]);
const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const total = ref(0);
const offset = ref(0);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const selectedId = ref<number | null>(null);
const draftCategory = ref('');
const draftOwner = ref('unassigned');
const draftIncluded = ref(true);
const { reviewCount } = useReviewCount();
const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);
const categoryMap = computed(
  () => new Map(categories.value.map((item) => [item.name, item.label])),
);
const copy = computed(() =>
  language.value === 'he'
    ? {
        title: 'ממתינות לבדיקה',
        reason: 'למה צריך לבדוק',
        category: 'קטגוריה',
        owner: 'שיוך',
        include: 'לכלול בנתונים',
        confirm: 'אישור ומעבר לבאה',
        allClear: 'הכל נבדק',
        empty: 'אין עסקאות שממתינות לבדיקה.',
        advanced: 'טבלה מלאה',
        page: 'עמוד',
        of: 'מתוך',
      }
    : {
        title: 'To review',
        reason: 'Why this needs review',
        category: 'Category',
        owner: 'Owner',
        include: 'Include in reports',
        confirm: 'Confirm and next',
        allClear: 'All caught up',
        empty: 'No transactions need review.',
        advanced: 'Full table',
        page: 'Page',
        of: 'of',
      },
);
function select(item: Transaction) {
  selectedId.value = item.id;
  draftCategory.value = item.category ?? '';
  draftOwner.value =
    item.expenseOwnerType === 'member'
      ? `member:${item.expenseOwnerMemberId}`
      : item.expenseOwnerType;
  draftIncluded.value = !item.ignored;
}
function amount(item: Transaction) {
  return `${item.chargedAmount < 0 ? '−' : '+'}${formatAmount(item.chargedAmount, item.chargedCurrency)}`;
}
function date(item: Transaction) {
  return new Date(`${item.reportingDate.slice(0, 10)}T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en-GB',
  );
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await getTransactions({
      needsReview: true,
      limit: 50,
      offset: offset.value,
      sortBy: 'date',
      sortOrder: 'desc',
    });
    items.value = result.transactions;
    total.value = result.pagination.total;
    reviewCount.value = total.value;
    if (!items.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = null;
      if (window.innerWidth > 1120 && items.value[0]) select(items.value[0]);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    loading.value = false;
  }
}
async function confirm() {
  const item = selected.value;
  if (!item || !draftCategory.value) return;
  saving.value = true;
  error.value = '';
  try {
    const ownerType: OwnerType = draftOwner.value.startsWith('member:')
      ? 'member'
      : (draftOwner.value as OwnerType);
    const ownerMemberId = ownerType === 'member' ? Number(draftOwner.value.slice(7)) : null;
    let updated = (await resolveTransaction(item.id, draftCategory.value)).transaction;
    if (ownerType !== updated.expenseOwnerType || ownerMemberId !== updated.expenseOwnerMemberId) {
      updated = (await updateTransactionOwner(item.id, { ownerType, ownerMemberId })).transaction;
    }
    if (updated.ignored === draftIncluded.value)
      await ignoreTransaction(item.id, !draftIncluded.value);
    selectedId.value = null;
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    saving.value = false;
  }
}
async function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * 50);
  selectedId.value = null;
  await load();
}
onMounted(async () => {
  const [categoryResult, memberResult] = await Promise.allSettled([getCategories(), getMembers()]);
  if (categoryResult.status === 'fulfilled') categories.value = categoryResult.value.categories;
  if (memberResult.status === 'fulfilled')
    members.value = memberResult.value.members.filter((item) => item.isActive);
  await load();
});
</script>

<template>
  <div class="review-page">
    <div class="review-toolbar">
      <p>
        <strong>{{ total }}</strong> {{ copy.title }}
      </p>
      <RouterLink to="/insights/advanced">{{ copy.advanced }}</RouterLink>
    </div>
    <p v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </p>
    <div class="review-workspace">
      <div class="review-list">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ t('date') }}</th>
              <th scope="col">{{ t('description') }}</th>
              <th scope="col">{{ t('category') }}</th>
              <th scope="col">{{ t('amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in items"
              :key="item.id"
              :class="{ selected: selectedId === item.id }"
              tabindex="0"
              :aria-selected="selectedId === item.id"
              @click="select(item)"
              @keydown.enter.self="select(item)"
              @keydown.space.self.prevent="select(item)"
            >
              <td>
                <bdi dir="ltr">{{ date(item) }}</bdi>
              </td>
              <td>
                <button
                  type="button"
                  class="review-row-open"
                  :title="item.description"
                  @click.stop="select(item)"
                >
                  <bdi dir="auto">{{ item.description }}</bdi>
                  <ChevronRight :size="14" aria-hidden="true" />
                </button>
              </td>
              <td>
                <bdi dir="auto">{{
                  categoryMap.get(item.category ?? '') ?? item.category ?? t('uncategorized')
                }}</bdi>
              </td>
              <td class="review-amount" :class="item.chargedAmount >= 0 ? 'positive' : 'negative'">
                <bdi dir="ltr">{{ amount(item) }}</bdi>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loading && !items.length" class="review-empty">
          <Check :size="26" /><strong>{{ copy.allClear }}</strong
          ><span>{{ copy.empty }}</span>
        </div>
        <p v-if="loading && !items.length" class="review-empty">{{ t('loadingTransactions') }}</p>
        <div v-if="total > 50" class="review-pagination">
          <span
            >{{ copy.page }} {{ Math.floor(offset / 50) + 1 }} {{ copy.of }}
            {{ Math.ceil(total / 50) }}</span
          >
          <div>
            <button :disabled="offset === 0" @click="page(-1)">{{ t('previous') }}</button
            ><button :disabled="offset + 50 >= total" @click="page(1)">{{ t('next') }}</button>
          </div>
        </div>
      </div>
      <Transition name="detail-backdrop">
        <button
          v-if="selected"
          type="button"
          class="review-backdrop"
          :aria-label="t('cancel')"
          @click="selectedId = null"
        />
      </Transition>
      <Transition name="detail-panel">
        <aside v-if="selected" class="review-inspector" :aria-label="t('details')">
          <div class="review-inspector-head">
            <h3>{{ t('details') }}</h3>
            <button type="button" :aria-label="t('cancel')" @click="selectedId = null">
              <X :size="18" />
            </button>
          </div>
          <div class="review-inspector-body">
            <h4 dir="auto">{{ selected.description }}</h4>
            <p class="review-detail-date">
              <bdi dir="ltr">{{ date(selected) }}</bdi>
            </p>
            <strong
              class="review-detail-amount"
              :class="selected.chargedAmount >= 0 ? 'positive' : 'negative'"
              ><bdi dir="ltr">{{ amount(selected) }}</bdi></strong
            >
            <div class="review-reason">
              <span>{{ copy.reason }}</span>
              <p>{{ selected.reviewReason ?? t('needsReview') }}</p>
              <small v-if="selected.confidence != null"
                >{{ Math.round(selected.confidence * 100) }}%</small
              >
            </div>
            <label
              ><span>{{ copy.category }}</span
              ><select v-model="draftCategory">
                <option value="">{{ t('uncategorized') }}</option>
                <option v-for="category in categories" :key="category.name" :value="category.name">
                  {{ category.label }}
                </option>
              </select></label
            >
            <label
              ><span>{{ copy.owner }}</span
              ><select v-model="draftOwner">
                <option value="shared">{{ t('together') }}</option>
                <option value="unassigned">{{ t('unassigned') }}</option>
                <option v-for="member in members" :key="member.id" :value="`member:${member.id}`">
                  {{ member.name }}
                </option>
              </select></label
            >
            <label class="review-check"
              ><input v-model="draftIncluded" type="checkbox" />{{ copy.include }}</label
            >
          </div>
          <div class="review-inspector-footer">
            <button type="button" :disabled="saving || !draftCategory" @click="confirm">
              {{ copy.confirm }}
            </button>
          </div>
        </aside>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.review-page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 165px);
  min-width: 0;
}
.review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding-inline: 16px;
  flex-wrap: wrap;
  gap: 12px;
  border-bottom: 1px solid var(--separator);
}
.review-toolbar p {
  margin: 0;
  color: var(--text-secondary);
}
.review-toolbar strong {
  color: var(--text-primary);
}
.review-toolbar a {
  color: var(--accent);
  font-size: 12px;
  font-weight: 650;
  text-decoration: none;
}
.review-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
  gap: 24px;
  align-items: flex-start;
}
.review-list {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  table-layout: fixed;
}
th,
td {
  padding: 16px;
  text-align: start;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 42px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--separator);
  font-size: 12px;
}
th:first-child {
  width: 17%;
}
th:nth-child(2) {
  width: 39%;
}
th:nth-child(3) {
  width: 24%;
}
th:last-child {
  width: 20%;
  text-align: end;
}
td {
  height: 62px;
  border-bottom: 1px solid var(--separator);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.review-row-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  text-align: start;
  color: inherit;
  font-weight: inherit;
}
.review-row-open bdi {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-row-open svg {
  flex: none;
  color: var(--text-tertiary);
}
:global([dir='rtl'] .review-row-open svg) {
  transform: rotate(180deg);
}
td:nth-child(2) {
  color: var(--text-primary);
  font-weight: 620;
}
tbody tr {
  cursor: pointer;
}
tbody tr.selected {
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-primary));
}
tbody tr:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.review-amount {
  text-align: end !important;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.negative {
  color: var(--destructive) !important;
}
.positive {
  color: var(--success) !important;
}
.review-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 260px;
  color: var(--text-secondary);
}
.review-empty strong {
  color: var(--text-primary);
  font-size: 17px;
  overflow-wrap: anywhere;
}
.review-pagination {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 14px 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.review-pagination button {
  margin-inline-start: 8px;
  color: var(--accent);
  font-weight: 650;
}
.review-pagination button:disabled {
  opacity: 0.4;
}
.review-inspector {
  display: flex;
  position: sticky;
  top: 20px;
  flex: 0 0 320px;
  min-width: 0;
  flex-direction: column;
  padding: 20px 24px 24px;
  border-inline-start: 1px solid color-mix(in srgb, var(--separator) 65%, transparent);
  background: var(--bg-primary);
}
.review-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  flex-shrink: 0;
  margin-bottom: 24px;
}
.review-inspector-head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.review-inspector-head button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--text-secondary);
}
.review-inspector-body {
  min-height: 0;
  overflow: auto;
}
.review-detail-amount {
  display: block;
  margin-block: 22px 24px;
  font-size: 28px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.review-inspector-body h4 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.review-detail-date {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.review-reason {
  margin-bottom: 24px;
}
.review-reason span,
.review-inspector-body label > span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}
.review-reason p {
  margin: 8px 0;
  font-size: 14px;
  line-height: 1.6;
}
.review-reason small {
  color: var(--text-tertiary);
}
.review-inspector-body label:not(.review-check) {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding-block: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 65%, transparent);
}
.review-inspector-body select {
  width: 100%;
  min-height: 36px;
  min-width: 0;
  padding-inline: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  text-align: end;
}
.review-check {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.review-check input {
  accent-color: var(--accent);
}
.review-inspector-footer {
  padding-top: 24px;
  flex-shrink: 0;
}
.review-inspector-footer button {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--primary-foreground);
  font-weight: 700;
}
.review-inspector-footer button:disabled {
  opacity: 0.5;
}
.review-backdrop {
  display: none;
}
.review-inspector-head button:hover {
  background: var(--bg-secondary);
}
@media (max-width: 1120px) {
  .review-inspector-body {
    flex: 1;
  }
  .review-inspector-footer button {
    width: 100%;
  }
  .review-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 5;
    background: #12223d2b;
  }
  .review-inspector {
    position: fixed;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 6;
    width: min(360px, 100vw);
    padding: 20px 24px;
    border: 0;
    box-shadow: 0 8px 36px #162b4833;
  }
}
</style>
