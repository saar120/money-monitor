<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import {
  aiChatStream,
  createChatSession,
  getChatSession,
  type SessionMeta,
  type SessionMessage,
  type ChatMessage,
  type AdvisorChart,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SendHorizontal, Bot, User, PanelLeftClose, PanelLeft } from 'lucide-vue-next';
import MarkdownContent from './MarkdownContent.vue';
import ChatSidebar from './ChatSidebar.vue';
import AdvisorChartView from './AdvisorChartView.vue';
import { t, type LanguageLabel } from '@/lib/language';

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const status = ref('');
const chatContainer = ref<HTMLElement | null>(null);
const activeSession = ref<SessionMeta | null>(null);
const sidebarOpen = ref(true);
const sidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null);

// Show loading dots only when loading and no text has streamed yet
const isWaiting = computed(() => {
  if (!loading.value) return false;
  const last = messages.value[messages.value.length - 1];
  return !last || last.role !== 'assistant' || !last.content;
});

const suggestionKeys: LanguageLabel[] = [
  'askTopCategories',
  'askFoodComparison',
  'askSavings',
  'askSubscriptions',
  'askCategorize',
];

async function scrollToBottom(instant = false) {
  await nextTick();
  requestAnimationFrame(() => {
    chatContainer.value?.scrollTo({
      top: chatContainer.value.scrollHeight,
      behavior: instant ? 'instant' : 'smooth',
    });
  });
}

async function selectSession(session: SessionMeta) {
  activeSession.value = session;
  try {
    const { session: data } = await getChatSession(session.id);
    messages.value = data.messages.map((m: SessionMessage) => ({
      role: m.role,
      content: m.content,
      chart: m.chart,
    }));
    await scrollToBottom(true);
  } catch {
    messages.value = [];
  }
}

function handleNewChat(session: SessionMeta) {
  activeSession.value = session;
  messages.value = [];
}

async function ensureSession(): Promise<string> {
  if (activeSession.value) return activeSession.value.id;
  const { session } = await createChatSession();
  activeSession.value = session;
  sidebarRef.value?.loadSessions();
  return session.id;
}

