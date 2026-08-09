// The interactive authorization flow: the localhost callback listener, its CSRF
// state check, and the code-for-tokens exchange.
//
// Drives the real http listener that runAuthorizationFlow starts. The callback is
// fired with node:http (not fetch) so the stubbed global.fetch only ever sees the
// outbound call to Intuit's token endpoint.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { makeTokensDir, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;
delete process.env.QBO_ENVIRONMENT;

// Claim a free port up front so the flow never collides with a real dev server.
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
});

afterEach(async () => {
  console.error = originalConsoleError;
  fetchStub?.restore();
  fetchStub = undefined;
  for (const f of await readdir(TOKENS_DIR)) {
    if (f.startsWith("tokens")) await unlink(path.join(TOKENS_DIR, f)).catch(() => {});
  }
});

// Start the flow and immediately capture its settlement, so a rejection can never
// be an unhandled promise (which the test runner would attribute to whichever test
// happened to be running). Await the returned promise for {ok, value|error}.
function startFlow() {
  return qbo.runAuthorizationFlow().then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
}

// Wait until the flow has logged its authorize URL, then lift the state out of it.
async function waitForState(timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = logs.find((l) => l.includes("AUTHORIZE_URL>>>"));
    if (line) return new URL(authUrlFrom(line)).searchParams.get("state");
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("authorize URL was never logged");
}

function authUrlFrom(line) {
  return /AUTHORIZE_URL>>>\s+(\S+)\s+<<</.exec(line)[1];
}

// Hit the callback listener directly. `Connection: close` keeps no keep-alive
// socket around, so the flow's server.close() completes and frees the port.
function hitCallback(query, pathname = "/callback") {
  const qs = new URLSearchParams(query).toString();
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "localhost",
        port: PORT,
        path: `${pathname}?${qs}`,
        agent: false,
        headers: { Connection: "close" },
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

const TOKEN_RESPONSE = {
  access_token: "fresh-access",
  refresh_token: "fresh-refresh",
  expires_in: 3600,
  x_refresh_token_expires_in: 8640000,
};

const okTokens = () => { fetchStub = stubFetch(() => ({ body: TOKEN_RESPONSE })); };

describe("runAuthorizationFlow — happy path", () => {
  test("exchanges the code and saves tokens for the default company", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();

    const res = await hitCallback({ code: "the-code", realmId: "9130350000008315", state });
    assert.equal(res.status, 200);
    assert.match(res.body, /QuickBooks connected/);

    const out = await flow;
    assert.ok(out.ok, out.error?.message);
    assert.equal(out.value.access_token, "fresh-access");
    assert.equal(out.value.refresh_token, "fresh-refresh");
    assert.equal(out.value.realmId, "9130350000008315");
    // QBO_ENVIRONMENT is unset, so a new company must default to sandbox.
    assert.equal(out.value.environment, "sandbox");

    // With no QBO_COMPANY set, the bundle lands in the legacy tokens.json.
    assert.equal((await qbo.loadTokens("")).access_token, "fresh-access");
  });

  test("computes both expiry timestamps from the response", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();
    const before = Date.now();
    await hitCallback({ code: "c", realmId: "111", state });
    const { value } = await flow;
    assert.ok(value.expires_at >= before + 3600_000);
    assert.ok(value.refresh_expires_at >= before + 8640000_000 - 1000);
  });

  test("logs an authorize URL carrying the right client, scope and redirect", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();
    const parsed = new URL(authUrlFrom(logs.find((l) => l.includes("AUTHORIZE_URL>>>"))));

    assert.equal(parsed.origin + parsed.pathname, qbo.AUTHORIZE_URL);
    assert.equal(parsed.searchParams.get("client_id"), "test-client-id");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("scope"), qbo.SCOPE);
    assert.equal(parsed.searchParams.get("redirect_uri"), `http://localhost:${PORT}/callback`);
    assert.match(parsed.searchParams.get("state"), /^[0-9a-f]{32}$/);

    await hitCallback({ code: "c", realmId: "1", state });
    assert.ok((await flow).ok);
  });

  test("sends the authorization_code grant to Intuit's token endpoint", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();
    await hitCallback({ code: "the-code", realmId: "1", state });
    assert.ok((await flow).ok);

    const call = fetchStub.calls.find((c) => c.url === qbo.TOKEN_URL);
    assert.ok(call, "the token endpoint should have been called");
    const body = new URLSearchParams(call.init.body.toString());
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "the-code");
    assert.equal(body.get("redirect_uri"), `http://localhost:${PORT}/callback`);
    assert.match(call.init.headers.Authorization, /^Basic /);
  });

  test("records production when QBO_ENVIRONMENT says so", async () => {
    // connectEnvironment() reads env at call time, so this takes effect here.
    process.env.QBO_ENVIRONMENT = "production";
    try {
      okTokens();
      const flow = startFlow();
      const state = await waitForState();
      await hitCallback({ code: "c", realmId: "1", state });
      assert.equal((await flow).value.environment, "production");
    } finally {
      delete process.env.QBO_ENVIRONMENT;
    }
  });
});

