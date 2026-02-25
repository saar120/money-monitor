# Provider-Specific Credential Forms Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic key-value credential inputs in the Add Account dialog with provider-specific labeled fields driven by a static config file.

**Architecture:** A new `dashboard/src/lib/providers.ts` exports a `PROVIDERS` array with field schemas per bank. `AccountManager.vue` imports it, derives the selected provider via a computed, and dynamically renders the correct labeled inputs. Providers with no known schema fall back to the existing generic key-value UI.

**Tech Stack:** Vue 3 (Composition API), TypeScript, shadcn-vue `Input` component

---

### Task 1: Create `dashboard/src/lib/providers.ts`

**Files:**
- Create: `dashboard/src/lib/providers.ts`

**Step 1: Write the file**

```ts
export interface ProviderField {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  hint?: string
}

export interface Provider {
  id: string
  name: string
  fields: ProviderField[]
  otpNote?: string
}

// Shared field definitions (reused across multiple providers)
const pw: ProviderField = { key: 'password', label: 'Password', type: 'password' }
const username: ProviderField = { key: 'username', label: 'Username', type: 'text' }
const idField: ProviderField = { key: 'id', label: 'ID Number', type: 'text' }
const num: ProviderField = {
  key: 'num',
  label: 'Identification Code',
  type: 'text',
  hint: 'The 2–4 digit code assigned to your account',
}
const card6: ProviderField = {
  key: 'card6Digits',
  label: 'Last 6 Card Digits',
  type: 'text',
  hint: 'Last 6 digits of your card number',
}

export const PROVIDERS: Provider[] = [
  {
    id: 'hapoalim',
    name: 'Bank Hapoalim',
    fields: [{ key: 'userCode', label: 'User Code', type: 'text' }, pw],
  },
  { id: 'leumi', name: 'Bank Leumi', fields: [username, pw] },
  { id: 'discount', name: 'Bank Discount', fields: [idField, pw, num] },
  { id: 'mizrahi', name: 'Bank Mizrahi', fields: [username, pw] },
  { id: 'otsarHahayal', name: 'Otsar Hahayal', fields: [username, pw] },
  { id: 'mercantile', name: 'Mercantile', fields: [idField, pw, num] },
  { id: 'massad', name: 'Massad', fields: [username, pw] },
  { id: 'beinleumi', name: 'First International', fields: [username, pw] },
  { id: 'union', name: 'Union Bank', fields: [username, pw] },
  {
    id: 'yahav',
    name: 'Bank Yahav',
    fields: [
      username,
      { key: 'nationalID', label: 'National ID', type: 'text', hint: 'Your Israeli national ID number' },
      pw,
    ],
  },
  { id: 'isracard', name: 'Isracard', fields: [idField, card6, pw] },
  { id: 'amex', name: 'American Express (Israel)', fields: [username, card6, pw] },
  { id: 'max', name: 'Max (Leumi Card)', fields: [username, pw] },
  { id: 'visaCal', name: 'Visa Cal', fields: [username, pw] },
  { id: 'beyahadBishvilha', name: 'Beyond (Beyahad)', fields: [idField, pw] },
  {
    id: 'oneZero',
    name: 'One Zero',
    fields: [{ key: 'email', label: 'Email', type: 'text', placeholder: 'your@email.com' }, pw],
    otpNote:
      'One Zero requires a one-time password during each scrape — you will be prompted to enter it at scrape time.',
  },
  // Unknown credential schema — will use generic fallback UI (fields: [])
  { id: 'behatsdaa', name: 'Behatsdaa', fields: [] },
  { id: 'pagi', name: 'Pagi', fields: [] },
]
```

**Step 2: Type-check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add dashboard/src/lib/providers.ts
git commit -m "feat: add provider credential field config"
```

---

### Task 2: Update `AccountManager.vue` — script section

**Files:**
- Modify: `dashboard/src/components/AccountManager.vue`

**Step 1: Update the Vue import to include `computed` and `watch`**

Find:
```ts
import { ref, onMounted, onUnmounted } from 'vue';
```

Replace with:
```ts
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
```

**Step 2: Add the PROVIDERS import (after the existing `../api/client` import)**

```ts
import { PROVIDERS } from '@/lib/providers';
```

**Step 3: Remove the inline `providers` array**

Delete the entire block (18 lines):
```ts
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
```

**Step 4: Replace `credentialFields` ref and add new refs/computed/watcher**

Find:
```ts
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
```

Replace with:
```ts
// For providers with known schema
const credentialValues = ref<Record<string, string>>({});
// For providers with unknown schema (generic fallback)
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

