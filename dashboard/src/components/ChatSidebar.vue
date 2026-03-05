<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getChatSessions, createChatSession, deleteChatSession, type SessionMeta } from '../api/client';
import { Plus, Trash2, MessageSquare } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

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
  } catch { /* ignore */ }
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
    sessions.value = sessions.value.filter(s => s.id !== id);
  } catch { /* ignore */ }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IL', { month: 'short', day: 'numeric' });
}

onMounted(loadSessions);

defineExpose({ loadSessions });
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="p-3 border-b border-border">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start gap-2"
        :disabled="loading"
        @click="handleNewChat"
      >
        <Plus class="h-4 w-4" />
        New Chat
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <button
        v-for="session in sessions"
        :key="session.id"
        class="group w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-surface-3 flex items-start gap-2"
        :class="session.id === activeSessionId ? 'bg-primary/10 text-primary' : 'text-muted-foreground'"
        @click="$emit('select', session)"
      >
        <MessageSquare class="h-4 w-4 mt-0.5 flex-shrink-0 opacity-50" />
        <div class="flex-1 min-w-0">
          <div class="truncate text-sm font-medium">{{ session.title }}</div>
          <div class="text-[11px] opacity-60 mt-0.5">{{ formatDate(session.updatedAt) }}</div>
        </div>
        <button
          class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all flex-shrink-0"
          @click="handleDelete(session.id, $event)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </button>

      <div v-if="sessions.length === 0" class="px-3 py-6 text-center text-muted-foreground text-xs">
        No conversations yet
      </div>
    </div>
  </div>
</template>
