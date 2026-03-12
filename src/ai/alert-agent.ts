import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { AgentMessage, AgentEvent } from '@mariozechner/pi-agent-core';
import { parseModelSpec, getAIModelSpec } from '../config.js';
import { resolveApiKey } from './auth.js';
import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
} from './tools.js';
import {
  buildGetNetWorthTool,
  buildGetLiabilitiesTool,
  buildGetNetWorthHistoryTool,
} from './asset-tools.js';

const ALERT_MAX_TURNS = 4;

/** Extract text from the last assistant message. */
function extractAssistantText(messages: AgentMessage[]): string {
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

/** Build the read-only tool subset for alert agents. */
function buildAlertTools() {
  return [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
    buildGetNetWorthTool(),
    buildGetLiabilitiesTool(),
    buildGetNetWorthHistoryTool(),
  ];
}

/**
 * Spawn a headless Agent with read-only financial tools.
 * Returns the composed message, or null if the agent decided [SILENT].
 */
export async function runAlertAgent(opts: {
  systemPrompt: string;
  userMessage: string;
}): Promise<string | null> {
  const { provider, model: modelName } = parseModelSpec(getAIModelSpec());

  // getModel is strictly typed; dynamic strings from config need a cast on the result
  const model = (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
    provider,
    modelName,
  );

  const tools = buildAlertTools();

  const agent = new Agent({
    initialState: { systemPrompt: opts.systemPrompt, model, tools },
    getApiKey: resolveApiKey,
  });

  return new Promise<string | null>((resolve) => {
    let turnCount = 0;
    let resolved = false;

    const finish = (text: string) => {
      if (resolved) return;
      resolved = true;
      const trimmed = text.trim();
      resolve(trimmed === '[SILENT]' || trimmed === '' ? null : trimmed);
    };

    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'turn_end') {
        turnCount++;
        if (turnCount >= ALERT_MAX_TURNS) {
          agent.abort();
        }
      }
      if (event.type === 'agent_end') {
        const lastMsg = event.messages[event.messages.length - 1];
        if (lastMsg && 'stopReason' in lastMsg && lastMsg.stopReason === 'error') {
          finish('');
          return;
        }
        finish(extractAssistantText(event.messages));
      }
    });

    agent.prompt(opts.userMessage).catch(() => finish(''));
  });
}
