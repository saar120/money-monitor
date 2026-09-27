<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  getTransactions,
  getCategories,
  getMembers,
  ignoreTransaction,
  resolveTransaction,
  updateTransactionOwner,
  type Transaction,
  type Category,
  type Member,
  type OwnerType,
} from '../api/client';
import { useReviewCount } from '../composables/useReviewCount';
import { Button } from '@/components/ui/button';
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
import { Check } from 'lucide-vue-next';
import {
  formatCurrency,
  formatDate,
  DEFAULT_CATEGORY_COLOR,
  getCategoryStyle,
  buildCategoryMap,
} from '@/lib/format';
import { t } from '@/lib/language';

const items = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const error = ref('');
const categoryMap = computed(() => buildCategoryMap(categories.value));
const { reviewCount } = useReviewCount();
const resolvingId = ref<number | null>(null);
const offset = ref(0);
const limit = 50;

async function fetchItems() {
  loading.value = true;
  error.value = '';
  try {
    const result = await getTransactions({ needsReview: true, limit, offset: offset.value });
    if (offset.value > 0 && offset.value >= result.pagination.total) {
      offset.value = Math.floor((Math.max(result.pagination.total, 1) - 1) / limit) * limit;
      await fetchItems();
      return;
    }
    items.value = result.transactions;
    total.value = result.pagination.total;
    reviewCount.value = result.pagination.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Review queue could not load.';
  } finally {
    loading.value = false;
  }
}

async function resolve(txn: Transaction, category: string) {
  resolvingId.value = txn.id;
  try {
    await resolveTransaction(txn.id, category);
    await fetchItems();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Transaction could not be reviewed.';
  } finally {
    resolvingId.value = null;
  }
}

function ownerValue(txn: Transaction) {
  return txn.expenseOwnerType === 'member' && txn.expenseOwnerMemberId !== null
    ? `member:${txn.expenseOwnerMemberId}`
    : txn.expenseOwnerType;
}
function onOwnerChange(txn: Transaction, event: Event) {
  const input = event.target as globalThis.HTMLSelectElement;
  void setOwner(txn, input.value);
}
async function setOwner(txn: Transaction, value: string) {
  resolvingId.value = txn.id;
  try {
    const ownerType: OwnerType = value.startsWith('member:') ? 'member' : (value as OwnerType);
    const ownerMemberId = ownerType === 'member' ? Number(value.slice('member:'.length)) : null;
    const { transaction } = await updateTransactionOwner(txn.id, { ownerType, ownerMemberId });
    items.value = items.value.map((item) => (item.id === txn.id ? transaction : item));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Owner could not be updated.';
  } finally {
    resolvingId.value = null;
  }
}
async function setIncluded(txn: Transaction) {
  resolvingId.value = txn.id;
  try {
    const { transaction } = await ignoreTransaction(txn.id, !txn.ignored);
    items.value = items.value.map((item) => (item.id === txn.id ? transaction : item));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Inclusion could not be updated.';
  } finally {
    resolvingId.value = null;
  }
}

function nextPage() {
  if (offset.value + limit < total.value) {
    offset.value += limit;
    fetchItems();
  }
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit);
  fetchItems();
}

const currentPage = () => Math.floor(offset.value / limit) + 1;
const totalPages = () => Math.ceil(total.value / limit);

