import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createBuilders } from "../src/lib/builders.js";
import { fakeQbo } from "./helpers/fakes.js";

const CHART = {
  Account: [
    { Id: "1", Name: "Checking", AccountType: "Bank" },
    { Id: "2", Name: "Consulting Income", AccountType: "Income" },
    { Id: "3", Name: "Rent", AccountType: "Expense" },
  ],
  Customer: [{ Id: "10", DisplayName: "Acme Corp" }],
  Vendor: [{ Id: "20", DisplayName: "Landlord LLC" }],
  Employee: [{ Id: "30", DisplayName: "Jane Doe" }],
  Item: [{ Id: "40", Name: "Bookkeeping", Type: "Service" }],
};

function builders(tables = CHART, opts = {}) {
  const qbo = fakeQbo(tables, opts);
  return { ...createBuilders(qbo), qbo };
}

describe("entity lookups", () => {
  test("findCustomerByName returns the matching customer", async () => {
    const b = builders();
    assert.equal((await b.findCustomerByName("Acme Corp")).Id, "10");
  });

  test("findCustomerByName returns null when absent", async () => {
    assert.equal(await builders().findCustomerByName("Nobody"), null);
  });

  test("findVendorByName returns the matching vendor", async () => {
    assert.equal((await builders().findVendorByName("Landlord LLC")).Id, "20");
  });

  test("findAccountByName matches on Name, not DisplayName", async () => {
    assert.equal((await builders().findAccountByName("Rent")).Id, "3");
  });

  test("findAnyIncomeAccount finds an income account", async () => {
    assert.equal((await builders().findAnyIncomeAccount()).Id, "2");
  });

  test("findAnyServiceItem finds a service item", async () => {
    assert.equal((await builders().findAnyServiceItem()).Id, "40");
  });

  test("lookups return null rather than throwing on an empty book", async () => {
    const b = builders({});
    assert.equal(await b.findCustomerByName("x"), null);
    assert.equal(await b.findAnyServiceItem(), null);
  });

  test("escapes an apostrophe in a name so the query stays well-formed", async () => {
    const b = builders({ Customer: [{ Id: "11", DisplayName: "O'Brien" }] });
    assert.equal((await b.findCustomerByName("O'Brien")).Id, "11");
    assert.match(b.qbo.queries[0].sql, /DisplayName = 'O\\'Brien'/);
  });

  test("threads the company through to the query layer", async () => {
    const b = builders();
    await b.findAccountByName("Rent", "acme");
    assert.equal(b.qbo.queries[0].company, "acme");
  });
});

describe("resolveRef", () => {
  test("treats a numeric string as an Id", async () => {
    const b = builders();
    assert.deepEqual(await b.resolveRef("Customer", "10", undefined), { value: "10", name: "Acme Corp" });
    assert.match(b.qbo.queries[0].sql, /WHERE Id = '10'/);
  });

  test("treats a non-numeric string as a name", async () => {
    const b = builders();
    assert.deepEqual(await b.resolveRef("Customer", "Acme Corp", undefined), { value: "10", name: "Acme Corp" });
    assert.match(b.qbo.queries[0].sql, /WHERE DisplayName = 'Acme Corp'/);
  });

  test("uses the supplied name field", async () => {
    const b = builders();
    await b.resolveRef("Account", "Rent", undefined, "Name");
    assert.match(b.qbo.queries[0].sql, /WHERE Name = 'Rent'/);
  });

  test("passes an unknown numeric Id straight through, trusting QBO to reject it", async () => {
    assert.deepEqual(await builders().resolveRef("Customer", "999", undefined), { value: "999" });
  });

  test("throws for an unknown name", async () => {
    await assert.rejects(
      () => builders().resolveRef("Customer", "Ghost", undefined),
      /Customer not found: "Ghost"/
    );
  });

  test("falls back to Name when the requested name field is absent", async () => {
    const b = builders({ Account: [{ Id: "7", Name: "Only Name" }] });
    assert.deepEqual(await b.resolveRef("Account", "7", undefined), { value: "7", name: "Only Name" });
  });
});

describe("fetchEntity", () => {
  test("returns the full record, so callers get its SyncToken", async () => {
    const b = builders({ Invoice: [{ Id: "5", SyncToken: "3", DocNumber: "1001" }] });
    assert.deepEqual(await b.fetchEntity("Invoice", "5"), { Id: "5", SyncToken: "3", DocNumber: "1001" });
  });

  test("throws when the record does not exist", async () => {
    await assert.rejects(() => builders({}).fetchEntity("Invoice", "5"), /No Invoice with Id 5/);
  });
});

describe("buildJournalLines — balance assertion", () => {
  const balanced = [
    { account: "Rent", amount: 500, posting_type: "Debit" },
    { account: "Checking", amount: 500, posting_type: "Credit" },
  ];

  test("accepts a balanced two-line entry", async () => {
    const lines = await builders().buildJournalLines(balanced);
    assert.equal(lines.length, 2);
  });

  test("rejects an unbalanced entry, reporting both totals", async () => {
    const unbalanced = [
      { account: "Rent", amount: 500, posting_type: "Debit" },
      { account: "Checking", amount: 400, posting_type: "Credit" },
    ];
    await assert.rejects(
      () => builders().buildJournalLines(unbalanced),
      /not balanced: debits 500\.00 vs credits 400\.00/
    );
  });

  test("rejects fewer than two lines", async () => {
    await assert.rejects(
      () => builders().buildJournalLines([{ account: "Rent", amount: 1, posting_type: "Debit" }]),
      /needs at least two lines/
    );
  });

  test("rejects an empty array and a non-array", async () => {
    await assert.rejects(() => builders().buildJournalLines([]), /at least two lines/);
    await assert.rejects(() => builders().buildJournalLines(undefined), /at least two lines/);
  });

  test("tolerates sub-cent float drift within the half-cent epsilon", async () => {
    const drifty = [
      { account: "Rent", amount: 0.1, posting_type: "Debit" },
      { account: "Rent", amount: 0.2, posting_type: "Debit" },
      { account: "Checking", amount: 0.3, posting_type: "Credit" },
    ];
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754; must not be rejected.
    assert.equal((await builders().buildJournalLines(drifty)).length, 3);
  });

  test("rejects a one-cent imbalance, which is outside the epsilon", async () => {
    const off = [
      { account: "Rent", amount: 100, posting_type: "Debit" },
      { account: "Checking", amount: 100.01, posting_type: "Credit" },
    ];
    await assert.rejects(() => builders().buildJournalLines(off), /not balanced/);
  });

  test("balances across many lines on both sides", async () => {
    const many = [
      { account: "Rent", amount: 300, posting_type: "Debit" },
      { account: "Rent", amount: 200, posting_type: "Debit" },
      { account: "Checking", amount: 100, posting_type: "Credit" },
      { account: "Checking", amount: 400, posting_type: "Credit" },
    ];
    assert.equal((await builders().buildJournalLines(many)).length, 4);
  });
});

describe("buildJournalLines — line shaping", () => {
  test("emits the QBO JournalEntryLineDetail shape", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "Rent", amount: 500, posting_type: "Debit" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.deepEqual(line, {
      Amount: 500,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: "Debit",
        AccountRef: { value: "3", name: "Rent" },
      },
    });
  });

  test("includes a per-line description when supplied", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "Rent", amount: 500, posting_type: "Debit", description: "March rent" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.equal(line.Description, "March rent");
  });

  test("omits Description entirely when not supplied", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "Rent", amount: 500, posting_type: "Debit" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.ok(!("Description" in line));
  });

  test("resolves an account given by numeric Id", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "3", amount: 500, posting_type: "Debit" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.deepEqual(line.JournalEntryLineDetail.AccountRef, { value: "3", name: "Rent" });
  });

  test("passes an unknown numeric account Id through without a name", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "888", amount: 500, posting_type: "Debit" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.deepEqual(line.JournalEntryLineDetail.AccountRef, { value: "888" });
  });

  test("throws for an unknown account name", async () => {
    await assert.rejects(
      () => builders().buildJournalLines([
        { account: "Nonexistent", amount: 5, posting_type: "Debit" },
        { account: "Checking", amount: 5, posting_type: "Credit" },
      ]),
      /Account not found for journal line: "Nonexistent"/
    );
  });

  test("tags a line with a resolved entity", async () => {
    const [line] = await builders().buildJournalLines([
      { account: "Rent", amount: 500, posting_type: "Debit", entity_name: "Landlord LLC", entity_type: "Vendor" },
      { account: "Checking", amount: 500, posting_type: "Credit" },
    ]);
    assert.deepEqual(line.JournalEntryLineDetail.Entity, {
      Type: "Vendor",
      EntityRef: { value: "20" },
    });
  });

  test("requires entity_type when entity_name is given", async () => {
    await assert.rejects(
      () => builders().buildJournalLines([
        { account: "Rent", amount: 500, posting_type: "Debit", entity_name: "Landlord LLC" },
        { account: "Checking", amount: 500, posting_type: "Credit" },
      ]),
      /entity_type is required when entity_name is set \(line account "Rent"\)/
    );
  });

  test("throws when the line entity cannot be found", async () => {
    await assert.rejects(
      () => builders().buildJournalLines([
        { account: "Rent", amount: 500, posting_type: "Debit", entity_name: "Ghost", entity_type: "Vendor" },
        { account: "Checking", amount: 500, posting_type: "Credit" },
      ]),
      /Vendor not found for journal-line entity: "Ghost"/
    );
  });
});

