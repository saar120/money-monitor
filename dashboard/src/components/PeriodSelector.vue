<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const props = defineProps<{
  periodMode: 'days' | 'month';
  selectedDays: string;
  selectedMonth: string;
}>();

const emit = defineEmits<{
  'update:periodMode': [value: 'days' | 'month'];
  'update:selectedDays': [value: string];
  'update:selectedMonth': [value: string];
}>();

const presetPeriods = [
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '6M' },
  { value: '365', label: '1Y' },
] as const;

const monthLabel = computed(() => {
  const [y, m] = props.selectedMonth.split('-');
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  });
});

function shiftMonth(delta: number) {
  const [y, m] = props.selectedMonth.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  emit('update:selectedMonth', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
}

function selectMonth(monthStr: string) {
  emit('update:selectedMonth', monthStr);
  emit('update:periodMode', 'month');
}

function nowMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonth() {
  const n = new Date();
  n.setMonth(n.getMonth() - 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function onSelect(v: any) {
  const val = String(v);
  if (val === 'this-month') {
    selectMonth(nowMonth());
  } else if (val === 'last-month') {
    selectMonth(lastMonth());
  } else if (val === 'month') {
    emit('update:periodMode', 'month');
  } else {
    emit('update:periodMode', 'days');
    emit('update:selectedDays', val);
  }
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <!-- Month nav arrows -->
    <div v-if="periodMode === 'month'" class="flex items-center gap-0.5">
      <button
        class="p-0.5 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
        @click="shiftMonth(-1)"
      >
        <ChevronLeft class="h-3.5 w-3.5" />
      </button>
      <span class="text-[12px] text-text-primary min-w-[70px] text-center select-none">{{
        monthLabel
      }}</span>
      <button
        class="p-0.5 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
        @click="shiftMonth(1)"
      >
        <ChevronRight class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Dropdown -->
    <Select
      :model-value="periodMode === 'month' ? 'month' : selectedDays"
      @update:model-value="onSelect"
    >
      <SelectTrigger class="w-[80px] h-7 text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="this-month">This Mo.</SelectItem>
        <SelectItem value="last-month">Last Mo.</SelectItem>
        <SelectItem v-if="periodMode === 'month'" value="month">Month</SelectItem>
        <SelectItem v-for="p in presetPeriods" :key="p.value" :value="p.value">
          {{ p.label }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
