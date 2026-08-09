// Token persistence, company discovery and the refresh lifecycle.
//
// src/qbo.js resolves its tokens directory once, at import time, so the env var
// is set BEFORE the dynamic import below. Each `node --test` file runs in its own
// process, so this does not leak into other test files.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

import { makeTokensDir, validTokens, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;

const qbo = await import("../src/qbo.js");

// Remove every token file between tests so each starts from a known state.
async function clearTokensDir() {
  const { unlink } = await import("node:fs/promises");
  for (const f of await readdir(TOKENS_DIR)) {
    if (f.startsWith("tokens")) await unlink(path.join(TOKENS_DIR, f));
  }
}

beforeEach(clearTokensDir);

describe("ROOT / QBO_TOKENS_DIR", () => {
  test("honours QBO_TOKENS_DIR", () => {
    assert.equal(qbo.ROOT, TOKENS_DIR);
  });
});

describe("tokensPathFor", () => {
  test("maps a slug to tokens.<slug>.json inside the tokens dir", () => {
    assert.equal(qbo.tokensPathFor("acme"), path.join(TOKENS_DIR, "tokens.acme.json"));
  });

  test("maps an empty slug to the legacy tokens.json", () => {
    assert.equal(qbo.tokensPathFor(""), path.join(TOKENS_DIR, "tokens.json"));
    assert.equal(qbo.tokensPathFor(null), path.join(TOKENS_DIR, "tokens.json"));
    assert.equal(qbo.tokensPathFor(undefined), path.join(TOKENS_DIR, "tokens.json"));
  });

  // The path-traversal property: a hostile slug cannot escape the tokens dir.
  test("cannot escape the tokens directory", () => {
    for (const evil of ["../../etc/passwd", "/etc/passwd", "..", "../sibling", "a/../../b"]) {
      const resolved = qbo.tokensPathFor(evil);
      assert.equal(
        path.dirname(resolved),
        TOKENS_DIR,
        `${evil} escaped to ${resolved}`
      );
    }
  });

  test("produces a filename with no separators", () => {
    assert.equal(path.basename(qbo.tokensPathFor("a/b/c")), "tokens.abc.json");
  });
});

describe("saveTokens / loadTokens", () => {
  test("round-trips a token bundle", async () => {
    const tokens = validTokens();
    await qbo.saveTokens("acme", tokens);
    assert.deepEqual(await qbo.loadTokens("acme"), tokens);
  });

  test("writes human-readable JSON", async () => {
    await qbo.saveTokens("acme", validTokens());
    const raw = await readFile(path.join(TOKENS_DIR, "tokens.acme.json"), "utf8");
    assert.match(raw, /^\{\n  "access_token"/);
  });

  test("overwrites an existing file rather than merging", async () => {
    await qbo.saveTokens("acme", validTokens({ access_token: "first" }));
    await qbo.saveTokens("acme", validTokens({ access_token: "second" }));
    assert.equal((await qbo.loadTokens("acme")).access_token, "second");
  });

  test("loadTokens returns null for a company with no token file", async () => {
    assert.equal(await qbo.loadTokens("missing"), null);
  });

  test("loadTokens returns null for corrupt JSON rather than throwing", async () => {
    await writeFile(path.join(TOKENS_DIR, "tokens.broken.json"), "{not json", "utf8");
    assert.equal(await qbo.loadTokens("broken"), null);
  });

  test("saves the legacy default under tokens.json", async () => {
    await qbo.saveTokens("", validTokens());
    assert.deepEqual(JSON.parse(await readFile(path.join(TOKENS_DIR, "tokens.json"), "utf8")).realmId, "9130350000000000");
  });
});

describe("listCompanies", () => {
  test("returns an empty list when nothing is authorized", async () => {
    assert.deepEqual(await qbo.listCompanies(), []);
  });

  test("discovers each tokens.<slug>.json with its realm and environment", async () => {
    await qbo.saveTokens("acme", validTokens({ realmId: "111", environment: "sandbox" }));
    await qbo.saveTokens("beta", validTokens({ realmId: "222", environment: "production" }));
    assert.deepEqual(await qbo.listCompanies(), [
      { slug: "acme", realmId: "111", environment: "sandbox" },
      { slug: "beta", realmId: "222", environment: "production" },
    ]);
  });

  test("sorts by slug", async () => {
    for (const s of ["zeta", "alpha", "mid"]) await qbo.saveTokens(s, validTokens());
    assert.deepEqual((await qbo.listCompanies()).map((c) => c.slug), ["alpha", "mid", "zeta"]);
  });

  // This exclusion is what creates the write-gate gap documented in SECURITY.md.
  test("KNOWN GAP: skips the legacy tokens.json, so it is invisible as a company", async () => {
    await qbo.saveTokens("", validTokens({ realmId: "999" }));
    assert.deepEqual(await qbo.listCompanies(), []);
  });

  test("skips the sandbox-backup reserved slug", async () => {
    await qbo.saveTokens("sandbox-backup", validTokens());
    await qbo.saveTokens("acme", validTokens());
    assert.deepEqual((await qbo.listCompanies()).map((c) => c.slug), ["acme"]);
  });

  test("skips unreadable token files instead of failing the whole listing", async () => {
    await qbo.saveTokens("good", validTokens({ realmId: "111" }));
    await writeFile(path.join(TOKENS_DIR, "tokens.bad.json"), "{corrupt", "utf8");
    assert.deepEqual((await qbo.listCompanies()).map((c) => c.slug), ["good"]);
  });

  test("ignores unrelated files in the directory", async () => {
    await writeFile(path.join(TOKENS_DIR, "notes.txt"), "hi", "utf8");
    await writeFile(path.join(TOKENS_DIR, "tokens.acme.json.bak"), "{}", "utf8");
    await qbo.saveTokens("acme", validTokens());
    assert.deepEqual((await qbo.listCompanies()).map((c) => c.slug), ["acme"]);
  });

  test("reports null for realm and environment when the file omits them", async () => {
    await writeFile(path.join(TOKENS_DIR, "tokens.sparse.json"), JSON.stringify({ access_token: "x" }), "utf8");
    assert.deepEqual(await qbo.listCompanies(), [
      { slug: "sparse", realmId: null, environment: null },
    ]);
  });
});

describe("refreshTokens", () => {
  let fetchStub;
  afterEach(() => fetchStub?.restore());

  test("stores the new access token", async () => {
    fetchStub = stubFetch(() => ({
      body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, x_refresh_token_expires_in: 8640000 },
    }));
    const updated = await qbo.refreshTokens("acme", validTokens());
    assert.equal(updated.access_token, "new-access");
  });

  test("adopts a rotated refresh token", async () => {
    fetchStub = stubFetch(() => ({
      body: { access_token: "a", refresh_token: "rotated", expires_in: 3600, x_refresh_token_expires_in: 8640000 },
    }));
    assert.equal((await qbo.refreshTokens("acme", validTokens())).refresh_token, "rotated");
  });

  test("keeps the existing refresh token when the response omits one", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600 } }));
    const updated = await qbo.refreshTokens("acme", validTokens({ refresh_token: "keep-me" }));
    assert.equal(updated.refresh_token, "keep-me");
  });

  test("preserves realmId and environment across a refresh", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600, x_refresh_token_expires_in: 8640000 } }));
    const updated = await qbo.refreshTokens("acme", validTokens({ realmId: "777", environment: "production" }));
    assert.equal(updated.realmId, "777");
    assert.equal(updated.environment, "production");
  });

  test("persists the refreshed bundle to disk", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "persisted", expires_in: 3600, x_refresh_token_expires_in: 8640000 } }));
    await qbo.refreshTokens("acme", validTokens());
    assert.equal((await qbo.loadTokens("acme")).access_token, "persisted");
  });

  test("posts to Intuit's token endpoint with Basic auth and a refresh grant", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600 } }));
    await qbo.refreshTokens("acme", validTokens({ refresh_token: "the-refresh" }));
    const [call] = fetchStub.calls;
    assert.equal(call.url, qbo.TOKEN_URL);
    assert.equal(call.init.method, "POST");
    assert.match(call.init.headers.Authorization, /^Basic /);
    assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(call.init.body.toString());
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "the-refresh");
  });

  test("computes expires_at from expires_in", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600 } }));
    const before = Date.now();
    const updated = await qbo.refreshTokens("acme", validTokens());
    assert.ok(updated.expires_at >= before + 3600_000);
    assert.ok(updated.expires_at <= Date.now() + 3600_000);
  });

  test("throws with Intuit's response body when the refresh is rejected", async () => {
    fetchStub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await assert.rejects(
      () => qbo.refreshTokens("acme", validTokens()),
      /Token refresh failed.*invalid_grant/s
    );
  });

  test("does not overwrite the stored tokens when the refresh fails", async () => {
    await qbo.saveTokens("acme", validTokens({ access_token: "original" }));
    fetchStub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await assert.rejects(() => qbo.refreshTokens("acme", validTokens()));
    assert.equal((await qbo.loadTokens("acme")).access_token, "original");
  });
});

