<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getTransactions, getCategories, resolveTransaction, type Transaction, type Category } from '../api/client';
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
import { formatCurrency, formatDate, DEFAULT_CATEGORY_COLOR, getCategoryStyle, buildCategoryMap } from '@/lib/format';

const items = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<Category[]>([]);
const categoryMap = computed(() => buildCategoryMap(categories.value));
const { reviewCount } = useReviewCount();
const resolvingId = ref<number | null>(null);
const offset = ref(0);
const limit = 50;

async function fetchItems() {
  loading.value = true;
  try {
    const result = await getTransactions({ needsReview: true, limit, offset: offset.value });
    items.value = result.transactions;
    total.value = result.pagination.total;
    reviewCount.value = result.pagination.total;
  } catch (err) {
    console.error('Failed to fetch needs-review transactions:', err);
  } finally {
    loading.value = false;
  }
}

async function resolve(txn: Transaction, category: string) {
  resolvingId.value = txn.id;
  try {
    await resolveTransaction(txn.id, category);
    items.value = items.value.filter(t => t.id !== txn.id);
    total.value--;
    reviewCount.value = total.value;
  } catch (err) {
    console.error('Failed to resolve transaction:', err);
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

onMounted(async () => {
  const [catData] = await Promise.all([getCategories(), fetchItems()]);
  categories.value = catData.categories;
});
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <h1 class="text-[22px] font-semibold text-text-primary flex-shrink-0 mb-4">Insights</h1>

    <Card class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader class="pb-2 flex-shrink-0">
        <CardTitle class="text-[15px]">
          <template v-if="!loading">
            {{ total }} transaction{{ total !== 1 ? 's' : '' }} need{{ total === 1 ? 's' : '' }} review
          </template>
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0 flex-1 min-h-0">
        <div class="overflow-auto h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead class="text-right">Amount</TableHead>
                <TableHead>Current Category</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="loading">
                <TableRow v-for="i in 5" :key="i">
                  <TableCell><Skeleton class="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-48" /></TableCell>
                  <TableCell class="text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton class="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton class="h-7 w-36" /></TableCell>
                </TableRow>
              </template>
              <TableRow v-else-if="items.length === 0">
                <TableCell colspan="7" class="text-center text-text-secondary py-12">
                  All clear! No transactions need review.
                </TableCell>
              </TableRow>
              <TableRow
                v-else
                v-for="txn in items"
                :key="txn.id"
              >
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
                <TableCell class="max-w-xs text-[13px] text-text-secondary">
                  {{ txn.reviewReason }}
                </TableCell>
                <TableCell class="text-center">
                  <Badge
                    v-if="txn.confidence != null"
                    :variant="txn.confidence >= 0.8 ? 'default' : 'secondary'"
                    :class="[
                      'text-[11px] tabular-nums',
                      txn.confidence < 0.5 ? 'bg-destructive/15 text-destructive' :
                      txn.confidence < 0.8 ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' :
                      'bg-success/15 text-success'
                    ]"
                  >
                    {{ Math.round(txn.confidence * 100) }}%
                  </Badge>
                  <span v-else class="text-text-secondary">—</span>
                </TableCell>
                <TableCell @click.stop>
                  <div class="flex items-center gap-2">
                    <Select
                      :model-value="txn.category ?? ''"
                      :disabled="resolvingId === txn.id"
                      @update:model-value="(val) => { if (val && val !== txn.category) resolve(txn, String(val)); }"
                    >
                      <SelectTrigger class="h-7 text-[11px] w-36 border-0 bg-transparent hover:bg-bg-tertiary px-1" :class="resolvingId === txn.id ? 'opacity-50' : ''">
                        <SelectValue placeholder="Re-categorize" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="cat in categories"
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
                    <Button
                      v-if="txn.category"
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0"
                      :disabled="resolvingId === txn.id"
                      title="Confirm current category"
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
    <div v-if="total > 0" class="flex items-center justify-between flex-shrink-0 pt-4">
      <p class="text-[13px] text-text-secondary">
        Page {{ currentPage() }} of {{ totalPages() || 1 }}
        &nbsp;·&nbsp;
        {{ offset + 1 }}–{{ Math.min(offset + limit, total) }}
        of {{ total }}
      </p>
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="offset === 0"
          @click="prevPage"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="offset + limit >= total"
          @click="nextPage"
        >
          Next
        </Button>
      </div>
    </div>
  </div>
</template>
