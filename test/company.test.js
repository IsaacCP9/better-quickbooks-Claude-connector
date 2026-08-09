import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatCompanyList, createCompanyResolver } from "../src/lib/company.js";
import { fakeCompanies, sanitizeSlug } from "./helpers/fakes.js";

const ACME = { slug: "acme", realmId: "111", environment: "sandbox" };
const BETA = { slug: "beta", realmId: "222", environment: "production" };

// Build a resolver over a fixed company list and env.
function resolver(companies = [], env = {}) {
  const { listCompanies } = fakeCompanies(companies);
  return createCompanyResolver({ listCompanies, sanitizeSlug, env });
}

describe("formatCompanyList", () => {
  test("renders slug, environment and realm for each company", () => {
    assert.equal(formatCompanyList([ACME]), "acme (sandbox, realm 111)");
  });

  test("joins several companies with semicolons", () => {
    assert.equal(
      formatCompanyList([ACME, BETA]),
      "acme (sandbox, realm 111); beta (production, realm 222)"
    );
  });

  test("gives actionable guidance when nothing is authorized", () => {
    assert.match(formatCompanyList([]), /none — authorize one with/);
  });
});

describe("resolveCompany — precedence", () => {
  test("1. an explicit slug wins over the session and env defaults", async () => {
    const r = resolver([ACME, BETA], { QBO_COMPANY: "acme" });
    r.setSessionDefault("acme");
    assert.equal(await r.resolveCompany("beta"), "beta");
  });

  test("2. the session default is used when no explicit slug is given", async () => {
    const r = resolver([ACME, BETA], { QBO_COMPANY: "acme" });
    r.setSessionDefault("beta");
    assert.equal(await r.resolveCompany(), "beta");
  });

  test("3. env QBO_COMPANY is used when there is no session default", async () => {
    const r = resolver([ACME, BETA], { QBO_COMPANY: "beta" });
    assert.equal(await r.resolveCompany(), "beta");
  });

  test("4. a sole connected company is auto-picked for reads", async () => {
    assert.equal(await resolver([ACME]).resolveCompany(), "acme");
  });

  test("5. ambiguity is an error, never a guess", async () => {
    await assert.rejects(
      () => resolver([ACME, BETA]).resolveCompany(),
      /multiple companies are connected/
    );
  });

  test("the ambiguity error lists the available companies", async () => {
    await assert.rejects(() => resolver([ACME, BETA]).resolveCompany(), (e) => {
      assert.match(e.message, /acme \(sandbox, realm 111\)/);
      assert.match(e.message, /beta \(production, realm 222\)/);
      return true;
    });
  });
});

describe("resolveCompany — explicit slug validation", () => {
  test("rejects a slug that is not authorized", async () => {
    await assert.rejects(
      () => resolver([ACME]).resolveCompany("nope"),
      /No such company "nope"/
    );
  });

  test("the rejection lists what is available", async () => {
    await assert.rejects(
      () => resolver([ACME]).resolveCompany("nope"),
      /Available: acme \(sandbox, realm 111\)/
    );
  });

  test("treats an empty or whitespace-only slug as 'not supplied'", async () => {
    const r = resolver([ACME]);
    assert.equal(await r.resolveCompany(""), "acme");
    assert.equal(await r.resolveCompany("   "), "acme");
  });

  test("treats null and undefined as 'not supplied'", async () => {
    const r = resolver([ACME]);
    assert.equal(await r.resolveCompany(null), "acme");
    assert.equal(await r.resolveCompany(undefined), "acme");
  });
});

