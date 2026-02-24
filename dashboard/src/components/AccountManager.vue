<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getAccounts, createAccount, updateAccount, deleteAccount, triggerScrape, type Account } from '../api/client';

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddForm = ref(false);

const newCompanyId = ref('');
const newDisplayName = ref('');
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

const providers = [
  { id: 'hapoalim', name: 'Bank Hapoalim' },
  { id: 'leumi', name: 'Bank Leumi' },
  { id: 'discount', name: 'Bank Discount' },
  { id: 'mizrahi', name: 'Bank Mizrahi' },
  { id: 'otsarHahayal', name: 'Otsar Hahayal' },
  { id: 'mercantile', name: 'Mercantile' },
  { id: 'massad', name: 'Massad' },
  { id: 'beinleumi', name: 'First International' },
  { id: 'union', name: 'Union Bank' },
  { id: 'yahav', name: 'Bank Yahav' },
  { id: 'isracard', name: 'Isracard' },
  { id: 'amex', name: 'American Express (Israel)' },
  { id: 'max', name: 'Max (Leumi Card)' },
  { id: 'visaCal', name: 'Visa Cal' },
  { id: 'beyahadBishvilha', name: 'Beyond (Beyahad)' },
  { id: 'oneZero', name: 'One Zero' },
  { id: 'behatsdaa', name: 'Behatsdaa' },
  { id: 'pagi', name: 'Pagi' },
];

async function fetchAccounts() {
  loading.value = true;
  try {
    const result = await getAccounts();
    accounts.value = result.accounts;
  } finally {
    loading.value = false;
  }
}

function addCredentialField() {
  credentialFields.value.push({ key: '', value: '' });
}

async function handleAdd() {
  const credentials: Record<string, string> = {};
  for (const field of credentialFields.value) {
    if (field.key) credentials[field.key] = field.value;
  }

  await createAccount({
    companyId: newCompanyId.value,
    displayName: newDisplayName.value,
    credentials,
  });

  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialFields.value = [{ key: '', value: '' }];
  showAddForm.value = false;
  fetchAccounts();
}

async function handleToggleActive(account: Account) {
  await updateAccount(account.id, { isActive: !account.isActive });
  fetchAccounts();
}

async function handleDelete(account: Account) {
  if (confirm(`Delete "${account.displayName}"? This will also delete its transactions.`)) {
    await deleteAccount(account.id, true);
    fetchAccounts();
  }
}

async function handleScrape(account: Account) {
  try {
    const result = await triggerScrape(account.id);
    alert(`Scrape complete: ${result.transactionsFound} found, ${result.transactionsNew} new`);
    fetchAccounts();
  } catch (err) {
    alert(`Scrape failed: ${err instanceof Error ? err.message : err}`);
  }
}

onMounted(fetchAccounts);
</script>

<template>
  <div class="accounts-page">
    <div class="header">
      <h1>Accounts</h1>
      <button class="btn-primary" @click="showAddForm = !showAddForm">
        {{ showAddForm ? 'Cancel' : '+ Add Account' }}
      </button>
    </div>

    <div v-if="showAddForm" class="add-form card">
      <h3>Add New Account</h3>
      <div class="form-row">
        <label>Provider</label>
        <select v-model="newCompanyId">
          <option value="">Select provider...</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Display Name</label>
        <input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
      </div>
      <div class="form-row">
        <label>Credentials</label>
        <div v-for="(field, i) in credentialFields" :key="i" class="cred-row">
          <input v-model="field.key" placeholder="Field name (e.g. userCode)" />
          <input v-model="field.value" type="password" placeholder="Value" />
        </div>
        <button class="btn-small" @click="addCredentialField">+ Add Field</button>
      </div>
      <button class="btn-primary" @click="handleAdd" :disabled="!newCompanyId || !newDisplayName">
        Save Account
      </button>
    </div>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else class="accounts-list">
      <div v-for="account in accounts" :key="account.id" class="card account-card">
        <div class="account-info">
          <h3>{{ account.displayName }}</h3>
          <p class="meta">
            {{ providers.find(p => p.id === account.companyId)?.name ?? account.companyId }}
            <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
          </p>
          <p class="meta">
            <span :class="account.isActive ? 'active' : 'inactive'">
              {{ account.isActive ? 'Active' : 'Inactive' }}
            </span>
            <span v-if="account.lastScrapedAt"> · Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}</span>
            <span v-else> · Never scraped</span>
          </p>
        </div>
        <div class="account-actions">
          <button @click="handleScrape(account)" title="Trigger scrape">Scrape</button>
          <button @click="handleToggleActive(account)">
            {{ account.isActive ? 'Disable' : 'Enable' }}
          </button>
          <button class="btn-danger" @click="handleDelete(account)">Delete</button>
        </div>
      </div>
      <p v-if="accounts.length === 0">No accounts configured. Add one to get started.</p>
    </div>
  </div>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.card { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
.account-card { display: flex; justify-content: space-between; align-items: center; }
.meta { color: #666; font-size: 0.875rem; margin: 0.25rem 0; }
.active { color: #27ae60; font-weight: 600; }
.inactive { color: #999; }
.account-actions { display: flex; gap: 0.5rem; }
.account-actions button {
  padding: 0.4rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  font-size: 0.8rem;
}
.btn-primary { padding: 0.5rem 1rem; background: #36A2EB; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
.btn-danger { background: #e74c3c; color: #fff; border-color: #e74c3c; }
.btn-small { padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #f5f5f5; }
.add-form { margin-bottom: 1.5rem; }
.form-row { margin-bottom: 1rem; }
.form-row label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
.form-row input, .form-row select { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
.cred-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.cred-row input { flex: 1; }
</style>
