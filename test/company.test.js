// The company-resolution gate — the thing standing between a write and the wrong
// client's books. Exercised against temp token files via QBO_DATA_DIR.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qbo-company-"));
  process.env.QBO_DATA_DIR = dir;
  delete process.env.QBO_COMPANY;
});
after(async () => {
  delete process.env.QBO_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const f of await readdir(dir)) await unlink(path.join(dir, f));
  delete process.env.QBO_COMPANY;
});

const addCompany = (slug, realmId, environment = "sandbox") =>
  writeFile(path.join(dir, `tokens.${slug}.json`), JSON.stringify({ realmId, environment }));

const { resolveCompany, writeBanner, callContext } = await import("../src/index.js");

describe("resolveCompany", () => {
  test("an explicit slug wins, and is validated against what's authorized", async () => {
    await addCompany("aaa", "1");
    await addCompany("bbb", "2");
    assert.equal(await resolveCompany("bbb"), "bbb");
    assert.equal(await resolveCompany("bbb", { write: true }), "bbb");
  });

  test("rejects a company that isn't authorized, and names the real ones", async () => {
    await addCompany("aaa", "1");
    await assert.rejects(
      () => resolveCompany("nope"),
      (e) => e.message.includes('No such company "nope"') && e.message.includes("aaa"),
    );
  });

  test("falls back to env QBO_COMPANY when no slug is passed", async () => {
    await addCompany("aaa", "1");
    await addCompany("bbb", "2");
    process.env.QBO_COMPANY = "bbb";
    assert.equal(await resolveCompany(undefined), "bbb");
    assert.equal(await resolveCompany(undefined, { write: true }), "bbb");
  });

  test("a lone company is assumed for reads", async () => {
    await addCompany("only", "1");
    assert.equal(await resolveCompany(undefined), "only");
  });

  test("a lone company is NOT assumed for writes", async () => {
    // The whole point of the write gate: convenience for reads, never for writes.
    await addCompany("only", "1");
    await assert.rejects(
      () => resolveCompany(undefined, { write: true }),
      (e) => e.message.includes("I won't guess which company to post a write to"),
    );
  });

  test("refuses to guess between several companies, for reads or writes", async () => {
    await addCompany("aaa", "1");
    await addCompany("bbb", "2");
    await assert.rejects(() => resolveCompany(undefined), /No company selected/);
    await assert.rejects(() => resolveCompany(undefined, { write: true }), /No company selected/);
  });

  test("with nothing authorized, resolves to the legacy default token file", async () => {
    assert.equal(await resolveCompany(undefined), "");
    assert.equal(await resolveCompany(undefined, { write: true }), "");
  });

  test("publishes the settled company into the call context", async () => {
    // This is what feeds the write banner; if it stops firing the banner silently
    // disappears and a wrong-company write becomes invisible again.
    await addCompany("aaa", "1");
    const store = { company: undefined };
    await callContext.run(store, () => resolveCompany("aaa", { write: true }));
    assert.equal(store.company, "aaa");
  });

  test("publishes nothing when resolution fails", async () => {
    await addCompany("aaa", "1");
    const store = { company: undefined };
    await callContext.run(store, async () => {
      await assert.rejects(() => resolveCompany("ghost", { write: true }));
    });
    assert.equal(store.company, undefined);
  });
});

describe("writeBanner", () => {
  test("names the company, realm and environment", async () => {
    await addCompany("aaa", "12345", "sandbox");
    const banner = await writeBanner("aaa");
    assert.match(banner, /aaa/);
    assert.match(banner, /12345/);
    assert.match(banner, /test company/);
  });

  test("shouts about production", async () => {
    await addCompany("real", "99", "production");
    const banner = await writeBanner("real");
    assert.match(banner, /PRODUCTION/);
    assert.match(banner, /real books/);
  });

  test("still says something useful for the legacy default file", async () => {
    assert.match(await writeBanner(""), /legacy default/);
  });
});
