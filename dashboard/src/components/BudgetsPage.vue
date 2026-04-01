<script setup lang="ts">
import { ref, computed, onMounted, watchEffect } from 'vue';
import { ToggleGroupRoot, ToggleGroupItem } from 'reka-ui';
import {
  getBudgetProgress,
  getCategories,
  createBudget,
  updateBudget as updateBudgetApi,
  deleteBudget as deleteBudgetApi,
  type Budget,
  type BudgetProgress,
  type Category,
} from '../api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, buildCategoryMap, DEFAULT_CATEGORY_COLOR } from '@/lib/format';
import { Plus, Pencil, Trash2, Wallet, Search, Check } from 'lucide-vue-next';

// ── State ──

const progressData = ref<BudgetProgress[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(false);
const error = ref('');
const activePeriod = ref<'monthly' | 'yearly'>('monthly');

// Dialog state
const showDialog = ref(false);
const editingBudget = ref<Budget | null>(null);
const saving = ref(false);

// Form state
const formName = ref('');
const formAmount = ref<number | string>('');
const formPeriod = ref<'monthly' | 'yearly'>('monthly');
const formAlertThreshold = ref(80);
const formAlertEnabled = ref(true);
const formColor = ref('#007AFF');
const formCategoryNames = ref<string[]>([]);

const categorySearch = ref('');

const categoryMap = computed(() => buildCategoryMap(categories.value));

const nonIgnoredCategories = computed(() => categories.value.filter((c) => !c.ignoredFromStats));

const filteredCategories = computed(() => {
  const q = categorySearch.value.toLowerCase();
  if (!q) return nonIgnoredCategories.value;
  return nonIgnoredCategories.value.filter(
    (c) => c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
});

const TOGGLE_ITEM_CLASS =
  'px-3 py-1 text-[12px] font-medium rounded-md transition-colors duration-150 data-[state=on]:bg-bg-primary data-[state=on]:text-text-primary data-[state=on]:shadow-[var(--shadow-sm)] data-[state=off]:text-text-secondary data-[state=off]:hover:text-text-primary';

const COLOR_SWATCHES = [
  '#007AFF',
  '#5856D6',
  '#AF52DE',
  '#FF2D55',
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#00C7BE',
  '#30B0C7',
  '#64D2FF',
  '#AC8E68',
];

// ── Data loading ──

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const [progressRes, catRes] = await Promise.all([getBudgetProgress(false), getCategories()]);
    progressData.value = progressRes.progress;
    categories.value = catRes.categories;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load budgets';
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

// ── Computed ──

const monthlyBudgets = computed(() =>
  progressData.value.filter((p) => p.budget.period === 'monthly'),
);
const yearlyBudgets = computed(() =>
  progressData.value.filter((p) => p.budget.period === 'yearly'),
);
const hasBothPeriods = computed(
  () => monthlyBudgets.value.length > 0 && yearlyBudgets.value.length > 0,
);

// Auto-select the period that has budgets if only one exists
watchEffect(() => {
  if (monthlyBudgets.value.length === 0 && yearlyBudgets.value.length > 0)
    activePeriod.value = 'yearly';
  else if (yearlyBudgets.value.length === 0 && monthlyBudgets.value.length > 0)
    activePeriod.value = 'monthly';
});

const isMonthly = computed(() => activePeriod.value === 'monthly');
const activeBudgets = computed(() =>
  isMonthly.value ? monthlyBudgets.value : yearlyBudgets.value,
);

// Summary for active period
const activeTotal = computed(() => activeBudgets.value.reduce((s, p) => s + p.budget.amount, 0));
const activeSpent = computed(() => activeBudgets.value.reduce((s, p) => s + p.spent, 0));
const activePct = computed(() =>
  activeTotal.value > 0 ? Math.round((activeSpent.value / activeTotal.value) * 100) : 0,
);
const activeRemaining = computed(() => Math.max(activeTotal.value - activeSpent.value, 0));

const alertCount = computed(
  () => activeBudgets.value.filter((p) => p.isAlertTriggered || p.isOverBudget).length,
);

// ── Dialog ──

function openCreate() {
  editingBudget.value = null;
  formName.value = '';
  formAmount.value = '';
  formPeriod.value = 'monthly';
  formAlertThreshold.value = 80;
  formAlertEnabled.value = true;
  formColor.value = '#007AFF';
  formCategoryNames.value = [];
  categorySearch.value = '';
  showDialog.value = true;
}

function openEdit(budget: Budget) {
  editingBudget.value = budget;
  formName.value = budget.name;
  formAmount.value = budget.amount;
  formPeriod.value = budget.period;
  formAlertThreshold.value = budget.alertThreshold;
  formAlertEnabled.value = budget.alertEnabled;
  formColor.value = budget.color ?? '#007AFF';
  formCategoryNames.value = [...budget.categoryNames];
  categorySearch.value = '';
  showDialog.value = true;
}

function toggleCategory(name: string) {
  const idx = formCategoryNames.value.indexOf(name);
  if (idx >= 0) {
    formCategoryNames.value.splice(idx, 1);
  } else {
    formCategoryNames.value.push(name);
  }
}

async function saveBudget() {
  const amount = Number(formAmount.value);
  if (!formName.value || !amount || formCategoryNames.value.length === 0) return;

  saving.value = true;
  try {
    const payload = {
      name: formName.value,
      amount,
      period: formPeriod.value,
      categoryNames: formCategoryNames.value,
      alertThreshold: formAlertThreshold.value,
      alertEnabled: formAlertEnabled.value,
      color: formColor.value,
    };
    if (editingBudget.value) {
      await updateBudgetApi(editingBudget.value.id, payload);
    } else {
      await createBudget(payload);
    }
    showDialog.value = false;
    await loadData();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to save budget';
  } finally {
    saving.value = false;
  }
}

async function removeBudget(id: number, name: string) {
  if (!window.confirm(`Delete budget "${name}"?`)) return;
  try {
    await deleteBudgetApi(id);
    await loadData();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to delete budget';
  }
}

// ── Progress color ──

function setActivePeriod(v: unknown) {
  if (v === 'monthly' || v === 'yearly') activePeriod.value = v;
}

function progressColor(percentage: number, neutral = false): string {
  if (percentage >= 100) return 'var(--destructive)';
  if (percentage >= 80) return 'var(--warning)';
  return neutral ? 'var(--text-primary)' : 'var(--success)';
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <div class="flex items-center gap-2">
        <!-- Period picker — only if both types exist -->
        <ToggleGroupRoot
          v-if="hasBothPeriods"
          type="single"
          :model-value="activePeriod"
          class="inline-flex rounded-lg bg-bg-tertiary p-0.5"
          @update:model-value="setActivePeriod"
        >
          <ToggleGroupItem value="monthly" :class="TOGGLE_ITEM_CLASS">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="yearly" :class="TOGGLE_ITEM_CLASS">Yearly</ToggleGroupItem>
        </ToggleGroupRoot>
        <Button size="sm" @click="openCreate">
          <Plus class="h-4 w-4 mr-1" />
          New Budget
        </Button>
      </div>
    </Teleport>

    <p v-if="error" class="text-[13px] text-destructive mb-3">{{ error }}</p>

    <!-- Loading -->
    <div v-if="loading && progressData.length === 0" class="space-y-5">
      <div class="grid grid-cols-3 gap-3">
        <Skeleton class="h-[72px] rounded-xl" />
        <Skeleton class="h-[72px] rounded-xl" />
        <Skeleton class="h-[72px] rounded-xl" />
      </div>
      <Skeleton class="h-[200px] rounded-xl" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="progressData.length === 0 && !loading"
      class="flex flex-col items-center justify-center flex-1 gap-5"
    >
      <Wallet class="h-10 w-10 text-text-tertiary" />
      <div class="text-center">
        <p class="text-[14px] font-medium text-text-primary">No budgets yet</p>
        <p class="text-[13px] text-text-secondary mt-1.5">
          Set spending limits on categories to track where your money goes.
        </p>
      </div>
      <Button size="sm" variant="secondary" @click="openCreate">
        <Plus class="h-4 w-4 mr-1" />
        Create budget
      </Button>
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto space-y-5">
      <!-- Summary -->
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-xl border border-separator/50 px-4 py-3">
          <p class="text-[11px] text-text-tertiary mb-1">
            {{ isMonthly ? 'Monthly Budget' : 'Yearly Budget' }}
          </p>
          <p class="text-[20px] font-semibold tabular-nums text-text-primary leading-tight">
            {{ formatCurrency(activeTotal) }}
          </p>
          <p class="text-[11px] text-text-tertiary mt-1.5">
            {{ activeBudgets.length }} {{ activeBudgets.length === 1 ? 'budget' : 'budgets' }}
            <template v-if="!isMonthly">
              &middot; {{ formatCurrency(activeTotal / 12) }}/mo</template
            >
          </p>
        </div>
        <div class="rounded-xl border border-separator/50 px-4 py-3">
          <p class="text-[11px] text-text-tertiary mb-1">
            {{ isMonthly ? 'Spent This Month' : 'Spent YTD' }}
          </p>
          <div class="flex items-baseline gap-2">
            <p
              class="text-[20px] font-semibold tabular-nums leading-tight"
              :style="{ color: progressColor(activePct, true) }"
            >
              {{ formatCurrency(activeSpent) }}
            </p>
            <span
              class="text-[12px] tabular-nums font-medium"
              :style="{ color: progressColor(activePct) }"
              >{{ activePct }}%</span
            >
          </div>
          <div class="h-1 rounded-full bg-separator/30 overflow-hidden mt-2">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{
                width: `${Math.min(activePct, 100)}%`,
                backgroundColor: progressColor(activePct),
              }"
            />
          </div>
        </div>
        <div class="rounded-xl border border-separator/50 px-4 py-3">
          <p class="text-[11px] text-text-tertiary mb-1">Remaining</p>
          <p class="text-[20px] font-semibold tabular-nums text-text-primary leading-tight">
            {{ formatCurrency(activeRemaining) }}
          </p>
          <p
            v-if="alertCount > 0"
            class="text-[11px] text-[var(--warning)] mt-1.5 flex items-center gap-1"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
            {{ alertCount }} need attention
          </p>
          <p v-else-if="!isMonthly" class="text-[11px] text-text-tertiary mt-1.5">
            {{ formatCurrency(activeRemaining / 12) }}/mo
          </p>
          <p v-else class="text-[11px] text-text-tertiary mt-1.5">All on track</p>
        </div>
      </div>

      <!-- Budget list -->
      <Card>
        <CardContent class="p-0 divide-y divide-separator/40">
          <div v-for="p in activeBudgets" :key="p.budget.id" class="group px-5 py-4">
            <div class="flex items-center justify-between gap-4 mb-2.5 min-w-0">
              <div class="flex items-center gap-2.5 min-w-0">
                <span
                  class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: p.budget.color ?? 'var(--accent)' }"
                />
                <h3 class="text-[13px] font-medium text-text-primary truncate">
                  {{ p.budget.name }}
                </h3>
                <span
                  v-if="p.isOverBudget"
                  class="text-[11px] font-medium text-destructive flex-shrink-0"
                  >Over budget</span
                >
                <span
                  v-else-if="p.isAlertTriggered"
                  class="text-[11px] font-medium text-[var(--warning)] flex-shrink-0"
                  >Alert</span
                >
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span
                  class="text-[13px] tabular-nums text-text-primary font-medium whitespace-nowrap"
                >
                  {{ formatCurrency(p.spent) }}
                  <span class="text-text-tertiary font-normal"
                    >/ {{ formatCurrency(p.budget.amount) }}</span
                  >
                </span>
                <div
                  class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                >
                  <button
                    type="button"
                    class="p-1 rounded-md text-text-tertiary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-text-primary transition-all duration-150"
                    @click="openEdit(p.budget)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="p-1 rounded-md text-text-tertiary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-destructive transition-all duration-150"
                    @click="removeBudget(p.budget.id, p.budget.name)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3 mb-2">
              <div class="flex-1 h-1.5 rounded-full bg-separator/25 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{
                    width: `${Math.min(p.percentage, 100)}%`,
                    backgroundColor: progressColor(p.percentage),
                  }"
                />
              </div>
              <span
                class="text-[11px] tabular-nums font-medium w-10 text-right flex-shrink-0"
                :style="{ color: progressColor(p.percentage) }"
                >{{ p.percentage }}%</span
              >
            </div>
            <div class="flex items-center justify-between gap-4 min-w-0">
              <p class="text-[11px] text-text-tertiary truncate">
                {{ p.budget.categoryNames.map((n) => categoryMap.get(n)?.label ?? n).join(', ') }}
              </p>
              <span
                class="text-[11px] text-text-secondary tabular-nums flex-shrink-0 whitespace-nowrap"
              >
                {{ formatCurrency(Math.max(p.remaining, 0)) }} left
                <template v-if="!isMonthly">
                  <span class="text-text-tertiary"
                    >&middot; {{ formatCurrency(p.budget.amount / 12) }}/mo</span
                  >
                </template>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingBudget ? 'Edit Budget' : 'New Budget' }}</DialogTitle>
        </DialogHeader>

        <div class="space-y-5">
          <!-- Name + Color row -->
          <div class="flex gap-3 items-end">
            <div class="flex-1">
              <label class="text-[12px] font-medium text-text-secondary mb-1 block">Name</label>
              <Input v-model="formName" placeholder="e.g. Living Expenses" />
            </div>
            <div>
              <label class="text-[12px] font-medium text-text-secondary mb-1 block">Color</label>
              <div class="grid grid-cols-6 gap-1.5">
                <button
                  v-for="swatch in COLOR_SWATCHES"
                  :key="swatch"
                  type="button"
                  class="w-5 h-5 rounded-full transition-all duration-150 border-2 hover:scale-110"
                  :class="
                    formColor === swatch ? 'border-text-primary scale-110' : 'border-transparent'
                  "
                  :style="{ backgroundColor: swatch }"
                  @click="formColor = swatch"
                />
              </div>
            </div>
          </div>

          <!-- Amount + Period row -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[12px] font-medium text-text-secondary mb-1 block"
                >Amount (₪)</label
              >
              <Input v-model="formAmount" type="number" placeholder="5000" min="0" step="100" />
            </div>
            <div>
              <label class="text-[12px] font-medium text-text-secondary mb-1 block">Period</label>
              <Select v-model="formPeriod">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- Alert section -->
          <div class="border-t border-separator/30 pt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[12px] font-medium text-text-primary">Alerts</span>
              <Switch v-model="formAlertEnabled" />
            </div>
            <div
              class="flex items-center gap-2 text-[12px] transition-opacity duration-150"
              :class="
                formAlertEnabled
                  ? 'text-text-secondary'
                  : 'text-text-tertiary opacity-40 pointer-events-none'
              "
            >
              <span class="whitespace-nowrap">Notify at</span>
              <Input
                v-model.number="formAlertThreshold"
                type="number"
                min="0"
                max="100"
                step="5"
                class="!h-7 w-16 text-center text-[12px] tabular-nums"
              />
              <span>% of budget</span>
            </div>
          </div>

          <!-- Categories -->
          <div class="border-t border-separator/30 pt-4">
            <label class="text-[12px] font-medium text-text-primary mb-2 block">
              Categories
              <span v-if="formCategoryNames.length" class="text-text-tertiary font-normal"
                >&middot; {{ formCategoryNames.length }}</span
              >
            </label>
            <div v-if="nonIgnoredCategories.length > 8" class="relative mb-2">
              <Search
                class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary"
              />
              <Input v-model="categorySearch" placeholder="Search…" class="!h-7 text-[12px] pl-8" />
            </div>
            <div class="max-h-48 overflow-y-auto -mx-1 space-y-px">
              <button
                v-for="cat in filteredCategories"
                :key="cat.name"
                class="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded text-left text-[13px] transition-colors"
                :class="
                  formCategoryNames.includes(cat.name)
                    ? 'bg-[var(--glass-bg-heavy)] border border-[var(--glass-border)]'
                    : 'hover:bg-[var(--glass-bg)] border border-transparent'
                "
                @click="toggleCategory(cat.name)"
              >
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: cat.color ?? DEFAULT_CATEGORY_COLOR }"
                />
                <span class="flex-1 text-text-primary">{{ cat.label }}</span>
                <Check
                  v-if="formCategoryNames.includes(cat.name)"
                  class="h-3.5 w-3.5 text-text-primary flex-shrink-0"
                />
              </button>
              <p
                v-if="filteredCategories.length === 0"
                class="text-[12px] text-text-tertiary text-center py-3 px-2"
              >
                No match for "{{ categorySearch }}"
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="showDialog = false">Cancel</Button>
          <Button
            variant="filled"
            :disabled="saving || !formName || !Number(formAmount) || formCategoryNames.length === 0"
            @click="saveBudget"
          >
            {{ saving ? 'Saving…' : editingBudget ? 'Save Changes' : 'Create Budget' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
