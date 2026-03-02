<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getTransactions, getCategories, resolveTransaction, type Transaction, type Category } from '../api/client';
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
import { formatCurrency, formatDate, DEFAULT_CATEGORY_COLOR, getCategoryStyle } from '@/lib/format';

const items = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const categories = ref<Category[]>([]);
const resolvingId = ref<number | null>(null);
const offset = ref(0);
const limit = 50;

async function fetchItems() {
  loading.value = true;
  try {
    const result = await getTransactions({ needsReview: true, limit, offset: offset.value });
    items.value = result.transactions;
    total.value = result.pagination.total;
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
  const catData = await getCategories();
  categories.value = catData.categories;
  fetchItems();
});
</script>

<template>
  <div class="space-y-4 animate-fade-in-up">
    <h1 class="text-2xl font-semibold tracking-tight heading-font">Insights</h1>

    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-base">
          <template v-if="!loading">
            {{ total }} transaction{{ total !== 1 ? 's' : '' }} need{{ total === 1 ? 's' : '' }} review
          </template>
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead class="text-right">Amount</TableHead>
                <TableHead>Current Category</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
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
              <TableRow v-else-if="items.length === 0">
                <TableCell colspan="6" class="text-center text-muted-foreground py-12">
                  All clear! No transactions need review.
                </TableCell>
              </TableRow>
              <TableRow
                v-else
                v-for="txn in items"
                :key="txn.id"
              >
                <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
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
                    class="text-xs"
                    :style="getCategoryStyle(categories.find(c => c.name === txn.category)?.color)"
                  >
                    {{ categories.find(c => c.name === txn.category)?.label ?? txn.category }}
                  </Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell class="max-w-xs text-sm text-muted-foreground">
                  {{ txn.reviewReason }}
                </TableCell>
                <TableCell @click.stop>
                  <div class="flex items-center gap-2">
                    <Select
                      :model-value="txn.category ?? ''"
                      :disabled="resolvingId === txn.id"
                      @update:model-value="(val) => { if (val && val !== txn.category) resolve(txn, String(val)); }"
                    >
                      <SelectTrigger class="h-7 text-xs w-36 border-0 bg-transparent hover:bg-accent px-1" :class="resolvingId === txn.id ? 'opacity-50' : ''">
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
    <div v-if="total > 0" class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
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
