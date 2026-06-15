/**
 * Local dev server — runs the same MCP handler as the Netlify function on a
 * plain HTTP port, for testing without the Netlify CLI.
 *
 *   npm run serve   # then POST http://localhost:8910/mcp
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { setupMCPServer } from "../src/mcp/server.js";

const app = express();
app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = setupMCPServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
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
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const port = Number(process.env.PORT ?? 8910);
app.listen(port, () => console.log(`MCP dev server on http://localhost:${port}/mcp`));
