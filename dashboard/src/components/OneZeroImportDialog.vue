<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FileSpreadsheet, Loader2 } from 'lucide-vue-next';
import {
  commitOneZeroImport,
  previewOneZeroImport,
  type Account,
  type OneZeroImportPreview,
} from '@/api/client';
import { formatCurrency } from '@/lib/format';
import { language } from '@/lib/language';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

type BrowserFile = InstanceType<typeof globalThis.File>;
type BrowserInput = InstanceType<typeof globalThis.HTMLInputElement>;

const props = defineProps<{ open: boolean; account: Account | null }>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  imported: [];
}>();

const file = ref<BrowserFile | null>(null);
const preview = ref<OneZeroImportPreview | null>(null);
const checking = ref(false);
const importing = ref(false);
const imported = ref(false);
const error = ref('');
const fileInput = ref<BrowserInput | null>(null);

const copy = computed(() =>
  language.value === 'he'
    ? {
        eyebrow: 'ייבוא תנועות · ONE ZERO',
        title: 'ייבוא דוח בנק',
        intro: 'בחרו קובץ Excel. נבדוק כל תנועה לפני השמירה בחשבון:',
        choose: 'בחירת קובץ',
        noFile: 'לא נבחר קובץ',
        fileHint: 'קובץ ‎.xls או ‎.xlsx של ONE ZERO',
        checking: 'בודקים את הדוח…',
        preview: 'תצוגה לפני ייבוא',
        rows: 'תנועות',
        new: 'חדשות',
        matched: 'קיימות לקישור',
        duplicate: 'כבר יובאו',
        ambiguous: 'לא חד־משמעיות',
        newHint: 'יתווספו לחשבון',
        matchedHint: 'יקושרו לתנועות מסנכרון',
        duplicateHint: 'ידולגו ללא שינוי',
        ambiguousHint: 'מחייבות בדיקה',
        rowReview: 'פירוט התנועות',
        row: 'שורה',
        blocked: 'יש תנועות שדורשות תיקון בדוח לפני הייבוא.',
        invalid: 'שורות לא תקינות',
        allDuplicate: 'כל התנועות כבר יובאו. אין צורך לייבא שוב.',
        complete: 'הייבוא הושלם. התנועות החדשות נוספו והכפילויות דולגו.',
        cancel: 'ביטול',
        done: 'סיום',
        import: 'אישור ייבוא',
        importing: 'מייבאים…',
        badFile: 'בחרו קובץ Excel מסוג ‎.xls או ‎.xlsx.',
        failed: 'לא ניתן לעבד את הדוח. בדקו את הקובץ ונסו שוב.',
      }
    : {
        eyebrow: 'TRANSACTION IMPORT · ONE ZERO',
        title: 'Import bank statement',
        intro: 'Choose an Excel statement. Every transaction is checked before saving to:',
        choose: 'Choose file',
        noFile: 'No file selected',
        fileHint: 'ONE ZERO .xls or .xlsx statement',
        checking: 'Checking the statement…',
        preview: 'Review before import',
        rows: 'transactions',
        new: 'New',
        matched: 'Link existing',
        duplicate: 'Already imported',
        ambiguous: 'Needs review',
        newHint: 'Added to this account',
        matchedHint: 'Linked to scraped transactions',
        duplicateHint: 'Skipped without changes',
        ambiguousHint: 'Must be resolved',
        rowReview: 'Transaction details',
        row: 'Row',
        blocked: 'Some rows need attention in the statement before import.',
        invalid: 'Invalid rows',
        allDuplicate: 'Every transaction was already imported. Nothing to add.',
        complete: 'Import complete. New transactions were added and duplicates were skipped.',
        cancel: 'Cancel',
        done: 'Done',
        import: 'Confirm import',
        importing: 'Importing…',
        badFile: 'Choose an Excel file ending in .xls or .xlsx.',
        failed: 'Could not process this statement. Check the file and try again.',
      },
);

const blocked = computed(
  () =>
    !!preview.value && (preview.value.ambiguousCount > 0 || preview.value.invalidRows.length > 0),
);
const canImport = computed(
  () =>
    !!file.value &&
    !!props.account &&
    !!preview.value &&
    preview.value.newCount + preview.value.matchedExistingCount > 0 &&
    !blocked.value &&
    !checking.value &&
    !importing.value &&
    !imported.value,
);
const outcomes = computed(() => {
  if (!preview.value) return [];
  return [
    {
      status: 'new',
      count: preview.value.newCount,
      label: copy.value.new,
      hint: copy.value.newHint,
    },
    {
      status: 'matched',
      count: preview.value.matchedExistingCount,
      label: copy.value.matched,
      hint: copy.value.matchedHint,
    },
    {
      status: 'duplicate',
      count: preview.value.duplicateCount,
      label: copy.value.duplicate,
      hint: copy.value.duplicateHint,
    },
    {
      status: 'ambiguous',
      count: preview.value.ambiguousCount,
      label: copy.value.ambiguous,
      hint: copy.value.ambiguousHint,
    },
  ];
});

