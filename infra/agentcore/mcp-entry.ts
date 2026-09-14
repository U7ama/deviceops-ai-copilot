// Reuse the scoped operations MCP implementation; exclude legacy database adapters.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOperationsMcp } from '../../apps/mcp/src/operations.js';

const transport = new StdioServerTransport();

// When stdin closes or transport terminates, exit immediately to prevent keepalive hang
process.stdin.on('close', () => {
  process.exit(0);
});
process.stdin.on('end', () => {
  process.exit(0);
});

transport.onclose = () => {
  process.exit(0);
};
transport.onerror = () => {
  process.exit(1);
};

createOperationsMcp().connect(transport).catch(() => process.exit(1));
