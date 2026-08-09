#!/usr/bin/env node
// index.js — MCP server exposing QuickBooks Online read + write tools to Claude Desktop.
// Run normally (stdio) for Claude Desktop, or `node src/index.js --connect` once to authorize.
//
// Multi-company (single connector): every tool takes an optional `company` slug.
// You can also set a session default with select_company; individual calls may
// still override it. Resolution precedence, per call:
//   explicit `company` arg → session default → env QBO_COMPANY → sole company
//   (reads only) → error listing the available companies.
// Write tools never auto-pick a company — they require an explicit arg or a
// session/env default, so a transaction can never post to the wrong books.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
// Load .env by absolute path (relative to this file), not the current working
// directory — Claude Desktop launches the server from a different cwd.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  qboRequest,
  qboQuery,
  qboUpload,
  getRealmId,
  runAuthorizationFlow,
  runBatchAuthorization,
  deriveSlugFromRealm,
  listCompanies,
  sanitizeSlug,
} from "./qbo.js";
import {
  log,
  todayISO,
  asText,
  tool,
  esc,
  reportQuery,
  guessContentType,
} from "./lib/format.js";
import {
  companyArg,
  journalLineSchema,
  salesLineSchema,
  accountLineSchema,
  itemLineSchema,
  depositLineSchema,
} from "./lib/schemas.js";
import { formatCompanyList, createCompanyResolver } from "./lib/company.js";
import { createBuilders } from "./lib/builders.js";
import {
  parseCSV,
  detectColumns,
  pickFallbackAccount,
  planImportRows,
  buildPurchaseBatchItems,
  chunk,
} from "./lib/csv.js";

// ---- wiring ----------------------------------------------------------------
// The company resolver owns the session default and the write gate; the builders
// own line construction. Both take their dependencies by injection so the same
// logic can be exercised in tests against fakes (see test/).
const companyCtx = createCompanyResolver({ listCompanies, sanitizeSlug });
const { resolveCompany, envDefaultCompany } = companyCtx;

const {
  findCustomerByName,
  findVendorByName,
  findAccountByName,
  findAnyIncomeAccount,
  findAnyServiceItem,
  resolveRef,
  fetchEntity,
  buildJournalLines,
  readJournalEntry,
  buildSalesLines,
  buildAccountLines,
  buildItemExpenseLines,
  buildDepositLines,
} = createBuilders({ qboQuery, qboRequest });

// ---- One-time authorization mode ------------------------------------------
if (process.argv.includes("--connect")) {
  try {
    await runAuthorizationFlow();
    log("Authorization complete. You can now start Claude Desktop.");
    process.exit(0);
  } catch (e) {
    log("Authorization failed:", e.message);
    process.exit(1);
  }
}

// ---- Pattern A: sequential batch authorization ----------------------------
// `npm run connect:batch`            → keep going, asking "add another?" after each
// `npm run connect:batch -- --count 50` → authorize exactly 50, no prompts
// `npm run connect:batch -- --dry`   → print the plan and exit (no browser)
if (process.argv.includes("--connect-batch")) {
  const argv = process.argv;
  const getArg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const dry = argv.includes("--dry");
  const count = Number(getArg("--count") ?? getArg("-n"));
  const hasCount = Number.isFinite(count) && count > 0;

  try {
    if (dry) {
      const existing = await listCompanies();
      const taken = new Set(existing.map((c) => c.slug));
      log("Batch plan (dry run — nothing authorized):");
      log(`  environment : ${(process.env.QBO_ENVIRONMENT || "sandbox").toLowerCase()}`);
      log(`  redirect    : ${process.env.QBO_REDIRECT_URI || "http://localhost:3000/callback"}`);
      log(`  mode        : ${hasCount ? `fixed count = ${count}` : "interactive (asks 'add another?')"}`);
      log(`  already connected (${existing.length}): ${existing.map((c) => `${c.slug}(${c.environment})`).join(", ") || "none"}`);
      log(`  example new slug for realm 9999999999123456 → "${deriveSlugFromRealm("9999999999123456", taken)}"`);
      process.exit(0);
    }

    // Decide whether to authorize another company after each success.
    let shouldContinue;
    if (hasCount) {
      shouldContinue = (connected) => connected.length < count;
    } else {
      const rl = (await import("node:readline/promises")).createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      shouldContinue = async () => {
        const answer = (await rl.question("Connect another company? [y/N] ")).trim().toLowerCase();
        const yes = answer === "y" || answer === "yes";
        if (!yes) rl.close();
        return yes;
      };
    }

    log(hasCount
      ? `Batch authorizing ${count} companies. Log in once, then pick + Allow each.`
      : "Batch authorize started. Log in once; after each company you'll be asked to add another.");

    const connected = await runBatchAuthorization({ shouldContinue });

    log(`\nDone — ${connected.length} compan${connected.length === 1 ? "y" : "ies"} authorized:`);
    for (const c of connected) {
      log(`  • ${c.slug}  (realm ${c.realmId}, ${c.environment})${c.reused ? "  [refreshed]" : ""}`);
    }
    log("\nNo config change or restart needed — the unified `qbo` connector picks these up on the next call.");
    process.exit(0);
  } catch (e) {
    log("Batch authorization failed:", e.message);
    process.exit(1);
  }
}

// ---- MCP server ------------------------------------------------------------
const server = new McpServer({ name: "qbo-mcp-server", version: "1.0.0" });

/* =========================== COMPANY TOOLS (3) =========================== */

server.tool(
  "list_companies",
  "List every QuickBooks company this connector can access (each an authorized tokens.<slug>.json), with realmId and environment, plus the current active default.",
  {},
  tool(async () => {
    const companies = await listCompanies();
    return asText({
      count: companies.length,
      active_default: companyCtx.getSessionDefault() || envDefaultCompany() || null,
      companies,
    });
  })
);

