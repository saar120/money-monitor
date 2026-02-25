<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { aiChat, type ChatMessage } from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { SendHorizontal, Bot, User } from 'lucide-vue-next';

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

const suggestions = [
  'What are my top spending categories this month?',
  'How much did I spend on food this month vs last month?',
  'Any unusually large charges recently?',
  'Categorize my uncategorized transactions',
  'What is my total spending this month?',
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
  await scrollToBottom();

  try {
    const result = await aiChat(messages.value);
    messages.value.push({ role: 'assistant', content: result.response });
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
    });
  } finally {
    loading.value = false;
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
  <div class="flex flex-col h-[calc(100vh-6rem)]">
    <h1 class="text-2xl font-semibold tracking-tight mb-4 flex-shrink-0">AI Financial Advisor</h1>

    <!-- Chat area -->
    <Card class="flex-1 overflow-hidden flex flex-col min-h-0">
      <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">

        <!-- Empty state with suggestions -->
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center py-8">
          <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Bot class="h-6 w-6 text-primary" />
          </div>
          <p class="text-muted-foreground text-sm mb-4">
            Ask me anything about your finances
          </p>
          <div class="flex flex-wrap gap-2 justify-center max-w-lg">
            <Button
              v-for="s in suggestions"
              :key="s"
              variant="outline"
              size="sm"
              class="rounded-full text-xs h-auto py-1.5 px-3"
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
              : 'bg-muted text-foreground rounded-bl-sm'"
          >
            <div class="text-[10px] font-semibold opacity-60 mb-1">
              {{ msg.role === 'user' ? 'You' : 'AI Advisor' }}
            </div>
            <div v-html="msg.content.replace(/\n/g, '<br>')" />
          </div>

          <!-- User avatar -->
          <div
            v-if="msg.role === 'user'"
            class="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <User class="h-4 w-4 text-primary-foreground" />
          </div>
        </div>

        <!-- Typing indicator -->
        <div v-if="loading" class="flex gap-3 justify-start">
          <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot class="h-4 w-4 text-primary" />
          </div>
          <div class="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
            <div class="flex gap-1 items-center h-4">
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="border-t border-border p-3 flex gap-2 items-end flex-shrink-0">
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
          class="flex-shrink-0"
        >
          <SendHorizontal class="h-4 w-4" />
        </Button>
      </div>
    </Card>
  </div>
</template>
