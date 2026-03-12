import { getModel } from '@mariozechner/pi-ai';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { parseModelSpec, getAIModelSpec } from '../config.js';

/** Extract text from the last assistant message in a list. */
export function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && 'role' in msg && msg.role === 'assistant') {
      return (msg as AssistantMessage).content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }
  return '';
}

/** Resolve the configured AI model with the necessary type cast. */
export function resolveModel() {
  const { provider, model: modelName } = parseModelSpec(getAIModelSpec());
  return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(provider, modelName);
}