server.tool(
  "select_company",
  "Set the active QuickBooks company for subsequent tool calls (persists until changed or the server restarts). Individual tools can still override it with their own `company` argument.",
  { company: z.string().describe("Company slug from list_companies, e.g. 8315") },
  tool(async ({ company }) => {
    const slug = sanitizeSlug(company);
    const companies = await listCompanies();
    const info = companies.find((c) => c.slug === slug);
    if (!info) {
      throw new Error(`No such company "${company}". Available: ${formatCompanyList(companies)}.`);
    }
    companyCtx.setSessionDefault(slug);
    return asText({ active_company: slug, realmId: info.realmId, environment: info.environment });
  })
);

server.tool(
  "get_active_company",
  "Show which QuickBooks company is currently active (the default for calls that omit `company`) and how it was determined.",
  {},
  tool(async () => {
    const active = companyCtx.getSessionDefault() || envDefaultCompany() || null;
    const source = companyCtx.getSessionDefault() ? "select_company" : envDefaultCompany() ? "env QBO_COMPANY" : "none";
    let info = null;
    if (active) {
      const companies = await listCompanies();
      info = companies.find((c) => c.slug === active) || null;
    }
    return asText({
      active_company: active,
      source,
      ...(info ? { realmId: info.realmId, environment: info.environment } : {}),
    });
  })
);

/* =========================== READ TOOLS (9) =========================== */

server.tool(
  "get_profit_and_loss",
  "Profit & Loss report for a date range (YYYY-MM-DD).",
  { start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string().describe("YYYY-MM-DD"), company: companyArg },
  tool(async ({ start_date, end_date, company }) => {
    const c = await resolveCompany(company);
    return asText(await qboRequest(`/reports/ProfitAndLoss?start_date=${start_date}&end_date=${end_date}`, { company: c }));
  })
);

server.tool(
  "get_balance_sheet",
  "Balance Sheet report for a date range (YYYY-MM-DD).",
  { start_date: z.string(), end_date: z.string(), company: companyArg },
  tool(async ({ start_date, end_date, company }) => {
    const c = await resolveCompany(company);
    return asText(await qboRequest(`/reports/BalanceSheet?start_date=${start_date}&end_date=${end_date}`, { company: c }));
  })
);

server.tool(
  "get_cash_flow",
  "Statement of Cash Flows for a date range (YYYY-MM-DD).",
  { start_date: z.string(), end_date: z.string(), company: companyArg },
  tool(async ({ start_date, end_date, company }) => {
    const c = await resolveCompany(company);
    return asText(await qboRequest(`/reports/CashFlow?start_date=${start_date}&end_date=${end_date}`, { company: c }));
  })
);

server.tool(
  "get_aged_receivables",
  "Aged Receivables summary (who owes you, bucketed by age).",
  { company: companyArg },
  tool(async ({ company }) => {
    const c = await resolveCompany(company);
    return asText(await qboRequest(`/reports/AgedReceivables`, { company: c }));
  })
);

server.tool(
  "get_aged_payables",
  "Aged Payables summary (who you owe, bucketed by age).",
  { company: companyArg },
  tool(async ({ company }) => {
    const c = await resolveCompany(company);
    return asText(await qboRequest(`/reports/AgedPayables`, { company: c }));
  })
);

server.tool(
  "get_invoices",
  "List invoices, optionally filtered by status (paid|open|overdue), customer_id, and date range.",
  {
    status: z.enum(["paid", "open", "overdue"]).optional(),
    customer_id: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ status, customer_id, start_date, end_date, company }) => {
    const c = await resolveCompany(company);
    const where = [];
    if (customer_id) where.push(`CustomerRef = '${esc(customer_id)}'`);
    if (start_date) where.push(`TxnDate >= '${start_date}'`);
    if (end_date) where.push(`TxnDate <= '${end_date}'`);
    const sql = `SELECT * FROM Invoice${where.length ? " WHERE " + where.join(" AND ") : ""} ORDERBY TxnDate DESC MAXRESULTS 100`;
    let invoices = (await qboQuery(sql, { company: c })).Invoice || [];
    if (status) {
      const today = todayISO();
      invoices = invoices.filter((inv) => {
        const bal = Number(inv.Balance || 0);
        if (status === "paid") return bal === 0;
        if (status === "open") return bal > 0;
        if (status === "overdue") return bal > 0 && inv.DueDate && inv.DueDate < today;
        return true;
      });
    }
    return asText({ count: invoices.length, invoices });
  })
);

server.tool(
  "get_overdue_invoices",
  "All invoices with an outstanding balance whose due date has passed.",
  { company: companyArg },
  tool(async ({ company }) => {
    const c = await resolveCompany(company);
    const today = todayISO();
    const r = await qboQuery(`SELECT * FROM Invoice WHERE DueDate < '${today}' MAXRESULTS 500`, { company: c });
    const overdue = (r.Invoice || []).filter((inv) => Number(inv.Balance || 0) > 0);
    return asText({ as_of: today, count: overdue.length, invoices: overdue });
  })
);

server.tool(
  "query",
  "Run a QBO SQL-style query against any entity, e.g. \"SELECT * FROM Customer\".",
  { sql_query: z.string(), company: companyArg },
  tool(async ({ sql_query, company }) => {
    const c = await resolveCompany(company);
    return asText(await qboQuery(sql_query, { company: c }));
  })
);

server.tool(
  "get_company_info",
  "Basic information about the connected QuickBooks company.",
  { company: companyArg },
  tool(async ({ company }) => {
    const c = await resolveCompany(company);
    const realmId = await getRealmId(c);
    return asText(await qboRequest(`/companyinfo/${realmId}`, { company: c }));
  })
);

/* =========================== MORE REPORTS (6) =========================== */

const accountingMethodArg = z.enum(["Cash", "Accrual"]).optional().describe("Cash or Accrual (defaults to the company setting)");
const dateMacroArg = z.string().optional().describe("QBO date macro, e.g. \"This Fiscal Year\", \"Last Month\" (alternative to start/end dates)");

