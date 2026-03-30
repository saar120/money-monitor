<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  aiRecategorize,
  type Category,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-vue-next';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_CATEGORY_COLOR, getCategoryStyle } from '@/lib/format';

const categories = ref<Category[]>([]);
const loading = ref(false);
const error = ref('');

// Editing state
const editingId = ref<number | null>(null);
const editLabel = ref('');
const editColor = ref('');
const editRules = ref('');

// New category form
const newName = ref('');
const newLabel = ref('');
const newColor = ref(DEFAULT_CATEGORY_COLOR);
const newRules = ref('');
const showNewForm = ref(false);
const saving = ref(false);

// Re-categorize state
const recatStartDate = ref('');
const recatEndDate = ref('');
const recatLoading = ref(false);
const recatResult = ref('');
const recatError = ref('');

async function runRecategorize() {
  recatLoading.value = true;
  recatResult.value = '';
  recatError.value = '';
  try {
    const res = await aiRecategorize(
      recatStartDate.value || undefined,
      recatEndDate.value || undefined,
    );
    recatResult.value = `${res.categorized} transactions categorized`;
  } catch (e: unknown) {
    recatError.value = e instanceof Error ? e.message : 'Recategorization failed';
  } finally {
    recatLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const res = await getCategories();
    categories.value = res.categories;
  } catch {
    error.value = 'Failed to load categories';
  } finally {
    loading.value = false;
  }
}

