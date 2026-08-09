// End-to-end tests through the real MCP protocol.
//
// Boots the actual server from src/index.js over an in-memory transport and calls
// tools the way Claude Desktop would. Only the network boundary (global.fetch)
// and the tokens directory are faked, so tool registration, zod validation, the
// company resolver, the builders and the request layer are all exercised together.

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { makeTokensDir, validTokens, stubFetch } from "./helpers/fakes.js";

const TOKENS_DIR = await makeTokensDir();
process.env.QBO_TOKENS_DIR = TOKENS_DIR;
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
delete process.env.QBO_COMPANY;
delete process.env.QBO_ENVIRONMENT;

// Two companies, so the write gate has something to refuse to choose between.
const qbo = await import("../src/qbo.js");
await qbo.saveTokens("acme", validTokens({ realmId: "111", environment: "sandbox" }));
await qbo.saveTokens("beta", validTokens({ realmId: "222", environment: "production" }));

const { server, companyCtx } = await import("../src/index.js");

let client;
let fetchStub;
let originalConsoleError;

before(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

after(async () => {
  await client?.close();
});

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
  companyCtx.setSessionDefault(null);
});

afterEach(() => {
  console.error = originalConsoleError;
  fetchStub?.restore();
  fetchStub = undefined;
});

// Call a tool and return the parsed JSON payload of its text content.
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { res, text, json, isError: res.isError === true };
}

// The full expected tool surface. A rename, removal or accidental addition turns
// this red — the connector's public contract with Claude Desktop.
const EXPECTED_TOOLS = [
  "api_request", "attach_file", "create_account", "create_bill",
  "create_bill_item_based", "create_credit_memo", "create_customer",
  "create_deposit", "create_employee", "create_estimate", "create_expense",
  "create_invoice", "create_item", "create_journal_entry", "create_payment",
  "create_purchase_order", "create_refund_receipt", "create_sales_receipt",
  "create_time_activity", "create_vendor", "create_vendor_credit",
  "get_active_company", "get_aged_payables", "get_aged_receivables",
  "get_attachments", "get_balance_sheet", "get_cash_flow", "get_company_info",
  "get_general_ledger", "get_invoices", "get_overdue_invoices",
  "get_profit_and_loss", "get_transaction_list",
  "get_transaction_list_by_customer", "get_transaction_list_by_vendor",
  "get_transaction_list_with_splits", "get_trial_balance",
  "import_transactions_from_csv", "list_companies", "query",
  "select_company", "send_estimate", "send_invoice_email",
  "send_sales_receipt", "update_bill", "update_customer", "update_estimate",
  "update_invoice", "update_item", "update_journal_entry", "update_purchase",
  "update_sales_receipt", "update_vendor", "void_invoice",
];

describe("tool surface", () => {
  test("registers exactly 54 tools", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 54);
  });

  test("exposes exactly the expected tool names", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  });

  test("every tool has a non-empty description", async () => {
    const { tools } = await client.listTools();
    const undescribed = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
    assert.deepEqual(undescribed, []);
  });

  test("only the two session-state readers take no company argument", async () => {
    const { tools } = await client.listTools();
    const noCompany = tools
      .filter((t) => !Object.keys(t.inputSchema.properties || {}).includes("company"))
      .map((t) => t.name)
      .sort();
    assert.deepEqual(noCompany, ["get_active_company", "list_companies"]);
  });

  test("company is optional everywhere except select_company, where it is required", async () => {
    const { tools } = await client.listTools();
    const required = tools
      .filter((t) => (t.inputSchema.required || []).includes("company"))
      .map((t) => t.name);
    assert.deepEqual(required, ["select_company"]);
  });

  test("51 tools accept an optional company override", async () => {
    const { tools } = await client.listTools();
    const optionalCompany = tools.filter(
      (t) =>
        Object.keys(t.inputSchema.properties || {}).includes("company") &&
        !(t.inputSchema.required || []).includes("company")
    );
    assert.equal(optionalCompany.length, 51);
  });

  test("api_request advertises only GET and POST", async () => {
    const { tools } = await client.listTools();
    const api = tools.find((t) => t.name === "api_request");
    assert.deepEqual(api.inputSchema.properties.method.enum, ["GET", "POST"]);
  });
});

