import type { TSchema, Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

/**
 * Create a Pi AgentTool from simple arguments.
 * Wraps the execute function with error handling and consistent result format.
 */
export function createAgentTool<T extends TSchema>(opts: {
  name: string;
  description: string;
  label: string;
  parameters: T;
  execute: (params: Static<T>) => Promise<string>;
}): AgentTool<T, Record<string, never>> {
  return {
    name: opts.name,
    description: opts.description,
    label: opts.label,
    parameters: opts.parameters,
    execute: async (_toolCallId, params) => {
      try {
        const text = await opts.execute(params);
        return { content: [{ type: 'text', text }], details: {} };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: `Error: ${message}` }], details: {} };
      }
    },
  };
}
