<script setup lang="ts">
import SelectField from '@/components/ui/select/SelectField.vue';
import { computed, onMounted, ref } from 'vue';
import { Plus, Trash2, X, Pencil } from 'lucide-vue-next';
import {
  aiRecategorize,
  createCategory,
  deleteCategory,
  getCategories,
  getMembers,
  updateCategory,
  type Category,
  type Member,
  type OwnerType,
} from '@/api/client';
import { DEFAULT_CATEGORY_COLOR } from '@/lib/format';
import ConfirmAction from './ConfirmAction.vue';
import CategoryColorPicker from './CategoryColorPicker.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { language, t } from '@/lib/language';

const deleteOpen = ref(false);
const recategorizeOpen = ref(false);
const recatStartDate = ref('');
const recatEndDate = ref('');
const recatLoading = ref(false);
const recatMessage = ref('');
const recatError = ref('');
async function recategorize() {
  if (recatLoading.value) return;
  recatLoading.value = true;
  recatMessage.value = '';
  recatError.value = '';
  try {
    const result = await aiRecategorize(
      recatStartDate.value || undefined,
      recatEndDate.value || undefined,
    );
    recatMessage.value =
      language.value === 'he'
        ? `${result.categorized} עסקאות סווגו`
        : `${result.categorized} transactions categorized`;
  } catch (cause) {
    recatError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    recatLoading.value = false;
  }
}
const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const selectedId = ref<number | 'new' | null>(null);
const selected = computed(
  () => categories.value.find((item) => item.id === selectedId.value) ?? null,
);
const label = ref('');
const slug = ref('');
const color = ref(DEFAULT_CATEGORY_COLOR);
const colorValid = ref(true);
const rules = ref('');
const owner = ref('unassigned');
const included = ref(true);
const copy = computed(() =>
  language.value === 'he'
    ? {
        count: 'קטגוריות',
        add: 'קטגוריה חדשה',
        category: 'קטגוריה',
        rules: 'כללי סיווג',
        owner: 'שיוך כברירת מחדל',
        included: 'נכללת בדוחות',
        slug: 'מזהה',
        label: 'שם לתצוגה',
        color: 'צבע',
        save: 'שמירה',
        saving: 'שומר…',
        cancel: 'ביטול',
        delete: 'מחיקה',
        noRules: 'ללא כללי סיווג',
        empty: 'עדיין אין קטגוריות.',
        choose: 'בחרו קטגוריה כדי לערוך אותה.',
        newTitle: 'קטגוריה חדשה',
        deleteConfirm: 'למחוק את הקטגוריה? העסקאות הקיימות ישמרו את התווית שלה.',
        loadError: 'לא ניתן לטעון קטגוריות',
        saveError: 'לא ניתן לשמור את הקטגוריה',
        deleteError: 'לא ניתן למחוק את הקטגוריה',
        slugHint: 'באנגלית, ללא רווחים. לא ניתן לשנות בהמשך.',
        rulesHint: 'תיאור קצר שעוזר לסווג עסקאות באופן אוטומטי.',
      }
    : {
        count: 'categories',
        add: 'New category',
        category: 'Category',
        rules: 'Classification rules',
        owner: 'Default owner',
        included: 'Include in reports',
        slug: 'Identifier',
        label: 'Display name',
        color: 'Color',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        delete: 'Delete',
        noRules: 'No classification rules',
        empty: 'No categories yet.',
        choose: 'Select a category to edit it.',
        newTitle: 'New category',
        deleteConfirm: 'Delete this category? Existing transactions will keep its label.',
        loadError: 'Could not load categories',
        saveError: 'Could not save category',
        deleteError: 'Could not delete category',
        slugHint: 'Use lowercase English with no spaces. This cannot be changed later.',
        rulesHint: 'A short description that helps classify transactions automatically.',
      },
);

