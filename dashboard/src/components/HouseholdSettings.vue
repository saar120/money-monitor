<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  applyOwnershipRules,
  createMember,
  createOwnershipRule,
  deleteMember,
  deleteOwnershipRule,
  getAccounts,
  getCategories,
  getMembers,
  getOwnershipRules,
  updateMember,
  updateOwnershipRule,
  type Account,
  type Category,
  type Member,
  type OwnerType,
  type OwnershipRule,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';
import { Badge } from '@/components/ui/badge';
import { Check, Plus, Trash2, X } from 'lucide-vue-next';
import { language } from '@/lib/language';

const copy = computed(() =>
  language.value === 'he'
    ? {
        title: 'משק בית',
        hint: 'בני בית, כללי הוצאות משותפות ושיוך עסקאות',
        members: 'בני בית',
        loading: 'טוען את הגדרות משק הבית…',
        inactive: 'לא פעיל',
        rename: 'שינוי שם',
        newMember: 'שם בן בית חדש',
        addMember: 'הוספת בן בית',
        ownership: 'כללי שיוך',
        anyDescription: 'כל תיאור',
        anyCategory: 'כל קטגוריה',
        anyMember: 'כל בן בית',
        ruleName: 'שם הכלל',
        descriptionContains: 'התיאור מכיל',
        anyAccount: 'כל חשבון',
        target: 'שיוך לעסקה',
        together: 'ביחד',
        unassigned: 'ללא שיוך',
        addRule: 'הוספת כלל',
        applyRules: 'החלת הכללים',
        applying: 'מחיל…',
      }
    : {
        title: 'Household',
        hint: 'Members, shared expense rules, and ownership defaults',
        members: 'Members',
        loading: 'Loading household settings…',
        inactive: 'Inactive',
        rename: 'Rename',
        newMember: 'New member name',
        addMember: 'Add member',
        ownership: 'Ownership rules',
        anyDescription: 'Any description',
        anyCategory: 'Any category',
        anyMember: 'Any member',
        ruleName: 'Rule name',
        descriptionContains: 'Description contains',
        anyAccount: 'Any account',
        target: 'Target owner',
        together: 'Together',
        unassigned: 'Unassigned',
        addRule: 'Add rule',
        applyRules: 'Apply rules',
        applying: 'Applying…',
      },
);

const members = ref<Member[]>([]);
const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const rules = ref<OwnershipRule[]>([]);
const loading = ref(false);
const saving = ref(false);
const applying = ref(false);
const message = ref('');
const error = ref('');

const newMemberName = ref('');
const editingMemberId = ref<number | null>(null);
const editingMemberName = ref('');

const newRule = ref({
  name: '',
  accountId: 'any',
  accountMemberId: 'any',
  categoryName: 'any',
  descriptionContains: '',
  target: 'shared',
});

const activeMembers = computed(() => members.value.filter((m) => m.isActive));
const memberName = (id: number | null) =>
  id == null
    ? copy.value.anyMember
    : (members.value.find((m) => m.id === id)?.name ?? copy.value.anyMember);

function ownerTypeFromValue(value: string): OwnerType {
  return value.startsWith('member:') ? 'member' : (value as OwnerType);
}

function ownerMemberIdFromValue(value: string): number | null {
  return value.startsWith('member:') ? Number(value.slice('member:'.length)) : null;
}

function targetLabel(type: OwnerType, memberId: number | null): string {
  if (type === 'shared') return copy.value.together;
  if (type === 'unassigned') return copy.value.unassigned;
  return memberName(memberId);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [memberRes, accountRes, categoryRes, ruleRes] = await Promise.all([
      getMembers(),
      getAccounts(),
      getCategories(),
      getOwnershipRules(),
    ]);
    members.value = memberRes.members;
    accounts.value = accountRes.accounts;
    categories.value = categoryRes.categories;
    rules.value = ruleRes.rules;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load household settings';
  } finally {
    loading.value = false;
  }
}

async function addMember() {
  if (!newMemberName.value.trim()) return;
  saving.value = true;
  try {
    const { member } = await createMember({ name: newMemberName.value.trim() });
    members.value.push(member);
    newMemberName.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to add member';
  } finally {
    saving.value = false;
  }
}

function startEdit(member: Member) {
  editingMemberId.value = member.id;
  editingMemberName.value = member.name;
}

function cancelEdit() {
  editingMemberId.value = null;
  editingMemberName.value = '';
}

async function saveMember(member: Member) {
  const name = editingMemberName.value.trim();
  if (!name) return;
  const res = await updateMember(member.id, { name });
  const idx = members.value.findIndex((m) => m.id === member.id);
  if (idx !== -1) members.value[idx] = res.member;
  cancelEdit();
}

async function deactivateMember(member: Member) {
  try {
    const res = await deleteMember(member.id);
    const idx = members.value.findIndex((m) => m.id === member.id);
    if (idx !== -1) members.value[idx] = res.member;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to deactivate member';
  }
}

async function addRule() {
  if (!newRule.value.name.trim()) return;
  saving.value = true;
  try {
    const { rule } = await createOwnershipRule({
      name: newRule.value.name.trim(),
      priority: rules.value.length + 1,
      enabled: true,
      accountId: newRule.value.accountId === 'any' ? null : Number(newRule.value.accountId),
      accountMemberId:
        newRule.value.accountMemberId === 'any' ? null : Number(newRule.value.accountMemberId),
      categoryName: newRule.value.categoryName === 'any' ? null : newRule.value.categoryName,
      descriptionContains: newRule.value.descriptionContains.trim() || null,
      minAmount: null,
      maxAmount: null,
      targetOwnerType: ownerTypeFromValue(newRule.value.target),
      targetOwnerMemberId: ownerMemberIdFromValue(newRule.value.target),
    });
    rules.value.push(rule);
    newRule.value = {
      name: '',
      accountId: 'any',
      accountMemberId: 'any',
      categoryName: 'any',
      descriptionContains: '',
      target: 'shared',
    };
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to add rule';
  } finally {
    saving.value = false;
  }
}

