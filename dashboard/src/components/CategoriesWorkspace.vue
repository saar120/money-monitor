<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus, Trash2, X } from 'lucide-vue-next';
import {
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
import { language, t } from '@/lib/language';

const categories = ref<Category[]>([]);
const members = ref<Member[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const selectedId = ref<number | 'new' | null>(null);
const selected = computed(() => categories.value.find((item) => item.id === selectedId.value) ?? null);
const label = ref('');
const slug = ref('');
const color = ref(DEFAULT_CATEGORY_COLOR);
const rules = ref('');
const owner = ref('unassigned');
const included = ref(true);
const copy = computed(() =>
  language.value === 'he'
    ? {
        count: 'קטגוריות', add: 'קטגוריה חדשה', advanced: 'כלים מתקדמים', category: 'קטגוריה',
        rules: 'כללי סיווג', owner: 'שיוך כברירת מחדל', included: 'נכללת בדוחות',
        slug: 'מזהה', label: 'שם לתצוגה', color: 'צבע', save: 'שמירה', saving: 'שומר…',
        cancel: 'ביטול', delete: 'מחיקה', noRules: 'ללא כללי סיווג',
        empty: 'עדיין אין קטגוריות.', choose: 'בחרו קטגוריה כדי לערוך אותה.',
        newTitle: 'קטגוריה חדשה', deleteConfirm: 'למחוק את הקטגוריה? העסקאות הקיימות ישמרו את התווית שלה.',
        loadError: 'לא ניתן לטעון קטגוריות', saveError: 'לא ניתן לשמור את הקטגוריה',
        deleteError: 'לא ניתן למחוק את הקטגוריה', slugHint: 'באנגלית, ללא רווחים. לא ניתן לשנות בהמשך.',
        rulesHint: 'תיאור קצר שעוזר לסווג עסקאות באופן אוטומטי.',
      }
    : {
        count: 'categories', add: 'New category', advanced: 'Advanced tools', category: 'Category',
        rules: 'Classification rules', owner: 'Default owner', included: 'Include in reports',
        slug: 'Identifier', label: 'Display name', color: 'Color', save: 'Save', saving: 'Saving…',
        cancel: 'Cancel', delete: 'Delete', noRules: 'No classification rules',
        empty: 'No categories yet.', choose: 'Select a category to edit it.',
        newTitle: 'New category', deleteConfirm: 'Delete this category? Existing transactions will keep its label.',
        loadError: 'Could not load categories', saveError: 'Could not save category',
        deleteError: 'Could not delete category', slugHint: 'Use lowercase English with no spaces. This cannot be changed later.',
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
    return members.value.find((member) => member.id === Number(value.slice(7)))?.name ?? t('unassigned');
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
  if (!label.value.trim() || (selectedId.value === 'new' && !slug.value.trim())) return;
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
        label: label.value.trim(), color: color.value, rules: rules.value.trim() || undefined,
        defaultOwnerType: ownerType, defaultOwnerMemberId,
      });
      categories.value.push(result.category);
      select(result.category);
    } else if (selected.value) {
      const result = await updateCategory(selected.value.id, {
        label: label.value.trim(), color: color.value, rules: rules.value.trim() || null,
        defaultOwnerType: ownerType, defaultOwnerMemberId, ignoredFromStats: !included.value,
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
  if (!item || !window.confirm(copy.value.deleteConfirm)) return;
  saving.value = true;
  error.value = '';
  try {
    await deleteCategory(item.id);
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
      <button type="button" class="category-add-button" @click="create"><Plus :size="16" />{{ copy.add }}</button>
    </Teleport>
    <div class="category-workspace-top">
      <span><strong>{{ categories.length }}</strong> {{ copy.count }}</span>
      <RouterLink to="/categories/advanced">{{ copy.advanced }}</RouterLink>
    </div>
    <p v-if="error" class="ledger-notice" role="alert">{{ error }} <button @click="load">{{ t('retry') }}</button></p>
    <div class="category-workspace">
      <section class="category-workspace-list" :aria-label="t('categories')">
        <div class="category-list-head"><span>{{ copy.category }}</span><span>{{ copy.owner }}</span></div>
        <button
          v-for="item in categories" :key="item.id" type="button" class="category-list-row"
          :class="{ selected: selectedId === item.id, muted: item.ignoredFromStats }"
          :aria-current="selectedId === item.id ? 'true' : undefined" @click="select(item)"
        >
          <span class="category-list-name"><i :style="{ background: item.color ?? DEFAULT_CATEGORY_COLOR }" />
            <span><strong dir="auto">{{ item.label }}</strong><small dir="auto">{{ item.rules || copy.noRules }}</small></span>
          </span>
          <span class="category-list-owner">{{ ownerLabel(ownerValue(item)) }}</span>
        </button>
        <p v-if="loading" class="category-list-empty">{{ t('loadingTransactions') }}</p>
        <p v-else-if="!categories.length" class="category-list-empty">{{ copy.empty }}</p>
      </section>
      <button v-if="selectedId !== null" type="button" class="category-inspector-backdrop" :aria-label="copy.cancel" @click="selectedId = null" />
      <aside v-if="selectedId !== null" class="category-inspector" :aria-label="t('details')">
        <div class="category-inspector-head"><h3>{{ selectedId === 'new' ? copy.newTitle : label }}</h3>
          <button type="button" :aria-label="copy.cancel" @click="selectedId = null"><X :size="18" /></button>
        </div>
        <div class="category-inspector-body">
          <label><span>{{ copy.label }}</span><input v-model="label" type="text" /></label>
          <label><span>{{ copy.slug }}</span><input v-model="slug" type="text" :readonly="selectedId !== 'new'" dir="ltr" /><small v-if="selectedId === 'new'">{{ copy.slugHint }}</small></label>
          <label><span>{{ copy.color }}</span><input v-model="color" type="color" class="category-color-input" /></label>
          <label><span>{{ copy.rules }}</span><textarea v-model="rules" rows="4" /><small>{{ copy.rulesHint }}</small></label>
          <label><span>{{ copy.owner }}</span><select v-model="owner">
            <option value="unassigned">{{ t('unassigned') }}</option><option value="shared">{{ t('together') }}</option>
            <option v-for="member in members" :key="member.id" :value="`member:${member.id}`">{{ member.name }}</option>
          </select></label>
          <label v-if="selectedId !== 'new'" class="category-check"><input v-model="included" type="checkbox" /><span>{{ copy.included }}</span></label>
        </div>
        <div class="category-inspector-actions">
          <button v-if="selectedId !== 'new'" type="button" class="category-delete" :disabled="saving" @click="remove"><Trash2 :size="15" />{{ copy.delete }}</button>
          <button type="button" class="category-save" :disabled="saving || !label.trim() || (selectedId === 'new' && !slug.trim())" @click="save">{{ saving ? copy.saving : copy.save }}</button>
        </div>
      </aside>
      <div v-else class="category-inspector-placeholder">{{ copy.choose }}</div>
    </div>
  </div>
</template>
