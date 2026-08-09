// The authenticated request layer: URL construction, auth headers, response
// parsing and QBO Fault extraction. Sets the tokens dir before importing
// src/qbo.js, same as qbo.tokens.test.js.

import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { makeTokensDir, validTokens, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;

const qbo = await import("../src/qbo.js");

const SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const PRODUCTION = "https://quickbooks.api.intuit.com";

before(async () => {
  await qbo.saveTokens("acme", validTokens({ realmId: "111", environment: "sandbox" }));
  await qbo.saveTokens("prod", validTokens({ realmId: "222", environment: "production" }));
});

let fetchStub;
// Silence the module's stderr logging so test output stays readable.
let originalConsoleError;
beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
});
afterEach(() => {
  console.error = originalConsoleError;
  fetchStub?.restore();
});

function ok(body = {}) {
  fetchStub = stubFetch(() => ({ body }));
  return fetchStub;
}

describe("qboRequest — URL construction", () => {
  test("builds /v3/company/<realmId><path> against the company's host", async () => {
    ok();
    await qbo.qboRequest("/companyinfo/111", { company: "acme" });
    assert.equal(fetchStub.calls[0].url, `${SANDBOX}/v3/company/111/companyinfo/111?minorversion=70`);
  });

  test("routes a production company to the live host", async () => {
    ok();
    await qbo.qboRequest("/companyinfo/222", { company: "prod" });
    assert.match(fetchStub.calls[0].url, new RegExp(`^${PRODUCTION}/v3/company/222/`));
  });

  test("appends minorversion with ? when the path has no query string", async () => {
    ok();
    await qbo.qboRequest("/invoice/5", { company: "acme" });
    assert.ok(fetchStub.calls[0].url.endsWith("/invoice/5?minorversion=70"));
  });

  test("appends minorversion with & when the path already has a query string", async () => {
    ok();
    await qbo.qboRequest("/reports/ProfitAndLoss?start_date=2026-01-01", { company: "acme" });
    assert.ok(fetchStub.calls[0].url.endsWith("?start_date=2026-01-01&minorversion=70"));
  });

  test("preserves an operation query parameter alongside minorversion", async () => {
    ok();
    await qbo.qboRequest("/invoice?operation=void", { method: "POST", company: "acme" });
    assert.ok(fetchStub.calls[0].url.endsWith("/invoice?operation=void&minorversion=70"));
  });

  // Pins the traversal gap recorded in SECURITY.md → Known limitations: the path
  // is concatenated, and URL parsing collapses dot segments, so a crafted path
  // escapes the /v3/company/<realmId> prefix the api_request description promises.
  // Intuit's realm-scoped tokens should reject the result, but this layer sends it.
  test("KNOWN GAP: a path containing .. escapes the company prefix", async () => {
    ok();
    // "/v3/company/111" + "/../../999/invoice/1" collapses to "/v3/999/invoice/1":
    // two levels up drops the realm and the "company" segment.
    await qbo.qboRequest("/../../999/invoice/1", { company: "acme" });
    let sent = new URL(fetchStub.calls[0].url);
    assert.equal(sent.pathname, "/v3/999/invoice/1");
    assert.ok(!sent.pathname.startsWith("/v3/company/111"), "realm prefix was escaped");
    fetchStub.restore();

    // Enough levels reach the host root, leaving the QBO API path entirely.
    ok();
    await qbo.qboRequest("/../../../../elsewhere", { company: "acme" });
    sent = new URL(fetchStub.calls[0].url);
    assert.equal(sent.pathname, "/elsewhere");
  });
});

describe("qboRequest — headers and body", () => {
  test("sends the access token as a Bearer credential", async () => {
    ok();
    await qbo.qboRequest("/x", { company: "acme" });
    assert.equal(fetchStub.calls[0].init.headers.Authorization, "Bearer access-tok");
  });

  test("always accepts JSON", async () => {
    ok();
    await qbo.qboRequest("/x", { company: "acme" });
    assert.equal(fetchStub.calls[0].init.headers.Accept, "application/json");
  });

  test("defaults to GET with no body and no content type", async () => {
    ok();
    await qbo.qboRequest("/x", { company: "acme" });
    const { init } = fetchStub.calls[0];
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.ok(!("Content-Type" in init.headers));
  });

  test("serializes a body and sets the JSON content type", async () => {
    ok();
    await qbo.qboRequest("/invoice", { method: "POST", body: { Line: [] }, company: "acme" });
    const { init } = fetchStub.calls[0];
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { Line: [] });
  });

  test("passes the method through verbatim", async () => {
    ok();
    await qbo.qboRequest("/x", { method: "DELETE", company: "acme" });
    assert.equal(fetchStub.calls[0].init.method, "DELETE");
  });
});

describe("qboRequest — response handling", () => {
  test("returns the parsed JSON body", async () => {
    ok({ CompanyInfo: { CompanyName: "Acme" } });
    assert.deepEqual(await qbo.qboRequest("/companyinfo/111", { company: "acme" }), {
      CompanyInfo: { CompanyName: "Acme" },
    });
  });

  test("returns {} for an empty response body", async () => {
    fetchStub = stubFetch(() => ({ text: "" }));
    assert.deepEqual(await qbo.qboRequest("/x", { company: "acme" }), {});
  });

  test("wraps non-JSON success bodies as { raw }", async () => {
    fetchStub = stubFetch(() => ({ text: "<html>nope</html>" }));
    assert.deepEqual(await qbo.qboRequest("/x", { company: "acme" }), { raw: "<html>nope</html>" });
  });
});