describe("company tools", () => {
  test("list_companies reports both authorized companies", async () => {
    const { json } = await call("list_companies");
    assert.equal(json.count, 2);
    assert.deepEqual(json.companies.map((c) => c.slug), ["acme", "beta"]);
  });

  test("list_companies reports no active default initially", async () => {
    const { json } = await call("list_companies");
    assert.equal(json.active_default, null);
  });

  test("select_company sets the active company and echoes its realm", async () => {
    const { json } = await call("select_company", { company: "beta" });
    assert.equal(json.active_company, "beta");
    assert.equal(json.realmId, "222");
    assert.equal(json.environment, "production");
  });

  test("select_company rejects an unknown slug", async () => {
    const { isError, text } = await call("select_company", { company: "ghost" });
    assert.ok(isError);
    assert.match(text, /No such company "ghost"/);
  });

  test("get_active_company reports the source as select_company once set", async () => {
    await call("select_company", { company: "acme" });
    const { json } = await call("get_active_company");
    assert.equal(json.active_company, "acme");
    assert.equal(json.source, "select_company");
    assert.equal(json.realmId, "111");
  });

  test("get_active_company reports none when nothing is selected", async () => {
    const { json } = await call("get_active_company");
    assert.equal(json.active_company, null);
    assert.equal(json.source, "none");
  });

  test("the selected company persists across calls", async () => {
    await call("select_company", { company: "beta" });
    assert.equal((await call("list_companies")).json.active_default, "beta");
  });
});