describe("getValidTokens", () => {
  let fetchStub;
  afterEach(() => fetchStub?.restore());

  test("returns stored tokens unchanged when they are still fresh", async () => {
    const tokens = validTokens();
    await qbo.saveTokens("acme", tokens);
    fetchStub = stubFetch(() => { throw new Error("should not refresh"); });
    assert.deepEqual(await qbo.getValidTokens("acme"), tokens);
    assert.equal(fetchStub.calls.length, 0);
  });

  test("refreshes when the access token expires inside the 60s skew", async () => {
    await qbo.saveTokens("acme", validTokens({ expires_at: Date.now() + 30_000 }));
    fetchStub = stubFetch(() => ({ body: { access_token: "refreshed", expires_in: 3600, x_refresh_token_expires_in: 8640000 } }));
    assert.equal((await qbo.getValidTokens("acme")).access_token, "refreshed");
    assert.equal(fetchStub.calls.length, 1);
  });

  test("does not refresh when expiry is comfortably beyond the skew", async () => {
    await qbo.saveTokens("acme", validTokens({ expires_at: Date.now() + 120_000 }));
    fetchStub = stubFetch(() => { throw new Error("should not refresh"); });
    await qbo.getValidTokens("acme");
    assert.equal(fetchStub.calls.length, 0);
  });

  test("refreshes an already-expired access token", async () => {
    await qbo.saveTokens("acme", validTokens({ expires_at: Date.now() - 10_000 }));
    fetchStub = stubFetch(() => ({ body: { access_token: "refreshed", expires_in: 3600, x_refresh_token_expires_in: 8640000 } }));
    assert.equal((await qbo.getValidTokens("acme")).access_token, "refreshed");
  });

  test("throws an actionable error when the company was never authorized", async () => {
    await assert.rejects(
      () => qbo.getValidTokens("nope"),
      /Not connected to QuickBooks for nope\. Run `QBO_COMPANY=nope npm run connect` once to authorize\./
    );
  });

  test("names the default company and bare connect command for the legacy slug", async () => {
    await assert.rejects(
      () => qbo.getValidTokens(""),
      /Not connected to QuickBooks for the default company\. Run `npm run connect`/
    );
  });

  test("throws when the refresh token itself has expired", async () => {
    await qbo.saveTokens("acme", validTokens({ refresh_expires_at: Date.now() - 1000 }));
    await assert.rejects(
      () => qbo.getValidTokens("acme"),
      /Refresh token expired \(100\+ days\) for acme\. Re-authorize with `QBO_COMPANY=acme npm run connect`\./
    );
  });

  test("checks refresh-token expiry before attempting a refresh", async () => {
    await qbo.saveTokens("acme", validTokens({
      expires_at: Date.now() - 1000,
      refresh_expires_at: Date.now() - 1000,
    }));
    fetchStub = stubFetch(() => { throw new Error("should not refresh"); });
    await assert.rejects(() => qbo.getValidTokens("acme"), /Refresh token expired/);
    assert.equal(fetchStub.calls.length, 0);
  });
});

