import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = {
  ...process.env,
  DEVICEOPS_MCP_TENANT_ID: '00000000-0000-4000-8000-000000000001',
  DEVICEOPS_MCP_USER_ID: '10000000-0000-4000-8000-000000000001',
  DEVICEOPS_MCP_ROOM_ID: '20000000-0000-4000-8000-000000000001',
  DEVICEOPS_MCP_DEVICE_ID: '30000000-0000-4000-8000-000000000001',
  DEVICEOPS_MCP_EMAIL: 'mcp-readonly@deviceops.local'
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'apps/mcp/src/index.ts'],
  cwd: process.cwd(),
  env
});
const client = new Client({ name: 'deviceops-local-smoke', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const resources = await client.listResources();
  const health = await client.readResource({ uri: 'deviceops://system/health' });
  const names = tools.tools.map((tool) => tool.name).sort();
  if (names.join(',') !== 'get_device_status,search_manual') throw new Error(`Unexpected MCP tools: ${names.join(',')}`);
  const healthText = health.contents?.[0]?.text ?? '';
  if (!healthText.includes('tenantBound') || !healthText.includes('read_only')) throw new Error('MCP health resource is not tenant-bound/read-only');
  console.log(JSON.stringify({ ok: true, tools: names, resources: resources.resources.map((resource) => resource.uri), health: JSON.parse(healthText) }, null, 2));
} finally {
  await transport.close();
}
