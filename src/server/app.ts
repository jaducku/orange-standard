/**
 * The Express app shared by the Netlify function and the local dev server.
 *
 * Routes:
 *  - OAuth discovery + Dynamic Client Registration + authorize/token (stateless)
 *  - POST /mcp  — the MCP Streamable HTTP endpoint, protected by a bearer token
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import {
  authorizationServerMetadata,
  createAuthCode,
  isAuthorized,
  issueTokens,
  protectedResourceMetadata,
  registerClient,
  verifyAuthCode,
  verifyPkce,
  verifyToken,
} from "../auth/oauth.js";
import { setupMCPServer } from "../mcp/server.js";

/** Public base URL of this deployment, derived from the incoming request. */
function baseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

export function createApp(): express.Express {
  const app = express();

  // CORS so browser-based MCP clients and connector flows can reach us.
  app.use((req: Request, res: Response, next) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    );
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // --- OAuth discovery (RFC 9728 / RFC 8414) ---------------------------------
  app.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (req, res) => res.json(protectedResourceMetadata(baseUrl(req))),
  );
  app.get(
    [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/mcp",
      "/.well-known/openid-configuration",
    ],
    (req, res) => res.json(authorizationServerMetadata(baseUrl(req))),
  );

  // --- Dynamic Client Registration (RFC 7591) --------------------------------
  app.post("/register", (req, res) => {
    res.status(201).json(registerClient((req.body ?? {}) as Record<string, unknown>));
  });

  // --- Authorization endpoint (auto-approve; data is public) -----------------
  app.get("/authorize", (req, res) => {
    const { response_type, redirect_uri, code_challenge, code_challenge_method, state, client_id } =
      req.query;
    if (response_type !== "code") {
      return res.status(400).json({ error: "unsupported_response_type" });
    }
    if (typeof redirect_uri !== "string" || typeof code_challenge !== "string") {
      return res.status(400).json({ error: "invalid_request" });
    }
    if (code_challenge_method !== undefined && code_challenge_method !== "S256") {
      return res.status(400).json({ error: "invalid_request", error_description: "S256 required" });
    }
    const code = createAuthCode({
      code_challenge,
      redirect_uri,
      client_id: typeof client_id === "string" ? client_id : "",
    });
    const target = new URL(redirect_uri);
    target.searchParams.set("code", code);
    if (typeof state === "string") target.searchParams.set("state", state);
    return res.redirect(302, target.toString());
  });

  // --- Token endpoint --------------------------------------------------------
  app.post("/token", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.grant_type === "authorization_code") {
      const claims = typeof body.code === "string" ? verifyAuthCode(body.code) : null;
      if (!claims) return res.status(400).json({ error: "invalid_grant" });
      if (typeof body.code_verifier !== "string" || !verifyPkce(body.code_verifier, claims.code_challenge)) {
        return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }
      if (typeof body.redirect_uri === "string" && body.redirect_uri !== claims.redirect_uri) {
        return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      }
      return res.json(issueTokens(claims.client_id || "client"));
    }
    if (body.grant_type === "refresh_token") {
      const claims = typeof body.refresh_token === "string" ? verifyToken(body.refresh_token, "refresh") : null;
      if (!claims) return res.status(400).json({ error: "invalid_grant" });
      return res.json(issueTokens(String(claims.sub ?? "client")));
    }
    return res.status(400).json({ error: "unsupported_grant_type" });
  });

  // --- MCP endpoint (bearer-protected) ---------------------------------------
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!isAuthorized(req.headers.authorization)) {
      res.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
      );
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
    }
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
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
    return undefined;
  });

  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}
