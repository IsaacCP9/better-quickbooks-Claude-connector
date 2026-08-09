import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseCSV,
  detectColumns,
  parseAmount,
  pickFallbackAccount,
  categorizeRow,
  planImportRows,
  buildPurchaseBatchItems,
  chunk,
  QBO_BATCH_LIMIT,
} from "../src/lib/csv.js";

describe("parseCSV", () => {
  test("parses a simple grid", () => {
    assert.deepEqual(parseCSV("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  });

  test("returns no rows for empty input", () => {
    assert.deepEqual(parseCSV(""), []);
  });

  test("handles a trailing newline without emitting a blank row", () => {
    assert.deepEqual(parseCSV("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
  });

  test("handles CRLF line endings", () => {
    assert.deepEqual(parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  });

  test("handles bare CR line endings", () => {
    assert.deepEqual(parseCSV("a,b\r1,2"), [["a", "b"], ["1", "2"]]);
  });

  test("keeps commas that sit inside quotes", () => {
    assert.deepEqual(parseCSV('a,"b,c",d'), [["a", "b,c", "d"]]);
  });

  test("unescapes doubled quotes inside a quoted field", () => {
    assert.deepEqual(parseCSV('"say ""hi"""'), [['say "hi"']]);
  });

  test("keeps newlines inside a quoted field", () => {
    assert.deepEqual(parseCSV('"line1\nline2",x'), [["line1\nline2", "x"]]);
  });

  test("preserves empty trailing fields", () => {
    assert.deepEqual(parseCSV("a,,c"), [["a", "", "c"]]);
  });

  test("preserves leading whitespace inside fields", () => {
    assert.deepEqual(parseCSV("a, b"), [["a", " b"]]);
  });

  test("skips a blank line between records", () => {
    assert.deepEqual(parseCSV("a\n\nb"), [["a"], ["b"]]);
  });

  // The parser closes an unterminated quote at EOF rather than throwing. Pinned
  // because a truncated bank export should degrade, not crash the tool.
  test("closes an unterminated quoted field at end of input", () => {
    assert.deepEqual(parseCSV('a,"unterminated'), [["a", "unterminated"]]);
  });
});

describe("detectColumns", () => {
  test("finds the standard header trio", () => {
    assert.deepEqual(detectColumns(["Date", "Description", "Amount"]), {
      dateIdx: 0, descIdx: 1, amtIdx: 2,
    });
  });

  test("is case-insensitive and trims whitespace", () => {
    assert.deepEqual(detectColumns(["  DATE ", " desc ", "AMOUNT"]), {
      dateIdx: 0, descIdx: 1, amtIdx: 2,
    });
  });

  test("accepts substring variants for the date column", () => {
    assert.equal(detectColumns(["Posting Date", "Memo", "Amt"]).dateIdx, 0);
  });

  for (const alias of ["Description", "Memo", "Payee", "Name"]) {
    test(`accepts "${alias}" as the description column`, () => {
      assert.equal(detectColumns(["Date", alias, "Amount"]).descIdx, 1);
    });
  }

  for (const alias of ["Amount", "Debit", "amt"]) {
    test(`accepts "${alias}" as the amount column`, () => {
      assert.equal(detectColumns(["Date", "Memo", alias]).amtIdx, 2);
    });
  }

  test("returns -1 for a column it cannot find", () => {
    assert.deepEqual(detectColumns(["Foo", "Bar"]), {
      dateIdx: -1, descIdx: -1, amtIdx: -1,
    });
  });

  test("finds columns in any order", () => {
    assert.deepEqual(detectColumns(["Amount", "Payee", "Date"]), {
      dateIdx: 2, descIdx: 1, amtIdx: 0,
    });
  });

  // "amt" is matched exactly, unlike the others which are substring matches.
  test('matches "amt" only as a whole header', () => {
    assert.equal(detectColumns(["Date", "Memo", "amtx"]).amtIdx, -1);
  });
});

describe("parseAmount", () => {
  test("parses a plain number", () => {
    assert.equal(parseAmount("12.34"), 12.34);
  });

  test("strips a currency symbol", () => {
    assert.equal(parseAmount("$12.34"), 12.34);
  });

  test("strips thousands separators", () => {
    assert.equal(parseAmount("1,234.56"), 1234.56);
  });

  test("returns the magnitude of a negative amount", () => {
    assert.equal(parseAmount("-45.00"), 45);
  });

  test("handles parenthesised negatives as a magnitude", () => {
    assert.equal(parseAmount("(45.00)"), 45);
  });

  test("returns 0 for unparseable text", () => {
    assert.equal(parseAmount("n/a"), 0);
  });

  test("returns 0 for empty, null and undefined", () => {
    assert.equal(parseAmount(""), 0);
    assert.equal(parseAmount(null), 0);
    assert.equal(parseAmount(undefined), 0);
  });

  test("returns 0 rather than NaN for a lone minus sign", () => {
    assert.equal(parseAmount("-"), 0);
  });
});

describe("pickFallbackAccount", () => {
  test("prefers an account named Uncategorized, wherever it sits", () => {
    const accounts = [{ Name: "Rent", Id: "1" }, { Name: "Uncategorized Expense", Id: "9" }];
    assert.equal(pickFallbackAccount(accounts).Id, "9");
  });

  test("matches Uncategorized case-insensitively", () => {
    assert.equal(pickFallbackAccount([{ Name: "Rent", Id: "1" }, { Name: "UNCATEGORIZED", Id: "9" }]).Id, "9");
  });

  test("falls back to the first account when none is Uncategorized", () => {
    assert.equal(pickFallbackAccount([{ Name: "Rent", Id: "1" }, { Name: "Meals", Id: "2" }]).Id, "1");
  });

  test("returns undefined for an empty chart, so callers can error", () => {
    assert.equal(pickFallbackAccount([]), undefined);
  });
});

describe("categorizeRow", () => {
  const accounts = [
    { Name: "Office Supplies", Id: "10" },
    { Name: "Travel", Id: "11" },
  ];
  const fallback = { Name: "Uncategorized", Id: "99" };

  test("matches on the first word of an account name", () => {
    assert.equal(categorizeRow("OFFICE DEPOT #123", accounts, fallback).Id, "10");
  });

  test("is case-insensitive", () => {
    assert.equal(categorizeRow("weekend travel booking", accounts, fallback).Id, "11");
  });

  test("falls back when nothing matches", () => {
    assert.equal(categorizeRow("STARBUCKS", accounts, fallback).Id, "99");
  });

  test("returns the first match in chart order when several could match", () => {
    const both = [{ Name: "Travel", Id: "11" }, { Name: "Office", Id: "10" }];
    assert.equal(categorizeRow("office travel", both, fallback).Id, "11");
  });

  test("skips accounts with no Name", () => {
    assert.equal(categorizeRow("anything", [{ Id: "1" }], fallback).Id, "99");
  });

  // Regression guard: an account name with a leading space yields "" as its first
  // word, and "".includes() is true for every description — which would silently
  // claim every row. The categorizer must skip it and fall through.
  test("does not let a leading-space account name swallow every row", () => {
    const bad = [{ Name: " Leading Space", Id: "77" }, { Name: "Travel", Id: "11" }];
    assert.equal(categorizeRow("travel to NYC", bad, fallback).Id, "11");
    assert.equal(categorizeRow("totally unrelated", bad, fallback).Id, "99");
  });

  // Documents the crudeness of the rule: short first words over-match. This is
  // why import_transactions_from_csv has a dry_run.
  test("over-matches on short generic first words (known crudeness)", () => {
    const accounts2 = [{ Name: "IT Services", Id: "20" }];
    assert.equal(categorizeRow("DEPOSIT", accounts2, fallback).Id, "20");
  });
});

describe("planImportRows", () => {
  const columns = { dateIdx: 0, descIdx: 1, amtIdx: 2 };
  const accounts = [{ Name: "Travel", Id: "11" }];
  const fallback = { Name: "Uncategorized", Id: "99" };

  test("skips the header row", () => {
    const rows = [["Date", "Memo", "Amount"], ["2026-01-02", "Travel", "10.00"]];
    const planned = planImportRows({ rows, columns, accounts, fallback });
    assert.equal(planned.length, 1);
    assert.equal(planned[0].date, "2026-01-02");
  });

  test("maps description, amount and category", () => {
    const rows = [["Date", "Memo", "Amount"], ["2026-01-02", " Travel to NYC ", "$1,200.50"]];
    assert.deepEqual(planImportRows({ rows, columns, accounts, fallback })[0], {
      date: "2026-01-02",
      description: "Travel to NYC",
      amount: 1200.5,
      category: "Travel",
      category_id: "11",
    });
  });

  test("drops rows with a zero or unparseable amount", () => {
    const rows = [
      ["Date", "Memo", "Amount"],
      ["2026-01-02", "Zero", "0"],
      ["2026-01-03", "Junk", "n/a"],
      ["2026-01-04", "Good", "5"],
    ];
    const planned = planImportRows({ rows, columns, accounts, fallback });
    assert.deepEqual(planned.map((p) => p.description), ["Good"]);
  });

  test("drops rows too short to hold every detected column", () => {
    const rows = [["Date", "Memo", "Amount"], ["2026-01-02", "only two"]];
    assert.deepEqual(planImportRows({ rows, columns, accounts, fallback }), []);
  });

  test("returns an empty plan when there are no data rows", () => {
    assert.deepEqual(planImportRows({ rows: [["Date", "Memo", "Amount"]], columns, accounts, fallback }), []);
  });

  test("tolerates a missing date cell, leaving it blank for the caller to default", () => {
    const rows = [["Date", "Memo", "Amount"], ["", "Travel", "10"]];
    assert.equal(planImportRows({ rows, columns, accounts, fallback })[0].date, "");
  });

  test("respects non-contiguous column positions", () => {
    const rows = [["Amount", "x", "Date", "Memo"], ["10", "-", "2026-05-05", "Travel"]];
    const planned = planImportRows({
      rows, columns: { dateIdx: 2, descIdx: 3, amtIdx: 0 }, accounts, fallback,
    });
    assert.deepEqual(planned, [{
      date: "2026-05-05", description: "Travel", amount: 10, category: "Travel", category_id: "11",
    }]);
  });
});

describe("buildPurchaseBatchItems", () => {
  const bank = { Id: "5", Name: "Checking" };
  const planned = [{ date: "2026-01-02", description: "Travel", amount: 10, category: "Travel", category_id: "11" }];

  test("builds one create operation per planned row", () => {
    const items = buildPurchaseBatchItems(planned, bank, "2026-08-09");
    assert.equal(items.length, 1);
    assert.equal(items[0].operation, "create");
  });

  test("assigns sequential batch ids", () => {
    const many = [planned[0], planned[0], planned[0]];
    assert.deepEqual(
      buildPurchaseBatchItems(many, bank, "2026-08-09").map((i) => i.bId),
      ["bid0", "bid1", "bid2"]
    );
  });

  test("draws on the bank account and posts to the categorized account", () => {
    const [item] = buildPurchaseBatchItems(planned, bank, "2026-08-09");
    assert.deepEqual(item.Purchase.AccountRef, { value: "5", name: "Checking" });
    assert.deepEqual(
      item.Purchase.Line[0].AccountBasedExpenseLineDetail.AccountRef,
      { value: "11", name: "Travel" }
    );
    assert.equal(item.Purchase.Line[0].Amount, 10);
    assert.equal(item.Purchase.PaymentType, "Check");
  });

  test("uses the row date when present", () => {
    assert.equal(buildPurchaseBatchItems(planned, bank, "2026-08-09")[0].Purchase.TxnDate, "2026-01-02");
  });

  test("falls back to the supplied date when the row has none", () => {
    const undated = [{ ...planned[0], date: "" }];
    assert.equal(buildPurchaseBatchItems(undated, bank, "2026-08-09")[0].Purchase.TxnDate, "2026-08-09");
  });

  test("carries the description into PrivateNote", () => {
    assert.equal(buildPurchaseBatchItems(planned, bank, "2026-08-09")[0].Purchase.PrivateNote, "Travel");
  });
});

describe("chunk", () => {
  test("defaults to the QBO batch limit of 30", () => {
    assert.equal(QBO_BATCH_LIMIT, 30);
    const items = Array.from({ length: 61 }, (_, i) => i);
    assert.deepEqual(chunk(items).map((c) => c.length), [30, 30, 1]);
  });

  test("returns a single chunk when under the limit", () => {
    assert.deepEqual(chunk([1, 2, 3]), [[1, 2, 3]]);
  });

  test("returns no chunks for an empty list", () => {
    assert.deepEqual(chunk([]), []);
  });

  test("splits exactly at the boundary without a trailing empty chunk", () => {
    assert.deepEqual(chunk(Array.from({ length: 60 }, (_, i) => i)).length, 2);
  });

  test("honours a custom size", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  test("preserves order and loses nothing", () => {
    const items = Array.from({ length: 95 }, (_, i) => i);
    assert.deepEqual(chunk(items).flat(), items);
  });

  test("rejects a non-positive size instead of looping forever", () => {
    assert.throws(() => chunk([1, 2], 0), /positive/);
    assert.throws(() => chunk([1, 2], -1), /positive/);
  });
});
