<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useMediaQuery } from '@vueuse/core';
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
import { ArrowUp, ArrowRight, LoaderCircle, PanelLeftClose, PanelLeft } from 'lucide-vue-next';
import MarkdownContent from './MarkdownContent.vue';
import ChatSidebar from './ChatSidebar.vue';
import AdvisorChartView from './AdvisorChartView.vue';
import { language, t, type LanguageLabel } from '@/lib/language';

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const sessionLoading = ref(false);
const historyPending = ref(false);
const sessionLoadFailed = ref(false);
const busy = computed(() => loading.value || sessionLoading.value || historyPending.value);
const status = ref('');
const chatContainer = ref<HTMLElement | null>(null);
const activeSession = ref<SessionMeta | null>(null);
const compact = useMediaQuery('(max-width: 700px)');
const sidebarOpen = ref(!compact.value);
const historyLabel = computed(() =>
  language.value === 'he' ? 'היסטוריית שיחות' : 'Conversation history',
);
const sidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null);

// Keep the progress indicator visible until the complete response arrives.
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
  if (busy.value) return;
  sessionLoading.value = true;
  sessionLoadFailed.value = false;
  try {
    const { session: data } = await getChatSession(session.id);
    activeSession.value = session;
    if (compact.value) sidebarOpen.value = false;
    messages.value = data.messages.map((m: SessionMessage) => ({
      role: m.role,
      content: m.content,
      chart: m.chart,
    }));
    await scrollToBottom(true);
  } catch {
    sessionLoadFailed.value = true;
  } finally {
    sessionLoading.value = false;
  }
}

function handleNewChat(session: SessionMeta) {
  sessionLoadFailed.value = false;
  if (compact.value) sidebarOpen.value = false;
  activeSession.value = session;
  messages.value = [];
}