server.tool(
  "get_general_ledger",
  "General Ledger report for a date range — every account's transactions with running balances.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    accounting_method: accountingMethodArg,
    date_macro: dateMacroArg,
    columns: z.string().optional().describe("Comma-separated columns to include, e.g. \"tx_date,account_name,debt_amt,credit_amt\""),
    company: companyArg,
  },
  tool(async ({ start_date, end_date, accounting_method, date_macro, columns, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, accounting_method, date_macro, columns });
    return asText(await qboRequest(`/reports/GeneralLedger${q}`, { company: c }));
  })
);

server.tool(
  "get_trial_balance",
  "Trial Balance report for a date range — debit/credit balance of every account.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    accounting_method: accountingMethodArg,
    date_macro: dateMacroArg,
    company: companyArg,
  },
  tool(async ({ start_date, end_date, accounting_method, date_macro, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, accounting_method, date_macro });
    return asText(await qboRequest(`/reports/TrialBalance${q}`, { company: c }));
  })
);

server.tool(
  "get_transaction_list",
  "Transaction List report — all transactions in a date range, optionally filtered.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    date_macro: dateMacroArg,
    accounting_method: accountingMethodArg,
    transaction_type: z.string().optional().describe("Filter by type, e.g. Invoice, Bill, Payment, JournalEntry"),
    company: companyArg,
  },
  tool(async ({ start_date, end_date, date_macro, accounting_method, transaction_type, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, date_macro, accounting_method, transaction_type });
    return asText(await qboRequest(`/reports/TransactionList${q}`, { company: c }));
  })
);

server.tool(
  "get_transaction_list_by_vendor",
  "Transaction List grouped by vendor for a date range.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    date_macro: dateMacroArg,
    accounting_method: accountingMethodArg,
    vendor: z.string().optional().describe("Filter to a single vendor Id"),
    company: companyArg,
  },
  tool(async ({ start_date, end_date, date_macro, accounting_method, vendor, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, date_macro, accounting_method, vendor });
    return asText(await qboRequest(`/reports/TransactionListByVendor${q}`, { company: c }));
  })
);

server.tool(
  "get_transaction_list_by_customer",
  "Transaction List grouped by customer for a date range.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    date_macro: dateMacroArg,
    accounting_method: accountingMethodArg,
    customer: z.string().optional().describe("Filter to a single customer Id"),
    company: companyArg,
  },
  tool(async ({ start_date, end_date, date_macro, accounting_method, customer, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, date_macro, accounting_method, customer });
    return asText(await qboRequest(`/reports/TransactionListByCustomer${q}`, { company: c }));
  })
);

server.tool(
  "get_transaction_list_with_splits",
  "Transaction List with split lines (each line of every transaction) for a date range.",
  {
    start_date: z.string().optional().describe("YYYY-MM-DD"),
    end_date: z.string().optional().describe("YYYY-MM-DD"),
    date_macro: dateMacroArg,
    accounting_method: accountingMethodArg,
    company: companyArg,
  },
  tool(async ({ start_date, end_date, date_macro, accounting_method, company }) => {
    const c = await resolveCompany(company);
    const q = reportQuery({ start_date, end_date, date_macro, accounting_method });
    return asText(await qboRequest(`/reports/TransactionListWithSplits${q}`, { company: c }));
  })
);

/* =========================== WRITE TOOLS (8) =========================== */

server.tool(
  "create_customer",
  "Create a new customer.",
  {
    display_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    billing_address: z.string().optional().describe("Free-form billing address line"),
    company: companyArg,
  },
  tool(async ({ display_name, email, phone, billing_address, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { DisplayName: display_name };
    if (email) payload.PrimaryEmailAddr = { Address: email };
    if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
    if (billing_address) payload.BillAddr = { Line1: billing_address };
    const r = await qboRequest(`/customer`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Customer });
  })
);

server.tool(
  "update_customer",
  "Update an existing customer (fetches current SyncToken first).",
  {
    customer_id: z.string(),
    display_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    billing_address: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_id, display_name, email, phone, billing_address, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = (await qboQuery(`SELECT * FROM Customer WHERE Id = '${esc(customer_id)}'`, { company: c })).Customer?.[0];
    if (!current) throw new Error(`No customer with Id ${customer_id}`);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (display_name) payload.DisplayName = display_name;
    if (email) payload.PrimaryEmailAddr = { Address: email };
    if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
    if (billing_address) payload.BillAddr = { Line1: billing_address };
    const r = await qboRequest(`/customer`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Customer });
  })
);

server.tool(
  "create_item",
  "Create a product or service item.",
  {
    name: z.string(),
    type: z.enum(["Service", "Inventory", "NonInventory"]),
    unit_price: z.number().optional(),
    description: z.string().optional(),
    income_account_name: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ name, type, unit_price, description, income_account_name, company }) => {
    const c = await resolveCompany(company, { write: true });
    let income = income_account_name ? await findAccountByName(income_account_name, c) : await findAnyIncomeAccount(c);
    if (!income) throw new Error("No income account found. Create one with create_account (account_type 'Income') first, or pass income_account_name.");
    const payload = {
      Name: name,
      Type: type,
      IncomeAccountRef: { value: income.Id, name: income.Name },
    };
    if (unit_price != null) payload.UnitPrice = unit_price;
    if (description) payload.Description = description;
    const r = await qboRequest(`/item`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Item, note: type === "Inventory" ? "Inventory items may need asset/COGS accounts and a start date; create in QBO UI if this errors." : undefined });
  })
);