describe("runAuthorizationFlow — CSRF state check", () => {
  test("rejects a callback whose state does not match", async () => {
    okTokens();
    const flow = startFlow();
    await waitForState();

    const res = await hitCallback({ code: "c", realmId: "1", state: "forged-state" });
    assert.equal(res.status, 400);
    assert.match(res.body, /State mismatch/);

    const out = await flow;
    assert.equal(out.ok, false);
    assert.match(out.error.message, /OAuth state mismatch/);
  });

  test("does not exchange the code when the state is forged", async () => {
    okTokens();
    const flow = startFlow();
    await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: "forged" });
    await flow;
    assert.equal(fetchStub.calls.length, 0, "no token exchange should have happened");
  });

  test("does not save tokens when the state is forged", async () => {
    okTokens();
    const flow = startFlow();
    await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: "forged" });
    await flow;
    assert.equal(await qbo.loadTokens(""), null);
  });

  test("rejects a callback with no state at all", async () => {
    okTokens();
    const flow = startFlow();
    await waitForState();
    const res = await hitCallback({ code: "c", realmId: "1" });
    assert.equal(res.status, 400);
    assert.match((await flow).error.message, /OAuth state mismatch/);
  });

  test("generates a fresh 128-bit state on each run", async () => {
    okTokens();
    const first = startFlow();
    const stateA = await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: stateA });
    assert.ok((await first).ok);

    logs.length = 0;
    const second = startFlow();
    const stateB = await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: stateB });
    assert.ok((await second).ok);

    assert.notEqual(stateA, stateB);
    assert.match(stateA, /^[0-9a-f]{32}$/);
  });
});

describe("runAuthorizationFlow — malformed callbacks", () => {
  test("rejects a callback missing the code", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();
    const res = await hitCallback({ realmId: "1", state });
    assert.equal(res.status, 400);
    assert.match(res.body, /Missing code or realmId/);
    assert.match((await flow).error.message, /Missing code\/realmId in callback/);
  });

  test("rejects a callback missing the realmId", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();
    const res = await hitCallback({ code: "c", state });
    assert.equal(res.status, 400);
    assert.match((await flow).error.message, /Missing code\/realmId in callback/);
  });

  test("404s an unrelated path and keeps waiting for the real callback", async () => {
    okTokens();
    const flow = startFlow();
    const state = await waitForState();

    const stray = await hitCallback({}, "/favicon.ico");
    assert.equal(stray.status, 404);

    const res = await hitCallback({ code: "c", realmId: "1", state });
    assert.equal(res.status, 200);
    assert.equal((await flow).value.realmId, "1");
  });
});

describe("runAuthorizationFlow — token exchange failure", () => {
  test("rejects and reports Intuit's response body", async () => {
    fetchStub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    const flow = startFlow();
    const state = await waitForState();
    const res = await hitCallback({ code: "bad", realmId: "1", state });
    assert.equal(res.status, 500);
    assert.match(res.body, /Token exchange failed/);
    assert.match((await flow).error.message, /Token exchange failed.*invalid_grant/s);
  });

  test("saves nothing when the exchange fails", async () => {
    fetchStub = stubFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    const flow = startFlow();
    const state = await waitForState();
    await hitCallback({ code: "bad", realmId: "1", state });
    await flow;
    assert.equal(await qbo.loadTokens(""), null);
  });
});

describe("runAuthorizationFlow — listener lifecycle", () => {
  test("frees the port after a successful run, so a second run can bind", async () => {
    okTokens();
    const first = startFlow();
    const stateA = await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: stateA });
    assert.ok((await first).ok);

    logs.length = 0;
    const second = startFlow();
    const stateB = await waitForState();
    await hitCallback({ code: "c", realmId: "2", state: stateB });
    assert.equal((await second).value.realmId, "2");
  });

  test("frees the port after a rejected run", async () => {
    okTokens();
    const first = startFlow();
    await waitForState();
    await hitCallback({ code: "c", realmId: "1", state: "forged" });
    assert.equal((await first).ok, false);

    logs.length = 0;
    const second = startFlow();
    const stateB = await waitForState();
    await hitCallback({ code: "c", realmId: "3", state: stateB });
    assert.equal((await second).value.realmId, "3");
  });
});
