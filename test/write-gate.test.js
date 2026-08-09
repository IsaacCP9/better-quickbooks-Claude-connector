// Surface-wide safety invariant: every tool that changes QuickBooks data must
// refuse to guess the company, and every read-only tool must fail with the
// (softer) ambiguity message rather than silently picking one.
//
// Arguments are synthesized from each tool's own JSON Schema, so a new tool is
// covered the moment it is registered — it just has to be classified below, or
// the completeness test fails.

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { makeTokensDir, validTokens, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;

const qbo = await import("../src/qbo.js");
await qbo.saveTokens("acme", validTokens({ realmId: "111", environment: "sandbox" }));
await qbo.saveTokens("beta", validTokens({ realmId: "222", environment: "production" }));

const { server, companyCtx } = await import("../src/index.js");

// ---------------------------------------------------------------------------
// The read/write classification of the tool surface. This is the source of truth
// the invariant is checked against — deliberately written out rather than
// derived, so that mislabelling a mutating tool as a read is a visible edit.
// ---------------------------------------------------------------------------

// Tools that create, update, delete, void or email QuickBooks data.
const MUTATING_TOOLS = [
  "attach_file",
  "create_account",
  "create_bill",
  "create_bill_item_based",
  "create_credit_memo",
  "create_customer",
  "create_deposit",
  "create_employee",
  "create_estimate",
  "create_expense",
  "create_invoice",
  "create_item",
  "create_journal_entry",
  "create_payment",
  "create_purchase_order",
  "create_refund_receipt",
  "create_sales_receipt",
  "create_time_activity",
  "create_vendor",
  "create_vendor_credit",
  "import_transactions_from_csv",
  "send_estimate",
  "send_invoice_email",
  "send_sales_receipt",
  "update_bill",
  "update_customer",
  "update_estimate",
  "update_invoice",
  "update_item",
  "update_journal_entry",
  "update_purchase",
  "update_sales_receipt",
  "update_vendor",
  "void_invoice",
];

// Read-only tools that still take a company argument. api_request belongs here
// because it defaults to GET; its POST path is gated as a write and is covered
// in server.test.js.
const READ_TOOLS = [
  "api_request",
  "get_aged_payables",
  "get_aged_receivables",
  "get_attachments",
  "get_balance_sheet",
  "get_cash_flow",
  "get_company_info",
  "get_general_ledger",
  "get_invoices",
  "get_overdue_invoices",
  "get_profit_and_loss",
  "get_transaction_list",
  "get_transaction_list_by_customer",
  "get_transaction_list_by_vendor",
  "get_transaction_list_with_splits",
  "get_trial_balance",
  "query",
];

// Tools that operate on local connector state and never reach QuickBooks.
const SESSION_TOOLS = ["get_active_company", "list_companies", "select_company"];

// Build a minimal schema-valid argument object, omitting `company`.
function synthArgs(schema, { omit = ["company"] } = {}) {
  const args = {};
  for (const key of schema.required || []) {
    if (omit.includes(key)) continue;
    args[key] = synthValue(schema.properties[key], key);
  }
  return args;
}

function synthValue(prop, key = "") {
  if (!prop) return "x";
  if (prop.enum) return prop.enum[0];
  switch (prop.type) {
    case "string":
      // api_request wants a path; everything else is happy with a placeholder
      // that is deliberately non-numeric so name-vs-Id branches take the name path.
      return key === "path" ? "/companyinfo/111" : "x";
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return false;
    case "array":
      return [synthValue(prop.items)];
    case "object": {
      const obj = {};
      for (const k of prop.required || []) obj[k] = synthValue(prop.properties?.[k], k);
      return obj;
    }
    default:
      return "x";
  }
}

let client;
let fetchStub;
let originalConsoleError;
let schemas = new Map();

before(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "gate-test", version: "1.0.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  for (const t of tools) schemas.set(t.name, t.inputSchema);
});

after(async () => { await client?.close(); });

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
  companyCtx.setSessionDefault(null);
  // Any network call at all would mean the gate let the request through.
  fetchStub = stubFetch(() => { throw new Error("network reached — the gate did not stop this call"); });
});

afterEach(() => {
  console.error = originalConsoleError;
  fetchStub?.restore();
});

describe("classification completeness", () => {
  test("every registered tool is classified exactly once", () => {
    const classified = [...MUTATING_TOOLS, ...READ_TOOLS, ...SESSION_TOOLS].sort();
    assert.deepEqual(classified, [...schemas.keys()].sort());
    assert.equal(new Set(classified).size, classified.length, "no duplicates");
  });

  test("the split is 34 mutating, 17 read, 3 session", () => {
    assert.equal(MUTATING_TOOLS.length, 34);
    assert.equal(READ_TOOLS.length, 17);
    assert.equal(SESSION_TOOLS.length, 3);
    assert.equal(MUTATING_TOOLS.length + READ_TOOLS.length + SESSION_TOOLS.length, 54);
  });
});

describe("every mutating tool refuses to guess the company", () => {
  for (const name of MUTATING_TOOLS) {
    test(name, async () => {
      const args = synthArgs(schemas.get(name));
      const res = await client.callTool({ name, arguments: args });
      assert.equal(res.isError, true, `${name} should have refused`);
      assert.match(
        res.content[0].text,
        /I won't guess which company to post a write to/,
        `${name} did not apply the write gate`
      );
      assert.equal(fetchStub.calls.length, 0, `${name} reached the network before gating`);
    });
  }
});

describe("every read tool reports ambiguity rather than picking a company", () => {
  for (const name of READ_TOOLS) {
    test(name, async () => {
      const args = synthArgs(schemas.get(name));
      const res = await client.callTool({ name, arguments: args });
      assert.equal(res.isError, true, `${name} should have reported ambiguity`);
      assert.match(
        res.content[0].text,
        /multiple companies are connected/,
        `${name} did not report ambiguity`
      );
      assert.equal(fetchStub.calls.length, 0, `${name} reached the network before resolving`);
    });
  }
});

describe("the gate is the first thing every tool does", () => {
  // A handler that resolved the company late could do real work (a lookup, a file
  // read) before refusing. Nothing above reached the network, which pins that the
  // refusal precedes every outbound call.
  test("no mutating tool performed any network I/O while being refused", async () => {
    for (const name of MUTATING_TOOLS) {
      const res = await client.callTool({ name, arguments: synthArgs(schemas.get(name)) });
      assert.equal(res.isError, true, name);
    }
    assert.equal(fetchStub.calls.length, 0);
  });
});

describe("a selected company satisfies the gate for every mutating tool", () => {
  // The mirror of the above: with a session default set, the gate stops being the
  // reason a call fails. Each tool gets past resolveCompany and reaches the
  // network (or fails for its own domain reasons) — but never for lack of a company.
  for (const name of MUTATING_TOOLS) {
    test(name, async () => {
      fetchStub.restore();
      fetchStub = stubFetch(() => ({ body: { QueryResponse: {} } }));
      companyCtx.setSessionDefault("acme");
      const res = await client.callTool({ name, arguments: synthArgs(schemas.get(name)) });
      const text = res.content?.[0]?.text ?? "";
      assert.doesNotMatch(
        text,
        /I won't guess which company|No company selected/,
        `${name} still complained about company selection despite a session default`
      );
    });
  }
});
