import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  todayISO,
  asText,
  asError,
  OPZER_HELP,
  tool,
  esc,
  reportQuery,
  guessContentType,
} from "../src/lib/format.js";
import { spyLog } from "./helpers/fakes.js";

describe("asText", () => {
  test("passes a string through verbatim", () => {
    assert.deepEqual(asText("hello"), { content: [{ type: "text", text: "hello" }] });
  });

  test("pretty-prints objects with 2-space indent", () => {
    assert.equal(asText({ a: 1 }).content[0].text, '{\n  "a": 1\n}');
  });

  test("does not set isError on success", () => {
    assert.equal(asText({}).isError, undefined);
  });

  test("serializes arrays and null", () => {
    assert.equal(asText([1, 2]).content[0].text, "[\n  1,\n  2\n]");
    assert.equal(asText(null).content[0].text, "null");
  });
});

describe("asError", () => {
  test("marks the response as an error", () => {
    assert.equal(asError("boom").isError, true);
  });

  test("prefixes the message and appends the Opzer help text", () => {
    const text = asError("boom").content[0].text;
    assert.match(text, /^Error: boom/);
    assert.ok(text.endsWith(OPZER_HELP), "help text should be appended");
  });
});

describe("tool wrapper", () => {
  test("returns the handler result untouched on success", async () => {
    const wrapped = tool(async (args) => asText(args));
    assert.deepEqual(await wrapped({ x: 1 }), asText({ x: 1 }));
  });

  test("converts a thrown error into an isError response instead of rejecting", async () => {
    const log = spyLog();
    const wrapped = tool(async () => { throw new Error("kaboom"); }, { log });
    const res = await wrapped({});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Error: kaboom/);
  });

  test("logs the failure message", async () => {
    const log = spyLog();
    await tool(async () => { throw new Error("kaboom"); }, { log })({});
    assert.deepEqual(log.lines, ["tool error: kaboom"]);
  });

  test("substitutes {} when called with no arguments", async () => {
    let seen;
    await tool(async (args) => { seen = args; return asText("ok"); })();
    assert.deepEqual(seen, {});
  });

  test("substitutes {} when called with null", async () => {
    let seen;
    await tool(async (args) => { seen = args; return asText("ok"); })(null);
    assert.deepEqual(seen, {});
  });

  test("catches synchronous throws too", async () => {
    const log = spyLog();
    const res = await tool(() => { throw new Error("sync"); }, { log })({});
    assert.equal(res.isError, true);
  });
});

describe("esc", () => {
  test("leaves ordinary values alone", () => {
    assert.equal(esc("Acme Corp"), "Acme Corp");
  });

  test("backslash-escapes single quotes", () => {
    assert.equal(esc("O'Brien"), "O\\'Brien");
  });

  test("escapes every quote, not just the first", () => {
    assert.equal(esc("a'b'c"), "a\\'b\\'c");
  });

  test("coerces non-strings", () => {
    assert.equal(esc(42), "42");
    assert.equal(esc(null), "null");
    assert.equal(esc(undefined), "undefined");
  });

  // Documents a real limitation rather than asserting safety: a lone backslash is
  // NOT escaped, so a crafted value can still terminate the quoted literal. The
  // QBO query language is SELECT-only, so the consequence is a malformed or
  // over-broad read, not a mutation. Prefer Ids over names on untrusted input.
  test("does NOT escape backslashes (known limitation)", () => {
    assert.equal(esc("a\\'b"), "a\\\\'b");
  });
});

describe("reportQuery", () => {
  test("returns an empty string when every param is empty", () => {
    assert.equal(reportQuery({ a: null, b: undefined, c: "" }), "");
  });

  test("builds a leading-? query string", () => {
    assert.equal(reportQuery({ start_date: "2026-01-01" }), "?start_date=2026-01-01");
  });

  test("joins multiple params with &", () => {
    assert.equal(
      reportQuery({ start_date: "2026-01-01", end_date: "2026-03-31" }),
      "?start_date=2026-01-01&end_date=2026-03-31"
    );
  });

  test("drops empty params but keeps the rest", () => {
    assert.equal(reportQuery({ a: "1", b: "", c: null, d: "2" }), "?a=1&d=2");
  });

  test("url-encodes values", () => {
    assert.equal(reportQuery({ q: "a b&c=d" }), "?q=a%20b%26c%3Dd");
  });

  test("keeps 0 and false, which are not empty", () => {
    assert.equal(reportQuery({ n: 0, f: false }), "?n=0&f=false");
  });
});

describe("guessContentType", () => {
  for (const [name, expected] of [
    ["a.pdf", "application/pdf"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.csv", "text/csv"],
    ["a.txt", "text/plain"],
    ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ]) {
    test(`maps ${name}`, () => assert.equal(guessContentType(name), expected));
  }

  test("is case-insensitive on the extension", () => {
    assert.equal(guessContentType("SCAN.PDF"), "application/pdf");
  });

  test("uses the last extension for multi-dot names", () => {
    assert.equal(guessContentType("archive.tar.csv"), "text/csv");
  });

  test("falls back to octet-stream for unknown extensions", () => {
    assert.equal(guessContentType("a.xyz"), "application/octet-stream");
  });

  test("falls back to octet-stream when there is no extension", () => {
    assert.equal(guessContentType("README"), "application/octet-stream");
  });
});

describe("todayISO", () => {
  test("returns a bare YYYY-MM-DD date", () => {
    assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test("agrees with the current UTC date", () => {
    assert.equal(todayISO(), new Date().toISOString().slice(0, 10));
  });
});
