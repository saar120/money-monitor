<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  getChatSessions,
  createChatSession,
  deleteChatSession,
  type SessionMeta,
} from '../api/client';
import { Plus, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { language, t } from '@/lib/language';

const emit = defineEmits<{
  (e: 'select', session: SessionMeta): void;
  (e: 'new-chat', session: SessionMeta): void;
  (e: 'deleted', id: string): void;
  (e: 'pending', value: boolean): void;
}>();

defineProps<{
  activeSessionId?: string;
  busy?: boolean;
}>();

const sessions = ref<SessionMeta[]>([]);
const loading = ref(false);
const failure = ref<'load' | 'create' | 'delete' | null>(null);
const errorMessage = computed(() => {
  if (!failure.value) return '';
  const messages =
    language.value === 'he'
      ? {
          load: 'לא ניתן לטעון את היסטוריית השיחות.',
          create: 'לא ניתן ליצור שיחה. נסו שוב.',
          delete: 'לא ניתן למחוק את השיחה. נסו שוב.',
        }
      : {
          load: 'Conversation history could not be loaded.',
          create: 'Could not create a conversation. Please try again.',
          delete: 'Could not delete the conversation. Please try again.',
        };
  return messages[failure.value];
});

async function loadSessions() {
  failure.value = null;
  try {
    const { sessions: data } = await getChatSessions();
    sessions.value = data;
  } catch {
    failure.value = 'load';
  }
}

async function handleNewChat() {
  loading.value = true;
  failure.value = null;
  emit('pending', true);
  try {
    const { session } = await createChatSession();
    sessions.value.unshift(session);
    emit('new-chat', session);
  } catch {
    failure.value = 'create';
  } finally {
    loading.value = false;
    emit('pending', false);
  }
}

async function handleDelete(id: string, event: Event) {
  event.stopPropagation();
  loading.value = true;
  failure.value = null;
  emit('pending', true);
  try {
    await deleteChatSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    emit('deleted', id);
  } catch {
    failure.value = 'delete';
  } finally {
    loading.value = false;
    emit('pending', false);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t('today');
  if (diffDays === 1) return t('yesterday');
  if (diffDays < 7) return `${diffDays} ${language.value === 'he' ? 'ימים' : 'days ago'}`;
  return d.toLocaleDateString(language.value === 'he' ? 'he-IL' : 'en-IL', {
    month: 'short',
    day: 'numeric',
  });
}

onMounted(loadSessions);

defineExpose({ loadSessions });
</script>

<template>
  <div class="chat-history flex flex-col h-full min-h-0">
    <div class="history-heading">
      {{ language === 'he' ? 'שיחות' : 'Conversations' }}
    </div>
    <div class="history-actions">
      <Button
        variant="secondary"
        class="w-full justify-start gap-2 shadow-none"
        :disabled="loading || busy"
        @click="handleNewChat"
      >
        <Plus class="h-4 w-4" />
        {{ t('newChat') }}
      </Button>
    </div>

    <p v-if="errorMessage" class="history-error" role="alert">{{ errorMessage }}</p>

    <nav
      class="history-list flex-1 min-h-0 overflow-y-auto"
      :aria-label="language === 'he' ? 'היסטוריית שיחות' : 'Conversation history'"
    >
      <div
        v-for="session in sessions"
        :key="session.id"
        class="history-row"
        :class="{ 'history-row-active': session.id === activeSessionId }"
      >
        <button
          type="button"
          class="history-select"
          :aria-current="session.id === activeSessionId ? 'true' : undefined"
          :disabled="loading || busy"
          @click="$emit('select', session)"
        >
          <span class="history-title" :title="session.title">{{ session.title }}</span>
          <span class="history-date">{{ formatDate(session.updatedAt) }}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="history-delete"
          :disabled="loading || busy"
          :aria-label="`${language === 'he' ? 'מחיקת שיחה' : 'Delete conversation'}: ${session.title}`"
          @click="handleDelete(session.id, $event)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </Button>
      </div>

      <p v-if="sessions.length === 0 && !failure" class="history-empty">
        {{ t('noConversations') }}
      </p>
    </nav>
  </div>
</template>

<style scoped>
.history-heading {
  display: flex;
  align-items: center;
  min-height: 61px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--separator);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.history-actions {
  padding: 16px 12px 12px;
}
.history-error {
  padding: 0 20px 12px;
  color: var(--destructive);
  font-size: 12px;
  line-height: 1.6;
}
.history-list {
  padding: 0 8px 16px;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-block: 2px;
  padding-inline: 12px 4px;
  border-radius: 6px;
  transition: background 150ms;
}
.history-row:hover,
.history-row:focus-within {
  background: var(--bg-tertiary);
}
.history-row-active {
  background: var(--bg-tertiary);
}
.history-select {
  flex: 1;
  min-width: 0;
  padding-block: 12px;
  text-align: start;
}
.history-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}
.history-select:disabled {
  cursor: wait;
}
.history-title {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}
.history-date {
  display: block;
  margin-top: 4px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.history-delete {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  color: var(--text-secondary);
}
.history-delete:hover {
  color: var(--destructive);
  background: color-mix(in srgb, var(--destructive) 10%, transparent);
}
.history-empty {
  padding: 16px 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
@media (hover: hover) {
  .history-delete {
    opacity: 0;
  }
  .history-row:hover .history-delete,
  .history-row:focus-within .history-delete {
    opacity: 1;
  }
}
@media (max-width: 700px) {
  .history-heading {
    display: none;
  }
}
</style>
