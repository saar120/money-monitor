<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Building2, CreditCard, FileSpreadsheet, Plus, RefreshCw, X } from 'lucide-vue-next';
import {
  getAccounts,
  getMembers,
  triggerScrape,
  updateAccount,
  type Account,
  type Member,
} from '@/api/client';
import { formatCurrency } from '@/lib/format';
import { language, t } from '@/lib/language';
import OneZeroImportDialog from './OneZeroImportDialog.vue';

const accounts = ref<Account[]>([]);
const members = ref<Member[]>([]);
const selectedId = ref<number | null>(null);
const selected = computed(
  () => accounts.value.find((account) => account.id === selectedId.value) ?? null,
);
const name = ref('');
const memberId = ref('');
const active = ref(true);
const manualOnly = ref(false);
const showBrowser = ref(false);
const loading = ref(true);
const saving = ref(false);
const syncing = ref(false);
const error = ref('');
const message = ref('');
const importOpen = ref(false);
const sections = computed(() =>
  [
    {
      type: 'bank',
      label: t('banks'),
      icon: Building2,
      rows: accounts.value.filter((item) => item.accountType === 'bank'),
    },
    {
      type: 'credit_card',
      label: t('creditCards'),
      icon: CreditCard,
      rows: accounts.value.filter((item) => item.accountType === 'credit_card'),
    },
  ].filter((section) => section.rows.length),
);
const copy = computed(() =>
  language.value === 'he'
    ? {
        add: 'הוספת חשבון',
        advanced: 'ניהול מלא',
        count: 'חשבונות',
        choose: 'בחרו חשבון כדי לראות פרטים.',
        empty: 'עדיין אין חשבונות.',
        number: 'מספר חשבון',
        name: 'שם החשבון',
        member: 'בן בית',
        status: 'מצב',
        active: 'פעיל',
        inactive: 'מושבת',
        manual: 'סנכרון ידני בלבד',
        browser: 'הצגת דפדפן בזמן סנכרון',
        lastSync: 'סנכרון אחרון',
        never: 'עדיין לא סונכרן',
        save: 'שמירה',
        saving: 'שומר…',
        sync: 'סנכרון עכשיו',
        syncing: 'מסנכרן…',
        syncStarted: 'הסנכרון התחיל',
        loadError: 'לא ניתן לטעון חשבונות',
        saveError: 'לא ניתן לשמור את החשבון',
        syncError: 'לא ניתן להתחיל סנכרון',
        noMember: 'ללא שיוך',
        import: 'ייבוא דוח בנק',
        importHint: 'בדיקת תנועות וכפילויות לפני הייבוא',
      }
    : {
        add: 'Add account',
        advanced: 'Full management',
        count: 'accounts',
        choose: 'Select an account to see details.',
        empty: 'No accounts yet.',
        number: 'Account number',
        name: 'Account name',
        member: 'Member',
        status: 'Status',
        active: 'Active',
        inactive: 'Disabled',
        manual: 'Manual sync only',
        browser: 'Show browser during sync',
        lastSync: 'Last sync',
        never: 'Never synced',
        save: 'Save',
        saving: 'Saving…',
        sync: 'Sync now',
        syncing: 'Syncing…',
        syncStarted: 'Sync started',
        loadError: 'Could not load accounts',
        saveError: 'Could not save account',
        syncError: 'Could not start sync',
        noMember: 'Unassigned',
        import: 'Import bank statement',
        importHint: 'Review transactions and duplicates before import',
      },
);