const selectedProvider = computed(() =>
  PROVIDERS.find((p) => p.id === newCompanyId.value) ?? null,
);

watch(newCompanyId, () => {
  credentialValues.value = {};
  credentialFields.value = [{ key: '', value: '' }];
});
```

**Step 5: Update `handleAdd` to use the correct credentials source**

Find the existing `handleAdd` function and replace its body:
```ts
async function handleAdd() {
  const credentials: Record<string, string> = {};

  if (selectedProvider.value && selectedProvider.value.fields.length > 0) {
    Object.assign(credentials, credentialValues.value);
  } else {
    for (const field of credentialFields.value) {
      if (field.key) credentials[field.key] = field.value;
    }
  }

  await createAccount({
    companyId: newCompanyId.value,
    displayName: newDisplayName.value,
    credentials,
  });

  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialValues.value = {};
  credentialFields.value = [{ key: '', value: '' }];
  showAddDialog.value = false;
  fetchAccounts();
}
```

**Step 6: Type-check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors.

**Step 7: Commit**

```bash
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: wire provider config into AccountManager script"
```

---

### Task 3: Update `AccountManager.vue` — template section

**Files:**
- Modify: `dashboard/src/components/AccountManager.vue`

**Step 1: Update the provider `<SelectItem>` loop**

The template currently references `providers` (the deleted inline array). Find:
```html
<SelectItem v-for="p in providers" :key="p.id" :value="p.id">
  {{ p.name }}
</SelectItem>
```

Replace with:
```html
<SelectItem v-for="p in PROVIDERS" :key="p.id" :value="p.id">
  {{ p.name }}
</SelectItem>
```

**Step 2: Update the account card provider name display**

Find:
```html
{{ providers.find(p => p.id === account.companyId)?.name ?? account.companyId }}
```

Replace with:
```html
{{ PROVIDERS.find(p => p.id === account.companyId)?.name ?? account.companyId }}
```

**Step 3: Replace the credentials form section**

Find the entire credentials block inside the Add Account dialog:
```html
<div class="space-y-1.5">
  <label class="text-sm font-medium">Credentials</label>
  <div v-for="(field, i) in credentialFields" :key="i" class="flex gap-2">
    <Input v-model="field.key" placeholder="Field name (e.g. userCode)" />
    <Input v-model="field.value" type="password" placeholder="Value" />
  </div>
  <Button variant="outline" size="sm" @click="addCredentialField">
    <Plus class="h-3 w-3 mr-1" />
    Add Field
  </Button>
</div>
```

Replace with:
```html
<div v-if="newCompanyId" class="space-y-3">
  <!-- OTP note banner (e.g. OneZero) -->
  <div
    v-if="selectedProvider?.otpNote"
    class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
  >
    {{ selectedProvider.otpNote }}
  </div>

  <!-- Known provider: render labeled fields -->
  <template v-if="selectedProvider && selectedProvider.fields.length > 0">
    <div v-for="field in selectedProvider.fields" :key="field.key" class="space-y-1">
      <label class="text-sm font-medium">{{ field.label }}</label>
      <Input
        v-model="credentialValues[field.key]"
        :type="field.type"
        :placeholder="field.placeholder ?? ''"
        :autocomplete="field.type === 'password' ? 'current-password' : 'off'"
      />
      <p v-if="field.hint" class="text-xs text-muted-foreground">{{ field.hint }}</p>
    </div>
  </template>

  <!-- Unknown provider: generic key-value fallback -->
  <template v-else>
    <div class="space-y-1.5">
      <label class="text-sm font-medium">Credentials</label>
      <div v-for="(field, i) in credentialFields" :key="i" class="flex gap-2">
        <Input v-model="field.key" placeholder="Field name (e.g. userCode)" />
        <Input v-model="field.value" type="password" placeholder="Value" />
      </div>
      <Button variant="outline" size="sm" @click="addCredentialField">
        <Plus class="h-3 w-3 mr-1" />
        Add Field
      </Button>
    </div>
  </template>
</div>
```

**Step 4: Verify in the browser**

```bash
cd dashboard && npm run dev
```

Open the app → Accounts → Add Account.
- Select "Bank Hapoalim" → should show "User Code" and "Password" inputs (no generic key field).
- Select "Isracard" → should show "ID Number", "Last 6 Card Digits" (with hint), "Password".
- Select "One Zero" → should show the blue OTP note banner + "Email" and "Password".
- Select "Behatsdaa" → should fall back to generic key-value fields.
- Select a different provider → creds should reset.

**Step 5: Commit**

```bash
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: render provider-specific credential fields in Add Account dialog"
```
