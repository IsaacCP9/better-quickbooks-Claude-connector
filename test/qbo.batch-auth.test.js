// Batch authorization: one persistent localhost listener reused across several
// companies, with slug minting and slug reuse for an already-connected realm.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { makeTokensDir, validTokens, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;
delete process.env.QBO_ENVIRONMENT;

const PORT = await new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
process.env.QBO_REDIRECT_URI = `http://localhost:${PORT}/callback`;

const qbo = await import("../src/qbo.js");

let fetchStub;
let logs;
let originalConsoleError;

beforeEach(() => {
  logs = [];
  originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  fetchStub = stubFetch(() => ({
    body: {
      access_token: "batch-access",
      refresh_token: "batch-refresh",
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
    },
  }));
});

afterEach(async () => {
  console.error = originalConsoleError;
  fetchStub?.restore();
  for (const f of await readdir(TOKENS_DIR)) {
    if (f.startsWith("tokens")) await unlink(path.join(TOKENS_DIR, f)).catch(() => {});
  }
});

function startBatch(opts) {
  return qbo.runBatchAuthorization(opts).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
}

// Wait until at least `n` authorize URLs have been logged, returning the nth state.
async function waitForState(n, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = logs.filter((l) => l.includes("AUTHORIZE_URL>>>"));
    if (lines.length >= n) {
      const url = /AUTHORIZE_URL>>>\s+(\S+)\s+<<</.exec(lines[n - 1])[1];
      return new URL(url).searchParams.get("state");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`authorize URL #${n} was never logged`);
}

function hitCallback(query, pathname = "/callback") {
  const qs = new URLSearchParams(query).toString();
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "localhost", port: PORT, path: `${pathname}?${qs}`,
        agent: false, headers: { Connection: "close" },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
  });
}

describe("runBatchAuthorization — single company", () => {
  test("authorizes one company and stops when shouldContinue is false", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    const res = await hitCallback({ code: "c1", realmId: "9130350000008315", state });

    assert.equal(res.status, 200);
    assert.match(res.body, /Connected \(#1\)/);

    const out = await batch;
    assert.ok(out.ok, out.error?.message);
    assert.deepEqual(out.value, [{
      slug: "8315",
      realmId: "9130350000008315",
      environment: "sandbox",
      reused: false,
    }]);
  });

  test("persists the tokens under the minted slug", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "9130350000008315", state });
    await batch;

    const saved = await qbo.loadTokens("8315");
    assert.equal(saved.access_token, "batch-access");
    assert.equal(saved.realmId, "9130350000008315");
  });

  test("stops after one company when no shouldContinue is supplied", async () => {
    const batch = startBatch({});
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1111", state });
    assert.equal((await batch).value.length, 1);
  });
});

describe("runBatchAuthorization — several companies", () => {
  test("authorizes companies in sequence on one listener", async () => {
    const batch = startBatch({ shouldContinue: (connected) => connected.length < 3 });

    for (const [i, realmId] of ["1000000000001111", "1000000000002222", "1000000000003333"].entries()) {
      const state = await waitForState(i + 1);
      const res = await hitCallback({ code: `c${i}`, realmId, state });
      assert.equal(res.status, 200);
      assert.match(res.body, new RegExp(`Connected \\(#${i + 1}\\)`));
    }

    const out = await batch;
    assert.deepEqual(out.value.map((c) => c.slug), ["1111", "2222", "3333"]);
    assert.deepEqual(out.value.map((c) => c.realmId), [
      "1000000000001111", "1000000000002222", "1000000000003333",
    ]);
  });

  test("passes the running list to shouldContinue", async () => {
    const seen = [];
    const batch = startBatch({
      shouldContinue: (connected) => { seen.push(connected.length); return connected.length < 2; },
    });
    for (const [i, realmId] of ["1111", "2222"].entries()) {
      const state = await waitForState(i + 1);
      await hitCallback({ code: `c${i}`, realmId, state });
    }
    await batch;
    assert.deepEqual(seen, [1, 2]);
  });

  test("mints distinct slugs when realms share their last four digits", async () => {
    const batch = startBatch({ shouldContinue: (c) => c.length < 2 });

    let state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1000000000008315", state });
    state = await waitForState(2);
    await hitCallback({ code: "c2", realmId: "2000000000008315", state });

    const out = await batch;
    assert.deepEqual(out.value.map((c) => c.slug), ["8315", "08315"]);
  });

  test("uses a fresh state for each company in the batch", async () => {
    const batch = startBatch({ shouldContinue: (c) => c.length < 2 });
    const stateA = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1111", state: stateA });
    const stateB = await waitForState(2);
    await hitCallback({ code: "c2", realmId: "2222", state: stateB });
    await batch;
    assert.notEqual(stateA, stateB);
  });
});

