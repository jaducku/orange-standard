/**
 * Builds the Bitcoin Mempool MCP server and registers its tools and UI.
 *
 * The server is stateless: a fresh instance is created per request by the
 * Netlify function, which keeps it safe for concurrent serverless invocations.
 *
 * Each tool is an MCP App: it is linked (via `_meta.ui.resourceUri`) to a
 * `ui://` HTML resource that hosts render in a sandboxed iframe. Tool results
 * also carry plain text, so hosts without UI support degrade gracefully.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MempoolApiError, MempoolClient } from "../mempool/client.js";
import { type View, UI_MIME_TYPE, UI_RESOURCES, shellHtml, uiResourceContent } from "./ui.js";

export interface SetupOptions {
  /** Override the data client, primarily for tests. */
  client?: MempoolClient;
}

/** Links a tool to its UI resource per the MCP Apps extension. */
function uiMeta(view: View): Record<string, unknown> {
  return { ui: { resourceUri: UI_RESOURCES[view].uri, visibility: ["model", "app"] } };
}

export function setupMCPServer(options: SetupOptions = {}): McpServer {
  const client = options.client ?? new MempoolClient();

  const server = new McpServer(
    { name: "bitcoin-mempool", version: "0.1.0" },
    {
      instructions:
        "Provides real-time Bitcoin network state from mempool.space: latest blocks, " +
        "block details, mempool congestion, and recommended fees. Read-only. Tools render " +
        "interactive UI in MCP Apps-capable hosts.",
      capabilities: { tools: {}, resources: {} },
    },
  );

  // Register the UI resources (the iframe shells) that tools link to.
  for (const view of Object.keys(UI_RESOURCES) as View[]) {
    const meta = UI_RESOURCES[view];
    server.registerResource(
      view,
      meta.uri,
      { title: meta.name, description: meta.description, mimeType: UI_MIME_TYPE },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: UI_MIME_TYPE, text: shellHtml(view) }],
      }),
    );
  }

  server.registerTool(
    "get_latest_blocks",
    {
      description:
        "Get the most recently mined Bitcoin blocks (height, hash, timestamp, transaction count, and mining pool).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("How many recent blocks to return (1-15, default 10)."),
      },
      _meta: uiMeta("blocks"),
    },
    async ({ limit }) =>
      run("blocks", async () => ({ blocks: await client.getLatestBlocks(limit ?? 10) })),
  );

  server.registerTool(
    "get_block_detail",
    {
      description:
        "Get detailed metadata for a specific Bitcoin block, identified by height or block hash.",
      inputSchema: {
        height: z.number().int().nonnegative().optional().describe("Block height to look up."),
        hash: z.string().min(1).optional().describe("Block hash to look up."),
      },
      _meta: uiMeta("block-detail"),
    },
    async ({ height, hash }) => {
      if (height === undefined && hash === undefined) {
        return toolError("Provide either a block 'height' or a block 'hash'.");
      }
      return run("block-detail", () => client.getBlockDetail({ height, hash }));
    },
  );

  server.registerTool(
    "get_mempool_status",
    {
      description:
        "Get the current Bitcoin mempool status: pending transaction count, total size (vbytes), " +
        "total fees, and the next projected blocks.",
      _meta: uiMeta("mempool"),
    },
    async () => run("mempool", () => client.getMempoolStatus()),
  );

  server.registerTool(
    "get_fee_estimates",
    {
      description:
        "Get recommended Bitcoin transaction fee rates (sat/vB): fastest, half-hour, hour, economy, and minimum.",
      _meta: uiMeta("fees"),
    },
    async () => run("fees", () => client.getFeeEstimates()),
  );

  return server;
}

/**
 * Runs a data fetch and renders it as an MCP tool result: structured data for
 * UI hosts, an inline UI resource for rendering, and JSON text as a fallback.
 */
async function run(view: View, fetcher: () => Promise<object>): Promise<CallToolResult> {
  try {
    const data = await fetcher();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }, uiResourceContent(view, data)],
      structuredContent: data as Record<string, unknown>,
    };
  } catch (err) {
    const message =
      err instanceof MempoolApiError
        ? err.message
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return toolError(message);
  }
}

/** Builds an MCP error result with a clear, agent-readable message. */
function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
