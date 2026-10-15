<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  getCategories,
  getMembers,
  createCategory,
  updateCategory,
  deleteCategory,
  aiRecategorize,
  type Category,
  type Member,
  type OwnerType,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { t } from '@/lib/language';

const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const loading = ref(false);
const error = ref('');

// Editing state
const editingId = ref<number | null>(null);
const editLabel = ref('');
const editColor = ref('');
const editRules = ref('');
const editOwner = ref('unassigned');

// New category form
const newName = ref('');
const newLabel = ref('');
const newColor = ref(DEFAULT_CATEGORY_COLOR);
const newRules = ref('');
const newOwner = ref('unassigned');
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
    const [res, memberRes] = await Promise.all([getCategories(), getMembers()]);
    categories.value = res.categories;
    members.value = memberRes.members.filter((m) => m.isActive);
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
  editOwner.value =
    cat.defaultOwnerType === 'member' && cat.defaultOwnerMemberId
      ? `member:${cat.defaultOwnerMemberId}`
      : cat.defaultOwnerType;
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
      defaultOwnerType: ownerTypeFromValue(editOwner.value),
      defaultOwnerMemberId: ownerMemberIdFromValue(editOwner.value),
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
      defaultOwnerType: ownerTypeFromValue(newOwner.value),
      defaultOwnerMemberId: ownerMemberIdFromValue(newOwner.value),
    });
    categories.value.push(res.category);
    newName.value = '';
    newLabel.value = '';
    newColor.value = DEFAULT_CATEGORY_COLOR;
    newRules.value = '';
    newOwner.value = 'unassigned';
    showNewForm.value = false;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create';
  } finally {
    saving.value = false;
  }
}

function ownerTypeFromValue(value: string): OwnerType {
  return value.startsWith('member:') ? 'member' : (value as OwnerType);
}

function ownerMemberIdFromValue(value: string): number | null {
  return value.startsWith('member:') ? Number(value.slice('member:'.length)) : null;
}

function ownerValue(cat: Category): string {
  return cat.defaultOwnerType === 'member' && cat.defaultOwnerMemberId
    ? `member:${cat.defaultOwnerMemberId}`
    : cat.defaultOwnerType;
}

