<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  aiRecategorize,
  type Category,
  type CategoryOwnerMember,
  type OwnerType,
  type CategoryMutationMeta,
  APIError,
  rememberCategoryVersions,
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
import {
  emptyCategoryCreateDraft,
  intendedNullableColor,
  toggleRecoveryDecision,
} from '@/lib/category-recovery';

const categories = ref<Category[]>([]);
const members = ref<CategoryOwnerMember[]>([]);
const loading = ref(false);
const error = ref('');

// Editing state
const editingId = ref<number | null>(null);
const reapplyId = ref<number | null>(null);
const editLabel = ref('');
const editColor = ref('');
const editOriginalColor = ref<string | null>(null);
const editRules = ref('');
const editOwner = ref('unassigned');

// New category form
const newName = ref('');
const newLabel = ref('');
const newColor = ref(DEFAULT_CATEGORY_COLOR);
const newRules = ref('');
const newOwner = ref('unassigned');
const newIgnored = ref(false);
const showNewForm = ref(false);
const saving = ref(false);
const pendingCreateKey = ref<string>(crypto.randomUUID());
const pendingCreatePayload = ref('');

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
    await reloadCategories();
  } catch {
    error.value = 'Failed to load categories';
  } finally {
    loading.value = false;
  }
}

async function reloadCategories() {
  const res = await getCategories();
  categories.value = res.categories;
  members.value = res.ownerMembers;
  rememberCategoryVersions(res.categories);
  return res.categories;
}

async function recoverCategories() {
  try {
    return await reloadCategories();
  } catch {
    return null;
  }
}

function applyRefreshHints(meta: CategoryMutationMeta) {
  const domains = meta.refreshHints.map((hint) => hint.domain);
  if (domains.includes('categories')) {
    window.dispatchEvent(
      new globalThis.CustomEvent('money-monitor:refresh', { detail: { domains } }),
    );
  }
}

function refreshCategoryProjections() {
  window.dispatchEvent(
    new globalThis.CustomEvent('money-monitor:refresh', {
      detail: { domains: ['categories'] },
    }),
  );
}

function startEdit(cat: Category) {
  editingId.value = cat.id;
  editLabel.value = cat.label;
  editOriginalColor.value = cat.color;
  editColor.value = cat.color ?? DEFAULT_CATEGORY_COLOR;
  editRules.value = cat.rules ?? '';
  editOwner.value =
    cat.defaultOwnerType === 'member' && cat.defaultOwnerMemberId
      ? `member:${cat.defaultOwnerMemberId}`
      : cat.defaultOwnerType;
}

function cancelEdit() {
  editingId.value = null;
  reapplyId.value = null;
}

async function saveEdit(cat: Category) {
  try {
    const res = await updateCategory(cat.id, {
      label: editLabel.value,
      color: intendedEditColor(),
      rules: editRules.value || null,
      defaultOwnerType: ownerTypeFromValue(editOwner.value),
      defaultOwnerMemberId: ownerMemberIdFromValue(editOwner.value),
    });
    const idx = categories.value.findIndex((c) => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    rememberCategoryVersions([res.category]);
    applyRefreshHints(res.meta);
    editingId.value = null;
    reapplyId.value = null;
    error.value = '';
  } catch (caught) {
    const code = caught instanceof APIError ? caught.code : undefined;
    if (code === 'resource_conflict' || isUnknownOutcome(caught)) {
      const authoritative = await recoverCategories();
      if (!authoritative) {
        error.value = 'Could not confirm the result. Reconnect, then reapply your draft.';
        return;
      }
      const latest = authoritative.find((value) => value.id === cat.id);
      if (!latest) {
        error.value = 'This category no longer exists.';
        editingId.value = null;
        return;
      }
      if (isUnknownOutcome(caught) && categoryMatchesDraft(latest)) {
        refreshCategoryProjections();
        editingId.value = null;
        error.value = '';
        return;
      }
      editingId.value = cat.id;
      reapplyId.value = cat.id;
      error.value = 'This category changed on another client. Review your draft, then reapply it.';
    } else {
      error.value = 'Failed to save';
    }
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
    const res = await deleteCategory(cat.id);
    categories.value = categories.value.filter((c) => c.id !== cat.id);
    applyRefreshHints(res.meta);
    error.value = '';
  } catch (caught) {
    if (caught instanceof APIError && caught.code === 'resource_conflict') {
      if (!(await recoverCategories())) {
        error.value = 'Could not confirm deletion. Reconnect before trying again.';
        return;
      }
      error.value = 'This category changed. Review it and confirm deletion again.';
    } else if (isUnknownOutcome(caught)) {
      const latest = await recoverCategories();
      if (!latest) {
        error.value = 'Could not confirm deletion. Reconnect before trying again.';
        return;
      }
      error.value = latest.some((value) => value.id === cat.id)
        ? 'Deletion was not accepted. Review the latest category and confirm again.'
        : '';
      if (!latest.some((value) => value.id === cat.id)) refreshCategoryProjections();
    } else {
      error.value = 'Failed to delete';
    }
  }
}

async function addCategory() {
  if (!newName.value || !newLabel.value) return;
  saving.value = true;
  const payload = JSON.stringify({
    name: newName.value,
    label: newLabel.value,
    color: newColor.value,
    rules: newRules.value,
    owner: newOwner.value,
    ignored: newIgnored.value,
  });
  if (pendingCreatePayload.value !== payload) {
    pendingCreateKey.value = crypto.randomUUID();
    pendingCreatePayload.value = payload;
  }
  try {
    const res = await createCategory({
      idempotencyKey: pendingCreateKey.value,
      name: newName.value,
      label: newLabel.value,
      color: newColor.value,
      rules: newRules.value || undefined,
      defaultOwnerType: ownerTypeFromValue(newOwner.value),
      defaultOwnerMemberId: ownerMemberIdFromValue(newOwner.value),
      ignoredFromStats: newIgnored.value,
    });
    categories.value.push(res.category);
    rememberCategoryVersions([res.category]);
    applyRefreshHints(res.meta);
    resetCreateForm();
  } catch (e: unknown) {
    if (isUnknownOutcome(e)) {
      const latest = await recoverCategories();
      if (!latest) {
        error.value = 'Could not confirm the result. Reconnect, then retry the same receipt.';
        return;
      }
      const accepted = latest.some(categoryMatchesCreate);
      if (accepted) {
        refreshCategoryProjections();
        resetCreateForm();
        error.value = '';
      } else {
        error.value = 'The result is unknown. Try again to reuse the same Mutation Receipt.';
      }
    } else {
      error.value = e instanceof Error ? e.message : 'Failed to create';
    }
  } finally {
    saving.value = false;
  }
}

function resetCreateForm() {
  const reset = emptyCategoryCreateDraft(crypto.randomUUID(), DEFAULT_CATEGORY_COLOR);
  newName.value = reset.name;
  newLabel.value = reset.label;
  newColor.value = reset.color;
  newRules.value = reset.rules;
  newOwner.value = reset.owner;
  newIgnored.value = reset.ignored;
  pendingCreateKey.value = reset.idempotencyKey;
  pendingCreatePayload.value = reset.attemptedPayload;
  showNewForm.value = false;
}

function isUnknownOutcome(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof APIError && error.code === 'unknown_outcome')
  );
}