describe("readJournalEntry", () => {
  test("returns the entry from the API response", async () => {
    const b = builders(CHART, { requestResponses: { "/journalentry/": { JournalEntry: { Id: "7" } } } });
    assert.deepEqual(await b.readJournalEntry("7"), { Id: "7" });
  });

  test("url-encodes the id in the request path", async () => {
    const b = builders(CHART, { requestResponses: { "/journalentry/": { JournalEntry: { Id: "a b" } } } });
    await b.readJournalEntry("a b");
    assert.equal(b.qbo.requests[0].path, "/journalentry/a%20b");
  });

  test("throws when the response has no JournalEntry", async () => {
    await assert.rejects(() => builders().readJournalEntry("7"), /No journal entry with Id 7/);
  });
});

describe("buildSalesLines", () => {
  test("resolves a named item into an ItemRef", async () => {
    const [line] = await builders().buildSalesLines([{ amount: 100, item: "Bookkeeping" }]);
    assert.deepEqual(line, {
      Amount: 100,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "40", name: "Bookkeeping" } },
    });
  });

  test("defaults to any service item when none is given", async () => {
    const [line] = await builders().buildSalesLines([{ amount: 100 }]);
    assert.deepEqual(line.SalesItemLineDetail.ItemRef, { value: "40", name: "Bookkeeping" });
  });

  test("omits ItemRef when no item is given and the book has none", async () => {
    const [line] = await builders({ Item: [] }).buildSalesLines([{ amount: 100 }]);
    assert.deepEqual(line.SalesItemLineDetail, {});
  });

  test("carries quantity and unit price when supplied", async () => {
    const [line] = await builders().buildSalesLines([
      { amount: 200, item: "Bookkeeping", quantity: 2, unit_price: 100 },
    ]);
    assert.equal(line.SalesItemLineDetail.Qty, 2);
    assert.equal(line.SalesItemLineDetail.UnitPrice, 100);
  });

  test("omits quantity and unit price when absent", async () => {
    const [line] = await builders().buildSalesLines([{ amount: 200, item: "Bookkeeping" }]);
    assert.ok(!("Qty" in line.SalesItemLineDetail));
    assert.ok(!("UnitPrice" in line.SalesItemLineDetail));
  });

  test("keeps a zero unit price, which is meaningful", async () => {
    const [line] = await builders().buildSalesLines([
      { amount: 0, item: "Bookkeeping", quantity: 0, unit_price: 0 },
    ]);
    assert.equal(line.SalesItemLineDetail.Qty, 0);
    assert.equal(line.SalesItemLineDetail.UnitPrice, 0);
  });

  test("builds one line per input, in order", async () => {
    const lines = await builders().buildSalesLines([{ amount: 1 }, { amount: 2 }, { amount: 3 }]);
    assert.deepEqual(lines.map((l) => l.Amount), [1, 2, 3]);
  });

  test("returns an empty array for no lines", async () => {
    assert.deepEqual(await builders().buildSalesLines([]), []);
  });
});

