import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDeviceStatus, searchManualForActor } from '@deviceops/core';
import type { SessionUser } from '@deviceops/contracts';
import { logStructured } from '@deviceops/observability';
import { z } from 'zod';

const Uuid = z.string().uuid();

export type McpContext = {
  actor: SessionUser;
  roomId: string;
  deviceId: string;
};

export function readMcpContext(environment: NodeJS.ProcessEnv = process.env): McpContext {
  const tenantId = Uuid.parse(environment.DEVICEOPS_MCP_TENANT_ID);
  const userId = Uuid.parse(environment.DEVICEOPS_MCP_USER_ID);
  const roomId = Uuid.parse(environment.DEVICEOPS_MCP_ROOM_ID);
  const deviceId = Uuid.parse(environment.DEVICEOPS_MCP_DEVICE_ID);
  return {
    roomId,
    deviceId,
    actor: {
      id: userId,
      email: environment.DEVICEOPS_MCP_EMAIL ?? 'mcp-readonly@deviceops.local',
      displayName: environment.DEVICEOPS_MCP_DISPLAY_NAME ?? 'DeviceOps MCP read-only operator',
      tenantId,
      tenantName: environment.DEVICEOPS_MCP_TENANT_NAME ?? 'Bound synthetic tenant',
      role: 'viewer',
      demoMode: true
    }
  };
}

export function createMcpAdapterServer(context: McpContext = readMcpContext()) {
  const server = new Server({ name: 'deviceops-mcp-server', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'search_manual', description: 'Read-only, tenant-bound search over published manual evidence.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 3 }, topK: { type: 'number', minimum: 1, maximum: 10 } }, required: ['query'] } },
    { name: 'get_device_status', description: 'Read-only status for the one device bound to this MCP process.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    if (request.params.name === 'search_manual') {
      const query = z.string().trim().min(3).max(4000).parse(args.query);
      const topK = z.number().int().min(1).max(10).optional().parse(args.topK) ?? 5;
      logStructured('mcp.read_tool', { tool: 'search_manual', tenantId: context.actor.tenantId });
      const results = (await searchManualForActor(context.actor, query)).slice(0, topK);
      return { content: [{ type: 'text', text: JSON.stringify({ tenantId: context.actor.tenantId, results }) }] };
    }
    if (request.params.name === 'get_device_status') {
      logStructured('mcp.read_tool', { tool: 'get_device_status', tenantId: context.actor.tenantId, deviceId: context.deviceId });
      const status = await getDeviceStatus(context.actor, context.roomId, context.deviceId);
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    }
    throw new Error(`Unknown read-only tool: ${request.params.name}`);
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'deviceops://system/health', name: 'MCP capability status', mimeType: 'application/json' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== 'deviceops://system/health') throw new Error('Resource not found');
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify({ status: 'ready', mode: 'read_only', tenantBound: true, correlationId: randomUUID() }) }] };
  });
  return server;
}

if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  const server = createMcpAdapterServer();
  await server.connect(new StdioServerTransport());
  logStructured('mcp.ready', { mode: 'read_only', tenantBound: true });
}
