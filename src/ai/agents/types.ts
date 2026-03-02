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
