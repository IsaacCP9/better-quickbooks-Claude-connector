import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  companyArg,
  journalLineSchema,
  salesLineSchema,
  accountLineSchema,
  itemLineSchema,
  depositLineSchema,
} from "../src/lib/schemas.js";

describe("companyArg", () => {
  test("accepts a slug", () => {
    assert.equal(companyArg.parse("acme"), "acme");
  });

  test("is optional", () => {
    assert.equal(companyArg.parse(undefined), undefined);
  });

  test("rejects a non-string", () => {
    assert.equal(companyArg.safeParse(123).success, false);
  });

  test("carries a description for the model to read", () => {
    assert.match(companyArg.description, /list_companies/);
  });
});

describe("journalLineSchema", () => {
  const valid = { account: "Rent", amount: 500, posting_type: "Debit" };

  test("accepts a minimal valid line", () => {
    assert.deepEqual(journalLineSchema.parse(valid), valid);
  });

  test("requires account, amount and posting_type", () => {
    for (const key of ["account", "amount", "posting_type"]) {
      const partial = { ...valid };
      delete partial[key];
      assert.equal(journalLineSchema.safeParse(partial).success, false, `${key} should be required`);
    }
  });

  test("restricts posting_type to Debit or Credit", () => {
    assert.equal(journalLineSchema.safeParse({ ...valid, posting_type: "Credit" }).success, true);
    assert.equal(journalLineSchema.safeParse({ ...valid, posting_type: "debit" }).success, false);
    assert.equal(journalLineSchema.safeParse({ ...valid, posting_type: "Both" }).success, false);
  });

  // Direction is carried by posting_type, so a signed amount would be ambiguous.
  test("requires a positive amount", () => {
    assert.equal(journalLineSchema.safeParse({ ...valid, amount: 0 }).success, false);
    assert.equal(journalLineSchema.safeParse({ ...valid, amount: -5 }).success, false);
  });

  test("accepts optional description and entity fields", () => {
    const parsed = journalLineSchema.parse({
      ...valid, description: "memo", entity_name: "Acme", entity_type: "Customer",
    });
    assert.equal(parsed.entity_type, "Customer");
  });

  test("restricts entity_type to Customer, Vendor or Employee", () => {
    for (const t of ["Customer", "Vendor", "Employee"]) {
      assert.equal(journalLineSchema.safeParse({ ...valid, entity_type: t }).success, true);
    }
    assert.equal(journalLineSchema.safeParse({ ...valid, entity_type: "Supplier" }).success, false);
  });

  // The entity_name/entity_type pairing is enforced in buildJournalLines rather
  // than the schema, so the schema alone accepts a lone entity_name.
  test("does not enforce the entity_name/entity_type pairing (done in builders)", () => {
    assert.equal(journalLineSchema.safeParse({ ...valid, entity_name: "Acme" }).success, true);
  });
});

describe("salesLineSchema", () => {
  test("requires only an amount", () => {
    assert.deepEqual(salesLineSchema.parse({ amount: 100 }), { amount: 100 });
  });

  test("accepts item, description, quantity and unit_price", () => {
    const line = { amount: 100, item: "Bookkeeping", description: "d", quantity: 2, unit_price: 50 };
    assert.deepEqual(salesLineSchema.parse(line), line);
  });

  test("rejects a missing amount", () => {
    assert.equal(salesLineSchema.safeParse({ item: "x" }).success, false);
  });

  test("rejects a non-numeric amount", () => {
    assert.equal(salesLineSchema.safeParse({ amount: "100" }).success, false);
  });

  // Unlike journal lines, sales lines allow zero and negative amounts — QBO uses
  // negative sales lines for discounts.
  test("allows zero and negative amounts", () => {
    assert.equal(salesLineSchema.safeParse({ amount: 0 }).success, true);
    assert.equal(salesLineSchema.safeParse({ amount: -10 }).success, true);
  });
});

describe("accountLineSchema", () => {
  test("requires account and amount", () => {
    assert.deepEqual(accountLineSchema.parse({ account: "Rent", amount: 5 }), { account: "Rent", amount: 5 });
    assert.equal(accountLineSchema.safeParse({ amount: 5 }).success, false);
    assert.equal(accountLineSchema.safeParse({ account: "Rent" }).success, false);
  });

  test("accepts an optional description", () => {
    assert.equal(accountLineSchema.parse({ account: "Rent", amount: 5, description: "d" }).description, "d");
  });
});

describe("itemLineSchema", () => {
  test("requires item and amount", () => {
    assert.equal(itemLineSchema.safeParse({ item: "Bookkeeping", amount: 5 }).success, true);
    assert.equal(itemLineSchema.safeParse({ amount: 5 }).success, false);
  });

  test("accepts quantity, unit_price and description", () => {
    const line = { item: "Bookkeeping", amount: 5, quantity: 1, unit_price: 5, description: "d" };
    assert.deepEqual(itemLineSchema.parse(line), line);
  });
});

describe("depositLineSchema", () => {
  test("requires account and amount", () => {
    assert.equal(depositLineSchema.safeParse({ account: "Income", amount: 5 }).success, true);
    assert.equal(depositLineSchema.safeParse({ account: "Income" }).success, false);
  });

  test("accepts entity fields with a restricted entity_type", () => {
    assert.equal(
      depositLineSchema.safeParse({ account: "Income", amount: 5, entity_name: "Acme", entity_type: "Customer" }).success,
      true
    );
    assert.equal(
      depositLineSchema.safeParse({ account: "Income", amount: 5, entity_type: "Supplier" }).success,
      false
    );
  });
});