describe("reads", () => {
  test("get_company_info fetches against the selected company's realm and host", async () => {
    fetchStub = stubFetch(() => ({ body: { CompanyInfo: { CompanyName: "Acme Inc" } } }));
    const { json } = await call("get_company_info", { company: "acme" });
    assert.equal(json.CompanyInfo.CompanyName, "Acme Inc");
    assert.match(fetchStub.calls[0].url, /sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/111\/companyinfo\/111/);
  });

  test("a production company routes to the live host", async () => {
    fetchStub = stubFetch(() => ({ body: { CompanyInfo: {} } }));
    await call("get_company_info", { company: "beta" });
    assert.match(fetchStub.calls[0].url, /^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/222\//);
  });

  test("query passes SQL through and unwraps QueryResponse", async () => {
    fetchStub = stubFetch(() => ({ body: { QueryResponse: { Customer: [{ Id: "1", DisplayName: "Acme" }] } } }));
    const { json } = await call("query", { sql_query: "SELECT * FROM Customer", company: "acme" });
    assert.deepEqual(json.Customer, [{ Id: "1", DisplayName: "Acme" }]);
  });

  test("get_profit_and_loss builds the report query string", async () => {
    fetchStub = stubFetch(() => ({ body: { Header: {} } }));
    await call("get_profit_and_loss", { start_date: "2026-01-01", end_date: "2026-03-31", company: "acme" });
    const url = fetchStub.calls[0].url;
    assert.match(url, /\/reports\/ProfitAndLoss\?/);
    assert.match(url, /start_date=2026-01-01/);
    assert.match(url, /end_date=2026-03-31/);
  });

  test("a QBO Fault is surfaced as a tool error, not a crash", async () => {
    fetchStub = stubFetch(() => ({ status: 400, body: { Fault: { Error: [{ Message: "Bad request" }] } } }));
    const { isError, text } = await call("get_company_info", { company: "acme" });
    assert.ok(isError);
    assert.match(text, /QBO API 400 on GET .*Bad request/);
  });

  test("reads still refuse to guess between two companies", async () => {
    const { isError, text } = await call("get_company_info");
    assert.ok(isError);
    assert.match(text, /multiple companies are connected/);
  });
});

describe("the write gate, end to end", () => {
  const invoiceArgs = { customer_ref: "Acme Corp", line_items: [{ description: "work", amount: 100 }] };

  test("a write with no company named is refused", async () => {
    const { isError, text } = await call("create_invoice", invoiceArgs);
    assert.ok(isError);
    assert.match(text, /I won't guess which company to post a write to/);
  });

  test("the refusal happens before any network call", async () => {
    fetchStub = stubFetch(() => { throw new Error("should not reach the network"); });
    await call("create_invoice", invoiceArgs);
    assert.equal(fetchStub.calls.length, 0);
  });

  test("a write proceeds once a company is selected", async () => {
    await call("select_company", { company: "acme" });
    fetchStub = stubFetch((url) => {
      if (url.includes("/query?")) {
        if (url.includes("Customer")) return { body: { QueryResponse: { Customer: [{ Id: "10", DisplayName: "Acme Corp" }] } } };
        if (url.includes("Item")) return { body: { QueryResponse: { Item: [{ Id: "40", Name: "Bookkeeping" }] } } };
      }
      return { body: { Invoice: { Id: "500", DocNumber: "1001" } } };
    });
    const { json, isError } = await call("create_invoice", invoiceArgs);
    assert.ok(!isError, JSON.stringify(json));
    assert.equal(json.created.Id, "500");
  });

  test("an explicit company is enough without selecting one", async () => {
    fetchStub = stubFetch((url) => {
      if (url.includes("Customer")) return { body: { QueryResponse: { Customer: [{ Id: "10", DisplayName: "Acme Corp" }] } } };
      if (url.includes("Item")) return { body: { QueryResponse: { Item: [{ Id: "40", Name: "Bookkeeping" }] } } };
      return { body: { Invoice: { Id: "501" } } };
    });
    const { json } = await call("create_invoice", { ...invoiceArgs, company: "acme" });
    assert.equal(json.created.Id, "501");
  });

  test("api_request treats GET as a read and POST as a write", async () => {
    const read = await call("api_request", { path: "/companyinfo/111" });
    assert.match(read.text, /multiple companies are connected/);

    const write = await call("api_request", { path: "/invoice", method: "POST", body: {} });
    assert.match(write.text, /I won't guess which company to post a write to/);
  });

  test("api_request normalizes a path missing its leading slash", async () => {
    fetchStub = stubFetch(() => ({ body: { ok: true } }));
    await call("api_request", { path: "companyinfo/111", company: "acme" });
    assert.match(fetchStub.calls[0].url, /\/v3\/company\/111\/companyinfo\/111\?minorversion=70$/);
  });
});

describe("journal entries, end to end", () => {
  test("an unbalanced entry is rejected before it reaches QuickBooks", async () => {
    fetchStub = stubFetch((url) => {
      if (url.includes("Account")) return { body: { QueryResponse: { Account: [{ Id: "3", Name: "Rent" }] } } };
      throw new Error("should not post");
    });
    const { isError, text } = await call("create_journal_entry", {
      company: "acme",
      lines: [
        { account: "Rent", amount: 500, posting_type: "Debit" },
        { account: "Rent", amount: 400, posting_type: "Credit" },
      ],
    });
    assert.ok(isError);
    assert.match(text, /not balanced: debits 500\.00 vs credits 400\.00/);
    assert.ok(!fetchStub.calls.some((c) => c.init.method === "POST"), "nothing should have been posted");
  });

  test("zod rejects a negative line amount before the handler runs", async () => {
    const res = await client.callTool({
      name: "create_journal_entry",
      arguments: {
        company: "acme",
        lines: [
          { account: "Rent", amount: -500, posting_type: "Debit" },
          { account: "Rent", amount: 500, posting_type: "Credit" },
        ],
      },
    });
    assert.equal(res.isError, true);
  });

  test("a balanced entry posts", async () => {
    fetchStub = stubFetch((url) => {
      if (url.includes("/query?")) return { body: { QueryResponse: { Account: [{ Id: "3", Name: "Rent" }] } } };
      return { body: { JournalEntry: { Id: "77" } } };
    });
    const { json, isError } = await call("create_journal_entry", {
      company: "acme",
      lines: [
        { account: "Rent", amount: 500, posting_type: "Debit" },
        { account: "Rent", amount: 500, posting_type: "Credit" },
      ],
    });
    assert.ok(!isError, JSON.stringify(json));
    assert.equal(json.created.Id, "77");
  });
});

describe("import_transactions_from_csv", () => {
  let csvPath;

  before(async () => {
    csvPath = path.join(TOKENS_DIR, "statement.csv");
    await writeFile(
      csvPath,
      [
        "Date,Description,Amount",
        "2026-01-02,OFFICE DEPOT #12,-45.00",
        "2026-01-03,UNKNOWN VENDOR,-10.00",
        "2026-01-04,ZERO ROW,0",
      ].join("\n"),
      "utf8"
    );
  });

  function chartOfAccounts() {
    return stubFetch((url) => {
      if (url.includes("/query?")) {
        if (url.includes("AccountType%20%3D%20'Expense'")) {
          return { body: { QueryResponse: { Account: [
            { Id: "10", Name: "Office Supplies" },
            { Id: "99", Name: "Uncategorized Expense" },
          ] } } };
        }
        return { body: { QueryResponse: { Account: [{ Id: "1", Name: "Checking" }] } } };
      }
      return { body: { BatchItemResponse: [{ Purchase: { Id: "1" } }, { Purchase: { Id: "2" } }] } };
    });
  }

  test("a dry run previews rows and posts nothing", async () => {
    fetchStub = chartOfAccounts();
    const { json, isError } = await call("import_transactions_from_csv", {
      file_path: csvPath,
      transaction_type: "Expense",
      bank_account_name: "Checking",
      dry_run: true,
      company: "acme",
    });
    assert.ok(!isError, JSON.stringify(json));
    assert.equal(json.dry_run, true);
    assert.equal(json.row_count, 2, "the zero-amount row should be dropped");
    assert.equal(json.total_amount, 55);
    assert.ok(!fetchStub.calls.some((c) => c.init.method === "POST"), "a dry run must not post");
  });

  test("a dry run categorizes by description, falling back to Uncategorized", async () => {
    fetchStub = chartOfAccounts();
    const { json } = await call("import_transactions_from_csv", {
      file_path: csvPath, transaction_type: "Expense", bank_account_name: "Checking",
      dry_run: true, company: "acme",
    });
    assert.deepEqual(json.preview.map((p) => p.category), ["Office Supplies", "Uncategorized Expense"]);
  });

  test("a live import posts a batch of Purchases", async () => {
    fetchStub = chartOfAccounts();
    const { json, isError } = await call("import_transactions_from_csv", {
      file_path: csvPath, transaction_type: "Expense", bank_account_name: "Checking",
      dry_run: false, company: "acme",
    });
    assert.ok(!isError, JSON.stringify(json));
    assert.equal(json.imported, 2);
    const batch = fetchStub.calls.find((c) => c.url.includes("/batch"));
    assert.ok(batch, "a /batch request should have been made");
    assert.equal(JSON.parse(batch.init.body).BatchItemRequest.length, 2);
  });

  test("a live import refuses to guess the company", async () => {
    fetchStub = chartOfAccounts();
    const { isError, text } = await call("import_transactions_from_csv", {
      file_path: csvPath, transaction_type: "Expense", bank_account_name: "Checking", dry_run: false,
    });
    assert.ok(isError);
    assert.match(text, /I won't guess which company to post a write to/);
  });

  test("only Expense is wired for live posting", async () => {
    fetchStub = chartOfAccounts();
    const { isError, text } = await call("import_transactions_from_csv", {
      file_path: csvPath, transaction_type: "Bill", bank_account_name: "Checking",
      dry_run: false, company: "acme",
    });
    assert.ok(isError);
    assert.match(text, /Only transaction_type "Expense" is wired for live posting/);
  });

  test("an unknown bank account is an error", async () => {
    fetchStub = stubFetch(() => ({ body: { QueryResponse: {} } }));
    const { isError, text } = await call("import_transactions_from_csv", {
      file_path: csvPath, transaction_type: "Expense", bank_account_name: "Nope",
      dry_run: true, company: "acme",
    });
    assert.ok(isError);
    assert.match(text, /Bank account not found: "Nope"/);
  });

  test("a missing file is reported as a tool error", async () => {
    fetchStub = chartOfAccounts();
    const { isError, text } = await call("import_transactions_from_csv", {
      file_path: path.join(TOKENS_DIR, "nope.csv"),
      transaction_type: "Expense", bank_account_name: "Checking", dry_run: true, company: "acme",
    });
    assert.ok(isError);
    assert.match(text, /ENOENT|no such file/);
  });
});

describe("error responses", () => {
  test("tool errors carry the Opzer help text", async () => {
    const { text } = await call("select_company", { company: "ghost" });
    assert.match(text, /built by Opzer/);
  });

  test("an invalid argument type is rejected by zod, not the handler", async () => {
    const res = await client.callTool({ name: "select_company", arguments: { company: 123 } });
    assert.equal(res.isError, true);
  });
});
