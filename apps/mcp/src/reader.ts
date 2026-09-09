import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** A user's existing session supplies tenant/role scope. This adapter has no database credentials. */
export function createOperationsReader(
  config = {
    base: process.env.DEVICEOPS_URL,
    token: process.env.DEVICEOPS_MCP_ACCESS_TOKEN,
  },
) {
  if (!config.base || !config.token)
    throw new Error(
      "Operations reader requires DEVICEOPS_URL and DEVICEOPS_MCP_ACCESS_TOKEN",
    );
  const base = new URL(config.base);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid trusted backend origin");
  const server = new Server(
    { name: "deviceops-operations-reader", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_incidents",
        description:
          "List up to 50 recent incidents visible to the signed-in DeviceOps tenant. Read-only.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_triage_report",
        description:
          "Read an incident report and supporting evidence. A report may still be a draft or unavailable.",
        inputSchema: {
          type: "object",
          properties: { incidentId: { type: "string", format: "uuid" } },
          required: ["incidentId"],
          additionalProperties: false,
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    let path: string;
    if (request.params.name === "list_incidents") {
      z.object({})
        .strict()
        .parse(request.params.arguments ?? {});
      path = "/api/v2/incidents";
    } else if (request.params.name === "get_triage_report") {
      const { incidentId } = z
        .object({ incidentId: z.uuid() })
        .strict()
        .parse(request.params.arguments);
      path = `/api/v2/incidents/${incidentId}`;
    } else throw new Error("Unknown read-only operation");
    const response = await fetch(new URL(path, base), {
      headers: { authorization: `Bearer ${config.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new Error(
        `DeviceOps read denied or unavailable (${response.status})`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 262144) {
          await reader.cancel();
          throw new Error("Response exceeds read budget");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return {
      content: [{ type: "text", text: Buffer.concat(chunks).toString("utf8") }],
    };
  });
  return server;
}
