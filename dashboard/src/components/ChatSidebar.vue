<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  getChatSessions,
  createChatSession,
  deleteChatSession,
  type SessionMeta,
} from '../api/client';
import { Plus, Trash2, MessageSquare } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { language, t } from '@/lib/language';

const emit = defineEmits<{
  (e: 'select', session: SessionMeta): void;
  (e: 'new-chat', session: SessionMeta): void;
}>();

defineProps<{
  activeSessionId?: string;
}>();

const sessions = ref<SessionMeta[]>([]);
const loading = ref(false);

async function loadSessions() {
  try {
    const { sessions: data } = await getChatSessions();
    sessions.value = data;
  } catch {
    /* ignore */
  }
}

async function handleNewChat() {
  loading.value = true;
  try {
    const { session } = await createChatSession();
    sessions.value.unshift(session);
    emit('new-chat', session);
  } finally {
    loading.value = false;
  }
}

async function handleDelete(id: string, event: Event) {
  event.stopPropagation();
  try {
    await deleteChatSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
  } catch {
    /* ignore */
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
  <div class="flex flex-col h-full min-h-0">
    <div class="p-4 border-b border-separator">
      <Button
        variant="secondary"
        size="sm"
        class="w-full justify-start gap-2 bg-transparent border-separator/60 shadow-none"
        :disabled="loading"
        @click="handleNewChat"
      >
        <Plus class="h-4 w-4" />
        {{ t('newChat') }}
      </Button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto py-2">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center gap-2 px-4 hover:bg-bg-tertiary"
        :class="
          session.id === activeSessionId ? 'bg-primary/10 text-primary' : 'text-text-secondary'
        "
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-3 py-4 text-start"
          :aria-current="session.id === activeSessionId ? 'true' : undefined"
          @click="$emit('select', session)"
        >
          <MessageSquare class="h-4 w-4 mt-0.5 shrink-0 opacity-50" />
          <span class="flex-1 min-w-0">
            <span class="block truncate text-[14px] font-medium" :title="session.title">{{
              session.title
            }}</span>
            <span class="block text-[12px] text-text-secondary mt-1">{{
              formatDate(session.updatedAt)
            }}</span>
          </span>
        </button>
        <button
          type="button"
          class="icon-control grid place-items-center rounded hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
          :aria-label="`${language === 'he' ? 'מחיקת שיחה' : 'Delete conversation'}: ${session.title}`"
          @click="handleDelete(session.id, $event)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        v-if="sessions.length === 0"
        class="px-4 py-8 text-center text-text-secondary text-[12px] leading-relaxed"
      >
        {{ t('noConversations') }}
      </div>
    </div>
  </div>
</template>
