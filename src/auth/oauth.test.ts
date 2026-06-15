import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  createAuthCode,
  isAuthorized,
  issueTokens,
  verifyAuthCode,
  verifyPkce,
  verifyToken,
} from "./oauth.js";

test("PKCE S256 verification round-trips", () => {
  const verifier = "abc123~verifier_string-_test.value";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(verifyPkce(verifier, challenge), true);
  assert.equal(verifyPkce("wrong", challenge), false);
});

test("auth code carries claims and verifies", () => {
  const code = createAuthCode({
    code_challenge: "chal",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    client_id: "oc_x",
  });
  const claims = verifyAuthCode(code);
  assert.ok(claims);
  assert.equal(claims.code_challenge, "chal");
  assert.equal(claims.redirect_uri, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(claims.client_id, "oc_x");
});

test("access tokens authorize, refresh/code tokens do not", () => {
  const { access_token, refresh_token } = issueTokens("client-1");
  assert.equal(isAuthorized(`Bearer ${access_token}`), true);
  assert.equal(isAuthorized(`bearer ${access_token}`), true);
  // A refresh token must not be accepted as an access token.
  assert.equal(isAuthorized(`Bearer ${refresh_token}`), false);
  assert.equal(verifyToken(refresh_token, "refresh")?.sub, "client-1");
});

test("tampered and missing tokens are rejected", () => {
  const { access_token } = issueTokens("client-1");
  assert.equal(isAuthorized(undefined), false);
  assert.equal(isAuthorized("Bearer not.a.jwt"), false);
  assert.equal(isAuthorized(`Bearer ${access_token}x`), false);
  const swapped = access_token.slice(0, -4) + "AAAA";
  assert.equal(isAuthorized(`Bearer ${swapped}`), false);
});
