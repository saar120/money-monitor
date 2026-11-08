import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { resolveApiKey } from './auth.js';
import { extractAssistantText, resolveModel } from './ai-utils.js';
import { getConfiguredThinkingLevel } from '../config.js';
import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
  buildGetLatestScrapeTransactionsTool,
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
    buildGetLatestScrapeTransactionsTool(),
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
    initialState: {
      systemPrompt: opts.systemPrompt,
      model,
      tools,
      thinkingLevel: getConfiguredThinkingLevel(model.reasoning) ?? 'off',
    },
    getApiKey: resolveApiKey,
    streamFn: streamSimple,
  });

  return new Promise<string | null>((resolve, reject) => {
    let turnCount = 0;
    let resolved = false;

    const finish = (text: string, error?: string) => {
      if (resolved) return;
      resolved = true;
      unsubscribe();
      if (error) {
        reject(new Error(error));
        return;
      }
      const trimmed = text.trim();

      if (trimmed === '') {
        reject(new Error('alert_empty_result'));
        return;
      }

      // Extract content from <message> tags if present (strips reasoning/thinking)
      const messageMatch = trimmed.match(/<message>([\s\S]*?)<\/message>\s*$/);
      const content = messageMatch ? messageMatch[1].trim() : trimmed;

      // Only an explicit SILENT result advances a silent analysis.
      if (content === '[SILENT]') {
        resolve(null);
        return;
      }

      if (!content) {
        reject(new Error('alert_empty_result'));
        return;
      }
      resolve(content);
    };

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === 'turn_end') {
        turnCount++;
        if (
          turnCount >= ALERT_MAX_TURNS &&
          event.message.role === 'assistant' &&
          event.message.stopReason === 'toolUse'
        ) {
          finish('', 'alert_turn_limit');
          agent.abort();
        }
      }
      if (event.type === 'agent_end') {
        const lastMsg = event.messages[event.messages.length - 1];
        if (
          lastMsg &&
          'stopReason' in lastMsg &&
          (lastMsg.stopReason === 'error' || lastMsg.stopReason === 'aborted')
        ) {
          finish('', 'alert_generation_failed');
          return;
        }
        finish(extractAssistantText(event.messages));
      }
    });

    void Promise.resolve()
      .then(() => agent.prompt(opts.userMessage))
      .catch(() => finish('', 'alert_generation_failed'));
  });
}