function ownerValue(item: Category) {
  return item.defaultOwnerType === 'member' && item.defaultOwnerMemberId
    ? `member:${item.defaultOwnerMemberId}`
    : item.defaultOwnerType;
}
function ownerLabel(value: string) {
  if (value === 'shared') return t('together');
  if (value.startsWith('member:'))
    return (
      members.value.find((member) => member.id === Number(value.slice(7)))?.name ?? t('unassigned')
    );
  return t('unassigned');
}
function select(item: Category) {
  selectedId.value = item.id;
  label.value = item.label;
  slug.value = item.name;
  color.value = item.color ?? DEFAULT_CATEGORY_COLOR;
  rules.value = item.rules ?? '';
  owner.value = ownerValue(item);
  included.value = !item.ignoredFromStats;
  error.value = '';
}
function create() {
  selectedId.value = 'new';
  label.value = '';
  slug.value = '';
  color.value = DEFAULT_CATEGORY_COLOR;
  rules.value = '';
  owner.value = 'unassigned';
  included.value = true;
  error.value = '';
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [categoryResult, memberResult] = await Promise.all([getCategories(), getMembers()]);
    categories.value = categoryResult.categories;
    members.value = memberResult.members.filter((member) => member.isActive);
    if (window.innerWidth > 1120 && selectedId.value == null && categories.value[0])
      select(categories.value[0]);
  } catch {
    error.value = copy.value.loadError;
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (
    !colorValid.value ||
    !label.value.trim() ||
    (selectedId.value === 'new' && !slug.value.trim())
  )
    return;
  saving.value = true;
  error.value = '';
  try {
    const ownerType: OwnerType = owner.value.startsWith('member:')
      ? 'member'
      : (owner.value as OwnerType);
    const defaultOwnerMemberId = ownerType === 'member' ? Number(owner.value.slice(7)) : null;
    if (selectedId.value === 'new') {
      const result = await createCategory({
        name: slug.value.trim().toLowerCase().replace(/\s+/g, '-'),
        label: label.value.trim(),
        color: color.value,
        rules: rules.value.trim() || undefined,
        defaultOwnerType: ownerType,
        defaultOwnerMemberId,
      });
      categories.value.push(result.category);
      select(result.category);
    } else if (selected.value) {
      const result = await updateCategory(selected.value.id, {
        label: label.value.trim(),
        color: color.value,
        rules: rules.value.trim() || null,
        defaultOwnerType: ownerType,
        defaultOwnerMemberId,
        ignoredFromStats: !included.value,
      });
      const index = categories.value.findIndex((item) => item.id === result.category.id);
      categories.value[index] = result.category;
      select(result.category);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.saveError;
  } finally {
    saving.value = false;
  }
}
async function remove() {
  const item = selected.value;
  if (!item || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await deleteCategory(item.id);
    deleteOpen.value = false;
    categories.value = categories.value.filter((category) => category.id !== item.id);
    selectedId.value = null;
    if (window.innerWidth > 1120 && categories.value[0]) select(categories.value[0]);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.deleteError;
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="category-workspace-page">
    <Teleport to="#toolbar-actions">
      <Button variant="secondary" @click="recategorizeOpen = true">{{
        language === 'he' ? 'סיווג מחדש' : 'Recategorize'
      }}</Button>
      <button type="button" class="category-add-button" @click="create">
        <Plus :size="16" />{{ copy.add }}
      </button>
    </Teleport>
    <div class="category-workspace-top">
      <span
        ><strong>{{ categories.length }}</strong> {{ copy.count }}</span
      >
    </div>
    <p v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </p>
    <div class="category-workspace">
      <section class="category-workspace-list" :aria-label="t('categories')">
        <div class="category-list-head">
          <span>{{ copy.category }}</span
          ><span>{{ copy.owner }}</span>
        </div>
        <button
          v-for="item in categories"
          :key="item.id"
          type="button"
          class="category-list-row"
          :class="{ selected: selectedId === item.id, muted: item.ignoredFromStats }"
          :aria-current="selectedId === item.id ? 'true' : undefined"
          @click="select(item)"
        >
          <span class="category-list-name"
            ><i :style="{ background: item.color ?? DEFAULT_CATEGORY_COLOR }" />
            <span
              ><strong
                ><bdi dir="auto">{{ item.label }}</bdi></strong
              ><small :title="item.rules || copy.noRules"
                ><bdi dir="auto">{{ item.rules || copy.noRules }}</bdi></small
              ></span
            >
          </span>
          <span class="category-list-owner"
            ><bdi dir="auto">{{ ownerLabel(ownerValue(item)) }}</bdi
            ><Pencil :size="14" aria-hidden="true"
          /></span>
        </button>
        <p v-if="loading" class="category-list-empty">{{ t('loadingTransactions') }}</p>
        <p v-else-if="!categories.length" class="category-list-empty">{{ copy.empty }}</p>
      </section>
      <button
        v-if="selectedId !== null"
        type="button"
        class="category-inspector-backdrop"
        :aria-label="copy.cancel"
        @click="selectedId = null"
      />
      <aside v-if="selectedId !== null" class="category-inspector" :aria-label="t('details')">
        <div class="category-inspector-head">
          <h3>
            <bdi dir="auto">{{ selectedId === 'new' ? copy.newTitle : label }}</bdi>
          </h3>
          <button type="button" :aria-label="copy.cancel" @click="selectedId = null">
            <X :size="18" />
          </button>
        </div>
        <div class="category-inspector-body">
          <label
            ><span>{{ copy.label }}</span
            ><input v-model="label" type="text"
          /></label>
          <label
            ><span>{{ copy.slug }}</span
            ><input v-model="slug" type="text" :readonly="selectedId !== 'new'" dir="ltr" /><small
              v-if="selectedId === 'new'"
              >{{ copy.slugHint }}</small
            ></label
          >
          <fieldset class="category-color-field">
            <legend>{{ copy.color }}</legend>
            <CategoryColorPicker :key="selectedId" v-model="color" v-model:valid="colorValid" />
          </fieldset>
          <label
            ><span>{{ copy.rules }}</span
            ><textarea v-model="rules" rows="4" /><small>{{ copy.rulesHint }}</small></label
          >
          <label
            ><span>{{ copy.owner }}</span
            ><SelectField
              v-model="owner"
              :options="[
                { value: 'unassigned', label: t('unassigned') },
                { value: 'shared', label: t('together') },
                ...members.map((member) => ({ value: `member:${member.id}`, label: member.name })),
              ]"
          /></label>
          <label v-if="selectedId !== 'new'" class="category-check"
            ><input v-model="included" type="checkbox" /><span>{{ copy.included }}</span></label
          >
        </div>
        <div class="category-inspector-actions">
          <button
            v-if="selectedId !== 'new'"
            type="button"
            class="category-delete"
            :disabled="saving"
            @click="deleteOpen = true"
          >
            <Trash2 :size="15" />{{ copy.delete }}
          </button>
          <button
            type="button"
            class="category-save"
            :disabled="
              saving || !colorValid || !label.trim() || (selectedId === 'new' && !slug.trim())
            "
            @click="save"
          >
            {{ saving ? copy.saving : copy.save }}
          </button>
        </div>
      </aside>
      <div v-else class="category-inspector-placeholder">{{ copy.choose }}</div>
    </div>
    <ConfirmAction
      v-model:open="deleteOpen"
      :title="`${copy.delete}: ${selected?.label ?? ''}`"
      :description="copy.deleteConfirm"
      :pending="saving"
      :error="error"
      @confirm="remove"
    />
    <Dialog v-model:open="recategorizeOpen"
      ><DialogContent
        ><DialogHeader>
          <DialogTitle>{{
            language === 'he' ? 'סיווג עסקאות מחדש' : 'Recategorize transactions'
          }}</DialogTitle>
          <DialogDescription>{{
            language === 'he'
              ? 'הסיווג יחליף את הקטגוריות הקיימות בטווח שנבחר. ללא תאריכים, כל העסקאות ייכללו.'
              : 'Replace existing categories in the selected date range using your categorization rules. Leave dates empty to include all transactions.'
          }}</DialogDescription>
        </DialogHeader>
        <div class="grid grid-cols-2 gap-4">
          <label class="field-label"
            >{{ t('startDate')
            }}<Input v-model="recatStartDate" type="date" :max="recatEndDate || undefined" /></label
          ><label class="field-label"
            >{{ t('endDate')
            }}<Input v-model="recatEndDate" type="date" :min="recatStartDate || undefined"
          /></label>
        </div>
        <p v-if="recatMessage" role="status" class="text-sm text-success">{{ recatMessage }}</p>
        <p v-if="recatError" role="alert" class="text-sm text-destructive">{{ recatError }}</p>
        <DialogFooter
          ><DialogClose as-child
            ><Button variant="secondary">{{ t('cancel') }}</Button></DialogClose
          ><Button
            variant="filled"
            :disabled="
              recatLoading || (!!recatStartDate && !!recatEndDate && recatStartDate > recatEndDate)
            "
            @click="recategorize"
            >{{
              recatLoading ? t('saving') : language === 'he' ? 'סיווג מחדש' : 'Recategorize'
            }}</Button
          ></DialogFooter
        >
      </DialogContent></Dialog
    >
  </div>
</template>

<style scoped>
.category-workspace-top {
  padding: 0 0 24px;
  font-size: 14px;
}
.category-list-head,
.category-list-row {
  padding-inline: 16px;
}
.category-list-head {
  font-size: 12px;
}
.category-list-row {
  padding-block: 16px;
}
.category-list-name strong {
  font-size: 14px;
}
.category-list-name small {
  margin-top: 6px;
  font-size: 12px;
}
.category-inspector-head,
.category-inspector-body,
.category-inspector-actions {
  padding-inline: 24px;
}
.category-inspector-head {
  min-height: 64px;
}
.category-inspector-head h3 {
  font-size: var(--type-section);
  font-weight: 650;
}
.category-inspector-body {
  padding-block: 24px;
}
.category-inspector-body label {
  margin: 0;
}
.category-inspector-actions {
  padding-block: 20px;
}
.category-inspector-head button {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}
.category-inspector-body input:not([type='checkbox']),
.category-inspector-body select,
.category-inspector-body textarea {
  min-height: var(--control-height);
  font-size: 14px;
}
.category-inspector-body small {
  font-size: 12px;
  line-height: 1.5;
}
.category-inspector-actions button {
  min-height: var(--control-height);
  font-size: 14px;
}
.category-list-row {
  border-bottom-color: color-mix(in srgb, var(--separator) 55%, transparent);
}
.category-list-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.category-list-empty,
.category-inspector-placeholder,
.category-list-owner {
  font-size: 14px;
}

.category-list-owner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.category-list-owner bdi {
  overflow: hidden;
  text-overflow: ellipsis;
}
.category-list-owner svg {
  flex-shrink: 0;
}
.category-inspector-head h3 {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