server.tool(
  "create_invoice",
  "Create an invoice for a customer. line_items is an array of {description, amount}. Optionally email it.",
  {
    customer_ref: z.string().describe("Customer Id or DisplayName"),
    line_items: z.array(z.object({ description: z.string(), amount: z.number() })),
    due_date: z.string().optional().describe("YYYY-MM-DD"),
    send_email: z.boolean().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, line_items, due_date, send_email, company }) => {
    const c = await resolveCompany(company, { write: true });
    // Resolve customer by Id (numeric) or by name.
    let customer;
    if (/^\d+$/.test(customer_ref)) {
      customer = (await qboQuery(`SELECT * FROM Customer WHERE Id = '${esc(customer_ref)}'`, { company: c })).Customer?.[0];
    } else {
      customer = await findCustomerByName(customer_ref, c);
    }
    if (!customer) throw new Error(`Customer not found: ${customer_ref}`);

    const item = await findAnyServiceItem(c);
    if (!item) throw new Error("No Service item exists to attach invoice lines to. Create one with create_item first.");

    const Line = line_items.map((li) => ({
      Amount: li.amount,
      DetailType: "SalesItemLineDetail",
      Description: li.description,
      SalesItemLineDetail: { ItemRef: { value: item.Id, name: item.Name } },
    }));

    const payload = { CustomerRef: { value: customer.Id }, Line };
    if (due_date) payload.DueDate = due_date;
    if (customer.PrimaryEmailAddr?.Address) {
      payload.BillEmail = { Address: customer.PrimaryEmailAddr.Address };
    }

    const r = await qboRequest(`/invoice`, { method: "POST", body: payload, company: c });
    const invoice = r.Invoice;

    let emailed = false;
    if (send_email) {
      const addr = customer.PrimaryEmailAddr?.Address;
      if (!addr) throw new Error(`Invoice ${invoice.Id} created, but the customer has no email on file to send to.`);
      await qboRequest(`/invoice/${invoice.Id}/send?sendTo=${encodeURIComponent(addr)}`, { method: "POST", company: c });
      emailed = true;
    }
    return asText({ created: invoice, emailed });
  })
);

server.tool(
  "create_bill",
  "Record a bill (money you owe a vendor), categorized to an expense account.",
  {
    vendor_name: z.string(),
    amount: z.number(),
    category: z.string().describe("Expense account name to categorize against"),
    transaction_date: z.string().describe("YYYY-MM-DD"),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ vendor_name, amount, category, transaction_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    let vendor = await findVendorByName(vendor_name, c);
    if (!vendor) {
      const created = await qboRequest(`/vendor`, { method: "POST", body: { DisplayName: vendor_name }, company: c });
      vendor = created.Vendor;
    }
    const account = await findAccountByName(category, c);
    if (!account) throw new Error(`Expense account not found: "${category}". Create it with create_account or check the name.`);

    const payload = {
      VendorRef: { value: vendor.Id },
      TxnDate: transaction_date,
      Line: [{
        Amount: amount,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: account.Id, name: account.Name } },
      }],
    };
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/bill`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Bill });
  })
);

server.tool(
  "create_account",
  "Create a Chart of Accounts entry.",
  {
    name: z.string(),
    account_type: z.string().describe("e.g. Income, Expense, Bank, Credit Card"),
    account_sub_type: z.string().optional(),
    description: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ name, account_type, account_sub_type, description, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { Name: name, AccountType: account_type };
    if (account_sub_type) payload.AccountSubType = account_sub_type;
    if (description) payload.Description = description;
    const r = await qboRequest(`/account`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Account });
  })
);

server.tool(
  "send_invoice_email",
  "Email an existing invoice to the customer (or an override address).",
  { invoice_id: z.string(), email: z.string().optional(), company: companyArg },
  tool(async ({ invoice_id, email, company }) => {
    const c = await resolveCompany(company, { write: true });
    const q = email ? `?sendTo=${encodeURIComponent(email)}` : "";
    await qboRequest(`/invoice/${invoice_id}/send${q}`, { method: "POST", company: c });
    return asText({ sent: true, invoice_id, to: email || "email on file" });
  })
);

server.tool(
  "import_transactions_from_csv",
  "Read a bank-statement CSV, categorize rows against the Chart of Accounts, and import to QBO. Use dry_run first to preview.",
  {
    file_path: z.string(),
    transaction_type: z.enum(["Expense", "Bill", "JournalEntry"]),
    bank_account_name: z.string(),
    dry_run: z.boolean().optional(),
    company: companyArg,
  },
  tool(async ({ file_path, transaction_type, bank_account_name, dry_run, company }) => {
    // A dry_run only reads/previews, so allow the sole-company convenience for it;
    // a live import posts transactions and must name a company explicitly.
    const c = await resolveCompany(company, { write: !dry_run });
    const raw = await readFile(file_path.replace(/^~(?=$|\/)/, process.env.HOME), "utf8");
    const rows = parseCSV(raw);
    if (rows.length < 2) throw new Error("CSV appears empty or has no data rows.");

    const columns = detectColumns(rows[0]);
    if (columns.dateIdx < 0 || columns.descIdx < 0 || columns.amtIdx < 0) {
      throw new Error(`Could not detect Date/Description/Amount columns. Found headers: ${rows[0].join(", ")}`);
    }

    const bank = await findAccountByName(bank_account_name, c);
    if (!bank) throw new Error(`Bank account not found: "${bank_account_name}".`);

    const accounts = (await qboQuery(`SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 200`, { company: c })).Account || [];
    const fallback = pickFallbackAccount(accounts);
    if (!fallback) throw new Error("No expense accounts exist to categorize into.");

    const planned = planImportRows({ rows, columns, accounts, fallback });

    if (dry_run) {
      const total = planned.reduce((s, p) => s + p.amount, 0);
      return asText({
        dry_run: true,
        company: c || "(default)",
        bank_account: bank.Name,
        transaction_type,
        row_count: planned.length,
        total_amount: Number(total.toFixed(2)),
        preview: planned,
        note: "Nothing was posted. Re-run with dry_run: false to import.",
      });
    }

    if (transaction_type !== "Expense") {
      throw new Error(`Only transaction_type "Expense" is wired for live posting in this build. Use dry_run to preview ${transaction_type} rows.`);
    }

    // Post as a QBO batch of Purchase (Expense) transactions from the bank account.
    const items = buildPurchaseBatchItems(planned, bank, todayISO());

    const results = [];
    for (const batch of chunk(items)) {
      const r = await qboRequest(`/batch`, { method: "POST", body: { BatchItemRequest: batch }, company: c });
      results.push(...(r.BatchItemResponse || []));
    }
    const posted = results.filter((r) => r.Purchase).length;
    const errors = results.filter((r) => r.Fault).map((r) => r.Fault?.Error?.[0]?.Message);
    return asText({ imported: posted, errors, total_rows: planned.length });
  })
);

/* =========================== JOURNAL ENTRY TOOLS (6) =========================== */

server.tool(
  "create_journal_entry",
  "Create a journal entry from balanced lines (total Debits must equal total Credits). Each line posts an amount to an account as a Debit or Credit; lines may optionally be tagged to a customer/vendor/employee.",
  {
    lines: z.array(journalLineSchema).describe("At least two lines; debits must equal credits"),
    txn_date: z.string().optional().describe("YYYY-MM-DD (defaults to today)"),
    doc_number: z.string().optional().describe("Reference/journal number"),
    memo: z.string().optional().describe("Note on the entry (PrivateNote)"),
    adjustment: z.boolean().optional().describe("Mark as an adjusting journal entry"),
    company: companyArg,
  },
  tool(async ({ lines, txn_date, doc_number, memo, adjustment, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { Line: await buildJournalLines(lines, c) };
    if (txn_date) payload.TxnDate = txn_date;
    if (doc_number) payload.DocNumber = doc_number;
    if (memo) payload.PrivateNote = memo;
    if (adjustment != null) payload.Adjustment = adjustment;
    const r = await qboRequest(`/journalentry`, { method: "POST", body: payload, company: c });
    return asText({ created: r.JournalEntry });
  })
);

server.tool(
  "update_journal_entry",
  "Full update of a journal entry: REPLACES all lines with the ones you provide (must stay balanced). Omitted header fields are carried over from the current entry. Fetches SyncToken automatically.",
  {
    journal_entry_id: z.string(),
    lines: z.array(journalLineSchema).describe("Complete replacement set of lines; debits must equal credits"),
    txn_date: z.string().optional(),
    doc_number: z.string().optional(),
    memo: z.string().optional(),
    adjustment: z.boolean().optional(),
    company: companyArg,
  },
  tool(async ({ journal_entry_id, lines, txn_date, doc_number, memo, adjustment, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await readJournalEntry(journal_entry_id, c);
    const payload = {
      Id: current.Id,
      SyncToken: current.SyncToken,
      Line: await buildJournalLines(lines, c),
      TxnDate: txn_date ?? current.TxnDate,
    };
    const docN = doc_number ?? current.DocNumber;
    const note = memo ?? current.PrivateNote;
    const adj = adjustment ?? current.Adjustment;
    if (docN != null) payload.DocNumber = docN;
    if (note != null) payload.PrivateNote = note;
    if (adj != null) payload.Adjustment = adj;
    const r = await qboRequest(`/journalentry`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.JournalEntry });
  })
);

/* =========================== SALES TRANSACTIONS =========================== */

server.tool(
  "create_estimate",
  "Create an estimate (quote) for a customer, with line items.",
  {
    customer_ref: z.string().describe("Customer Id or DisplayName"),
    line_items: z.array(salesLineSchema),
    txn_date: z.string().optional().describe("YYYY-MM-DD"),
    expiration_date: z.string().optional().describe("YYYY-MM-DD"),
    email: z.string().optional().describe("BillEmail address"),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, line_items, txn_date, expiration_date, email, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { CustomerRef: await resolveRef("Customer", customer_ref, c, "DisplayName"), Line: await buildSalesLines(line_items, c) };
    if (txn_date) payload.TxnDate = txn_date;
    if (expiration_date) payload.ExpirationDate = expiration_date;
    if (email) payload.BillEmail = { Address: email };
    if (memo) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/estimate`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Estimate });
  })
);