function categoryMatchesDraft(category: Category): boolean {
  return (
    category.label === editLabel.value &&
    category.color === intendedEditColor() &&
    category.rules === (editRules.value || null) &&
    ownerValue(category) === editOwner.value
  );
}

function intendedEditColor(): string | null {
  return intendedNullableColor(editOriginalColor.value, editColor.value, DEFAULT_CATEGORY_COLOR);
}

function categoryMatchesCreate(category: Category): boolean {
  return (
    category.name === newName.value &&
    category.label === newLabel.value &&
    category.color === newColor.value &&
    category.rules === (newRules.value || null) &&
    ownerValue(category) === newOwner.value &&
    category.ignoredFromStats === newIgnored.value
  );
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
  const intendedIgnored = !cat.ignoredFromStats;
  try {
    const res = await updateCategory(cat.id, { ignoredFromStats: intendedIgnored });
    const idx = categories.value.findIndex((c) => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    rememberCategoryVersions([res.category]);
    applyRefreshHints(res.meta);
    error.value = '';
  } catch (caught) {
    const unknownOutcome = isUnknownOutcome(caught);
    if ((caught instanceof APIError && caught.code === 'resource_conflict') || unknownOutcome) {
      const authoritative = await recoverCategories();
      if (!authoritative) {
        error.value = 'Could not confirm the result. Reconnect, then reapply the toggle.';
      } else if (
        toggleRecoveryDecision(authoritative, cat.id, intendedIgnored) === 'accepted'
      ) {
        refreshCategoryProjections();
        error.value = '';
      } else {
        error.value = 'This category changed. Review the latest value, then reapply the toggle.';
      }
    } else {
      error.value = 'Failed to update';
    }
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
      <SettingsRow label="Default Owner">
        <Select v-model="newOwner">
          <SelectTrigger class="w-44">
            <SelectValue placeholder="Default owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Account member</SelectItem>
            <SelectItem value="shared">Together</SelectItem>
            <SelectItem
              v-for="member in members"
              :key="member.id"
              :value="`member:${member.id}`"
              :disabled="!member.isActive"
            >
              {{ member.name }}{{ member.isActive ? '' : ' (Inactive)' }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Ignore from statistics">
        <Switch :model-value="newIgnored" @update:model-value="newIgnored = $event" />
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
                      <button
                        class="text-success hover:text-success/80"
                        :aria-label="
                          reapplyId === cat.id
                            ? 'Reapply category changes'
                            : 'Save category changes'
                        "
                        @click="saveEdit(cat)"
                      >
                        <Check class="h-4 w-4" />
                        <span v-if="reapplyId === cat.id" class="ml-1 text-xs">Reapply</span>
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
                    <Select v-model="editOwner">
                      <SelectTrigger class="h-8 w-44">
                        <SelectValue placeholder="Default owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Account member</SelectItem>
                        <SelectItem value="shared">Together</SelectItem>
                        <SelectItem
                          v-for="member in members"
                          :key="member.id"
                          :value="`member:${member.id}`"
                          :disabled="!member.isActive"
                        >
                          {{ member.name }}{{ member.isActive ? '' : ' (Inactive)' }}
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
                class="text-[11px] text-text-secondary max-w-[200px] truncate"
                :title="cat.rules ?? ''"
              >
                {{ cat.rules ?? '—' }}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" class="text-[11px]">
                  {{ ownerLabel(ownerValue(cat)) }}
                </Badge>
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