describe("resolveCompany — the write gate", () => {
  test("refuses to auto-pick a sole company for a write", async () => {
    await assert.rejects(
      () => resolver([ACME]).resolveCompany(undefined, { write: true }),
      /I won't guess which company to post a write to/
    );
  });

  test("still allows an explicit slug for a write", async () => {
    assert.equal(await resolver([ACME]).resolveCompany("acme", { write: true }), "acme");
  });

  test("still honours the session default for a write", async () => {
    const r = resolver([ACME, BETA]);
    r.setSessionDefault("beta");
    assert.equal(await r.resolveCompany(undefined, { write: true }), "beta");
  });

  test("still honours the env default for a write", async () => {
    const r = resolver([ACME, BETA], { QBO_COMPANY: "acme" });
    assert.equal(await r.resolveCompany(undefined, { write: true }), "acme");
  });

  test("refuses ambiguity for a write, with the write-specific message", async () => {
    await assert.rejects(
      () => resolver([ACME, BETA]).resolveCompany(undefined, { write: true }),
      /I won't guess which company to post a write to/
    );
  });

  // ---------------------------------------------------------------------------
  // KNOWN GAP — pinned deliberately, not endorsed.
  //
  // listCompanies() skips the legacy `tokens.json` filename, so a single-company
  // install created by a bare `npm run connect` produces an EMPTY company list.
  // resolveCompany returns "" for that case before the write check runs, so
  // writes post with no company named. This is documented in SECURITY.md →
  // Known limitations. The test exists so that fixing it is a deliberate change
  // that turns this test red, rather than something that silently regresses.
  // ---------------------------------------------------------------------------
  test("KNOWN GAP: an empty company list bypasses the write gate entirely", async () => {
    const resolved = await resolver([]).resolveCompany(undefined, { write: true });
    assert.equal(resolved, "", "legacy tokens.json installs resolve to the empty slug");
  });

  test("KNOWN GAP: the same empty-list path applies to reads", async () => {
    assert.equal(await resolver([]).resolveCompany(), "");
  });
});

describe("resolveCompany — slug sanitization", () => {
  // KNOWN GAP: sanitizeSlug strips unexpected characters instead of rejecting,
  // so a near-miss can resolve to a real, different company. Pinned for the same
  // reason as above — see SECURITY.md → Known limitations.
  test("KNOWN GAP: input that strips down to a real slug is silently accepted", async () => {
    // Each of these is NOT the name of any authorized company, but collapses to
    // "acme" once the disallowed characters are removed — and is then accepted
    // against the real acme company with no warning that the input was rewritten.
    for (const input of ["a c m e", "acme!", "acme.", "$acme$", "a/c/m/e"]) {
      assert.equal(
        await resolver([ACME]).resolveCompany(input),
        "acme",
        `${input} should have silently resolved to acme`
      );
    }
  });

  test("stripping that does NOT collide is still rejected", async () => {
    // "acme/prod" collapses to "acmeprod", which matches nothing.
    await assert.rejects(
      () => resolver([ACME]).resolveCompany("acme/prod"),
      /No such company "acme\/prod"/
    );
  });

  test("slug matching is case-sensitive", async () => {
    await assert.rejects(() => resolver([ACME]).resolveCompany("ACME"), /No such company "ACME"/);
  });

  test("cannot escape to a path outside the authorized set", async () => {
    // "../../etc/passwd" sanitizes to "etcpasswd", which is not authorized.
    await assert.rejects(
      () => resolver([ACME]).resolveCompany("../../etc/passwd"),
      /No such company/
    );
  });

  test("the error message quotes the raw input, not the sanitized form", async () => {
    await assert.rejects(
      () => resolver([ACME]).resolveCompany("bad!!slug"),
      /No such company "bad!!slug"/
    );
  });
});

describe("session default", () => {
  test("starts unset", () => {
    assert.equal(resolver([ACME]).getSessionDefault(), null);
  });

  test("setSessionDefault stores and returns the slug", () => {
    const r = resolver([ACME]);
    assert.equal(r.setSessionDefault("acme"), "acme");
    assert.equal(r.getSessionDefault(), "acme");
  });

  test("is per-resolver, not shared global state", () => {
    const a = resolver([ACME]);
    const b = resolver([ACME]);
    a.setSessionDefault("acme");
    assert.equal(b.getSessionDefault(), null);
  });

  test("can be overwritten", () => {
    const r = resolver([ACME, BETA]);
    r.setSessionDefault("acme");
    r.setSessionDefault("beta");
    assert.equal(r.getSessionDefault(), "beta");
  });
});

describe("envDefaultCompany", () => {
  test("returns the sanitized QBO_COMPANY value", () => {
    assert.equal(resolver([], { QBO_COMPANY: "acme!" }).envDefaultCompany(), "acme");
  });

  test("returns an empty string when QBO_COMPANY is unset", () => {
    assert.equal(resolver([], {}).envDefaultCompany(), "");
  });

  test("reads env lazily, so a later change is picked up", async () => {
    const env = {};
    const r = resolver([ACME, BETA], env);
    env.QBO_COMPANY = "beta";
    assert.equal(await r.resolveCompany(), "beta");
  });
});