server.tool(
  "update_estimate",
  "Sparse-update an estimate (fetches SyncToken first). Pass line_items only to replace all lines.",
  {
    estimate_id: z.string(),
    line_items: z.array(salesLineSchema).optional(),
    txn_date: z.string().optional(),
    email: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ estimate_id, line_items, txn_date, email, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Estimate", estimate_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (line_items) payload.Line = await buildSalesLines(line_items, c);
    if (txn_date != null) payload.TxnDate = txn_date;
    if (email != null) payload.BillEmail = { Address: email };
    if (memo != null) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/estimate`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Estimate });
  })
);

server.tool(
  "send_estimate",
  "Email an existing estimate to the customer (or an override address).",
  { estimate_id: z.string(), email: z.string().optional(), company: companyArg },
  tool(async ({ estimate_id, email, company }) => {
    const c = await resolveCompany(company, { write: true });
    const q = email ? `?sendTo=${encodeURIComponent(email)}` : "";
    await qboRequest(`/estimate/${encodeURIComponent(estimate_id)}/send${q}`, { method: "POST", company: c });
    return asText({ sent: true, estimate_id, to: email || "email on file" });
  })
);

server.tool(
  "update_invoice",
  "Sparse-update an invoice (fetches SyncToken first). Pass line_items only to replace all lines.",
  {
    invoice_id: z.string(),
    line_items: z.array(salesLineSchema).optional(),
    due_date: z.string().optional(),
    customer_ref: z.string().optional(),
    email: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ invoice_id, line_items, due_date, customer_ref, email, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Invoice", invoice_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (line_items) payload.Line = await buildSalesLines(line_items, c);
    if (due_date != null) payload.DueDate = due_date;
    if (customer_ref != null) payload.CustomerRef = await resolveRef("Customer", customer_ref, c, "DisplayName");
    if (email != null) payload.BillEmail = { Address: email };
    if (memo != null) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/invoice`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Invoice });
  })
);

