<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { aiChatStream, type ChatMessage } from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { SendHorizontal, Bot, User } from 'lucide-vue-next';

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const status = ref('');
const chatContainer = ref<HTMLElement | null>(null);

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

async function sendMessage(text?: string) {
  const messageText = text ?? input.value.trim();
  if (!messageText) return;

  messages.value.push({ role: 'user', content: messageText });
  input.value = '';
  loading.value = true;
  status.value = '';
  await scrollToBottom();

  try {
    let response = '';
    for await (const event of aiChatStream(messages.value)) {
      if (event.type === 'status') {
        status.value = event.text;
      } else if (event.type === 'result') {
        response = event.text;
      } else if (event.type === 'error') {
        throw new Error(event.text);
      }
    }
    messages.value.push({ role: 'assistant', content: response });
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
  <div class="flex flex-col h-[calc(100vh-6rem)] animate-fade-in-up">
    <h1 class="text-2xl font-semibold tracking-tight mb-4 flex-shrink-0 heading-font">AI Financial Advisor</h1>

    <!-- Chat area -->
    <Card class="flex-1 overflow-hidden flex flex-col min-h-0">
      <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">

        <!-- Empty state with suggestions -->
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center py-8">
          <div class="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4">
            <Bot class="h-7 w-7 text-primary" />
          </div>
          <p class="text-muted-foreground text-sm mb-2">
            Ask me anything about your finances
          </p>
          <p class="text-muted-foreground text-xs mb-4 max-w-sm">
            I can analyze spending, track subscriptions, categorize transactions, and give budget advice
          </p>
          <div class="flex flex-wrap gap-2 justify-center max-w-lg">
            <Button
              v-for="s in suggestions"
              :key="s"
              variant="outline"
              size="sm"
              class="rounded-full border-border-accent text-primary hover:bg-primary/10 text-xs h-auto py-1.5 px-3"
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
          <!-- AI avatar -->
          <div
            v-if="msg.role === 'assistant'"
            class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <Bot class="h-4 w-4 text-primary" />
          </div>

          <div
            class="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
            :class="msg.role === 'user'
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-surface-2 text-foreground rounded-bl-sm'"
          >
            <div class="flex items-center gap-1.5 mb-1">
              <span class="text-[10px] font-semibold opacity-60">
                {{ msg.role === 'user' ? 'You' : 'AI Advisor' }}
              </span>
            </div>
            <div class="whitespace-pre-wrap">{{ msg.content }}</div>
          </div>

          <!-- User avatar -->
          <div
            v-if="msg.role === 'user'"
            class="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <User class="h-4 w-4 text-primary-foreground" />
          </div>
        </div>

        <!-- Typing indicator with status -->
        <div v-if="loading" class="flex gap-3 justify-start">
          <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot class="h-4 w-4 text-primary" />
          </div>
          <div class="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="flex gap-1 items-center h-4">
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]" />
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]" />
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" />
              </div>
              <span v-if="status" class="text-xs text-muted-foreground">{{ status }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="border-t border-border p-4 flex gap-3 items-end flex-shrink-0 bg-surface-1/50">
        <Textarea
          v-model="input"
          placeholder="Ask about your finances... (Enter to send, Shift+Enter for newline)"
          class="resize-none min-h-[40px] max-h-32 text-sm"
          rows="1"
          :disabled="loading"
          @keydown="handleKeydown"
        />
        <Button
          size="icon"
          :disabled="loading || !input.trim()"
          @click="sendMessage()"
          class="flex-shrink-0 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
        >
          <SendHorizontal class="h-4 w-4" />
        </Button>
      </div>
    </Card>
  </div>
</template>
