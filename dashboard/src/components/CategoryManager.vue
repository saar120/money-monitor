<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getCategories, createCategory, updateCategory, deleteCategory, aiRecategorize, type Category } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-vue-next';

const categories = ref<Category[]>([]);
const loading = ref(false);
const error = ref('');

// Editing state
const editingId = ref<number | null>(null);
const editLabel = ref('');
const editColor = ref('');

// New category form
const newName = ref('');
const newLabel = ref('');
const newColor = ref('#94a3b8');
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
    const res = await aiRecategorize(recatStartDate.value || undefined, recatEndDate.value || undefined);
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
  } catch (e) {
    error.value = 'Failed to load categories';
  } finally {
    loading.value = false;
  }
}

function startEdit(cat: Category) {
  editingId.value = cat.id;
  editLabel.value = cat.label;
  editColor.value = cat.color ?? '#94a3b8';
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit(cat: Category) {
  try {
    const res = await updateCategory(cat.id, { label: editLabel.value, color: editColor.value });
    const idx = categories.value.findIndex(c => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    editingId.value = null;
  } catch {
    error.value = 'Failed to save';
  }
}

async function remove(cat: Category) {
  if (!confirm(`Delete category "${cat.label}"? Transactions with this category will keep the label but it won't appear in dropdowns.`)) return;
  try {
    await deleteCategory(cat.id);
    categories.value = categories.value.filter(c => c.id !== cat.id);
  } catch {
    error.value = 'Failed to delete';
  }
}

async function addCategory() {
  if (!newName.value || !newLabel.value) return;
  saving.value = true;
  try {
    const res = await createCategory({ name: newName.value, label: newLabel.value, color: newColor.value });
    categories.value.push(res.category);
    newName.value = '';
    newLabel.value = '';
    newColor.value = '#94a3b8';
    showNewForm.value = false;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Categories</h1>
      <Button size="sm" @click="showNewForm = !showNewForm">
        <Plus class="h-4 w-4 mr-1" /> Add category
      </Button>
    </div>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <!-- New category form -->
    <Card v-if="showNewForm">
      <CardHeader class="pb-2">
        <CardTitle class="text-sm">New Category</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Name (slug)</label>
            <Input v-model="newName" placeholder="e.g. groceries" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Label</label>
            <Input v-model="newLabel" placeholder="e.g. Groceries" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Color</label>
            <input type="color" v-model="newColor" class="h-9 w-14 rounded border cursor-pointer" />
          </div>
          <Button size="sm" :disabled="saving || !newName || !newLabel" @click="addCategory">
            {{ saving ? 'Saving...' : 'Save' }}
          </Button>
          <Button size="sm" variant="ghost" @click="showNewForm = false">Cancel</Button>
        </div>
        <p class="text-xs text-muted-foreground mt-1">Name must be lowercase letters, numbers, dashes, or underscores.</p>
      </CardContent>
    </Card>

    <!-- Table -->
    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-8">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Label</TableHead>
              <TableHead class="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading">
              <TableCell colspan="4" class="text-center text-muted-foreground py-8">Loading...</TableCell>
            </TableRow>
            <TableRow v-for="cat in categories" :key="cat.id">
              <TableCell>
                <div
                  class="w-5 h-5 rounded-full border"
                  :style="{ backgroundColor: cat.color ?? '#94a3b8' }"
                />
              </TableCell>
              <TableCell class="font-mono text-sm">{{ cat.name }}</TableCell>
              <TableCell>
                <template v-if="editingId === cat.id">
                  <div class="flex gap-2 items-center">
                    <Input v-model="editLabel" class="w-32 h-7 text-sm" />
                    <input type="color" v-model="editColor" class="h-7 w-10 rounded border cursor-pointer" />
                    <button @click="saveEdit(cat)" class="text-green-600 hover:text-green-700">
                      <Check class="h-4 w-4" />
                    </button>
                    <button @click="cancelEdit" class="text-muted-foreground hover:text-foreground">
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                </template>
                <template v-else>
                  <Badge variant="secondary" :style="{ backgroundColor: (cat.color ?? '#94a3b8') + '33', color: cat.color ?? undefined }">
                    {{ cat.label }}
                  </Badge>
                </template>
              </TableCell>
              <TableCell class="text-right">
                <div v-if="editingId !== cat.id" class="flex gap-1 justify-end">
                  <button @click="startEdit(cat)" class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button @click="remove(cat)" class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive">
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
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-sm">Re-categorize Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          Re-run AI categorization over all transactions in a date range, overwriting existing categories. Leave dates empty to process all transactions.
        </p>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Start Date</label>
            <Input v-model="recatStartDate" type="date" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">End Date</label>
            <Input v-model="recatEndDate" type="date" class="w-36" />
          </div>
          <Button size="sm" :disabled="recatLoading" @click="runRecategorize">
            {{ recatLoading ? 'Running...' : 'Re-categorize All' }}
          </Button>
        </div>
        <p v-if="recatResult" class="text-sm text-green-600 mt-2">{{ recatResult }}</p>
        <p v-if="recatError" class="text-sm text-destructive mt-2">{{ recatError }}</p>
      </CardContent>
    </Card>
  </div>
</template>
