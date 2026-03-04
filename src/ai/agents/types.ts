import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.js';
import { buildMcpServerFromTools } from '../tools.js';

export type AgentType =
  | 'orchestrator'
  | 'spending_analyst'
  | 'budget_advisor'
  | 'categorizer'
  | 'subscription_tracker';

export interface AgentResult {
  response: string;
  agent: AgentType;
}

export interface AgentConfig {
  serverName: string;
  systemPrompt: string;
  tools: Parameters<typeof buildMcpServerFromTools>[1];
  maxTurns: number;
  errorLabel: string;
}

export async function runAgent(question: string, cfg: AgentConfig): Promise<string> {
  const server = buildMcpServerFromTools(cfg.serverName, cfg.tools);

  for await (const msg of query({
    prompt: question,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: cfg.systemPrompt,
      mcpServers: { [cfg.serverName]: server },
      tools: [],
      allowedTools: [`mcp__${cfg.serverName}__*`],
      maxTurns: cfg.maxTurns,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return `I reached the maximum steps. Please try a more specific question.`;
      }
      throw new Error(`${cfg.errorLabel} error (${msg.subtype})`);
    }
  }

  return `No ${cfg.errorLabel.toLowerCase()} result generated.`;
}
