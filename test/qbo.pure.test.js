import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeSlug,
  apiBaseFor,
  basicAuthHeader,
  connectEnvironment,
  credentials,
  deriveSlugFromRealm,
  MINOR_VERSION,
  AUTHORIZE_URL,
  TOKEN_URL,
  SCOPE,
} from "../src/qbo.js";

describe("sanitizeSlug", () => {
  test("leaves a safe slug untouched", () => {
    assert.equal(sanitizeSlug("acme-1_2"), "acme-1_2");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(sanitizeSlug("  acme  "), "acme");
  });

  test("strips characters outside [A-Za-z0-9_-]", () => {
    assert.equal(sanitizeSlug("acme corp!"), "acmecorp");
  });

  test("preserves case", () => {
    assert.equal(sanitizeSlug("AcMe"), "AcMe");
  });

  test("returns an empty string for null and undefined", () => {
    assert.equal(sanitizeSlug(null), "");
    assert.equal(sanitizeSlug(undefined), "");
    assert.equal(sanitizeSlug(""), "");
  });

  test("coerces numbers", () => {
    assert.equal(sanitizeSlug(8315), "8315");
  });

  // The security property this function exists for: no path separators, no dot
  // segments, so a slug can never escape the tokens directory.
  test("removes path separators and dot segments", () => {
    assert.equal(sanitizeSlug("../../etc/passwd"), "etcpasswd");
    assert.equal(sanitizeSlug("..\\..\\windows"), "windows");
    assert.equal(sanitizeSlug("/absolute/path"), "absolutepath");
    assert.equal(sanitizeSlug("a/../b"), "ab");
  });

  test("removes a NUL byte", () => {
    assert.equal(sanitizeSlug("acme\u0000.json"), "acmejson");
  });

  test("strips characters rather than rejecting them (documented behaviour)", () => {
    // This is the lossiness behind the SECURITY.md known limitation: distinct
    // inputs can collapse to the same slug.
    assert.equal(sanitizeSlug("a c m e"), sanitizeSlug("acme!"));
  });
});

describe("apiBaseFor", () => {
  test("routes production to the live host", () => {
    assert.equal(apiBaseFor("production"), "https://quickbooks.api.intuit.com");
  });

  test("routes sandbox to the sandbox host", () => {
    assert.equal(apiBaseFor("sandbox"), "https://sandbox-quickbooks.api.intuit.com");
  });

  test("is case-insensitive for production", () => {
    assert.equal(apiBaseFor("PRODUCTION"), "https://quickbooks.api.intuit.com");
    assert.equal(apiBaseFor("Production"), "https://quickbooks.api.intuit.com");
  });

  // Fail safe: anything unrecognised must NOT reach live books.
  test("defaults to sandbox for unknown, empty, null and undefined values", () => {
    for (const v of ["", "staging", "prod", null, undefined, 0]) {
      assert.equal(
        apiBaseFor(v),
        "https://sandbox-quickbooks.api.intuit.com",
        `${JSON.stringify(v)} must not route to production`
      );
    }
  });

  test("only the exact string 'production' selects the live host", () => {
    assert.equal(apiBaseFor("production "), "https://sandbox-quickbooks.api.intuit.com");
  });
});

describe("basicAuthHeader", () => {
  test("builds a Basic header from clientId:clientSecret", () => {
    const header = basicAuthHeader({ clientId: "id", clientSecret: "secret" });
    assert.equal(header, "Basic " + Buffer.from("id:secret").toString("base64"));
  });

  test("is decodable back to the original pair", () => {
    const header = basicAuthHeader({ clientId: "abc", clientSecret: "d:ef" });
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "abc:d:ef");
  });

  test("handles non-ascii secrets", () => {
    const header = basicAuthHeader({ clientId: "id", clientSecret: "sécret" });
    assert.equal(Buffer.from(header.slice(6), "base64").toString(), "id:sécret");
  });
});

