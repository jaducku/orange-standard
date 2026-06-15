import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MempoolClient } from "../mempool/client.js";
import { setupMCPServer } from "./server.js";

/** A MempoolClient wired to canned responses, no network. */
function stubbedClient(): MempoolClient {
  const routes: Record<string, string> = {
    "/api/v1/fees/recommended": JSON.stringify({
      fastestFee: 30,
      halfHourFee: 20,
      hourFee: 10,
      economyFee: 5,
      minimumFee: 1,
    }),
    "/api/v1/blocks": JSON.stringify([
      { id: "h1", height: 800000, timestamp: 1, tx_count: 7, extras: { pool: { name: "Foundry" } } },
    ]),
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = new URL(input.toString()).pathname;
    const body = routes[path];
    if (body === undefined) return new Response("nope", { status: 404, statusText: "Not Found" });
    return new Response(body, { status: 200, statusText: "OK" });
  }) as typeof fetch;
  return new MempoolClient({ fetchImpl });
}

/** Connects an MCP client to a freshly built server over an in-memory pair. */
async function connect(): Promise<Client> {
  const server = setupMCPServer({ client: stubbedClient() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

test("exposes all four PRD tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_block_detail",
    "get_fee_estimates",
    "get_latest_blocks",
    "get_mempool_status",
  ]);
});

test("get_fee_estimates returns data, structuredContent, and a UI resource", async () => {
  const client = await connect();
  const result = (await client.callTool({ name: "get_fee_estimates", arguments: {} })) as CallToolResult;
  assert.notEqual(result.isError, true);

  // Text fallback for non-UI hosts.
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  const parsed = JSON.parse(text);
  assert.equal(parsed.fastestFee, 30);
  assert.equal(parsed.minimumFee, 1);

  // Structured data for UI hosts.
  assert.equal((result.structuredContent as { fastestFee?: number })?.fastestFee, 30);

  // Inline MCP App UI resource.
  const resource = result.content.find((c) => c.type === "resource");
  assert.ok(resource && resource.type === "resource");
  assert.equal(resource.resource.uri, "ui://bitcoin-mempool/fees");
  const html = "text" in resource.resource ? resource.resource.text : "";
  assert.match(html, /<!doctype html>/i);
});

test("exposes ui:// resources that render an iframe shell", async () => {
  const client = await connect();
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri).sort();
  assert.deepEqual(uris, [
    "ui://bitcoin-mempool/block-detail",
    "ui://bitcoin-mempool/blocks",
    "ui://bitcoin-mempool/fees",
    "ui://bitcoin-mempool/mempool",
  ]);

  const read = await client.readResource({ uri: "ui://bitcoin-mempool/fees" });
  const first = read.contents[0];
  const shell = first && "text" in first ? first.text : "";
  assert.match(shell, /Recommended fees/);
});

test("get_block_detail without height or hash returns a tool error", async () => {
  const client = await connect();
  const result = (await client.callTool({ name: "get_block_detail", arguments: {} })) as CallToolResult;
  assert.equal(result.isError, true);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /height.*hash/i);
});