describe("buildAccountLines", () => {
  test("emits the AccountBasedExpenseLineDetail shape", async () => {
    const [line] = await builders().buildAccountLines([{ account: "Rent", amount: 500 }]);
    assert.deepEqual(line, {
      Amount: 500,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: { value: "3", name: "Rent" } },
    });
  });

  test("includes a description when supplied", async () => {
    const [line] = await builders().buildAccountLines([{ account: "Rent", amount: 500, description: "office" }]);
    assert.equal(line.Description, "office");
  });

  test("throws for an unknown account", async () => {
    await assert.rejects(
      () => builders().buildAccountLines([{ account: "Ghost", amount: 1 }]),
      /Account not found: "Ghost"/
    );
  });
});

describe("buildItemExpenseLines", () => {
  test("emits the ItemBasedExpenseLineDetail shape", async () => {
    const [line] = await builders().buildItemExpenseLines([{ item: "Bookkeeping", amount: 50 }]);
    assert.deepEqual(line, {
      Amount: 50,
      DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: { ItemRef: { value: "40", name: "Bookkeeping" } },
    });
  });

  test("carries quantity and unit price", async () => {
    const [line] = await builders().buildItemExpenseLines([
      { item: "Bookkeeping", amount: 50, quantity: 5, unit_price: 10 },
    ]);
    assert.equal(line.ItemBasedExpenseLineDetail.Qty, 5);
    assert.equal(line.ItemBasedExpenseLineDetail.UnitPrice, 10);
  });

  test("requires the item to exist", async () => {
    await assert.rejects(
      () => builders().buildItemExpenseLines([{ item: "Ghost", amount: 1 }]),
      /Item not found: "Ghost"/
    );
  });
});

describe("buildDepositLines", () => {
  test("emits the DepositLineDetail shape", async () => {
    const [line] = await builders().buildDepositLines([{ account: "Consulting Income", amount: 900 }]);
    assert.deepEqual(line, {
      Amount: 900,
      DetailType: "DepositLineDetail",
      DepositLineDetail: { AccountRef: { value: "2", name: "Consulting Income" } },
    });
  });

  test("attaches a resolved entity when supplied", async () => {
    const [line] = await builders().buildDepositLines([
      { account: "Consulting Income", amount: 900, entity_name: "Acme Corp", entity_type: "Customer" },
    ]);
    assert.deepEqual(line.DepositLineDetail.Entity, { value: "10", name: "Acme Corp" });
  });

  test("requires entity_type when entity_name is given", async () => {
    await assert.rejects(
      () => builders().buildDepositLines([
        { account: "Consulting Income", amount: 900, entity_name: "Acme Corp" },
      ]),
      /entity_type is required when entity_name is set on a deposit line/
    );
  });

  test("includes a description when supplied", async () => {
    const [line] = await builders().buildDepositLines([
      { account: "Consulting Income", amount: 900, description: "retainer" },
    ]);
    assert.equal(line.Description, "retainer");
  });
});