function reset() {
  file.value = null;
  preview.value = null;
  checking.value = false;
  importing.value = false;
  imported.value = false;
  error.value = '';
  if (fileInput.value) fileInput.value.value = '';
}
watch(
  () => props.open,
  (open) => {
    if (!open) reset();
  },
);

function close(open: boolean) {
  if (!importing.value) emit('update:open', open);
}

async function chooseFile(event: Event) {
  const input = event.target as BrowserInput;
  const chosen = input.files?.[0] ?? null;
  file.value = null;
  preview.value = null;
  error.value = '';
  if (!chosen || !props.account) return;
  if (!/\.xlsx?$/i.test(chosen.name)) {
    error.value = copy.value.badFile;
    input.value = '';
    return;
  }
  file.value = chosen;
  checking.value = true;
  try {
    preview.value = await previewOneZeroImport(props.account.id, chosen);
  } catch (cause) {
    error.value =
      cause instanceof Error && language.value === 'en' ? cause.message : copy.value.failed;
  } finally {
    checking.value = false;
  }
}

async function confirm() {
  if (!canImport.value || !props.account || !file.value) return;
  importing.value = true;
  error.value = '';
  try {
    await commitOneZeroImport(props.account.id, file.value);
    imported.value = true;
    emit('imported');
  } catch (cause) {
    error.value =
      cause instanceof Error && language.value === 'en' ? cause.message : copy.value.failed;
  } finally {
    importing.value = false;
  }
}

