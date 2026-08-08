// Pure helpers in src/index.js — CSV parsing, query building, content types, escaping.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { parseCSV, reportQuery, guessContentType, esc } = await import("../src/index.js");

describe("parseCSV", () => {
  test("parses a plain table", () => {
    assert.deepEqual(parseCSV("date,desc,amount\n2026-01-01,Coffee,4.50"), [
      ["date", "desc", "amount"],
      ["2026-01-01", "Coffee", "4.50"],
    ]);
  });

  test("keeps commas inside quoted fields", () => {
    // Bank exports are full of these; splitting on ',' would shift every column.
    assert.deepEqual(parseCSV('a,b\n"Smith, John",10'), [
      ["a", "b"],
      ["Smith, John", "10"],
    ]);
  });

  test("unescapes doubled quotes", () => {
    assert.deepEqual(parseCSV('a\n"He said ""hi"""'), [["a"], ['He said "hi"']]);
  });

  test("handles CRLF line endings", () => {
    assert.deepEqual(parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  });

  test("keeps ragged rows rather than dropping them", () => {
    assert.deepEqual(parseCSV("a,b,c\n1,2"), [["a", "b", "c"], ["1", "2"]]);
  });

  test("returns nothing for empty input", () => {
    assert.deepEqual(parseCSV(""), []);
  });
});

describe("reportQuery", () => {
  test("drops null and empty params", () => {
    assert.equal(
      reportQuery({ start_date: "2026-01-01", end_date: null, customer: "" }),
      "?start_date=2026-01-01",
    );
  });

  test("returns an empty string when everything is dropped", () => {
    assert.equal(reportQuery({ a: null, b: "" }), "");
  });

  test("url-encodes values", () => {
    assert.equal(reportQuery({ name: "A & B" }), "?name=A%20%26%20B");
  });
});

describe("guessContentType", () => {
  test("maps known extensions", () => {
    assert.equal(guessContentType("invoice.pdf"), "application/pdf");
    assert.equal(guessContentType("scan.JPEG"), "image/jpeg");
    assert.equal(guessContentType("ledger.csv"), "text/csv");
  });

  test("falls back to octet-stream for anything unknown", () => {
    // Worth pinning: this is a convenience map, NOT an allowlist — an unknown
    // extension is uploaded anyway. See DEVELOPER.md "Powerful tools".
    assert.equal(guessContentType("id_rsa"), "application/octet-stream");
    assert.equal(guessContentType("tokens.8315.json"), "application/octet-stream");
  });
});

describe("esc", () => {
  test("escapes single quotes so a name can't break out of a QBO query", () => {
    assert.equal(esc("O'Brien"), "O\\'Brien");
    assert.equal(esc("plain"), "plain");
  });
});
