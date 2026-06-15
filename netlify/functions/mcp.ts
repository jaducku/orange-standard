/**
 * Netlify serverless entrypoint for the Bitcoin Mempool MCP server.
 *
 * Exposes a stateless Streamable HTTP MCP endpoint at /mcp (see netlify.toml
 * redirect). A new MCP server + transport is created per request so that
 * concurrent serverless invocations stay fully isolated — no shared session
 * state, no request-id collisions.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import serverless from "serverless-http";
import { setupMCPServer } from "../../src/mcp/server.js";

const app = express();

// Permissive CORS so browser-based MCP clients (e.g. the Inspector) and remote
// connectors can reach the endpoint. Streamable HTTP needs Mcp-Session-Id
// exposed even though this server is stateless.
app.use((req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  );
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = setupMCPServer();
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: no session id generation.
      sessionIdGenerator: undefined,
      // Serverless functions can't stream a response — they buffer until the
      // handler returns. Force a single JSON response per POST instead of an
      // open SSE stream, which would otherwise hang the client (ETIMEDOUT).
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// In stateless mode there is no server-to-client streaming, so GET (SSE) and
// DELETE (session teardown) are not supported.
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

export const handler = serverless(app);