async function toggleRule(rule: OwnershipRule) {
  const { rule: updated } = await updateOwnershipRule(rule.id, { enabled: !rule.enabled });
  const idx = rules.value.findIndex((r) => r.id === rule.id);
  if (idx !== -1) rules.value[idx] = updated;
}

async function removeRule(rule: OwnershipRule) {
  await deleteOwnershipRule(rule.id);
  rules.value = rules.value.filter((r) => r.id !== rule.id);
}

async function applyRules() {
  applying.value = true;
  message.value = '';
  error.value = '';
  try {
    const result = await applyOwnershipRules();
    message.value = `${result.updated} transactions updated`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to apply rules';
  } finally {
    applying.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SettingsGroup :title="copy.title" :description="copy.hint">
    <SettingsRow :label="copy.members" vertical>
      <div v-if="loading" class="text-[13px] text-text-secondary">
        {{ copy.loading }}
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="member in members"
          :key="member.id"
          class="flex items-center gap-2 rounded-lg border border-separator/60 px-3 py-2"
          :class="{ 'opacity-50': !member.isActive }"
        >
          <template v-if="editingMemberId === member.id">
            <Input
              v-model="editingMemberName"
              class="h-8 max-w-56"
              @keyup.enter="saveMember(member)"
            />
            <Button size="icon-sm" variant="ghost" @click="saveMember(member)">
              <Check class="h-4 w-4 text-success" />
            </Button>
            <Button size="icon-sm" variant="ghost" @click="cancelEdit">
              <X class="h-4 w-4" />
            </Button>
          </template>
          <template v-else>
            <span class="text-[13px] font-medium">{{ member.name }}</span>
            <Badge v-if="!member.isActive" variant="secondary" class="text-[10px]">{{
              copy.inactive
            }}</Badge>
            <Button size="sm" variant="secondary" class="ml-auto" @click="startEdit(member)">
              {{ copy.rename }}
            </Button>
            <Button
              v-if="member.isActive"
              size="icon-sm"
              variant="ghost"
              class="text-text-tertiary hover:text-destructive"
              @click="deactivateMember(member)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </template>
        </div>
        <div class="flex gap-2">
          <Input v-model="newMemberName" :placeholder="copy.newMember" class="max-w-64" />
          <Button size="sm" :disabled="saving || !newMemberName.trim()" @click="addMember">
            <Plus class="h-4 w-4 mr-1" />
            {{ copy.addMember }}
          </Button>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow :label="copy.ownership" vertical>
      <div class="space-y-2">
        <div
          v-for="rule in rules"
          :key="rule.id"
          class="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg border border-separator/60 px-3 py-2"
          :class="{ 'opacity-50': !rule.enabled }"
        >
          <div class="min-w-0">
            <div class="text-[13px] font-medium truncate">{{ rule.name }}</div>
            <div class="text-[11px] text-text-secondary truncate">
              {{ rule.descriptionContains || copy.anyDescription }} ·
              {{ rule.categoryName || copy.anyCategory }} · {{ memberName(rule.accountMemberId) }} →
              {{ targetLabel(rule.targetOwnerType, rule.targetOwnerMemberId) }}
            </div>
          </div>
          <Switch :model-value="rule.enabled" @update:model-value="toggleRule(rule)" />
          <Button
            size="icon-sm"
            variant="ghost"
            class="text-text-tertiary hover:text-destructive"
            @click="removeRule(rule)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>

        <div class="grid grid-cols-2 gap-2 rounded-lg border border-separator/60 p-3">
          <Input v-model="newRule.name" :placeholder="copy.ruleName" />
          <Input v-model="newRule.descriptionContains" :placeholder="copy.descriptionContains" />
          <Select v-model="newRule.accountId">
            <SelectTrigger><SelectValue :placeholder="copy.anyAccount" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{{ copy.anyAccount }}</SelectItem>
              <SelectItem v-for="account in accounts" :key="account.id" :value="String(account.id)">
                {{ account.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="newRule.accountMemberId">
            <SelectTrigger><SelectValue :placeholder="copy.anyMember" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{{ copy.anyMember }}</SelectItem>
              <SelectItem
                v-for="member in activeMembers"
                :key="member.id"
                :value="String(member.id)"
              >
                {{ member.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="newRule.categoryName">
            <SelectTrigger><SelectValue :placeholder="copy.anyCategory" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{{ copy.anyCategory }}</SelectItem>
              <SelectItem
                v-for="category in categories"
                :key="category.name"
                :value="category.name"
              >
                {{ category.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="newRule.target">
            <SelectTrigger><SelectValue :placeholder="copy.target" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="shared">{{ copy.together }}</SelectItem>
              <SelectItem value="unassigned">{{ copy.unassigned }}</SelectItem>
              <SelectItem
                v-for="member in activeMembers"
                :key="member.id"
                :value="`member:${member.id}`"
              >
                {{ member.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div class="col-span-2 flex items-center gap-2">
            <Button size="sm" :disabled="saving || !newRule.name.trim()" @click="addRule">
              {{ copy.addRule }}
            </Button>
            <Button size="sm" variant="secondary" :disabled="applying" @click="applyRules">
              {{ applying ? copy.applying : copy.applyRules }}
            </Button>
            <span v-if="message" class="text-[13px] text-success">{{ message }}</span>
            <span v-if="error" class="text-[13px] text-destructive">{{ error }}</span>
          </div>
        </div>
      </div>
    </SettingsRow>
  </SettingsGroup>
</template>