async function loadAll() {
  try {
    const [catData, memberData] = await Promise.all([getCategories(), getMembers(), fetchItems()]);
    categories.value = catData.categories;
    members.value = memberData.members.filter((member) => member.isActive);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Review options could not load.';
  }
}
onMounted(loadAll);
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <p v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="loadAll">{{ t('retry') }}</button>
    </p>
    <Card class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader class="pb-2 flex-shrink-0">
        <CardTitle class="text-[15px]">
          <template v-if="!loading"> {{ total }} {{ t('reviewTransactions') }} </template>
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0 flex-1 min-h-0">
        <div class="overflow-auto h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('date') }}</TableHead>
                <TableHead>{{ t('description') }}</TableHead>
                <TableHead class="text-right">{{ t('amount') }}</TableHead>
                <TableHead>{{ t('currentCategory') }}</TableHead>
                <TableHead>{{ t('owner') }}</TableHead>
                <TableHead>{{ t('included') }}</TableHead>
                <TableHead>{{ t('reason') }}</TableHead>
                <TableHead>{{ t('confidence') }}</TableHead>
                <TableHead>{{ t('actions') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="loading">
                <TableRow v-for="i in 5" :key="i">
                  <TableCell><Skeleton class="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-48" /></TableCell>
                  <TableCell class="text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-12 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-7 w-36" /></TableCell>
                </TableRow>
              </template>
              <TableRow v-else-if="items.length === 0 && !error">
                <TableCell colspan="9" class="text-center py-16">
                  <div class="flex flex-col items-center">
                    <Check class="h-10 w-10 text-success mb-3" />
                    <p class="text-text-primary text-[14px] font-medium mb-1">
                      {{ t('allClear') }}
                    </p>
                    <p class="text-text-secondary text-[13px]">
                      {{ t('noTransactionsNeedReview') }}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-for="txn in items" v-else :key="txn.id">
                <TableCell class="text-[13px] text-text-secondary whitespace-nowrap">
                  {{ formatDate(txn.date) }}
                </TableCell>
                <TableCell class="max-w-xs truncate">{{ txn.description }}</TableCell>
                <TableCell
                  class="text-right font-medium tabular-nums"
                  :class="txn.chargedAmount >= 0 ? 'text-success' : 'text-destructive'"
                >
                  {{ formatCurrency(txn.chargedAmount) }}
                </TableCell>
                <TableCell>
                  <Badge
                    v-if="txn.category"
                    variant="secondary"
                    class="text-[11px]"
                    :style="getCategoryStyle(categoryMap.get(txn.category)?.color)"
                  >
                    {{ categoryMap.get(txn.category)?.label ?? txn.category }}
                  </Badge>
                  <span v-else class="text-text-secondary">—</span>
                </TableCell>
                <TableCell>
                  <select
                    :value="ownerValue(txn)"
                    :disabled="resolvingId === txn.id"
                    :aria-label="`Owner for ${txn.description}`"
                    class="ledger-select"
                    @change="onOwnerChange(txn, $event)"
                  >
                    <option value="shared">{{ t('together') }}</option>
                    <option
                      v-for="member in members"
                      :key="member.id"
                      :value="`member:${member.id}`"
                    >
                      {{ member.name }}
                    </option>
                    <option value="unassigned">{{ t('unassigned') }}</option>
                  </select>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    class="review-inclusion"
                    :disabled="resolvingId === txn.id"
                    :aria-label="`${txn.ignored ? 'Include' : 'Exclude'} ${txn.description} in reports`"
                    @click="setIncluded(txn)"
                  >
                    {{ txn.ignored ? t('excluded') : t('included') }}
                  </button>
                </TableCell>
                <TableCell class="max-w-sm text-[13px] text-text-secondary">
                  {{ txn.reviewReason }}
                </TableCell>
                <TableCell class="text-center">
                  <Badge
                    v-if="txn.confidence != null"
                    :variant="txn.confidence >= 0.8 ? 'default' : 'secondary'"
                    :class="[
                      'text-[11px] tabular-nums',
                      txn.confidence < 0.5
                        ? 'bg-destructive/15 text-destructive'
                        : txn.confidence < 0.8
                          ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
                          : 'bg-success/15 text-success',
                    ]"
                  >
                    {{ txn.confidence < 0.5 ? '! ' : txn.confidence < 0.8 ? '~ ' : ''
                    }}{{ Math.round(txn.confidence * 100) }}%
                  </Badge>
                  <span v-else class="text-text-secondary">—</span>
                </TableCell>
                <TableCell @click.stop>
                  <div class="flex items-center gap-2">
                    <Select
                      :model-value="txn.category ?? ''"
                      :disabled="resolvingId === txn.id"
                      @update:model-value="
                        (val) => {
                          if (val && val !== txn.category) resolve(txn, String(val));
                        }
                      "
                    >
                      <SelectTrigger
                        class="h-7 text-[11px] w-36 border-0 bg-transparent hover:bg-bg-tertiary px-1"
                        :class="resolvingId === txn.id ? 'opacity-50' : ''"
                      >
                        <SelectValue :placeholder="t('recategorize')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="cat in categories" :key="cat.name" :value="cat.name">
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
                    <Button
                      v-if="txn.category"
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0"
                      :disabled="resolvingId === txn.id"
                      :title="t('confirmCurrentCategory')"
                      @click="resolve(txn, txn.category!)"
                    >
                      <Check class="h-4 w-4 text-success" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div
      v-if="total > 0"
      class="flex items-center justify-between flex-shrink-0 pt-3 mt-1 border-t border-separator/40"
    >
      <p class="text-[13px] text-text-secondary">
        {{ t('page') }} {{ currentPage() }} {{ t('of') }} {{ totalPages() || 1 }}
        &nbsp;·&nbsp;
        {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} {{ t('of') }} {{ total }}
      </p>
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" :disabled="offset === 0" @click="prevPage">
          {{ t('previous') }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="offset + limit >= total" @click="nextPage">
          {{ t('next') }}
        </Button>
      </div>
    </div>
  </div>
</template>