async function sendMessage(text?: string) {
  const messageText = text ?? input.value.trim();
  if (!messageText) return;

  messages.value.push({ role: 'user', content: messageText });
  input.value = '';
  loading.value = true;
  status.value = '';
  await scrollToBottom();

  try {
    const sessionId = await ensureSession();
    // Accumulate response without showing partial text —
    // the typing indicator stays visible until the full message is ready.
    let accumulated = '';
    let chart: AdvisorChart | undefined;

    for await (const event of aiChatStream(sessionId, messageText)) {
      if (event.type === 'text_delta') {
        accumulated += event.text;
      } else if (event.type === 'status') {
        status.value = event.text;
      } else if (event.type === 'result') {
        accumulated = event.text;
      } else if (event.type === 'chart') {
        chart = event.chart;
      } else if (event.type === 'error') {
        throw new Error(event.text);
      }
    }

    if (accumulated || chart) {
      messages.value.push({ role: 'assistant', content: accumulated, chart });
    }
    // Refresh sidebar to update title/timestamp
    sidebarRef.value?.loadSessions();
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
    });
  } finally {
    loading.value = false;
    status.value = '';
    await scrollToBottom();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <div class="advisor-workspace relative flex-1 min-h-0">
    <div class="absolute inset-0 flex gap-0">
      <!-- Sidebar -->
      <div v-if="sidebarOpen" class="advisor-history w-64 flex-shrink-0 overflow-hidden">
        <ChatSidebar
          ref="sidebarRef"
          :active-session-id="activeSession?.id"
          @select="selectSession"
          @new-chat="handleNewChat"
        />
      </div>

      <!-- Chat area -->
      <div class="flex-1 flex flex-col min-w-0">
        <div class="flex items-center gap-2 mb-4 flex-shrink-0">
          <Button variant="ghost" size="icon" class="h-8 w-8" @click="sidebarOpen = !sidebarOpen">
            <PanelLeftClose v-if="sidebarOpen" class="h-4 w-4" />
            <PanelLeft v-else class="h-4 w-4" />
          </Button>
        </div>

        <div class="advisor-conversation flex-1 overflow-hidden flex flex-col min-h-0">
          <div ref="chatContainer" class="chat-messages flex-1 overflow-y-auto p-5 space-y-5">
            <!-- Empty state with suggestions -->
            <div
              v-if="messages.length === 0"
              class="flex flex-col items-center justify-center h-full text-center py-8"
            >
              <div
                class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5"
              >
                <Bot class="h-8 w-8 text-primary" />
              </div>
              <p class="text-text-primary text-[15px] font-medium mb-1">
                {{ t('askAboutFinances') }}
              </p>
              <p class="text-text-secondary text-[12px] mb-6 max-w-sm">
                {{ t('advisorDescription') }}
              </p>
              <div class="flex flex-wrap gap-2 justify-center max-w-lg">
                <Button
                  v-for="key in suggestionKeys"
                  :key="key"
                  variant="secondary"
                  size="sm"
                  class="rounded-xl border-separator/70 text-primary hover:bg-primary/8 text-[12px] h-auto py-2 px-4 shadow-[var(--shadow-sm)]"
                  @click="sendMessage(t(key))"
                >
                  {{ t(key) }}
                </Button>
              </div>
            </div>

            <!-- Messages -->
            <div
              v-for="(msg, i) in messages"
              :key="i"
              class="flex gap-3"
              :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <div
                v-if="msg.role === 'assistant'"
                class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <Bot class="h-4 w-4 text-primary" />
              </div>

              <div
                class="max-w-[75%] px-4 py-2.5 text-[13px] leading-relaxed"
                :class="
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md'
                    : 'bg-bg-secondary text-text-primary rounded-2xl rounded-bl-md'
                "
              >
                <template v-if="msg.role === 'assistant'">
                  <MarkdownContent
                    v-if="msg.content"
                    :content="msg.content"
                    :streaming="loading && i === messages.length - 1"
                  />
                  <AdvisorChartView v-if="msg.chart" :chart="msg.chart" />
                </template>
                <div v-else class="whitespace-pre-wrap">{{ msg.content }}</div>
              </div>

              <div
                v-if="msg.role === 'user'"
                class="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <User class="h-4 w-4 text-primary-foreground" />
              </div>
            </div>

            <!-- Typing indicator (before text starts streaming) -->
            <div v-if="isWaiting" class="flex gap-3 justify-start animate-scale-in">
              <div
                class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <Bot class="h-4 w-4 text-primary" />
              </div>
              <div class="bg-bg-secondary rounded-2xl rounded-bl-md px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <div class="flex gap-1.5 items-center h-4">
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot"
                      style="animation-delay: 0s"
                    />
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot"
                      style="animation-delay: 0.15s"
                    />
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-text-tertiary typing-dot"
                      style="animation-delay: 0.3s"
                    />
                  </div>
                  <span v-if="status" class="text-[11px] text-text-secondary">{{ status }}</span>
                </div>
              </div>
            </div>

            <!-- Tool status while text is streaming -->
            <div v-if="loading && !isWaiting && status" class="flex justify-start pl-10">
              <span class="text-[11px] text-text-secondary italic">{{ status }}</span>
            </div>
          </div>

          <!-- Input area -->
          <div
            class="advisor-composer border-t border-separator/50 p-4 flex-shrink-0 bg-bg-primary"
          >
            <div class="advisor-composer-inner flex gap-3 items-end">
              <Textarea
                v-model="input"
                :placeholder="t('advisorPlaceholder')"
                class="resize-none min-h-[44px] max-h-32 text-[13px]"
                rows="1"
                :disabled="loading"
                @keydown="handleKeydown"
              />
              <Button
                size="icon"
                :disabled="loading || !input.trim()"
                class="flex-shrink-0"
                @click="sendMessage()"
              >
                <SendHorizontal class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.advisor-history {
  border-inline-end: 1px solid var(--separator);
  background: var(--bg-secondary);
}
.advisor-conversation {
  background: var(--bg-primary);
}
.chat-messages > * {
  width: min(100%, 760px);
  margin-inline: auto;
}
.advisor-composer-inner {
  width: min(100%, 760px);
  margin-inline: auto;
}
.advisor-composer {
  padding-block: 16px;
}
@media (max-width: 900px) {
  .advisor-history {
    width: 210px;
  }
}
.typing-dot {
  animation: typing-pulse 1.4s ease-in-out infinite;
}

@keyframes typing-pulse {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: scale(1);
  }
  30% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>