function amount(value: number) {
  return `${value < 0 ? '−' : '+'}${formatCurrency(value)}`;
}
function date(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en-GB',
  );
}
function statusLabel(status: OneZeroImportPreview['rows'][number]['status']) {
  return status === 'new'
    ? copy.value.new
    : status === 'matched'
      ? copy.value.matched
      : status === 'duplicate'
        ? copy.value.duplicate
        : copy.value.ambiguous;
}
</script>

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="import-dialog">
      <div class="import-dialog-header">
        <span class="import-eyebrow">{{ copy.eyebrow }}</span>
        <DialogTitle class="import-title">{{ copy.title }}</DialogTitle>
        <p>
          {{ copy.intro }}
          <strong class="import-account-name" dir="auto">{{ account?.displayName }}</strong>
        </p>
      </div>

      <div class="import-dialog-body">
        <div class="import-file-row">
          <input
            id="one-zero-import-file"
            ref="fileInput"
            class="sr-only peer"
            type="file"
            accept=".xls,.xlsx"
            :disabled="checking || importing || imported"
            @change="chooseFile"
          />
          <label
            for="one-zero-import-file"
            :class="{ disabled: checking || importing || imported }"
          >
            <FileSpreadsheet :size="16" /> {{ copy.choose }}
          </label>
          <span class="import-file-name" dir="auto">{{ file?.name || copy.noFile }}</span>
        </div>
        <p class="import-file-hint">{{ copy.fileHint }}</p>

        <p v-if="checking" class="import-progress" role="status">
          <Loader2 :size="16" class="animate-spin" />{{ copy.checking }}
        </p>
        <p v-if="error" class="import-error" role="alert">{{ error }}</p>

        <template v-if="preview">
          <div class="import-preview-head">
            <h3>{{ copy.preview }}</h3>
            <span>{{ preview.rowCount }} {{ copy.rows }}</span>
          </div>
          <div class="import-outcomes">
            <div
              v-for="item in outcomes"
              :key="item.status"
              class="import-outcome"
              :class="item.status"
            >
              <strong>{{ item.count }}</strong>
              <span>{{ item.label }}</span>
              <small>{{ item.hint }}</small>
            </div>
          </div>
          <p v-if="blocked" class="import-error" role="alert">{{ copy.blocked }}</p>
          <p v-else-if="!canImport && !imported && !checking" class="import-file-hint">
            {{ copy.allDuplicate }}
          </p>
          <div v-if="preview.invalidRows.length" class="import-invalid">
            <strong>{{ copy.invalid }} ({{ preview.invalidRows.length }})</strong>
            <p v-for="invalid in preview.invalidRows" :key="invalid.row" dir="auto">
              {{ copy.row }} {{ invalid.row }}: {{ invalid.reason }}
            </p>
          </div>
          <div v-if="preview.rows.length" class="import-rows">
            <h3>{{ copy.rowReview }}</h3>
            <div class="import-row-list">
              <div v-for="row in preview.rows" :key="row.row" class="import-row">
                <span class="import-row-number">{{ row.row }}</span>
                <span class="import-row-main"
                  ><strong dir="auto">{{ row.description }}</strong
                  ><small>{{ date(row.date) }} · {{ statusLabel(row.status) }}</small></span
                >
                <span class="import-row-amount" dir="ltr">{{ amount(row.amount) }}</span>
              </div>
            </div>
          </div>
        </template>
        <p v-if="imported" class="import-success" role="status">{{ copy.complete }}</p>
      </div>

      <div class="import-dialog-footer">
        <button type="button" class="import-cancel" :disabled="importing" @click="close(false)">
          {{ imported ? copy.done : copy.cancel }}
        </button>
        <button
          v-if="!imported"
          type="button"
          class="import-confirm"
          :disabled="!canImport"
          @click="confirm"
        >
          <Loader2 v-if="importing" :size="15" class="animate-spin" />{{
            importing ? copy.importing : copy.import
          }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style>
.import-dialog {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: min(620px, calc(100vw - 24px));
  max-width: none;
  max-height: min(790px, calc(100vh - 24px));
  overflow: hidden;
  padding: 0;
  border-radius: 12px;
}
.import-dialog-header {
  padding: 26px 28px 20px;
  border-bottom: 1px solid var(--separator);
  padding-inline-end: 60px;
}
.import-eyebrow {
  color: var(--accent);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.09em;
}
.import-title {
  margin: 7px 0 5px;
  font-size: 22px;
  font-weight: 730;
  line-height: 1.25;
}
.import-dialog-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.import-dialog-header strong {
  color: var(--text-primary);
}
.import-account-name {
  display: block;
  margin-top: 3px;
}
.import-dialog-body {
  min-height: 0;
  overflow-y: auto;
  padding: 22px 28px;
}
.import-file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border: 1px solid var(--separator);
  border-radius: 8px;
  padding: 6px;
}
.import-file-row label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  padding: 8px 11px;
  border-radius: 6px;
  background: #eaf2ff;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.import-file-row label:hover {
  background: #dae9ff;
}
.import-file-row input:focus-visible + label {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.import-file-row label.disabled {
  opacity: 0.5;
  cursor: default;
}
.import-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}
.import-file-hint {
  margin: 7px 0 0;
  color: var(--text-tertiary);
  font-size: 11px;
}
.import-progress,
.import-error,
.import-success {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.5;
}
.import-progress {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}
.import-error {
  background: #fff0ef;
  color: var(--destructive);
}
.import-success {
  background: #edf8f2;
  color: var(--success);
}
.import-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 25px 0 12px;
}
.import-preview-head h3,
.import-rows h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.import-preview-head span {
  color: var(--text-tertiary);
  font-size: 11px;
}
.import-outcomes {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--separator);
  border-radius: 8px;
  overflow: hidden;
}
.import-outcome {
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
  padding: 12px;
  border-inline-end: 1px solid var(--separator);
}
.import-outcome:last-child {
  border-inline-end: 0;
}
.import-outcome strong {
  font-size: 22px;
  line-height: 1;
}
.import-outcome span {
  font-size: 11px;
  font-weight: 700;
}
.import-outcome small {
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.3;
}
.import-outcome.new strong {
  color: var(--accent);
}
.import-outcome.ambiguous strong {
  color: var(--destructive);
}
.import-invalid {
  margin-top: 14px;
  color: var(--destructive);
  font-size: 11px;
}
.import-invalid p {
  margin: 4px 0 0;
}
.import-rows {
  margin-top: 24px;
}
.import-row-list {
  margin-top: 10px;
  border-top: 1px solid var(--separator);
}
.import-row {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  border-bottom: 1px solid var(--separator);
}
.import-row-number {
  color: var(--text-tertiary);
  font-size: 10px;
}
.import-row-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.import-row-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}
.import-row-main small {
  color: var(--text-secondary);
  font-size: 10px;
}
.import-row-amount {
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}
.import-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 28px;
  border-top: 1px solid var(--separator);
}
.import-dialog-footer button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 15px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
}
.import-cancel {
  border: 1px solid var(--separator);
}
.import-confirm {
  background: var(--accent);
  color: white;
}
.import-confirm:disabled {
  opacity: 0.45;
}
@media (max-width: 560px) {
  .import-dialog-header {
    padding: 21px 18px 16px;
    padding-inline-end: 55px;
  }
  .import-dialog-body {
    padding: 17px 18px;
  }
  .import-dialog-footer {
    padding: 14px 18px;
  }
  .import-outcomes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .import-outcome:nth-child(2) {
    border-inline-end: 0;
  }
  .import-outcome:nth-child(-n + 2) {
    border-bottom: 1px solid var(--separator);
  }
}
@media (prefers-reduced-motion: reduce) {
  .import-dialog .animate-spin {
    animation: none;
  }
}
</style>