function memberName(id: number | null) {
  return members.value.find((member) => member.id === id)?.name ?? copy.value.noMember;
}
function balance(account: Account) {
  return account.balance == null
    ? '—'
    : `${account.balance < 0 ? '−' : ''}${formatCurrency(account.balance)}`;
}
function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString(language.value === 'he' ? 'he-IL' : 'en-GB', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : copy.value.never;
}
function select(account: Account) {
  selectedId.value = account.id;
  name.value = account.displayName;
  memberId.value = account.memberId == null ? '' : String(account.memberId);
  active.value = account.isActive;
  manualOnly.value = account.manualScrapeOnly;
  showBrowser.value = account.showBrowser;
  error.value = '';
  message.value = '';
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [accountResult, memberResult] = await Promise.all([getAccounts(), getMembers()]);
    accounts.value = accountResult.accounts;
    members.value = memberResult.members.filter((member) => member.isActive);
    if (window.innerWidth > 1120 && selectedId.value == null && accounts.value[0])
      select(accounts.value[0]);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.loadError;
  } finally {
    loading.value = false;
  }
}
async function save() {
  const account = selected.value;
  if (!account || !name.value.trim()) return;
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await updateAccount(account.id, {
      displayName: name.value.trim(),
      ...(memberId.value ? { memberId: Number(memberId.value) } : {}),
      isActive: active.value,
      manualScrapeOnly: manualOnly.value,
      showBrowser: showBrowser.value,
    });
    const index = accounts.value.findIndex((item) => item.id === account.id);
    accounts.value[index] = result.account;
    select(result.account);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.saveError;
  } finally {
    saving.value = false;
  }
}
async function sync() {
  const account = selected.value;
  if (!account) return;
  syncing.value = true;
  error.value = '';
  message.value = '';
  try {
    await triggerScrape(account.id);
    message.value = copy.value.syncStarted;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.syncError;
  } finally {
    syncing.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="category-workspace-page account-workspace-page">
    <Teleport to="#toolbar-actions">
      <RouterLink class="category-add-button" to="/accounts/advanced?add=1"
        ><Plus :size="16" />{{ copy.add }}</RouterLink
      >
    </Teleport>
    <div class="category-workspace-top">
      <span
        ><strong>{{ accounts.length }}</strong> {{ copy.count }}</span
      >
      <RouterLink to="/accounts/advanced">{{ copy.advanced }}</RouterLink>
    </div>
    <p v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </p>
    <div class="category-workspace">
      <section class="category-workspace-list" :aria-label="t('accounts')">
        <div v-for="section in sections" :key="section.type" class="account-list-section">
          <h3>{{ section.label }}</h3>
          <button
            v-for="account in section.rows"
            :key="account.id"
            type="button"
            class="category-list-row account-list-row"
            :class="{ selected: selectedId === account.id, muted: !account.isActive }"
            :aria-current="selectedId === account.id ? 'true' : undefined"
            @click="select(account)"
          >
            <span class="category-list-name"
              ><span class="account-list-icon"><component :is="section.icon" :size="17" /></span>
              <span
                ><strong dir="auto">{{ account.displayName }}</strong
                ><small
                  >{{ memberName(account.memberId) }} · {{ date(account.lastScrapedAt) }}</small
                ></span
              >
            </span>
            <span class="account-list-value" dir="ltr">{{
              account.accountType === 'bank' ? balance(account) : (account.accountNumber ?? '—')
            }}</span>
          </button>
        </div>
        <p v-if="loading" class="category-list-empty">{{ t('loadingTransactions') }}</p>
        <p v-else-if="!accounts.length" class="category-list-empty">{{ copy.empty }}</p>
      </section>
      <button
        v-if="selected"
        type="button"
        class="category-inspector-backdrop"
        :aria-label="t('cancel')"
        @click="selectedId = null"
      />
      <aside v-if="selected" class="category-inspector" :aria-label="t('details')">
        <div class="category-inspector-head">
          <h3 dir="auto">{{ selected.displayName }}</h3>
          <button type="button" :aria-label="t('cancel')" @click="selectedId = null">
            <X :size="18" />
          </button>
        </div>
        <div class="category-inspector-body">
          <p class="account-inspector-balance" dir="ltr">
            {{
              selected.accountType === 'bank' ? balance(selected) : (selected.accountNumber ?? '—')
            }}
          </p>
          <label
            ><span>{{ copy.name }}</span
            ><input v-model="name" type="text"
          /></label>
          <label
            ><span>{{ copy.member }}</span
            ><select v-model="memberId">
              <option v-if="selected.memberId == null" value="">{{ copy.noMember }}</option>
              <option v-for="member in members" :key="member.id" :value="String(member.id)">
                {{ member.name }}
              </option>
            </select></label
          >
          <label
            ><span>{{ copy.number }}</span
            ><input :value="selected.accountNumber ?? '—'" readonly dir="ltr"
          /></label>
          <label
            ><span>{{ copy.lastSync }}</span
            ><input :value="date(selected.lastScrapedAt)" readonly
          /></label>
          <button
            v-if="selected.companyId === 'oneZero'"
            type="button"
            class="account-import-link"
            @click="importOpen = true"
          >
            <FileSpreadsheet :size="17" />
            <span
              ><strong>{{ copy.import }}</strong
              ><small>{{ copy.importHint }}</small></span
            >
          </button>
          <label class="category-check"
            ><input v-model="active" type="checkbox" /><span>{{ copy.active }}</span></label
          >
          <label class="category-check"
            ><input v-model="manualOnly" type="checkbox" /><span>{{ copy.manual }}</span></label
          >
          <label class="category-check"
            ><input v-model="showBrowser" type="checkbox" /><span>{{ copy.browser }}</span></label
          >
          <p v-if="message" class="account-inspector-message" role="status">{{ message }}</p>
        </div>
        <div class="category-inspector-actions">
          <button
            type="button"
            class="account-sync-button"
            :disabled="syncing || !active"
            @click="sync"
          >
            <RefreshCw :size="15" />{{ syncing ? copy.syncing : copy.sync }}
          </button>
          <button
            type="button"
            class="category-save"
            :disabled="saving || !name.trim()"
            @click="save"
          >
            {{ saving ? copy.saving : copy.save }}
          </button>
        </div>
      </aside>
      <div v-else class="category-inspector-placeholder">{{ copy.choose }}</div>
    </div>
    <OneZeroImportDialog v-model:open="importOpen" :account="selected" @imported="load" />
  </div>
</template>
