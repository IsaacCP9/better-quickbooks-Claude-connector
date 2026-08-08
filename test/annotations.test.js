// Regression guard on the tool classification.
//
// Claude Desktop's tool-permission screen relies entirely on the MCP annotations
// attached in defineTool(). If a new tool is registered without going through it,
// or a write lands in READ_ONLY_TOOLS, that screen quietly starts lying about
// which tools can move money. These tests make that a build failure.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");
const source = await readFile(SRC, "utf8");

const { registeredTools, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS } = await import("../src/index.js");

describe("registration", () => {
  test("no tool bypasses defineTool", () => {
    const bare = source.split("\n")
      .map((line, i) => [line, i + 1])
      .filter(([line]) => /^\s*server\.tool\(/.test(line));
    assert.deepEqual(bare, [],
      "register tools with defineTool() so they get MCP annotations, not server.tool()");
  });

  test("every registered tool carries a classification", () => {
    assert.ok(registeredTools.length > 0);
    for (const t of registeredTools) {
      assert.equal(typeof t.readOnly, "boolean", `${t.name} has no readOnly flag`);
      assert.equal(typeof t.destructive, "boolean", `${t.name} has no destructive flag`);
    }
  });

  test("the classification sets contain no names that don't exist", () => {
    // Catches a rename that silently demotes a write tool to unclassified.
    const names = new Set(registeredTools.map((t) => t.name));
    const stale = [...READ_ONLY_TOOLS, ...DESTRUCTIVE_TOOLS].filter((n) => !names.has(n));
    assert.deepEqual(stale, []);
  });

  test("tool names are unique", () => {
    const names = registeredTools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe("classification", () => {
  test("a read-only tool is never also destructive", () => {
    const bad = registeredTools.filter((t) => t.readOnly && t.destructive);
    assert.deepEqual(bad.map((t) => t.name), []);
  });

  test("anything that writes to the books is not marked read-only", () => {
    // Belt and braces against a create_/update_/void_/send_ tool being added to
    // READ_ONLY_TOOLS by mistake.
    const mislabelled = registeredTools
      .filter((t) => t.readOnly && /^(create|update|void|send|delete|import|attach)_/.test(t.name))
      .map((t) => t.name);
    assert.deepEqual(mislabelled, []);
  });

  test("the three tools with reach beyond QuickBooks are flagged destructive", () => {
    // attach_file reads any local file and uploads it; import_transactions_from_csv
    // reads any local file and bulk-posts; api_request's POST reaches
    // ?operation=delete. All three must surface as destructive in the UI.
    for (const name of ["attach_file", "import_transactions_from_csv", "api_request"]) {
      const t = registeredTools.find((x) => x.name === name);
      assert.ok(t, `${name} is no longer registered`);
      assert.equal(t.readOnly, false, `${name} must not be read-only`);
      assert.equal(t.destructive, true, `${name} must be marked destructive`);
    }
  });

  test("reports and lookups are read-only", () => {
    for (const name of ["get_profit_and_loss", "get_balance_sheet", "query", "list_companies"]) {
      const t = registeredTools.find((x) => x.name === name);
      assert.ok(t, `${name} is no longer registered`);
      assert.equal(t.readOnly, true, `${name} should be read-only`);
    }
  });
});
