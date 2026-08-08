// Token storage, slug safety, and API host selection.
// No network: every test drives the on-disk side of src/qbo.js against a temp
// QBO_DATA_DIR so nothing touches the real tokens.*.json files.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qbo-test-"));
  process.env.QBO_DATA_DIR = dir;
});
after(async () => {
  delete process.env.QBO_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const qbo = await import("../src/qbo.js");

describe("sanitizeSlug", () => {
  test("strips anything that isn't a safe filename fragment", () => {
    assert.equal(qbo.sanitizeSlug("8315"), "8315");
    assert.equal(qbo.sanitizeSlug("acme-corp_2"), "acme-corp_2");
    assert.equal(qbo.sanitizeSlug("  padded  "), "padded");
  });

  test("cannot escape the data directory", () => {
    // The slug is interpolated into a filename, so traversal is the thing to stop.
    for (const evil of ["../../etc/passwd", "..", "/etc/passwd", "a/../../b", "a\\..\\b"]) {
      const slug = qbo.sanitizeSlug(evil);
      assert.ok(!slug.includes("/"), `slug kept a slash: ${slug}`);
      assert.ok(!slug.includes("\\"), `slug kept a backslash: ${slug}`);
      assert.ok(!slug.includes(".."), `slug kept a traversal: ${slug}`);
      const resolved = path.resolve(qbo.tokensPathFor(evil));
      assert.equal(path.dirname(resolved), path.resolve(dir));
    }
  });

  test("empty slug maps to the legacy tokens.json", () => {
    assert.equal(path.basename(qbo.tokensPathFor("")), "tokens.json");
    assert.equal(path.basename(qbo.tokensPathFor("8315")), "tokens.8315.json");
  });
});

describe("apiBaseFor", () => {
  test("routes production and sandbox to different hosts", () => {
    assert.equal(qbo.apiBaseFor("production"), "https://quickbooks.api.intuit.com");
    assert.equal(qbo.apiBaseFor("PRODUCTION"), "https://quickbooks.api.intuit.com");
    assert.equal(qbo.apiBaseFor("sandbox"), "https://sandbox-quickbooks.api.intuit.com");
    // Anything unrecognised must fall back to sandbox, never production.
    assert.equal(qbo.apiBaseFor(undefined), "https://sandbox-quickbooks.api.intuit.com");
    assert.equal(qbo.apiBaseFor("typo"), "https://sandbox-quickbooks.api.intuit.com");
  });
});

describe("saveTokens", () => {
  const bundle = {
    access_token: "at", refresh_token: "rt", realmId: "123", environment: "sandbox",
    expires_at: 1, refresh_expires_at: 2,
  };

  test("writes owner-only permissions (0600)", { skip: process.platform === "win32" }, async () => {
    await qbo.saveTokens("permtest", bundle);
    const s = await stat(qbo.tokensPathFor("permtest"));
    assert.equal(s.mode & 0o777, 0o600, "a live refresh token must not be readable by other local users");
  });

  test("re-tightens permissions when replacing a world-readable file", { skip: process.platform === "win32" }, async () => {
    const p = qbo.tokensPathFor("looseperm");
    await writeFile(p, "{}", { mode: 0o644 });
    await qbo.saveTokens("looseperm", bundle);
    const s = await stat(p);
    assert.equal(s.mode & 0o777, 0o600);
  });

  test("round-trips through loadTokens", async () => {
    await qbo.saveTokens("roundtrip", bundle);
    assert.deepEqual(await qbo.loadTokens("roundtrip"), bundle);
  });

  test("leaves no temp files behind", async () => {
    await qbo.saveTokens("clean", bundle);
    const { readdir } = await import("node:fs/promises");
    assert.equal((await readdir(dir)).filter((f) => f.includes(".tmp-")).length, 0);
  });

  test("never leaves a truncated file in place of a good one", async () => {
    // The failure this guards: a plain writeFile that dies mid-write truncates the
    // file, loadTokens swallows the parse error, and the refresh token is gone.
    // An atomic write means the old bundle survives a failed save.
    await qbo.saveTokens("atomic", bundle);
    const before = await readFile(qbo.tokensPathFor("atomic"), "utf8");

    const circular = { ...bundle };
    circular.self = circular; // JSON.stringify throws
    await assert.rejects(() => qbo.saveTokens("atomic", circular));

    assert.equal(await readFile(qbo.tokensPathFor("atomic"), "utf8"), before);
    assert.deepEqual(await qbo.loadTokens("atomic"), bundle);
  });
});

describe("listCompanies", () => {
  test("reads from QBO_DATA_DIR, skipping the legacy file and partial writes", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "qbo-list-"));
    const prev = process.env.QBO_DATA_DIR;
    process.env.QBO_DATA_DIR = d;
    try {
      await writeFile(path.join(d, "tokens.aaa.json"),
        JSON.stringify({ realmId: "1", environment: "sandbox" }));
      await writeFile(path.join(d, "tokens.bbb.json"),
        JSON.stringify({ realmId: "2", environment: "production" }));
      await writeFile(path.join(d, "tokens.json"),
        JSON.stringify({ realmId: "9", environment: "sandbox" }));
      await writeFile(path.join(d, "tokens.ccc.json.tmp-1-ab"), "partial");
      await writeFile(path.join(d, "tokens.corrupt.json"), "{not json");

      const got = await qbo.listCompanies();
      assert.deepEqual(got.map((c) => c.slug), ["aaa", "bbb"]);
      assert.equal(got.find((c) => c.slug === "bbb").environment, "production");
    } finally {
      process.env.QBO_DATA_DIR = prev;
      await rm(d, { recursive: true, force: true });
    }
  });

  test("returns empty for a missing directory rather than throwing", async () => {
    const prev = process.env.QBO_DATA_DIR;
    process.env.QBO_DATA_DIR = path.join(tmpdir(), "qbo-does-not-exist-" + Date.now());
    try {
      assert.deepEqual(await qbo.listCompanies(), []);
    } finally {
      process.env.QBO_DATA_DIR = prev;
    }
  });
});

describe("deriveSlugFromRealm", () => {
  test("uses the last 4 digits, extending on collision", () => {
    assert.equal(qbo.deriveSlugFromRealm("9341452938315"), "8315");
    assert.equal(qbo.deriveSlugFromRealm("9341452938315", new Set(["8315"])), "38315");
    assert.equal(qbo.deriveSlugFromRealm("9341452938315", new Set(["8315", "38315"])), "938315");
  });
});