describe("exchangeCodeForTokens", () => {
  let fetchStub;
  afterEach(() => fetchStub?.restore());

  test("exchanges an authorization code for a token bundle", async () => {
    fetchStub = stubFetch(() => ({
      body: { access_token: "a", refresh_token: "r", expires_in: 3600, x_refresh_token_expires_in: 8640000 },
    }));
    const tokens = await qbo.exchangeCodeForTokens("the-code", "production");
    assert.equal(tokens.access_token, "a");
    assert.equal(tokens.refresh_token, "r");
    assert.equal(tokens.environment, "production");
  });

  test("sends the authorization_code grant with the code and redirect uri", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600, x_refresh_token_expires_in: 1 } }));
    await qbo.exchangeCodeForTokens("the-code", "sandbox");
    const body = new URLSearchParams(fetchStub.calls[0].init.body.toString());
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "the-code");
    assert.equal(body.get("redirect_uri"), "http://localhost:3000/callback");
  });

  test("does not include a realmId — that comes from the callback", async () => {
    fetchStub = stubFetch(() => ({ body: { access_token: "a", expires_in: 3600, x_refresh_token_expires_in: 1 } }));
    assert.ok(!("realmId" in (await qbo.exchangeCodeForTokens("c", "sandbox"))));
  });

  test("throws with the response body on failure", async () => {
    fetchStub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await assert.rejects(
      () => qbo.exchangeCodeForTokens("bad", "sandbox"),
      /Token exchange failed.*invalid_grant/s
    );
  });
});
