/**
 * Minimal, stateless OAuth 2.1 authorization server for the MCP endpoint.
 *
 * MCP-capable hosts such as claude.ai expect remote servers to advertise an
 * OAuth flow (discovery + Dynamic Client Registration + PKCE) and to challenge
 * unauthenticated requests with a 401. The data served here is public and
 * read-only, so there is no real user to authenticate: the authorization
 * endpoint auto-approves and issues a short-lived bearer token.
 *
 * Everything is stateless — authorization codes and access tokens are
 * HMAC-signed (compact JWT, HS256) and verified on later requests, so no
 * storage is needed across serverless invocations.
 */

import crypto from "node:crypto";

/** HMAC signing secret. Set OAUTH_SIGNING_SECRET in production. */
const SECRET =
  process.env.OAUTH_SIGNING_SECRET ??
  "orange-standard-dev-secret-please-override-in-netlify-env-settings";

const ACCESS_TTL_SEC = 60 * 60; // 1 hour
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL_SEC = 60 * 10; // 10 minutes
const SCOPE = "mcp";

type TokenType = "code" | "access" | "refresh";

interface TokenPayload {
  typ: TokenType;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

/** Signs a compact HS256 JWT. */
export function signToken(claims: Record<string, unknown>, typ: TokenType, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ ...claims, typ, iat: now, exp: now + ttlSec }));
  const data = `${header}.${payload}`;
  return `${data}.${hmac(data)}`;
}

/** Verifies a token's signature, type, and expiry. Returns claims or null. */
export function verifyToken(token: string, typ: TokenType): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = hmac(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims: TokenPayload;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.typ !== typ) return null;
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

/** Verifies a PKCE S256 challenge against a verifier. */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface AuthCodeClaims {
  code_challenge: string;
  redirect_uri: string;
  client_id: string;
  [key: string]: unknown;
}

export function createAuthCode(claims: AuthCodeClaims): string {
  return signToken(claims, "code", CODE_TTL_SEC);
}

export function verifyAuthCode(code: string): (TokenPayload & AuthCodeClaims) | null {
  return verifyToken(code, "code") as (TokenPayload & AuthCodeClaims) | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export function issueTokens(clientId: string): TokenResponse {
  return {
    access_token: signToken({ sub: clientId, scope: SCOPE }, "access", ACCESS_TTL_SEC),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEC,
    refresh_token: signToken({ sub: clientId, scope: SCOPE }, "refresh", REFRESH_TTL_SEC),
    scope: SCOPE,
  };
}

/** Validates an Authorization: Bearer header value. */
export function isAuthorized(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return false;
  return verifyToken(match[1] as string, "access") !== null;
}

// --- Discovery documents ------------------------------------------------------

export function protectedResourceMetadata(baseUrl: string): Record<string, unknown> {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(baseUrl: string): Record<string, unknown> {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

/** Builds a Dynamic Client Registration (RFC 7591) response. */
export function registerClient(body: Record<string, unknown>): Record<string, unknown> {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  return {
    client_id: `oc_${crypto.randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  };
}