function ownerLabel(value: string): string {
  if (value === 'shared') return 'Together';
  if (value === 'unassigned') return 'Account member';
  if (value.startsWith('member:')) {
    const id = Number(value.slice('member:'.length));
    return members.value.find((m) => m.id === id)?.name ?? 'Unknown member';
  }
  return 'Account member';
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
  <div class="advanced-categories flex flex-col h-full min-h-0 min-w-0 animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <Button size="sm" @click="showNewForm = !showNewForm">
        <Plus class="h-4 w-4 mr-1" />
        Add Category
      </Button>
    </Teleport>

    <p v-if="error" role="alert" class="text-[14px] text-destructive">{{ error }}</p>

    <!-- New category form -->
    <SettingsGroup v-if="showNewForm" title="New Category" class="category-form mb-8">
      <SettingsRow label="Name (slug)">
        <Input v-model="newName" placeholder="e.g. groceries" class="w-44" />
      </SettingsRow>
      <SettingsRow label="Label">
        <Input v-model="newLabel" placeholder="e.g. Groceries" class="w-44" />
      </SettingsRow>
      <SettingsRow label="Color">
        <input
          v-model="newColor"
          aria-label="Color"
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
      <SettingsRow label="Default Owner">
        <Select v-model="newOwner">
          <SelectTrigger class="w-44">
            <SelectValue placeholder="Default owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Account member</SelectItem>
            <SelectItem value="shared">Together</SelectItem>
            <SelectItem v-for="member in members" :key="member.id" :value="`member:${member.id}`">
              {{ member.name }}
            </SelectItem>
          </SelectContent>
        </Select>
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
    <section class="category-ledger flex-1 min-h-[240px] flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 overflow-auto">
        <Table class="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead class="w-8">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead>Default Owner</TableHead>
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
                <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton class="h-5 w-9" /></TableCell>
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
              <TableCell class="font-mono text-[14px]"
                ><bdi dir="ltr">{{ cat.name }}</bdi></TableCell
              >
              <TableCell>
                <template v-if="editingId === cat.id">
                  <div class="space-y-2">
                    <div class="flex flex-wrap gap-2 items-center">
                      <Input
                        v-model="editLabel"
                        aria-label="Display name"
                        class="w-32 h-7 text-[14px]"
                      />
                      <input
                        v-model="editColor"
                        aria-label="Color"
                        type="color"
                        class="h-7 w-10 rounded-lg overflow-hidden border cursor-pointer"
                      />
                      <button
                        aria-label="Save category"
                        title="Save category"
                        class="p-2 text-success hover:text-success/80"
                        @click="saveEdit(cat)"
                      >
                        <Check class="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Cancel editing"
                        title="Cancel editing"
                        class="p-2 text-text-secondary hover:text-text-primary"
                        @click="cancelEdit"
                      >
                        <X class="h-4 w-4" />
                      </button>
                    </div>
                    <Textarea
                      v-model="editRules"
                      aria-label="Classification rules"
                      placeholder="LLM categorization rules..."
                      class="text-[12px] min-h-[40px] resize-y"
                    />
                    <Select v-model="editOwner">
                      <SelectTrigger aria-label="Default owner" class="h-8 w-44">
                        <SelectValue placeholder="Default owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Account member</SelectItem>
                        <SelectItem value="shared">Together</SelectItem>
                        <SelectItem
                          v-for="member in members"
                          :key="member.id"
                          :value="`member:${member.id}`"
                        >
                          {{ member.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </template>
                <template v-else>
                  <Badge variant="secondary" :style="getCategoryStyle(cat.color)">
                    {{ cat.label }}
                  </Badge>
                </template>
              </TableCell>
              <TableCell
                class="text-[12px] text-text-secondary min-w-[200px] max-w-[320px] whitespace-normal break-words [overflow-wrap:anywhere]"
                :title="cat.rules ?? ''"
              >
                <bdi class="line-clamp-2" dir="auto">{{ cat.rules ?? '—' }}</bdi>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" class="text-[12px]">
                  {{ ownerLabel(ownerValue(cat)) }}
                </Badge>
              </TableCell>
              <TableCell>
                <Switch
                  :model-value="cat.ignoredFromStats"
                  :aria-label="`Exclude ${cat.label} from reports`"
                  @update:model-value="toggleIgnored(cat)"
                />
              </TableCell>
              <TableCell class="text-right">
                <div v-if="editingId !== cat.id" class="flex gap-1 justify-end">
                  <button
                    class="p-2.5 rounded-md hover:bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    :aria-label="`Edit ${cat.label}`"
                    :title="`Edit ${cat.label}`"
                    @click="startEdit(cat)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="p-2.5 rounded-md hover:bg-bg-tertiary text-text-secondary hover:text-destructive"
                    :aria-label="`Delete ${cat.label}`"
                    :title="`Delete ${cat.label}`"
                    @click="remove(cat)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>

    <!-- Re-categorize section -->
    <details class="category-advanced">
      <summary>{{ t('advanced') }}</summary>
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
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" :disabled="recatLoading" @click="runRecategorize">
              {{ recatLoading ? 'Running…' : 'Re-categorize All' }}
            </Button>
            <span v-if="recatResult" class="text-[14px] text-success">{{ recatResult }}</span>
            <span v-if="recatError" class="text-[14px] text-destructive">{{ recatError }}</span>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </details>
  </div>
</template>

<style scoped>
.category-ledger {
  border-block-start: 1px solid var(--separator) !important;
}
.category-ledger :deep(th),
.category-ledger :deep(td) {
  padding: 16px;
}
.category-ledger :deep(th) {
  font-size: 12px;
  white-space: nowrap;
}
.category-ledger :deep(td) {
  font-size: 14px;
}
.category-form,
.category-advanced {
  padding-inline: 24px;
}
.category-form :deep(h3),
.category-advanced :deep(h3) {
  font-size: 20px;
  margin-bottom: 8px;
}
.category-advanced {
  margin-top: 32px;
  padding-top: 24px;
}
.category-advanced summary {
  font-size: 14px;
  cursor: pointer;
  padding-block: 12px;
}
.category-advanced[open] > summary {
  margin-bottom: 24px;
}
.category-ledger :deep(tbody tr) {
  border-bottom-color: color-mix(in srgb, var(--separator) 55%, transparent);
}
@media (max-width: 600px) {
  .category-form,
  .category-advanced {
    padding-inline: 16px;
  }
}
</style>