server.tool(
  "void_invoice",
  "Void an existing invoice (zeros it out but keeps the number). Fetches SyncToken first.",
  { invoice_id: z.string(), company: companyArg },
  tool(async ({ invoice_id, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Invoice", invoice_id, c);
    const r = await qboRequest(`/invoice?operation=void`, { method: "POST", body: { Id: current.Id, SyncToken: current.SyncToken }, company: c });
    return asText({ voided: r.Invoice ?? { Id: invoice_id }, status: "Voided" });
  })
);

server.tool(
  "create_sales_receipt",
  "Create a sales receipt (paid-at-point-of-sale sale) with line items.",
  {
    customer_ref: z.string().optional().describe("Customer Id or DisplayName"),
    line_items: z.array(salesLineSchema),
    deposit_to_account: z.string().optional().describe("Account name/Id the money lands in"),
    txn_date: z.string().optional(),
    email: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, line_items, deposit_to_account, txn_date, email, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { Line: await buildSalesLines(line_items, c) };
    if (customer_ref) payload.CustomerRef = await resolveRef("Customer", customer_ref, c, "DisplayName");
    if (deposit_to_account) payload.DepositToAccountRef = await resolveRef("Account", deposit_to_account, c, "Name");
    if (txn_date) payload.TxnDate = txn_date;
    if (email) payload.BillEmail = { Address: email };
    if (memo) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/salesreceipt`, { method: "POST", body: payload, company: c });
    return asText({ created: r.SalesReceipt });
  })
);

server.tool(
  "update_sales_receipt",
  "Sparse-update a sales receipt (fetches SyncToken first). Pass line_items only to replace all lines.",
  {
    sales_receipt_id: z.string(),
    line_items: z.array(salesLineSchema).optional(),
    txn_date: z.string().optional(),
    email: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ sales_receipt_id, line_items, txn_date, email, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("SalesReceipt", sales_receipt_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (line_items) payload.Line = await buildSalesLines(line_items, c);
    if (txn_date != null) payload.TxnDate = txn_date;
    if (email != null) payload.BillEmail = { Address: email };
    if (memo != null) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/salesreceipt`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.SalesReceipt });
  })
);

server.tool(
  "send_sales_receipt",
  "Email an existing sales receipt to the customer (or an override address).",
  { sales_receipt_id: z.string(), email: z.string().optional(), company: companyArg },
  tool(async ({ sales_receipt_id, email, company }) => {
    const c = await resolveCompany(company, { write: true });
    const q = email ? `?sendTo=${encodeURIComponent(email)}` : "";
    await qboRequest(`/salesreceipt/${encodeURIComponent(sales_receipt_id)}/send${q}`, { method: "POST", company: c });
    return asText({ sent: true, sales_receipt_id, to: email || "email on file" });
  })
);

server.tool(
  "create_credit_memo",
  "Create a credit memo for a customer, with line items.",
  {
    customer_ref: z.string().describe("Customer Id or DisplayName"),
    line_items: z.array(salesLineSchema),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, line_items, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { CustomerRef: await resolveRef("Customer", customer_ref, c, "DisplayName"), Line: await buildSalesLines(line_items, c) };
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/creditmemo`, { method: "POST", body: payload, company: c });
    return asText({ created: r.CreditMemo });
  })
);

server.tool(
  "create_refund_receipt",
  "Create a refund receipt (money returned to a customer), with line items.",
  {
    customer_ref: z.string().describe("Customer Id or DisplayName"),
    line_items: z.array(salesLineSchema),
    deposit_to_account: z.string().optional().describe("Account the refund is paid from (name/Id)"),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, line_items, deposit_to_account, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { CustomerRef: await resolveRef("Customer", customer_ref, c, "DisplayName"), Line: await buildSalesLines(line_items, c) };
    if (deposit_to_account) payload.DepositToAccountRef = await resolveRef("Account", deposit_to_account, c, "Name");
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.CustomerMemo = { value: memo };
    const r = await qboRequest(`/refundreceipt`, { method: "POST", body: payload, company: c });
    return asText({ created: r.RefundReceipt });
  })
);

server.tool(
  "create_payment",
  "Record a customer payment, optionally applied to a specific invoice.",
  {
    customer_ref: z.string().describe("Customer Id or DisplayName"),
    amount: z.number(),
    invoice_id: z.string().optional().describe("Invoice to apply the payment to"),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ customer_ref, amount, invoice_id, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { CustomerRef: await resolveRef("Customer", customer_ref, c, "DisplayName"), TotalAmt: amount };
    if (invoice_id) {
      payload.Line = [{ Amount: amount, LinkedTxn: [{ TxnId: String(invoice_id), TxnType: "Invoice" }] }];
    }
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/payment`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Payment });
  })
);

server.tool(
  "create_deposit",
  "Create a bank deposit into an account, with one or more source lines.",
  {
    deposit_to_account: z.string().describe("Bank account to deposit into (name/Id)"),
    lines: z.array(depositLineSchema),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ deposit_to_account, lines, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = {
      DepositToAccountRef: await resolveRef("Account", deposit_to_account, c, "Name"),
      Line: await buildDepositLines(lines, c),
    };
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/deposit`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Deposit });
  })
);

/* =========================== PURCHASES / VENDORS =========================== */

server.tool(
  "create_expense",
  "Record an expense (Purchase) paid by cash, check, or credit card, categorized to expense accounts.",
  {
    payment_account: z.string().describe("Bank/credit-card account the money came from (name/Id)"),
    payment_type: z.enum(["Cash", "Check", "CreditCard"]),
    lines: z.array(accountLineSchema),
    payee_name: z.string().optional().describe("Vendor/Customer/Employee paid"),
    payee_type: z.enum(["Vendor", "Customer", "Employee"]).optional(),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ payment_account, payment_type, lines, payee_name, payee_type, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = {
      PaymentType: payment_type,
      AccountRef: await resolveRef("Account", payment_account, c, "Name"),
      Line: await buildAccountLines(lines, c),
    };
    if (payee_name) {
      if (!payee_type) throw new Error("payee_type is required when payee_name is set.");
      payload.EntityRef = await resolveRef(payee_type, payee_name, c, "DisplayName");
    }
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/purchase`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Purchase });
  })
);

