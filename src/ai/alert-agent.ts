import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import { resolveApiKey } from './auth.js';
import { extractAssistantText, resolveModel } from './ai-utils.js';
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
  const { model } = resolveModel();
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
      unsubscribe();
      const trimmed = text.trim();
      resolve(trimmed === '[SILENT]' || trimmed === '' ? null : trimmed);
    };

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
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