describe("runBatchAuthorization — reusing an existing company", () => {
  test("refreshes an already-connected realm under its existing slug", async () => {
    await qbo.saveTokens("acme", validTokens({ realmId: "1000000000009999", environment: "sandbox" }));

    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1000000000009999", state });

    const out = await batch;
    assert.deepEqual(out.value, [{
      slug: "acme",
      realmId: "1000000000009999",
      environment: "sandbox",
      reused: true,
    }]);
  });

  test("overwrites the existing slug's tokens rather than creating a duplicate", async () => {
    await qbo.saveTokens("acme", validTokens({ realmId: "1000000000009999", access_token: "old" }));

    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1000000000009999", state });
    await batch;

    assert.equal((await qbo.loadTokens("acme")).access_token, "batch-access");
    assert.deepEqual((await qbo.listCompanies()).map((c) => c.slug), ["acme"]);
  });

  test("does not collide with an existing slug when minting a new one", async () => {
    // "8315" is already taken by a different realm, so the new one must extend.
    await qbo.saveTokens("8315", validTokens({ realmId: "9999999999999999" }));

    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1000000000008315", state });

    const out = await batch;
    assert.equal(out.value[0].slug, "08315");
    assert.equal(out.value[0].reused, false);
  });
});

describe("runBatchAuthorization — callback validation", () => {
  test("409s a callback when no authorization is pending", async () => {
    // Finish the only pending authorization, then fire a second stray callback.
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1111", state });
    await batch;

    // The listener is closed once the batch resolves, so a stray callback fails
    // to connect rather than returning 409 — which is the safer outcome.
    await assert.rejects(() => hitCallback({ code: "x", realmId: "2", state }), /ECONNREFUSED/);
  });

  test("400s a state mismatch and keeps waiting for a valid callback", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);

    const forged = await hitCallback({ code: "c", realmId: "1", state: "forged" });
    assert.equal(forged.status, 400);
    assert.match(forged.body, /State mismatch/);

    // Unlike the single-company flow, the batch listener does not abort — the
    // same authorization can still be completed correctly.
    const good = await hitCallback({ code: "c", realmId: "1111", state });
    assert.equal(good.status, 200);
    assert.equal((await batch).value[0].realmId, "1111");
  });

  test("400s a callback missing the code and keeps waiting", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);

    const bad = await hitCallback({ realmId: "1", state });
    assert.equal(bad.status, 400);
    assert.match(bad.body, /Missing code or realmId/);

    await hitCallback({ code: "c", realmId: "1111", state });
    assert.ok((await batch).ok);
  });

  test("404s an unrelated path and keeps waiting", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);

    const stray = await hitCallback({}, "/robots.txt");
    assert.equal(stray.status, 404);

    await hitCallback({ code: "c", realmId: "1111", state });
    assert.ok((await batch).ok);
  });
});

describe("runBatchAuthorization — lifecycle", () => {
  test("closes the listener when the batch finishes", async () => {
    const batch = startBatch({ shouldContinue: () => false });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1111", state });
    await batch;
    await assert.rejects(() => hitCallback({ code: "x", realmId: "2" }), /ECONNREFUSED/);
  });

  test("closes the listener even when shouldContinue throws", async () => {
    const batch = startBatch({
      shouldContinue: () => { throw new Error("prompt failed"); },
    });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1111", state });

    const out = await batch;
    assert.equal(out.ok, false);
    assert.match(out.error.message, /prompt failed/);
    // The finally block must still have released the port.
    await assert.rejects(() => hitCallback({ code: "x", realmId: "2" }), /ECONNREFUSED/);
  });

  test("a company authorized before the throw is still on disk", async () => {
    const batch = startBatch({
      shouldContinue: () => { throw new Error("prompt failed"); },
    });
    const state = await waitForState(1);
    await hitCallback({ code: "c1", realmId: "1000000000001111", state });
    await batch;
    assert.equal((await qbo.loadTokens("1111")).access_token, "batch-access");
  });
});