server.tool(
  "update_purchase",
  "Sparse-update a purchase/expense (fetches SyncToken first). Pass lines only to replace all lines.",
  {
    purchase_id: z.string(),
    lines: z.array(accountLineSchema).optional(),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ purchase_id, lines, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Purchase", purchase_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true, PaymentType: current.PaymentType, AccountRef: current.AccountRef };
    if (lines) payload.Line = await buildAccountLines(lines, c);
    if (txn_date != null) payload.TxnDate = txn_date;
    if (memo != null) payload.PrivateNote = memo;
    const r = await qboRequest(`/purchase`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Purchase });
  })
);

server.tool(
  "create_bill_item_based",
  "Record a bill against product/service items (item-based lines), owed to a vendor.",
  {
    vendor_name: z.string(),
    line_items: z.array(itemLineSchema),
    transaction_date: z.string().optional().describe("YYYY-MM-DD"),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ vendor_name, line_items, transaction_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { VendorRef: await resolveRef("Vendor", vendor_name, c, "DisplayName"), Line: await buildItemExpenseLines(line_items, c) };
    if (transaction_date) payload.TxnDate = transaction_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/bill`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Bill });
  })
);

server.tool(
  "update_bill",
  "Sparse-update a bill (fetches SyncToken first). Pass account_lines only to replace all lines.",
  {
    bill_id: z.string(),
    account_lines: z.array(accountLineSchema).optional(),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ bill_id, account_lines, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Bill", bill_id, c);
    // VendorRef is required even on a sparse Bill update — carry it forward.
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true, VendorRef: current.VendorRef };
    if (account_lines) payload.Line = await buildAccountLines(account_lines, c);
    if (txn_date != null) payload.TxnDate = txn_date;
    if (memo != null) payload.PrivateNote = memo;
    const r = await qboRequest(`/bill`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Bill });
  })
);

server.tool(
  "create_vendor_credit",
  "Record a vendor credit (money a vendor owes you), categorized to expense accounts.",
  {
    vendor_name: z.string(),
    lines: z.array(accountLineSchema),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ vendor_name, lines, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { VendorRef: await resolveRef("Vendor", vendor_name, c, "DisplayName"), Line: await buildAccountLines(lines, c) };
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/vendorcredit`, { method: "POST", body: payload, company: c });
    return asText({ created: r.VendorCredit });
  })
);

server.tool(
  "create_purchase_order",
  "Create a purchase order to a vendor, with item-based lines.",
  {
    vendor_name: z.string(),
    line_items: z.array(itemLineSchema),
    txn_date: z.string().optional(),
    memo: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ vendor_name, line_items, txn_date, memo, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { VendorRef: await resolveRef("Vendor", vendor_name, c, "DisplayName"), Line: await buildItemExpenseLines(line_items, c) };
    // Purchase orders require an Accounts Payable account.
    const ap = (await qboQuery(`SELECT * FROM Account WHERE AccountType = 'Accounts Payable' MAXRESULTS 1`, { company: c })).Account?.[0];
    if (ap) payload.APAccountRef = { value: ap.Id, name: ap.Name };
    if (txn_date) payload.TxnDate = txn_date;
    if (memo) payload.PrivateNote = memo;
    const r = await qboRequest(`/purchaseorder`, { method: "POST", body: payload, company: c });
    return asText({ created: r.PurchaseOrder });
  })
);

server.tool(
  "create_vendor",
  "Create a new vendor.",
  {
    display_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    billing_address: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ display_name, email, phone, billing_address, company }) => {
    const c = await resolveCompany(company, { write: true });
    const payload = { DisplayName: display_name };
    if (email) payload.PrimaryEmailAddr = { Address: email };
    if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
    if (billing_address) payload.BillAddr = { Line1: billing_address };
    const r = await qboRequest(`/vendor`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Vendor });
  })
);

server.tool(
  "update_vendor",
  "Sparse-update an existing vendor (fetches SyncToken first).",
  {
    vendor_id: z.string(),
    display_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    billing_address: z.string().optional(),
    active: z.boolean().optional(),
    company: companyArg,
  },
  tool(async ({ vendor_id, display_name, email, phone, billing_address, active, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Vendor", vendor_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (display_name != null) payload.DisplayName = display_name;
    if (email != null) payload.PrimaryEmailAddr = { Address: email };
    if (phone != null) payload.PrimaryPhone = { FreeFormNumber: phone };
    if (billing_address != null) payload.BillAddr = { Line1: billing_address };
    if (active != null) payload.Active = active;
    const r = await qboRequest(`/vendor`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Vendor });
  })
);

/* =========================== PEOPLE / ITEMS =========================== */

server.tool(
  "create_employee",
  "Create a new employee.",
  {
    display_name: z.string().optional().describe("If omitted, built from given/family name"),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ display_name, given_name, family_name, email, phone, company }) => {
    const c = await resolveCompany(company, { write: true });
    if (!display_name && !given_name && !family_name) throw new Error("Provide display_name or given_name/family_name.");
    const payload = {};
    if (display_name) payload.DisplayName = display_name;
    if (given_name) payload.GivenName = given_name;
    if (family_name) payload.FamilyName = family_name;
    if (email) payload.PrimaryEmailAddr = { Address: email };
    if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
    const r = await qboRequest(`/employee`, { method: "POST", body: payload, company: c });
    return asText({ created: r.Employee });
  })
);

