<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import {
  aiChatStream,
  createChatSession,
  getChatSession,
  type SessionMeta,
  type SessionMessage,
  type ChatMessage,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { SendHorizontal, Bot, User, PanelLeftClose, PanelLeft } from 'lucide-vue-next';
import MarkdownContent from './MarkdownContent.vue';
import ChatSidebar from './ChatSidebar.vue';

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

const suggestions = [
  'What are my top spending categories this month?',
  'How much did I spend on food this month vs last month?',
  'How can I save money based on my spending?',
  'What are my recurring subscriptions?',
  'Categorize my uncategorized transactions',
];

async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

async function selectSession(session: SessionMeta) {
  activeSession.value = session;
  try {
    const { session: data } = await getChatSession(session.id);
    messages.value = data.messages.map((m: SessionMessage) => ({ role: m.role, content: m.content }));
    await scrollToBottom();
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

  const sessionId = await ensureSession();

  messages.value.push({ role: 'user', content: messageText });
  input.value = '';
  loading.value = true;
  status.value = '';
  await scrollToBottom();

  try {
    // Add assistant message upfront so text streams into it
    messages.value.push({ role: 'assistant', content: '' });
    const msgIndex = messages.value.length - 1;

    for await (const event of aiChatStream(sessionId, messageText)) {
      if (event.type === 'text_delta') {
        messages.value[msgIndex]!.content += event.text;
        await scrollToBottom();
      } else if (event.type === 'status') {
        status.value = event.text;
      } else if (event.type === 'result') {
        messages.value[msgIndex]!.content = event.text;
      } else if (event.type === 'error') {
        throw new Error(event.text);
      }
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
  <div class="flex h-[calc(100vh-6rem)] animate-fade-in-up gap-4">
    <!-- Sidebar -->
    <Card
      v-if="sidebarOpen"
      class="w-64 flex-shrink-0 overflow-hidden"
    >
      <ChatSidebar
        ref="sidebarRef"
        :active-session-id="activeSession?.id"
        @select="selectSession"
        @new-chat="handleNewChat"
      />
    </Card>

    <!-- Chat area -->
    <div class="flex-1 flex flex-col min-w-0">
      <div class="flex items-center gap-2 mb-4 flex-shrink-0">
        <Button variant="ghost" size="icon" class="h-8 w-8" @click="sidebarOpen = !sidebarOpen">
          <PanelLeftClose v-if="sidebarOpen" class="h-4 w-4" />
          <PanelLeft v-else class="h-4 w-4" />
        </Button>
        <h1 class="text-[22px] font-semibold text-text-primary">AI Financial Advisor</h1>
      </div>

      <Card class="flex-1 overflow-hidden flex flex-col min-h-0">
        <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">

          <!-- Empty state with suggestions -->
          <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center py-8">
            <div class="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4">
              <Bot class="h-7 w-7 text-primary" />
            </div>
            <p class="text-text-secondary text-[13px] mb-2">
              Ask me anything about your finances
            </p>
            <p class="text-text-secondary text-[11px] mb-4 max-w-sm">
              I can analyze spending, track subscriptions, categorize transactions, and give budget advice
            </p>
            <div class="flex flex-wrap gap-2 justify-center max-w-lg">
              <Button
                v-for="s in suggestions"
                :key="s"
                variant="outline"
                size="sm"
                class="rounded-full border-separator text-primary hover:bg-primary/10 text-[11px] h-auto py-1.5 px-3"
                @click="sendMessage(s)"
              >
                {{ s }}
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
              class="max-w-[75%] rounded-md px-4 py-2.5 text-[13px] leading-relaxed"
              :class="msg.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-bg-secondary text-text-primary rounded-bl-md'"
            >
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-[10px] font-semibold opacity-60">
                  {{ msg.role === 'user' ? 'You' : 'AI Advisor' }}
                </span>
              </div>
              <MarkdownContent v-if="msg.role === 'assistant'" :content="msg.content" />
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
          <div v-if="isWaiting" class="flex gap-3 justify-start">
            <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot class="h-4 w-4 text-primary" />
            </div>
            <div class="bg-bg-secondary rounded-md rounded-bl-md px-4 py-3">
              <div class="flex items-center gap-2">
                <div class="flex gap-1 items-center h-4">
                  <span class="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:-0.3s]" />
                  <span class="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:-0.15s]" />
                  <span class="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" />
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
        <div class="border-t border-separator p-4 flex gap-3 items-end flex-shrink-0 bg-bg-secondary/50">
          <Textarea
            v-model="input"
            placeholder="Ask about your finances... (Enter to send, Shift+Enter for newline)"
            class="resize-none min-h-[40px] max-h-32 text-[13px]"
            rows="1"
            :disabled="loading"
            @keydown="handleKeydown"
          />
          <Button
            size="icon"
            :disabled="loading || !input.trim()"
            @click="sendMessage()"
            class="flex-shrink-0"
          >
            <SendHorizontal class="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  </div>
</template>