describe("connectEnvironment", () => {
  const original = process.env.QBO_ENVIRONMENT;
  afterEach(() => {
    if (original === undefined) delete process.env.QBO_ENVIRONMENT;
    else process.env.QBO_ENVIRONMENT = original;
  });

  test("returns production when QBO_ENVIRONMENT is production", () => {
    process.env.QBO_ENVIRONMENT = "production";
    assert.equal(connectEnvironment(), "production");
  });

  test("is case-insensitive", () => {
    process.env.QBO_ENVIRONMENT = "PRODUCTION";
    assert.equal(connectEnvironment(), "production");
  });

  test("defaults to sandbox when unset", () => {
    delete process.env.QBO_ENVIRONMENT;
    assert.equal(connectEnvironment(), "sandbox");
  });

  test("defaults to sandbox for any other value", () => {
    for (const v of ["", "prod", "live", "staging"]) {
      process.env.QBO_ENVIRONMENT = v;
      assert.equal(connectEnvironment(), "sandbox", `${v} must not mean production`);
    }
  });
});

describe("credentials", () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("returns the configured credentials", () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    process.env.QBO_REDIRECT_URI = "http://localhost:9999/cb";
    assert.deepEqual(credentials(), {
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "http://localhost:9999/cb",
    });
  });

  test("defaults the redirect URI to localhost:3000/callback", () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    assert.equal(credentials().redirectUri, "http://localhost:3000/callback");
  });

  test("throws an actionable error when the client id is missing", () => {
    process.env.QBO_CLIENT_SECRET = "csecret";
    assert.throws(() => credentials(), /Missing QBO_CLIENT_ID \/ QBO_CLIENT_SECRET/);
  });

  test("throws when the client secret is missing", () => {
    process.env.QBO_CLIENT_ID = "cid";
    assert.throws(() => credentials(), /Missing QBO_CLIENT_ID \/ QBO_CLIENT_SECRET/);
  });

  test("throws when both are missing", () => {
    assert.throws(() => credentials(), /Missing QBO_CLIENT_ID/);
  });

  test("treats an empty string as missing", () => {
    process.env.QBO_CLIENT_ID = "";
    process.env.QBO_CLIENT_SECRET = "";
    assert.throws(() => credentials(), /Missing QBO_CLIENT_ID/);
  });
});

describe("deriveSlugFromRealm", () => {
  test("uses the last four digits by default", () => {
    assert.equal(deriveSlugFromRealm("9130350000008315"), "8315");
  });

  test("extends one digit at a time on collision", () => {
    assert.equal(deriveSlugFromRealm("9130350000008315", new Set(["8315"])), "08315");
  });

  test("keeps extending past multiple collisions", () => {
    const taken = new Set(["8315", "08315", "008315"]);
    assert.equal(deriveSlugFromRealm("9130350000008315", taken), "0008315");
  });

  test("strips non-digits from the realm id", () => {
    assert.equal(deriveSlugFromRealm("913-035-000-000-8315"), "8315");
  });

  test("returns the whole thing when shorter than four digits", () => {
    assert.equal(deriveSlugFromRealm("123"), "123");
  });

  test("falls back to a sanitized form when there are no digits", () => {
    assert.equal(deriveSlugFromRealm("abc"), "abc");
  });

  test("falls back to 'company' when nothing usable remains", () => {
    assert.equal(deriveSlugFromRealm(""), "company");
    assert.equal(deriveSlugFromRealm("!!!"), "company");
  });

  test("is deterministic for the same inputs", () => {
    const a = deriveSlugFromRealm("9130350000008315", new Set(["8315"]));
    const b = deriveSlugFromRealm("9130350000008315", new Set(["8315"]));
    assert.equal(a, b);
  });

  test("never returns a slug needing further sanitization", () => {
    assert.equal(sanitizeSlug(deriveSlugFromRealm("913-035-000-000-8315")), "8315");
  });

  // Documented edge: when every length is already taken the loop is exhausted and
  // the full digit string is returned even though it collides. Reaching this needs
  // the same realm registered under every suffix length, which the caller avoids
  // by reusing the existing slug for a known realmId.
  test("returns the full digit string when every length is taken", () => {
    assert.equal(deriveSlugFromRealm("1234", new Set(["1234"])), "1234");
  });
});

describe("API constants", () => {
  test("pin the QBO minor version", () => {
    assert.equal(MINOR_VERSION, "70");
  });

  test("point at Intuit's documented endpoints", () => {
    assert.equal(AUTHORIZE_URL, "https://appcenter.intuit.com/connect/oauth2");
    assert.equal(TOKEN_URL, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
  });

  test("request only the accounting scope", () => {
    assert.equal(SCOPE, "com.intuit.quickbooks.accounting");
  });
});
