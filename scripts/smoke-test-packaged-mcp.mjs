import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const command = process.argv[2];
if (!command) throw new Error('Packaged MCP command path is required');

const dataDir = await mkdtemp(join(tmpdir(), 'money-monitor-mcp-smoke-'));
const transport = new StdioClientTransport({
  command,
  env: { ...process.env, MONEY_MONITOR_DATA_DIR: dataDir },
});
const client = new Client({ name: 'money-monitor-release-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 16 || tools.some((tool) => tool.annotations?.readOnlyHint !== true)) {
    throw new Error(`Expected 16 read-only tools, received ${tools.length}`);
  }

  const result = await client.callTool({ name: 'get_account_balances', arguments: {} });
  if (result.isError) throw new Error('Packaged MCP read tool failed');

  console.log(`Packaged MCP verified: ${tools.length} read-only tools`);
} finally {
  await client.close().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
