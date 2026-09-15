import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { buildMoneyMonitorMcpServer, resolveMcpAccessMode } from './mcp-server.js';

async function listToolNames(access: 'read-only' | 'read-write') {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMoneyMonitorMcpServer(access);
  const client = new Client({ name: 'money-monitor-test', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const response = await client.listTools();
  await client.close();
  await server.close();
  return response.tools.map((tool) => tool.name);
}

describe('Money Monitor MCP server', () => {
  it('defaults to read-only and parses explicit access modes', () => {
    expect(resolveMcpAccessMode([], undefined)).toBe('read-only');
    expect(resolveMcpAccessMode(['--mcp-access=read-write'], undefined)).toBe('read-write');
    expect(resolveMcpAccessMode(['--mcp-access', 'read-only'], 'read-write')).toBe('read-only');
    expect(() => resolveMcpAccessMode(['--mcp-access=admin'], undefined)).toThrow(
      'Invalid MCP access mode',
    );
  });

  it('only advertises read tools in read-only mode', async () => {
    const names = await listToolNames('read-only');

    expect(names).toHaveLength(16);
    expect(names).toContain('get_budget_progress');
    expect(names).toContain('get_latest_scrape_transactions');
    expect(names).toContain('get_household_context');
    expect(names).not.toContain('categorize_transaction');
    expect(names).not.toContain('manage_budget');
  });

  it('advertises the complete 25-tool surface in read-write mode', async () => {
    const names = await listToolNames('read-write');

    expect(names).toHaveLength(25);
    expect(names).toContain('categorize_transaction');
    expect(names).toContain('manage_budget');
    expect(names).toContain('update_alert_settings');
  });
});
