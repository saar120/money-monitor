<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import SelectField from '@/components/ui/select/SelectField.vue';
import MerchantMark from './MerchantMark.vue';
import {
  getAccounts,
  getCategories,
  getMembers,
  getTransactions,
  getTransaction,
  reviewTransaction,
  undoTransactionReview,
  type Account,
  type Category,
  type Member,
  type OwnerType,
  type Transaction,
} from '@/api/client';
import {
  reviewState,
  type ReviewUndo,
  type TransactionReviewState,
} from '@shared/transaction-review';
import { formatAmount } from '@/lib/format';
import { normalizeMerchant } from '@/lib/merchant';
import { language, t } from '@/lib/language';
import { useReviewCount } from '@/composables/useReviewCount';

const route = useRoute();
const requestedId = ref(
  typeof route.query.transactionId === 'string' && /^[1-9]\d*$/.test(route.query.transactionId)
    ? Number(route.query.transactionId)
    : null,
);
const linked = ref<Transaction | null>(null);
const items = ref<Transaction[]>([]),
  categories = ref<Category[]>([]),
  members = ref<Member[]>([]),
  accounts = ref<Account[]>([]);
const total = ref(0),
  offset = ref(0),
  reviewed = ref(0),
  loading = ref(true),
  saving = ref(false),
  error = ref(''),
  metadataError = ref('');
const selectedId = ref<number | null>(null),
  draftCategory = ref(''),
  draftOwner = ref('unassigned'),
  draftIncluded = ref(true),
  draftDate = ref('');
const expected = ref<TransactionReviewState | null>(null),
  skipped = ref(new Set<number>());