function startEdit(cat: Category) {
  editingId.value = cat.id;
  editLabel.value = cat.label;
  editColor.value = cat.color ?? DEFAULT_CATEGORY_COLOR;
  editRules.value = cat.rules ?? '';
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit(cat: Category) {
  try {
    const res = await updateCategory(cat.id, {
      label: editLabel.value,
      color: editColor.value,
      rules: editRules.value || null,
    });
    const idx = categories.value.findIndex((c) => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    editingId.value = null;
  } catch {
    error.value = 'Failed to save';
  }
}

async function remove(cat: Category) {
  if (
    !window.confirm(
      `Delete category "${cat.label}"? Transactions with this category will keep the label but it won't appear in dropdowns.`,
    )
  )
    return;
  try {
    await deleteCategory(cat.id);
    categories.value = categories.value.filter((c) => c.id !== cat.id);
  } catch {
    error.value = 'Failed to delete';
  }
}

async function addCategory() {
  if (!newName.value || !newLabel.value) return;
  saving.value = true;
  try {
    const res = await createCategory({
      name: newName.value,
      label: newLabel.value,
      color: newColor.value,
      rules: newRules.value || undefined,
    });
    categories.value.push(res.category);
    newName.value = '';
    newLabel.value = '';
    newColor.value = DEFAULT_CATEGORY_COLOR;
    newRules.value = '';
    showNewForm.value = false;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create';
  } finally {
    saving.value = false;
  }
}

async function toggleIgnored(cat: Category) {
  try {
    const res = await updateCategory(cat.id, { ignoredFromStats: !cat.ignoredFromStats });
    const idx = categories.value.findIndex((c) => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
  } catch {
    error.value = 'Failed to update';
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <Button size="sm" @click="showNewForm = !showNewForm">
        <Plus class="h-4 w-4 mr-1" />
        Add Category
      </Button>
    </Teleport>

    <p v-if="error" class="text-[13px] text-destructive">{{ error }}</p>

    <!-- New category form -->
    <SettingsGroup v-if="showNewForm" title="New Category" class="mb-5">
      <SettingsRow label="Name (slug)">
        <Input v-model="newName" placeholder="e.g. groceries" class="w-44" />
      </SettingsRow>
      <SettingsRow label="Label">
        <Input v-model="newLabel" placeholder="e.g. Groceries" class="w-44" />
      </SettingsRow>
      <SettingsRow label="Color">
        <input
          v-model="newColor"
          type="color"
          class="h-8 w-12 rounded-lg overflow-hidden border cursor-pointer"
        />
      </SettingsRow>
      <SettingsRow label="Rules (LLM hint)" vertical>
        <Textarea
          v-model="newRules"
          placeholder="Describe what transactions belong here..."
          class="min-h-[60px] resize-y"
        />
      </SettingsRow>
      <SettingsRow>
        <div class="flex items-center gap-2 ml-auto">
          <Button size="sm" variant="secondary" @click="showNewForm = false">Cancel</Button>
          <Button size="sm" :disabled="saving || !newName || !newLabel" @click="addCategory">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </div>
      </SettingsRow>
    </SettingsGroup>

    <!-- Table -->
    <Card class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardContent class="p-0 flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-8">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead>Ignored</TableHead>
              <TableHead class="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 5" :key="i">
                <TableCell><Skeleton class="h-5 w-5 rounded-full" /></TableCell>
                <TableCell><Skeleton class="h-4 w-24" /></TableCell>
                <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton class="h-4 w-40" /></TableCell>
                <TableCell class="text-right"><Skeleton class="h-4 w-14 ml-auto" /></TableCell>
              </TableRow>
            </template>
            <TableRow
              v-for="cat in categories"
              :key="cat.id"
              :class="{ 'opacity-50': cat.ignoredFromStats }"
            >
              <TableCell>
                <div
                  class="w-5 h-5 rounded-full border"
                  :style="{ backgroundColor: cat.color ?? DEFAULT_CATEGORY_COLOR }"
                />
              </TableCell>
              <TableCell class="font-mono text-[13px]">{{ cat.name }}</TableCell>
              <TableCell>
                <template v-if="editingId === cat.id">
                  <div class="space-y-2">
                    <div class="flex gap-2 items-center">
                      <Input v-model="editLabel" class="w-32 h-7 text-[13px]" />
                      <input
                        v-model="editColor"
                        type="color"
                        class="h-7 w-10 rounded-lg overflow-hidden border cursor-pointer"
                      />
                      <button class="text-success hover:text-success/80" @click="saveEdit(cat)">
                        <Check class="h-4 w-4" />
                      </button>
                      <button
                        class="text-text-secondary hover:text-text-primary"
                        @click="cancelEdit"
                      >
                        <X class="h-4 w-4" />
                      </button>
                    </div>
                    <Textarea
                      v-model="editRules"
                      placeholder="LLM categorization rules..."
                      class="text-[11px] min-h-[40px] resize-y"
                    />
                  </div>
                </template>
                <template v-else>
                  <Badge variant="secondary" :style="getCategoryStyle(cat.color)">
                    {{ cat.label }}
                  </Badge>
                </template>
              </TableCell>
              <TableCell
                class="text-[11px] text-text-secondary max-w-[200px] truncate"
                :title="cat.rules ?? ''"
              >
                {{ cat.rules ?? '—' }}
              </TableCell>
              <TableCell>
                <Switch
                  :model-value="cat.ignoredFromStats"
                  @update:model-value="toggleIgnored(cat)"
                />
              </TableCell>
              <TableCell class="text-right">
                <div v-if="editingId !== cat.id" class="flex gap-1 justify-end">
                  <button
                    class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    @click="startEdit(cat)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary hover:text-destructive"
                    @click="remove(cat)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- Re-categorize section -->
    <SettingsGroup
      title="Re-categorize Transactions"
      description="Re-run AI categorization over a date range, overwriting existing categories"
    >
      <SettingsRow label="Start Date">
        <Input v-model="recatStartDate" type="date" class="w-36" />
      </SettingsRow>
      <SettingsRow label="End Date">
        <Input v-model="recatEndDate" type="date" class="w-36" />
      </SettingsRow>
      <SettingsRow>
        <div class="flex items-center gap-2">
          <Button size="sm" :disabled="recatLoading" @click="runRecategorize">
            {{ recatLoading ? 'Running…' : 'Re-categorize All' }}
          </Button>
          <span v-if="recatResult" class="text-[13px] text-success">{{ recatResult }}</span>
          <span v-if="recatError" class="text-[13px] text-destructive">{{ recatError }}</span>
        </div>
      </SettingsRow>
    </SettingsGroup>
  </div>
</template>