describe("qboRequest — errors", () => {
  test("throws with status, method and path for a non-2xx response", async () => {
    fetchStub = stubFetch(() => ({ status: 401, text: "unauthorized" }));
    await assert.rejects(
      () => qbo.qboRequest("/invoice/5", { company: "acme" }),
      /QBO API 401 on GET \/invoice\/5: unauthorized/
    );
  });

  test("extracts the QBO Fault message", async () => {
    fetchStub = stubFetch(() => ({
      status: 400,
      body: { Fault: { Error: [{ Message: "Invalid Reference Id" }] } },
    }));
    await assert.rejects(
      () => qbo.qboRequest("/invoice", { method: "POST", company: "acme" }),
      /QBO API 400 on POST \/invoice: Invalid Reference Id/
    );
  });

  test("appends the Fault detail when present", async () => {
    fetchStub = stubFetch(() => ({
      status: 400,
      body: { Fault: { Error: [{ Message: "Invalid Reference Id", Detail: "Account 999 not found" }] } },
    }));
    await assert.rejects(
      () => qbo.qboRequest("/invoice", { method: "POST", company: "acme" }),
      /Invalid Reference Id — Account 999 not found/
    );
  });

  test("falls back to the raw text when there is no Fault", async () => {
    fetchStub = stubFetch(() => ({ status: 500, body: { message: "boom" } }));
    await assert.rejects(() => qbo.qboRequest("/x", { company: "acme" }), /\{"message":"boom"\}/);
  });

  test("propagates the not-connected error for an unknown company", async () => {
    ok();
    await assert.rejects(() => qbo.qboRequest("/x", { company: "ghost" }), /Not connected to QuickBooks for ghost/);
  });
});

describe("qboQuery", () => {
  test("url-encodes the SQL into the /query endpoint", async () => {
    ok({ QueryResponse: {} });
    await qbo.qboQuery("SELECT * FROM Customer", { company: "acme" });
    assert.ok(
      fetchStub.calls[0].url.includes("/query?query=SELECT%20*%20FROM%20Customer"),
      fetchStub.calls[0].url
    );
  });

  test("encodes characters that would otherwise break the query string", async () => {
    ok({ QueryResponse: {} });
    await qbo.qboQuery("SELECT * FROM Customer WHERE DisplayName = 'A&B'", { company: "acme" });
    assert.ok(fetchStub.calls[0].url.includes("%26"), "ampersand must be encoded");
    assert.ok(!fetchStub.calls[0].url.includes("'A&B'"));
  });

  test("unwraps QueryResponse", async () => {
    ok({ QueryResponse: { Customer: [{ Id: "1" }] } });
    assert.deepEqual(await qbo.qboQuery("SELECT * FROM Customer", { company: "acme" }), {
      Customer: [{ Id: "1" }],
    });
  });

  test("returns {} when the response has no QueryResponse", async () => {
    ok({});
    assert.deepEqual(await qbo.qboQuery("SELECT * FROM Customer", { company: "acme" }), {});
  });

  test("returns {} for an empty QueryResponse, meaning no matches", async () => {
    ok({ QueryResponse: {} });
    assert.deepEqual(await qbo.qboQuery("SELECT * FROM Customer WHERE Id = '9'", { company: "acme" }), {});
  });

  test("issues a GET, so it can never mutate", async () => {
    ok({ QueryResponse: {} });
    await qbo.qboQuery("SELECT * FROM Customer", { company: "acme" });
    assert.equal(fetchStub.calls[0].init.method, "GET");
  });
});

describe("qboUpload", () => {
  test("posts multipart form data to /upload", async () => {
    ok({ AttachableResponse: [{ Attachable: { Id: "1" } }] });
    const fd = new FormData();
    fd.append("file_metadata_01", new Blob(["{}"], { type: "application/json" }), "metadata.json");
    await qbo.qboUpload(fd, { company: "acme" });
    const call = fetchStub.calls[0];
    assert.equal(call.url, `${SANDBOX}/v3/company/111/upload?minorversion=70`);
    assert.equal(call.init.method, "POST");
    assert.ok(call.init.body instanceof FormData);
  });

  test("does not set Content-Type, letting fetch choose the multipart boundary", async () => {
    ok({});
    await qbo.qboUpload(new FormData(), { company: "acme" });
    assert.ok(!("Content-Type" in fetchStub.calls[0].init.headers));
  });

  test("sends the Bearer token", async () => {
    ok({});
    await qbo.qboUpload(new FormData(), { company: "acme" });
    assert.equal(fetchStub.calls[0].init.headers.Authorization, "Bearer access-tok");
  });

  test("throws with the Fault message on failure", async () => {
    fetchStub = stubFetch(() => ({
      status: 400,
      body: { Fault: { Error: [{ Message: "Unsupported file", Detail: "exe not allowed" }] } },
    }));
    await assert.rejects(
      () => qbo.qboUpload(new FormData(), { company: "acme" }),
      /QBO upload 400: Unsupported file — exe not allowed/
    );
  });

  test("falls back to raw text when there is no Fault", async () => {
    fetchStub = stubFetch(() => ({ status: 413, text: "too large" }));
    await assert.rejects(() => qbo.qboUpload(new FormData(), { company: "acme" }), /QBO upload 413: too large/);
  });
});

describe("getRealmId", () => {
  test("returns the realm recorded in the company's token file", async () => {
    assert.equal(await qbo.getRealmId("acme"), "111");
    assert.equal(await qbo.getRealmId("prod"), "222");
  });

  test("throws for a company that was never authorized", async () => {
    await assert.rejects(() => qbo.getRealmId("ghost"), /Not connected to QuickBooks for ghost/);
  });
});