const undo = ref<{ id: number; offset: number; receipt: ReviewUndo } | null>(null);
const notice = ref('');
const inclusionTouched = ref(false);
const drafts = reactive(
  new Map<
    number,
    {
      category: string;
      owner: string;
      included: boolean;
      date: string;
      inclusionTouched: boolean;
      expected: TransactionReviewState;
    }
  >(),
);
const { reviewCount } = useReviewCount();
const queue = computed(() => items.value.filter((item) => !skipped.value.has(item.id)));
const selected = computed(
  () =>
    items.value.find((item) => item.id === selectedId.value) ??
    (linked.value?.id === selectedId.value ? linked.value : null),
);
const selectedIndex = computed(() => queue.value.findIndex((item) => item.id === selectedId.value));
const accountMap = computed(
  () => new Map(accounts.value.map((item) => [item.id, item.displayName])),
);
let requestId = 0;
const copy = computed(() =>
  language.value === 'he'
    ? {
        reason: 'סיבה לבדיקה',
        confirm: 'אישור ומעבר לבאה',
        allClear: 'הכול נבדק',
        empty: 'אין תנועות שממתינות לבדיקה.',
        of: 'מתוך',
        reviewed: 'נבדקו',
        skipped: 'דולגו',
        skip: 'דילוג',
        reviewSkipped: 'בדיקת התנועות שדולגו',
        skippedEmpty: 'התנועות שנותרו בעמוד הזה דולגו.',
        undo: 'ביטול השינוי',
        saved: 'התנועה נבדקה',
        undone: 'הבדיקה בוטלה',
        original: 'תיאור הבנק',
        suggested: 'הצעה',
        confidence: 'רמת ביטחון בקטגוריה',
        reload: 'רענון',
        transaction: 'תנועה',
        previous: 'התנועה הקודמת',
        next: 'התנועה הבאה',
        page: 'עמוד',
        skipNotice: 'התנועה דולגה למהלך הבדיקה הנוכחי',
      }
    : {
        reason: 'Reason',
        confirm: 'Confirm and next',
        allClear: 'All caught up',
        empty: 'No transactions need review.',
        of: 'of',
        reviewed: 'reviewed',
        skipped: 'skipped',
        skip: 'Skip',
        reviewSkipped: 'Review skipped',
        skippedEmpty: 'The remaining transactions on this page were skipped.',
        undo: 'Undo',
        saved: 'Transaction reviewed',
        undone: 'Review undone',
        original: 'Bank description',
        suggested: 'Suggested',
        confidence: 'Category confidence',
        reload: 'Reload',
        transaction: 'Transaction',
        previous: 'Previous transaction',
        next: 'Next transaction',
        page: 'Page',
        skipNotice: 'Skipped for this session',
      },
);
function stashDraft() {
  if (selected.value && expected.value)
    drafts.set(selected.value.id, {
      category: draftCategory.value,
      owner: draftOwner.value,
      included: draftIncluded.value,
      date: draftDate.value,
      inclusionTouched: inclusionTouched.value,
      expected: expected.value,
    });
}
function select(item: Transaction) {
  if (saving.value) return;
  stashDraft();
  selectedId.value = item.id;
  const draft = drafts.get(item.id);
  draftCategory.value = draft?.category ?? item.category ?? '';
  draftOwner.value =
    draft?.owner ??
    (item.expenseOwnerType === 'member'
      ? `member:${item.expenseOwnerMemberId}`
      : item.expenseOwnerType);
  draftIncluded.value = draft?.included ?? !item.ignored;
  draftDate.value = draft?.date ?? item.effectiveDate ?? '';
  inclusionTouched.value = draft?.inclusionTouched ?? false;
  expected.value = draft?.expected ?? reviewState(item);
}
function close() {
  stashDraft();
  const id = selectedId.value;
  selectedId.value = null;
  document.getElementById(`review-row-${id}`)?.focus({ preventScroll: true });
}
function amount(item: Transaction) {
  return `${item.chargedAmount < 0 ? '−' : item.chargedAmount > 0 ? '+' : ''}${formatAmount(item.chargedAmount, item.chargedCurrency)}`;
}
function date(value: string, compact = false) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en-US',
    { day: 'numeric', month: 'short', year: compact ? '2-digit' : 'numeric' },
  );
}
async function load(nextIndex?: number, discardDrafts = false) {
  const request = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const [result, refreshedLink] = await Promise.all([
      getTransactions({
        needsReview: true,
        limit: 50,
        offset: offset.value,
        sortBy: 'date',
        sortOrder: 'desc',
      }),
      discardDrafts && linked.value ? getTransaction(linked.value.id) : Promise.resolve(null),
    ]);
    if (request !== requestId) return;
    if (offset.value > 0 && offset.value >= result.pagination.total) {
      offset.value = Math.floor(Math.max(0, result.pagination.total - 1) / 50) * 50;
      await load(nextIndex, discardDrafts);
      return;
    }
    const oldId = selectedId.value;
    // Reload explicitly starts from current server values after a rejected decision.
    if (discardDrafts) drafts.clear();
    else stashDraft();
    selectedId.value = null;
    if (refreshedLink)
      linked.value = refreshedLink.transaction.needsReview ? refreshedLink.transaction : null;
    items.value = result.transactions;
    total.value = result.pagination.total;
    reviewCount.value = total.value;
    const next =
      queue.value.find((item) => item.id === requestedId.value) ??
      (linked.value?.id === requestedId.value ? linked.value : null) ??
      queue.value.find((item) => item.id === oldId) ??
      (linked.value?.id === oldId ? linked.value : null) ??
      (nextIndex != null
        ? queue.value[Math.min(nextIndex, queue.value.length - 1)]
        : window.innerWidth > 1120
          ? queue.value[0]
          : undefined);
    requestedId.value = null;
    if (next) select(next);
  } catch (cause) {
    if (request === requestId)
      error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    if (request === requestId) loading.value = false;
  }
}
async function reload() {
  loading.value = true;
  const results = await Promise.allSettled([getCategories(), getMembers(), getAccounts()]);
  metadataError.value = results.some((result) => result.status === 'rejected')
    ? t('couldNotLoad')
    : '';
  if (results[0].status === 'fulfilled') categories.value = results[0].value.categories;
  if (results[1].status === 'fulfilled')
    members.value = results[1].value.members.filter((item) => item.isActive);
  if (results[2].status === 'fulfilled') accounts.value = results[2].value.accounts;
  await load(undefined, true);
}
function chooseCategory(category: string) {
  draftCategory.value = category;
  if (inclusionTouched.value || !selected.value) return;
  const previous = categories.value.find((item) => item.name === selected.value?.category);
  const excludedByHand = selected.value.ignored && !previous?.ignoredFromStats;
  draftIncluded.value =
    !excludedByHand && !categories.value.find((item) => item.name === category)?.ignoredFromStats;
}
function chooseInclusion(included: boolean) {
  inclusionTouched.value = true;
  draftIncluded.value = included;
}
async function confirm() {
  const item = selected.value;
  if (
    !item ||
    !draftCategory.value ||
    !expected.value ||
    saving.value ||
    loading.value ||
    metadataError.value
  )
    return;
  const position = selectedIndex.value,
    pageOffset = offset.value;
  saving.value = true;
  error.value = '';
  try {
    const ownerType: OwnerType = draftOwner.value.startsWith('member:')
      ? 'member'
      : (draftOwner.value as OwnerType);
    const result = await reviewTransaction(item.id, {
      expected: expected.value,
      category: draftCategory.value,
      ownerType,
      ownerMemberId: ownerType === 'member' ? Number(draftOwner.value.slice(7)) : null,
      included: draftIncluded.value,
      ...(draftDate.value !== (item.effectiveDate ?? '')
        ? { effectiveDate: draftDate.value || null }
        : {}),
    });
    undo.value = { id: item.id, offset: pageOffset, receipt: result.undo };
    drafts.delete(item.id);
    skipped.value.delete(item.id);
    items.value = items.value.filter((row) => row.id !== item.id);
    selectedId.value = null;
    reviewed.value++;
    total.value = Math.max(0, total.value - 1);
    reviewCount.value = total.value;
    notice.value = `${normalizeMerchant(item.description)} · ${copy.value.saved}`;
    // Selection happens after saving ends; disabled controls cannot discard a failed draft.
    saving.value = false;
    await load(position);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    saving.value = false;
  }
}
async function undoLast() {
  const previous = undo.value;
  if (!previous || saving.value || loading.value) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await undoTransactionReview(previous.id, previous.receipt);
    if (linked.value?.id === previous.id) linked.value = result.transaction;
    undo.value = null;
    reviewed.value = Math.max(0, reviewed.value - 1);
    skipped.value.delete(previous.id);
    offset.value = previous.offset;
    notice.value = copy.value.undone;
    saving.value = false;
    selectedId.value = previous.id;
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    saving.value = false;
  }
}
function skip() {
  if (!selected.value || saving.value || loading.value) return;
  const index = selectedIndex.value;
  stashDraft();
  skipped.value.add(selected.value.id);
  selectedId.value = null;
  const next = queue.value[Math.min(index, queue.value.length - 1)];
  if (next) select(next);
  undo.value = null;
  notice.value = copy.value.skipNotice;
}
function revisit() {
  skipped.value.clear();
  if (queue.value[0]) select(queue.value[0]);
}
function move(delta: number) {
  if (saving.value || loading.value) return;
  const next =
    queue.value[Math.max(0, Math.min(queue.value.length - 1, selectedIndex.value + delta))];
  if (next) {
    select(next);
    document.getElementById(`review-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
  }
}
async function page(delta: number) {
  if (saving.value || loading.value) return;
  stashDraft();
  selectedId.value = null;
  offset.value = Math.max(0, offset.value + delta * 50);
  await load();
}
function onKeys(event: KeyboardEvent) {
  if (event.defaultPrevented || document.querySelector('[role="combobox"][aria-expanded="true"]'))
    return;
  if (event.key === 'Escape') {
    close();
    return;
  }
  if (
    event.target instanceof HTMLElement &&
    event.target.closest(
      'input,select,textarea,button:not(.review-row-open),[contenteditable],[role="listbox"]',
    )
  )
    return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKeys);
  if (requestedId.value) {
    try {
      const { transaction } = await getTransaction(requestedId.value);
      if (transaction.needsReview) linked.value = transaction;
    } catch {
      error.value = t('couldNotLoad');
    }
  }
  await reload();
});
onUnmounted(() => {
  requestId++;
  window.removeEventListener('keydown', onKeys);
});
</script>

<template>
  <div class="review-page" :aria-busy="loading">
    <div class="review-toolbar">
      <p v-if="!error || items.length">
        <strong>{{ total }}</strong> {{ t('toReview') }}
      </p>
      <span
        >{{ reviewed }} {{ copy.reviewed
        }}<template v-if="skipped.size"> · {{ skipped.size }} {{ copy.skipped }}</template></span
      >
    </div>
    <div v-if="error || metadataError" class="ledger-notice" role="alert">
      {{ error || metadataError }}
      <button :disabled="loading || saving" @click="reload">{{ copy.reload }}</button>
    </div>
    <div v-if="notice" class="workspace-feedback" role="status">
      <span>{{ notice }}</span>
      <div>
        <button v-if="undo" :disabled="saving || loading" @click="undoLast">{{ copy.undo }}</button
        ><button :aria-label="t('cancel')" @click="notice = ''"><X :size="15" /></button>
      </div>
    </div>
    <div class="review-workspace">
      <div class="review-list workspace-surface">
        <table v-if="queue.length">
          <thead>
            <tr>
              <th scope="col">{{ t('date') }}</th>
              <th scope="col">{{ t('description') }}</th>
              <th scope="col">{{ copy.reason }}</th>
              <th scope="col">{{ t('amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in queue"
              :id="`review-row-${item.id}`"
              :key="item.id"
              :class="{ selected: selectedId === item.id }"
              :aria-selected="selectedId === item.id"
              tabindex="0"
              @click="select(item)"
              @keydown.enter.self="select(item)"
              @keydown.space.self.prevent="select(item)"
            >
              <td>
                <bdi dir="ltr">{{ date(item.reportingDate, true) }}</bdi>
              </td>
              <td>
                <button
                  class="review-row-open"
                  type="button"
                  :title="item.description"
                  :disabled="saving"
                  @click.stop="select(item)"
                >
                  <MerchantMark :description="item.description" /><bdi dir="auto">{{
                    normalizeMerchant(item.description)
                  }}</bdi>
                </button>
              </td>
              <td :title="item.reviewReason ?? item.ownerReviewReason ?? t('needsReview')">
                <span class="review-row-reason"
                  ><bdi dir="auto">{{
                    item.reviewReason ?? item.ownerReviewReason ?? t('needsReview')
                  }}</bdi></span
                >
              </td>
              <td class="review-amount" :class="{ positive: item.chargedAmount > 0 }">
                <bdi dir="ltr">{{ amount(item) }}</bdi>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loading && !error && !queue.length" class="review-empty">
          <Check :size="28" /><strong>{{ total ? copy.skippedEmpty : copy.allClear }}</strong
          ><span v-if="!total">{{ copy.empty }}</span
          ><Button v-if="skipped.size" @click="revisit">{{ copy.reviewSkipped }}</Button>
        </div>
        <div v-if="loading && !items.length" class="review-empty">
          {{ t('loadingTransactions') }}
        </div>
        <div v-if="total > 50" class="review-pagination">
          <span
            >{{ copy.page }} {{ Math.floor(offset / 50) + 1 }} {{ copy.of }}
            {{ Math.ceil(total / 50) }}</span
          >
          <div>
            <button :disabled="!offset || loading || saving" @click="page(-1)">
              {{ t('previous') }}</button
            ><button :disabled="offset + 50 >= total || loading || saving" @click="page(1)">
              {{ t('next') }}
            </button>
          </div>
        </div>
      </div>
      <button
        v-if="selected"
        type="button"
        class="review-backdrop"
        :aria-label="t('cancel')"
        @click="close"
      />
      <aside v-if="selected" class="review-inspector workspace-surface" :aria-label="t('details')">
        <div class="review-inspector-head">
          <h3>{{ copy.transaction }}</h3>
          <button
            type="button"
            class="review-close"
            :disabled="saving"
            :aria-label="t('cancel')"
            @click="close"
          >
            <X :size="17" />
          </button>
          <div v-if="selectedIndex >= 0" class="review-position">
            <button
              :disabled="selectedIndex <= 0 || saving || loading"
              :aria-label="copy.previous"
              @click="move(-1)"
            >
              <ChevronRight v-if="language === 'he'" :size="16" /><ChevronLeft
                v-else
                :size="16"
              /></button
            ><span>{{ selectedIndex + 1 }} {{ copy.of }} {{ queue.length }}</span
            ><button
              :disabled="selectedIndex >= queue.length - 1 || saving || loading"
              :aria-label="copy.next"
              @click="move(1)"
            >
              <ChevronLeft v-if="language === 'he'" :size="16" /><ChevronRight v-else :size="16" />
            </button>
          </div>
        </div>
        <div class="review-inspector-body">
          <h4>
            <MerchantMark :description="selected.description" /><bdi dir="auto">{{
              normalizeMerchant(selected.description)
            }}</bdi>
          </h4>
          <strong class="review-detail-amount" :class="{ positive: selected.chargedAmount > 0 }"
            ><bdi dir="ltr">{{ amount(selected) }}</bdi></strong
          >
          <p class="review-detail-date">
            <bdi dir="ltr">{{ date(selected.reportingDate) }}</bdi
            ><template v-if="accountMap.get(selected.accountId)">
              · {{ accountMap.get(selected.accountId) }}</template
            >
          </p>
          <div class="review-reason">
            <span class="pending-review-dot" />
            <p>
              <bdi dir="auto">{{
                selected.reviewReason ?? selected.ownerReviewReason ?? t('needsReview')
              }}</bdi>
            </p>
          </div>
          <small v-if="selected.confidence != null" class="review-confidence"
            >{{ copy.confidence }}: {{ Math.round(selected.confidence * 100) }}%</small
          >
          <fieldset :disabled="saving">
            <div class="review-category-label">
              <label for="review-category">{{ t('category') }}</label
              ><small
                v-if="
                  selected.confidence != null &&
                  selected.category &&
                  draftCategory === selected.category
                "
                >{{ copy.suggested }}</small
              >
            </div>
            <SelectField
              id="review-category"
              :model-value="draftCategory"
              :aria-label="t('category')"
              :options="[
                { value: '', label: t('uncategorized') },
                ...categories.map((category) => ({ value: category.name, label: category.label })),
              ]"
              @update:model-value="chooseCategory"
            />
            <div class="review-two-fields">
              <label
                ><span>{{ t('owner') }}</span
                ><SelectField
                  v-model="draftOwner"
                  :aria-label="t('owner')"
                  :options="[
                    { value: 'shared', label: t('together') },
                    { value: 'unassigned', label: t('unassigned') },
                    ...members.map((member) => ({
                      value: `member:${member.id}`,
                      label: member.name,
                    })),
                  ]" /></label
              ><label
                ><span>{{ t('effectiveDate') }}</span
                ><input
                  v-model="draftDate"
                  type="date"
                  class="ui-field"
                  :aria-label="t('effectiveDate')"
              /></label>
            </div>
            <div v-if="selected.effectiveDate" class="review-bank-date">
              {{ t('bankDate') }}: <bdi dir="ltr">{{ date(selected.date) }}</bdi>
            </div>
            <label class="review-check"
              ><span>{{ t('includeInStatistics') }}</span
              ><Switch
                :model-value="draftIncluded"
                :disabled="saving"
                :aria-label="t('includeInStatistics')"
                @update:model-value="chooseInclusion"
            /></label>
          </fieldset>
          <details class="review-original" open>
            <summary>{{ copy.original }}</summary>
            <p>
              <bdi dir="auto">{{ selected.description }}</bdi>
            </p>
          </details>
        </div>
        <div class="review-inspector-footer">
          <Button :disabled="saving || loading" @click="skip">{{ copy.skip }}</Button
          ><Button
            variant="filled"
            class="review-confirm"
            :disabled="
              saving ||
              loading ||
              !draftCategory ||
              draftCategory === 'uncategorized' ||
              !!metadataError ||
              (!!draftDate && !/^\d{4}-\d{2}-\d{2}$/.test(draftDate))
            "
            @click="confirm"
            >{{ saving ? t('saving') : copy.confirm
            }}<ChevronLeft v-if="language === 'he'" :size="16" /><ChevronRight v-else :size="16"
          /></Button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.review-page {
  min-width: 0;
  position: relative;
}
.review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: calc(100% - 364px);
  margin-bottom: 20px;
}
.review-toolbar p {
  margin: 0;
  font-size: 16px;
}
.review-toolbar strong {
  font-weight: 600;
}
.review-toolbar > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.workspace-feedback > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.review-workspace {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  position: relative;
}
.review-list {
  flex: 1;
  min-width: 0;
  overflow: auto;
  scroll-padding-block: 42px;
}
.review-list table {
  width: 100%;
  min-width: 590px;
  table-layout: fixed;
  border-collapse: collapse;
}
.review-list th {
  height: 42px;
  padding: 0 16px;
  text-align: start;
  background: var(--surface-muted);
  border-bottom: 1px solid var(--separator);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.review-list th:first-child {
  width: 110px;
}
.review-list th:nth-child(2) {
  width: 36%;
}
.review-list th:last-child {
  width: 140px;
  text-align: end;
}
.review-list td {
  height: 38px;
  padding: 0 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
  font-size: 13px;
  color: var(--text-secondary);
}
.review-list tr:last-child td {
  border: 0;
}
.review-list tr {
  cursor: pointer;
}
.review-list tr:hover {
  background: var(--row-hover);
}
.review-list tr.selected,
.review-list tr.selected:hover {
  background: var(--selection);
}
.review-list tr:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.review-list td:first-child {
  font-size: 12px;
  white-space: nowrap;
}
.review-row-open {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  width: 100%;
  padding: 0;
  text-align: start;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-primary);
}
.review-row-open bdi,
.review-row-reason {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-row-reason {
  font-size: 12px;
}
.review-list .review-amount {
  text-align: end;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  color: var(--text-primary);
}
.positive {
  color: var(--success) !important;
}
.review-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
.review-empty strong {
  font-weight: 500;
  color: var(--text-primary);
}
.review-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--surface-muted);
  border-top: 1px solid var(--separator);
  font-size: 12px;
}
.review-pagination > div {
  display: flex;
  gap: 14px;
}
.review-pagination button {
  min-height: 36px;
  color: var(--accent);
}
.review-pagination button:disabled {
  opacity: 0.4;
}
.review-inspector {
  flex: 0 0 344px;
  min-width: 0;
  overflow: hidden;
}
.review-inspector-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 14px 20px;
}
.review-inspector-head h3 {
  font-size: 13px;
  font-weight: 550;
  margin: 0;
}
.review-inspector-head button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-secondary);
}
.review-inspector-head button:hover {
  background: var(--row-hover);
}
.review-inspector-head button:disabled {
  opacity: 0.3;
}
.review-close {
  order: 2;
}
.review-position {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-inline-start: auto;
  font-size: 11px;
  color: var(--text-secondary);
}
.review-inspector-body {
  padding: 0 20px 20px;
}
.review-inspector-body h4 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  margin: 10px 0 14px;
  overflow-wrap: anywhere;
}
.review-inspector-body h4 bdi {
  min-width: 0;
}
.review-detail-amount {
  display: block;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}
.review-detail-date {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 8px 0 16px;
}
.review-reason {
  display: flex;
  align-items: start;
  gap: 8px;
  font-size: 12px;
}
.review-reason .pending-review-dot {
  margin-top: 6px;
}
.review-reason p {
  margin: 0;
  line-height: 1.5;
}
.review-confidence {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}
.review-inspector fieldset {
  border: 0;
  border-top: 1px solid var(--separator);
  padding: 18px 0 0;
  margin: 20px 0 0;
  min-width: 0;
}
.review-category-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.review-category-label label,
.review-two-fields label > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.review-category-label small {
  font-size: 11px;
  color: var(--text-secondary);
}
.review-two-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}
.review-two-fields label {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.review-two-fields input {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--separator);
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 12px;
}
.review-bank-date {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 10px;
}
.review-check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  margin-top: 16px;
  border-block: 1px solid var(--separator);
  font-size: 13px;
}
.review-original {
  font-size: 12px;
  margin-top: 16px;
}
.review-original summary {
  color: var(--text-secondary);
  cursor: pointer;
}
.review-original p {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.review-inspector-footer {
  display: flex;
  gap: 10px;
  padding: 6px 20px 20px;
}
.review-inspector-footer .review-confirm {
  flex: 1;
}
.review-backdrop {
  display: none;
}
@media (max-width: 1120px) {
  .review-toolbar {
    max-width: none;
  }
  .review-inspector {
    position: fixed;
    z-index: 41;
    inset-block: 88px 24px;
    inset-inline-end: 24px;
    width: 344px;
    overflow: auto;
    box-shadow: var(--shadow-lg);
  }
  .review-backdrop {
    display: block;
    position: fixed;
    z-index: 40;
    inset: 0;
    background: #0004;
    border: 0;
  }
}
@media (max-width: 640px) {
  .review-inspector {
    inset-inline: 16px;
    inset-block: 80px 16px;
    width: auto;
  }
  .review-toolbar {
    align-items: start;
    gap: 10px;
  }
  .review-toolbar > span {
    font-size: 11px;
  }
}
</style>
