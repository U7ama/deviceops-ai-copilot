import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOperationsReader } from "./reader.js";
afterEach(() => vi.unstubAllGlobals());
it("exposes only two read operations and binds HTTP calls to the configured session", async () => {
  const fetcher = vi.fn(async () => Response.json({ incidents: [] }));
  vi.stubGlobal("fetch", fetcher);
  const server = createOperationsReader({
      base: "https://deviceops.example",
      token: "test-session",
    }),
    client = new Client({ name: "reader-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      "list_incidents",
      "get_triage_report",
    ]);
    await client.callTool({ name: "list_incidents", arguments: {} });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://deviceops.example/api/v2/incidents"),
      expect.objectContaining({
        headers: { authorization: "Bearer test-session" },
        redirect: "error",
      }),
    );
    await expect(
      client.callTool({
        name: "list_incidents",
        arguments: { tenantId: "other-tenant" },
      }),
    ).rejects.toThrow("tenantId");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});
