<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, MarkLineComponent } from 'echarts/components';
import VChart from 'vue-echarts';
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
import { Badge } from '@/components/ui/badge';
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
import {
  formatCurrency,
  getCategoryStyle,
  buildCategoryMap,
  DEFAULT_CATEGORY_COLOR,
} from '@/lib/format';
import { useChartTheme } from '@/composables/useChartTheme';
import {
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Wallet,
  ChevronDown,
  ChevronUp,
} from 'lucide-vue-next';

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent, MarkLineComponent]);

const { textPrimary, textSecondary, bgPrimary, separator } = useChartTheme();

// ── State ──

const progressData = ref<BudgetProgress[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(false);
const error = ref('');
const monthlyView = ref(false);
const expandedBudgetId = ref<number | null>(null);

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

const categoryMap = computed(() => buildCategoryMap(categories.value));

// ── Data loading ──

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const [progressRes, catRes] = await Promise.all([
      getBudgetProgress(monthlyView.value),
      getCategories(),
    ]);
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

const totalBudgeted = computed(() =>
  progressData.value.reduce((sum, p) => sum + p.budget.amount, 0),
);
const totalSpent = computed(() => progressData.value.reduce((sum, p) => sum + p.spent, 0));
const overallPercentage = computed(() =>
  totalBudgeted.value > 0 ? Math.round((totalSpent.value / totalBudgeted.value) * 100) : 0,
);
const alertCount = computed(
  () => progressData.value.filter((p) => p.isAlertTriggered || p.isOverBudget).length,
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
    if (editingBudget.value) {
      await updateBudgetApi(editingBudget.value.id, {
        name: formName.value,
        amount,
        period: formPeriod.value,
        categoryNames: formCategoryNames.value,
        alertThreshold: formAlertThreshold.value,
        alertEnabled: formAlertEnabled.value,
        color: formColor.value,
      });
    } else {
      await createBudget({
        name: formName.value,
        amount,
        period: formPeriod.value,
        categoryNames: formCategoryNames.value,
        alertThreshold: formAlertThreshold.value,
        alertEnabled: formAlertEnabled.value,
        color: formColor.value,
      });
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

function toggleExpand(id: number) {
  expandedBudgetId.value = expandedBudgetId.value === id ? null : id;
}

async function toggleMonthlyView() {
  monthlyView.value = !monthlyView.value;
  await loadData();
}

// ── Progress color ──

function progressColor(percentage: number): string {
  if (percentage >= 100) return 'var(--destructive)';
  if (percentage >= 80) return 'var(--warning)';
  return 'var(--success)';
}

function progressBgColor(percentage: number): string {
  if (percentage >= 100) return 'var(--destructive)';
  if (percentage >= 80) return 'var(--warning)';
  return 'var(--success)';
}

// ── Monthly breakdown chart ──

function monthlyChartOption(progress: BudgetProgress) {
  const mv = progress.monthlyView;
  if (!mv) return null;

  const months = mv.breakdown.map((m) => m.month);
  const spent = mv.breakdown.map((m) => m.spent);

  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      borderWidth: 1,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter(params: any) {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.axisValueLabel}<br/><b>${formatCurrency(p.value)}</b> / ${formatCurrency(mv.monthlyBudget)}`;
      },
    },
    grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: months,
      axisLabel: { color: textSecondary.value, fontSize: 10 },
      axisLine: { lineStyle: { color: separator.value } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: textSecondary.value, fontSize: 10 },
      splitLine: { lineStyle: { color: separator.value, type: 'dashed' as const } },
    },
    series: [
      {
        type: 'bar',
        data: spent.map((s) => ({
          value: s,
          itemStyle: {
            color: s > mv.monthlyBudget ? 'var(--destructive)' : 'var(--success)',
            borderRadius: [4, 4, 0, 0],
          },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: textSecondary.value, type: 'dashed' as const, width: 1.5 },
          data: [{ yAxis: mv.monthlyBudget, label: { show: false } }],
        },
      },
    ],
  };
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <div class="flex items-center gap-2">
        <Button
          v-if="progressData.some((p) => p.budget.period === 'yearly')"
          size="sm"
          variant="outline"
          @click="toggleMonthlyView"
        >
          {{ monthlyView ? 'Total View' : 'Monthly View' }}
        </Button>
        <Button size="sm" @click="openCreate">
          <Plus class="h-4 w-4 mr-1" />
          New Budget
        </Button>
      </div>
    </Teleport>

    <p v-if="error" class="text-[13px] text-destructive mb-3">{{ error }}</p>

    <!-- Loading skeletons -->
    <div v-if="loading && progressData.length === 0" class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        <Skeleton class="h-20 rounded-xl" />
        <Skeleton class="h-20 rounded-xl" />
        <Skeleton class="h-20 rounded-xl" />
      </div>
      <Skeleton class="h-44 rounded-xl" />
      <Skeleton class="h-44 rounded-xl" />
    </div>

    <div
      v-else-if="progressData.length === 0 && !loading"
      class="flex flex-col items-center justify-center flex-1 gap-3 text-text-secondary"
    >
      <Wallet class="h-12 w-12 opacity-30" />
      <p class="text-[14px]">No budgets yet</p>
      <p class="text-[12px]">Create a budget to start tracking your spending against limits.</p>
      <Button size="sm" @click="openCreate">
        <Plus class="h-4 w-4 mr-1" />
        Create Your First Budget
      </Button>
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto space-y-5">
      <!-- Overview cards -->
      <div class="grid grid-cols-3 gap-3">
        <Card>
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">Total Budgeted</p>
            <p class="text-[18px] font-semibold mt-1 tabular-nums">
              {{ formatCurrency(totalBudgeted) }}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">Total Spent</p>
            <p
              class="text-[18px] font-semibold mt-1 tabular-nums"
              :class="
                overallPercentage >= 100
                  ? 'text-destructive'
                  : overallPercentage >= 80
                    ? 'text-[var(--warning)]'
                    : ''
              "
            >
              {{ formatCurrency(totalSpent) }}
            </p>
            <p class="text-[11px] text-text-tertiary mt-0.5">{{ overallPercentage }}% of budget</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">Alerts</p>
            <div class="flex items-center gap-2 mt-1">
              <p
                class="text-[18px] font-semibold tabular-nums"
                :class="alertCount > 0 ? 'text-[var(--warning)]' : 'text-success'"
              >
                {{ alertCount }}
              </p>
              <AlertTriangle v-if="alertCount > 0" class="h-4 w-4 text-[var(--warning)]" />
            </div>
            <p class="text-[11px] text-text-tertiary mt-0.5">
              {{ alertCount > 0 ? 'budgets need attention' : 'all on track' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Budget cards -->
      <div class="space-y-3">
        <Card v-for="p in progressData" :key="p.budget.id" class="overflow-hidden">
          <CardContent class="p-5">
            <!-- Header row -->
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-2.5">
                <div
                  class="w-3 h-3 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: p.budget.color ?? '#007AFF' }"
                />
                <div>
                  <h3 class="text-[14px] font-semibold text-text-primary">{{ p.budget.name }}</h3>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                      {{ p.budget.period === 'yearly' ? 'Yearly' : 'Monthly' }}
                    </Badge>
                    <Badge
                      v-if="p.isOverBudget"
                      class="text-[10px] px-1.5 py-0 bg-destructive/15 text-destructive border-0"
                    >
                      Over Budget
                    </Badge>
                    <Badge
                      v-else-if="p.isAlertTriggered"
                      class="text-[10px] px-1.5 py-0 bg-[var(--warning)]/15 text-[var(--warning)] border-0"
                    >
                      Alert
                    </Badge>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button
                  v-if="p.budget.period === 'yearly' && monthlyView"
                  class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  @click="toggleExpand(p.budget.id)"
                >
                  <ChevronDown v-if="expandedBudgetId !== p.budget.id" class="h-3.5 w-3.5" />
                  <ChevronUp v-else class="h-3.5 w-3.5" />
                </button>
                <button
                  class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  @click="openEdit(p.budget)"
                >
                  <Pencil class="h-3.5 w-3.5" />
                </button>
                <button
                  class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary hover:text-destructive"
                  @click="removeBudget(p.budget.id, p.budget.name)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <!-- Progress bar -->
            <div class="mb-2">
              <div class="flex justify-between text-[12px] mb-1.5">
                <span class="text-text-secondary"> {{ formatCurrency(p.spent) }} spent </span>
                <span class="text-text-secondary">
                  {{ formatCurrency(p.budget.amount) }}
                </span>
              </div>
              <div class="h-2.5 rounded-full bg-separator/30 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{
                    width: `${Math.min(p.percentage, 100)}%`,
                    backgroundColor: progressBgColor(p.percentage),
                  }"
                />
              </div>
              <div class="flex justify-between text-[11px] mt-1">
                <span
                  class="font-medium tabular-nums"
                  :style="{ color: progressColor(p.percentage) }"
                >
                  {{ p.percentage }}%
                </span>
                <span class="text-text-tertiary tabular-nums">
                  {{ formatCurrency(Math.max(p.remaining, 0)) }} remaining
                </span>
              </div>
            </div>

            <!-- Category badges -->
            <div class="flex flex-wrap gap-1.5 mt-3">
              <Badge
                v-for="catName in p.budget.categoryNames"
                :key="catName"
                variant="secondary"
                :style="getCategoryStyle(categoryMap.get(catName)?.color)"
                class="text-[11px]"
              >
                {{ categoryMap.get(catName)?.label ?? catName }}
              </Badge>
            </div>

            <!-- Yearly monthly view -->
            <template v-if="p.monthlyView && expandedBudgetId === p.budget.id">
              <div class="mt-4 pt-4 border-t border-separator/30">
                <div class="flex items-center justify-between mb-2">
                  <p class="text-[12px] font-medium text-text-secondary">Monthly Breakdown</p>
                  <div class="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      class="text-[10px]"
                      :class="
                        p.monthlyView.isOnTrack
                          ? 'bg-success/15 text-success'
                          : 'bg-destructive/15 text-destructive'
                      "
                    >
                      <TrendingDown v-if="p.monthlyView.isOnTrack" class="h-3 w-3 mr-0.5" />
                      <TrendingUp v-else class="h-3 w-3 mr-0.5" />
                      {{ p.monthlyView.isOnTrack ? 'On Track' : 'Over Pace' }}
                    </Badge>
                    <span class="text-[11px] text-text-tertiary tabular-nums">
                      {{ formatCurrency(p.monthlyView.monthlyBudget) }}/mo
                    </span>
                  </div>
                </div>
                <VChart
                  v-if="monthlyChartOption(p)"
                  :option="monthlyChartOption(p)!"
                  :style="{ height: '160px' }"
                  autoresize
                />
              </div>
            </template>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingBudget ? 'Edit Budget' : 'New Budget' }}</DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <!-- Name -->
          <div>
            <label class="text-[12px] font-medium text-text-secondary mb-1 block">Name</label>
            <Input v-model="formName" placeholder="e.g. Living Expenses" />
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

          <!-- Alert threshold -->
          <div class="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label class="text-[12px] font-medium text-text-secondary mb-1 block">
                Alert at (%)
              </label>
              <Input v-model.number="formAlertThreshold" type="number" min="0" max="100" step="5" />
            </div>
            <div class="flex items-center gap-2 pb-1">
              <Switch v-model:checked="formAlertEnabled" />
              <span class="text-[12px] text-text-secondary">Enabled</span>
            </div>
          </div>

          <!-- Color -->
          <div>
            <label class="text-[12px] font-medium text-text-secondary mb-1 block">Color</label>
            <input
              v-model="formColor"
              type="color"
              class="h-8 w-12 rounded-lg overflow-hidden border cursor-pointer"
            />
          </div>

          <!-- Categories -->
          <div>
            <label class="text-[12px] font-medium text-text-secondary mb-1.5 block">
              Categories
              <span class="text-text-tertiary">({{ formCategoryNames.length }} selected)</span>
            </label>
            <div
              class="max-h-48 overflow-y-auto rounded-lg border border-separator/30 p-2 space-y-1"
            >
              <button
                v-for="cat in categories.filter((c) => !c.ignoredFromStats)"
                :key="cat.name"
                class="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-[13px] transition-colors"
                :class="
                  formCategoryNames.includes(cat.name)
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-bg-tertiary text-text-primary'
                "
                @click="toggleCategory(cat.name)"
              >
                <div
                  class="w-3 h-3 rounded-full flex-shrink-0 border"
                  :style="{ backgroundColor: cat.color ?? DEFAULT_CATEGORY_COLOR }"
                />
                <span class="flex-1">{{ cat.label }}</span>
                <svg
                  v-if="formCategoryNames.includes(cat.name)"
                  class="h-3.5 w-3.5 text-primary flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showDialog = false">Cancel</Button>
          <Button
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