server.tool(
  "create_time_activity",
  "Log a single time activity for an employee or vendor.",
  {
    name_of: z.enum(["Employee", "Vendor"]),
    person_name: z.string().describe("Employee/Vendor name or Id"),
    txn_date: z.string().describe("YYYY-MM-DD"),
    hours: z.number().int().optional(),
    minutes: z.number().int().optional(),
    description: z.string().optional(),
    customer_ref: z.string().optional().describe("Customer to bill the time to"),
    company: companyArg,
  },
  tool(async ({ name_of, person_name, txn_date, hours, minutes, description, customer_ref, company }) => {
    const c = await resolveCompany(company, { write: true });
    const ref = await resolveRef(name_of, person_name, c, "DisplayName");
    const payload = { NameOf: name_of, TxnDate: txn_date, Hours: hours ?? 0, Minutes: minutes ?? 0 };
    payload[name_of === "Employee" ? "EmployeeRef" : "VendorRef"] = ref;
    if (description) payload.Description = description;
    if (customer_ref) payload.CustomerRef = await resolveRef("Customer", customer_ref, c, "DisplayName");
    const r = await qboRequest(`/timeactivity`, { method: "POST", body: payload, company: c });
    return asText({ created: r.TimeActivity });
  })
);

server.tool(
  "update_item",
  "Sparse-update a product/service item (fetches SyncToken first).",
  {
    item_id: z.string(),
    name: z.string().optional(),
    unit_price: z.number().optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
    company: companyArg,
  },
  tool(async ({ item_id, name, unit_price, description, active, company }) => {
    const c = await resolveCompany(company, { write: true });
    const current = await fetchEntity("Item", item_id, c);
    const payload = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
    if (name != null) payload.Name = name;
    if (unit_price != null) payload.UnitPrice = unit_price;
    if (description != null) payload.Description = description;
    if (active != null) payload.Active = active;
    const r = await qboRequest(`/item`, { method: "POST", body: payload, company: c });
    return asText({ updated: r.Item });
  })
);

/* =========================== ATTACHMENTS & ADVANCED =========================== */

server.tool(
  "attach_file",
  "Attach a file (from a local path) and/or a note to a QuickBooks record, or upload a standalone file. Link it to a record with attach_to_entity + attach_to_id.",
  {
    note: z.string().optional(),
    file_path: z.string().optional().describe("Local path to a file to upload"),
    file_name: z.string().optional().describe("Override the stored file name"),
    content_type: z.string().optional().describe("MIME type; guessed from the extension if omitted"),
    attach_to_entity: z.string().optional().describe("e.g. Invoice, Bill, Customer, Vendor, Estimate, SalesReceipt, Purchase, JournalEntry"),
    attach_to_id: z.string().optional(),
    company: companyArg,
  },
  tool(async ({ note, file_path, file_name, content_type, attach_to_entity, attach_to_id, company }) => {
    const c = await resolveCompany(company, { write: true });
    if (!file_path && !note) throw new Error("Provide at least a file_path or a note.");
    const ref = (attach_to_entity && attach_to_id)
      ? [{ EntityRef: { type: attach_to_entity, value: String(attach_to_id) } }]
      : undefined;

    if (!file_path) {
      const body = { Note: note };
      if (ref) body.AttachableRef = ref;
      const r = await qboRequest(`/attachable`, { method: "POST", body, company: c });
      return asText({ created: r.Attachable });
    }

    const buf = await readFile(file_path.replace(/^~(?=$|\/)/, process.env.HOME));
    const name = file_name || path.basename(file_path);
    const ctype = content_type || guessContentType(name);
    const meta = { FileName: name, ContentType: ctype };
    if (note) meta.Note = note;
    if (ref) meta.AttachableRef = ref;
    const fd = new FormData();
    fd.append("file_metadata_01", new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
    fd.append("file_content_01", new Blob([buf], { type: ctype }), name);
    const r = await qboUpload(fd, { company: c });
    return asText({ created: r.AttachableResponse?.[0]?.Attachable ?? r });
  })
);

server.tool(
  "get_attachments",
  "List attachments (files/notes), optionally only those linked to a specific record.",
  {
    attach_to_entity: z.string().optional(),
    attach_to_id: z.string().optional(),
    max_results: z.number().int().positive().max(1000).optional(),
    company: companyArg,
  },
  tool(async ({ attach_to_entity, attach_to_id, max_results, company }) => {
    const c = await resolveCompany(company);
    const all = (await qboQuery(`SELECT * FROM Attachable MAXRESULTS ${max_results || 100}`, { company: c })).Attachable || [];
    const items = attach_to_id
      ? all.filter((a) => (a.AttachableRef || []).some((r) =>
          r.EntityRef?.value === String(attach_to_id) && (!attach_to_entity || r.EntityRef?.type === attach_to_entity)))
      : all;
    return asText({ count: items.length, attachments: items });
  })
);

server.tool(
  "api_request",
  "Advanced escape hatch: make a raw authenticated call to any QBO endpoint under /v3/company/{realmId}. Provide `path` (e.g. \"/reports/GeneralLedger?start_date=2026-01-01\", \"/query?query=SELECT * FROM Bill\", \"/invoice/145\"), an HTTP method, and an optional JSON body. Auth, realm, and minorversion are handled for you.",
  {
    path: z.string().describe("Path after /v3/company/{realmId}, starting with '/'"),
    method: z.enum(["GET", "POST"]).optional().describe("Default GET"),
    body: z.record(z.any()).optional().describe("JSON body for POST"),
    company: companyArg,
  },
  tool(async ({ path: reqPath, method, body, company }) => {
    const isWrite = (method || "GET").toUpperCase() !== "GET";
    const c = await resolveCompany(company, { write: isWrite });
    const p = reqPath.startsWith("/") ? reqPath : `/${reqPath}`;
    return asText(await qboRequest(p, { method: method || "GET", body, company: c }));
  })
);

// ---- start -----------------------------------------------------------------
// The configured server is exported so tests (and any embedder) can attach their
// own transport. Connecting stdio is skipped when this module is imported rather
// than run, because claiming stdin/stdout would corrupt the importer's I/O.
const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("QBO MCP server running (stdio). 54 tools registered.");
}

export { server, companyCtx };