function handleDeletedSession(id: string) {
  if (activeSession.value?.id !== id) return;
  activeSession.value = null;
  messages.value = [];
  input.value = '';
  sessionLoadFailed.value = false;
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
  if (!messageText || busy.value) return;

  sessionLoadFailed.value = false;
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <div class="advisor-workspace relative flex-1 min-h-0" @keydown.esc="sidebarOpen = false">
    <div class="absolute inset-0 flex">
      <button
        v-if="sidebarOpen && compact"
        type="button"
        class="advisor-history-backdrop"
        :aria-label="t('cancel')"
        @click="sidebarOpen = false"
      />
      <aside
        v-show="sidebarOpen"
        id="advisor-history"
        class="advisor-history flex-shrink-0 overflow-hidden"
        :aria-label="historyLabel"
      >
        <div v-if="compact" class="flex items-center justify-between px-4 pt-3">
          <span class="text-[13px] font-medium">{{ historyLabel }}</span>
          <Button
            variant="ghost"
            size="icon"
            :aria-label="t('cancel')"
            @click="sidebarOpen = false"
          >
            <PanelLeftClose class="h-4 w-4" />
          </Button>
        </div>
        <ChatSidebar
          ref="sidebarRef"
          :active-session-id="activeSession?.id"
          :busy="busy"
          @select="selectSession"
          @new-chat="handleNewChat"
          @deleted="handleDeletedSession"
          @pending="historyPending = $event"
        />
      </aside>

      <div class="flex-1 flex flex-col min-w-0">
        <header class="advisor-toolbar">
          <Button
            variant="ghost"
            size="icon"
            :aria-label="historyLabel"
            :title="historyLabel"
            :aria-expanded="sidebarOpen"
            aria-controls="advisor-history"
            @click="sidebarOpen = !sidebarOpen"
          >
            <PanelLeftClose v-if="sidebarOpen" class="h-4 w-4" />
            <PanelLeft v-else class="h-4 w-4" />
          </Button>
          <span class="advisor-conversation-title" :title="activeSession?.title">
            {{ activeSession?.title || t('newChat') }}
          </span>
        </header>

        <div class="advisor-conversation flex-1 overflow-hidden flex flex-col min-h-0">
          <p v-if="sessionLoadFailed" class="advisor-session-error" role="alert">
            {{
              language === 'he'
                ? 'לא ניתן לפתוח את השיחה. נסו שוב.'
                : 'Could not open the conversation. Please try again.'
            }}
          </p>
          <div ref="chatContainer" class="chat-messages flex-1 overflow-y-auto">
            <section v-if="messages.length === 0" class="advisor-welcome">
              <p class="advisor-eyebrow">{{ t('advisor') }}</p>
              <h2>{{ t('askAboutFinances') }}</h2>
              <p class="advisor-intro">{{ t('advisorDescription') }}</p>
              <div class="advisor-suggestions">
                <button
                  v-for="key in suggestionKeys"
                  :key="key"
                  type="button"
                  class="advisor-suggestion"
                  :disabled="busy"
                  @click="sendMessage(t(key))"
                >
                  <span>{{ t(key) }}</span>
                  <ArrowRight
                    class="advisor-suggestion-arrow h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </section>

            <article
              v-for="(msg, i) in messages"
              :key="i"
              class="advisor-message"
              :class="msg.role === 'user' ? 'advisor-message-user' : 'advisor-message-answer'"
            >
              <p class="advisor-message-author">
                {{ msg.role === 'assistant' ? t('advisor') : language === 'he' ? 'אתם' : 'You' }}
              </p>
              <div class="advisor-message-body">
                <template v-if="msg.role === 'assistant'">
                  <MarkdownContent v-if="msg.content" :content="msg.content" />
                  <AdvisorChartView v-if="msg.chart" :chart="msg.chart" />
                </template>
                <div v-else class="whitespace-pre-wrap" dir="auto">{{ msg.content }}</div>
              </div>
            </article>

            <div v-if="isWaiting" class="advisor-waiting" role="status">
              <LoaderCircle class="advisor-loading h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{{
                status || (language === 'he' ? 'בודק את הנתונים…' : 'Reviewing your finances…')
              }}</span>
            </div>
            <div v-if="loading && !isWaiting && status" class="advisor-waiting" role="status">
              {{ status }}
            </div>
          </div>

          <div class="advisor-composer">
            <div class="advisor-composer-inner">
              <div class="advisor-input-wrap">
                <Textarea
                  v-model="input"
                  :aria-label="t('askAboutFinances')"
                  :placeholder="
                    language === 'he' ? 'שאלו על הכספים שלכם…' : 'Ask about your finances…'
                  "
                  class="advisor-input"
                  rows="2"
                  :disabled="busy"
                  @keydown="handleKeydown"
                />
                <Button
                  size="icon"
                  :aria-label="language === 'he' ? 'שליחת הודעה' : 'Send message'"
                  :disabled="busy || !input.trim()"
                  class="advisor-send"
                  @click="sendMessage()"
                >
                  <ArrowUp class="h-4 w-4" />
                </Button>
              </div>
              <p class="advisor-input-hint">
                {{
                  language === 'he'
                    ? 'Enter לשליחה · Shift + Enter לשורה חדשה'
                    : 'Enter to send · Shift + Enter for a new line'
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.advisor-history {
  width: 240px;
  border-inline-end: 1px solid var(--separator);
  background: var(--bg-secondary);
}
.advisor-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-height: 61px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--separator);
}
.advisor-conversation-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.advisor-session-error {
  padding: 12px 32px;
  color: var(--destructive);
  font-size: 13px;
}
.advisor-conversation {
  background: var(--bg-primary);
}
.chat-messages {
  padding: 32px;
  scrollbar-gutter: stable;
}
.chat-messages > *,
.advisor-composer-inner {
  width: min(100%, 720px);
  margin-inline: auto;
}
.advisor-welcome {
  padding-block: clamp(16px, 5vh, 56px) 24px;
}
.advisor-eyebrow,
.advisor-message-author {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.advisor-welcome h2 {
  max-width: 24ch;
  font-size: clamp(24px, 2.5vw, 30px);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.025em;
  text-wrap: balance;
}
.advisor-intro {
  max-width: 54ch;
  margin-block: 14px 28px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  text-wrap: pretty;
}
.advisor-suggestions {
  border-top: 1px solid var(--separator);
}
.advisor-suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  min-height: 48px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--separator);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  text-align: start;
  transition:
    color 150ms,
    background 150ms;
}
.advisor-suggestion:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.advisor-suggestion:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.advisor-suggestion-arrow {
  color: var(--text-tertiary);
}
[dir='rtl'] .advisor-suggestion-arrow {
  transform: rotate(180deg);
}
.advisor-message {
  margin-bottom: 32px;
}
.advisor-message-user {
  padding: 16px 20px;
  border-radius: 8px;
  background: var(--bg-secondary);
}
.advisor-message-answer {
  padding: 0 20px;
}
.advisor-message-body {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.75;
}
.advisor-message-body :deep(.markdown-content) {
  overflow-x: auto;
}
.advisor-message-body :deep(ul),
.advisor-message-body :deep(ol) {
  padding-inline-start: 1.25em;
  padding-inline-end: 0;
}
.advisor-message-body :deep(th) {
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
}
.advisor-message-body :deep(blockquote) {
  border-left: 0;
  border-inline-start: 2px solid var(--separator);
  padding-inline-start: 12px;
  padding-inline-end: 0;
}
.advisor-waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline: 20px;
  color: var(--text-secondary);
  font-size: 13px;
}
.advisor-loading {
  animation: advisor-spin 1.5s linear infinite;
}
.advisor-composer {
  flex-shrink: 0;
  padding: 16px 32px 14px;
  background: var(--bg-primary);
}
.advisor-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg-primary);
  transition: border-color 150ms;
}
.advisor-input-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-15);
}
.advisor-input {
  min-width: 0;
  min-height: 48px;
  max-height: 160px;
  resize: vertical;
  border: 0;
  border-radius: 0;
  padding: 2px 4px;
  background: transparent;
  font-size: 14px;
  line-height: 1.6;
  box-shadow: none;
}
.advisor-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
}
.advisor-input-hint {
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
  text-align: end;
}
@media (max-width: 900px) {
  .advisor-history {
    width: 210px;
  }
}
@media (max-width: 700px) {
  .advisor-history-backdrop {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: #0d1d3652;
  }
  .advisor-history {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 11;
    width: min(280px, calc(100% - 32px));
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .advisor-history > :last-child {
    flex: 1;
    min-height: 0;
  }
  .advisor-toolbar {
    padding: 10px 16px;
  }
  .chat-messages {
    padding: 20px 16px;
  }
  .advisor-message-answer {
    padding-inline: 4px;
  }
  .advisor-composer {
    padding: 12px 16px;
  }
}
@keyframes advisor-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .advisor-loading {
    animation: none;
  }
}
</style>
