<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { aiChat, type ChatMessage } from '../api/client';

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
</script>

<template>
  <div class="chat-page">
    <h1>AI Financial Advisor</h1>

    <div class="chat-container" ref="chatContainer">
      <div v-if="messages.length === 0" class="empty-state">
        <p>Ask me anything about your finances. Try one of these:</p>
        <div class="suggestions">
          <button v-for="s in suggestions" :key="s" @click="sendMessage(s)" class="suggestion">
            {{ s }}
          </button>
        </div>
      </div>

      <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role]">
        <div class="message-bubble">
          <div class="message-role">{{ msg.role === 'user' ? 'You' : 'AI Advisor' }}</div>
          <div class="message-content" v-html="msg.content.replace(/\n/g, '<br>')"></div>
        </div>
      </div>

      <div v-if="loading" class="message assistant">
        <div class="message-bubble">
          <div class="message-role">AI Advisor</div>
          <div class="message-content typing">Analyzing your finances...</div>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <input
        v-model="input"
        @keyup.enter="sendMessage()"
        placeholder="Ask about your finances..."
        :disabled="loading"
      />
      <button @click="sendMessage()" :disabled="loading || !input.trim()">Send</button>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 4rem);
}
.chat-page h1 { margin-bottom: 1rem; flex-shrink: 0; }
.chat-container {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}
.empty-state { text-align: center; padding: 2rem; color: #666; }
.suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 1rem; }
.suggestion {
  padding: 0.5rem 1rem;
  background: #f0f7ff;
  border: 1px solid #36A2EB;
  border-radius: 20px;
  color: #36A2EB;
  cursor: pointer;
  font-size: 0.875rem;
}
.suggestion:hover { background: #36A2EB; color: #fff; }
.message { margin-bottom: 1rem; display: flex; }
.message.user { justify-content: flex-end; }
.message.assistant { justify-content: flex-start; }
.message-bubble {
  max-width: 80%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
}
.message.user .message-bubble { background: #36A2EB; color: #fff; }
.message.assistant .message-bubble { background: #f0f0f0; color: #333; }
.message-role { font-size: 0.75rem; font-weight: 600; margin-bottom: 0.25rem; opacity: 0.7; }
.typing { font-style: italic; opacity: 0.7; }
.chat-input {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}
.chat-input input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
}
.chat-input button {
  padding: 0.75rem 1.5rem;
  background: #36A2EB;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
}
.chat-input button:disabled { opacity: 0.5; cursor: default; }
</style>
