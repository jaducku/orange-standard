/**
 * Builds the Bitcoin Mempool MCP server and registers its tools.
 *
 * The server is stateless: a fresh instance is created per request by the
 * Netlify function, which keeps it safe for concurrent serverless invocations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MempoolApiError, MempoolClient } from "../mempool/client.js";

export interface SetupOptions {
  /** Override the data client, primarily for tests. */
  client?: MempoolClient;
}

export function setupMCPServer(options: SetupOptions = {}): McpServer {
  const client = options.client ?? new MempoolClient();

  const server = new McpServer(
    {
      name: "bitcoin-mempool",
      version: "0.1.0",
    },
    {
      instructions:
        "Provides real-time Bitcoin network state from mempool.space: latest blocks, " +
        "block details, mempool congestion, and recommended fees. Read-only.",
      capabilities: { tools: {} },
    },
  );

  server.tool(
    "get_latest_blocks",
    "Get the most recently mined Bitcoin blocks (height, hash, timestamp, transaction count, and mining pool).",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .describe("How many recent blocks to return (1-15, default 10)."),
    },
    async ({ limit }) => run(() => client.getLatestBlocks(limit ?? 10)),
  );

  server.tool(
    "get_block_detail",
    "Get detailed metadata for a specific Bitcoin block, identified by height or block hash.",
    {
      height: z.number().int().nonnegative().optional().describe("Block height to look up."),
      hash: z.string().min(1).optional().describe("Block hash to look up."),
    },
    async ({ height, hash }) => {
      if (height === undefined && hash === undefined) {
        return toolError("Provide either a block 'height' or a block 'hash'.");
      }
      return run(() => client.getBlockDetail({ height, hash }));
    },
  );

  server.tool(
    "get_mempool_status",
    "Get the current Bitcoin mempool status: pending transaction count, total size (vbytes), " +
      "total fees, and the next projected blocks.",
    async () => run(() => client.getMempoolStatus()),
  );

  server.tool(
    "get_fee_estimates",
    "Get recommended Bitcoin transaction fee rates (sat/vB): fastest, half-hour, hour, economy, and minimum.",
    async () => run(() => client.getFeeEstimates()),
  );

  return server;
}

/** Executes a data fetch and renders it as an MCP tool result. */
async function run(fetcher: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fetcher();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
