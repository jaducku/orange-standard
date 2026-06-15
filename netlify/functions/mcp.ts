/**
 * Netlify serverless entrypoint for the Bitcoin Mempool MCP server.
 *
 * Serves the OAuth flow and the stateless Streamable HTTP MCP endpoint (/mcp).
 * The app is built per cold start; a new MCP server + transport is created per
 * request so concurrent invocations stay isolated.
 */

import serverless from "serverless-http";
import { createApp } from "../../src/server/app.js";

export const handler = serverless(createApp());
