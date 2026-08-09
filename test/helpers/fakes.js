// Shared test doubles. No network, no real filesystem outside a tmpdir.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// A fake QBO client for the builders. `tables` maps entity name -> array of
// records; queries are matched by the entity name in `FROM <Entity>` and by a
// trailing `WHERE <field> = '<value>'` when present.
//
// Records the exact SQL it was asked for, so tests can assert on query shape
// (which is how the esc()/injection behaviour gets pinned down).
function fakeQbo(tables = {}, { requestResponses = {} } = {}) {
  const queries = [];
  const requests = [];

  async function qboQuery(sql, opts = {}) {
    queries.push({ sql, company: opts.company });
    const entity = /FROM\s+(\w+)/i.exec(sql)?.[1];
    if (!entity) return {};
    const rows = tables[entity] || [];

    const where = /WHERE\s+(\w+)\s*=\s*'([\s\S]*?)'(?:\s|$)/i.exec(sql);
    if (!where) return { [entity]: rows };
    const [, field, rawValue] = where;
    // Undo the escaping esc() applied, so the fake compares against real values.
    const value = rawValue.replace(/\\'/g, "'");
    const matched = rows.filter((r) => String(r[field]) === value);
    return matched.length ? { [entity]: matched } : {};
  }

  async function qboRequest(pathAndQuery, opts = {}) {
    requests.push({ path: pathAndQuery, ...opts });
    for (const [prefix, response] of Object.entries(requestResponses)) {
      if (pathAndQuery.startsWith(prefix)) return response;
    }
    return {};
  }

  return { qboQuery, qboRequest, queries, requests };
}

// A company list source for the resolver: returns whatever it's constructed with.
function fakeCompanies(companies = []) {
  let calls = 0;
  const listCompanies = async () => {
    calls++;
    return companies;
  };
  return { listCompanies, callCount: () => calls };
}

// The real sanitizeSlug behaviour, duplicated so company.js can be tested
// without importing qbo.js (which reads env and touches paths at import time).
const sanitizeSlug = (s) => String(s ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "");

// Fresh isolated tokens directory. Returns its path.
async function makeTokensDir(files = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "qbo-test-"));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(
      path.join(dir, name),
      typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
      "utf8"
    );
  }
  return dir;
}

// A token bundle that is currently valid (expires well beyond the 60s refresh skew).
function validTokens(overrides = {}) {
  const now = Date.now();
  return {
    access_token: "access-tok",
    refresh_token: "refresh-tok",
    realmId: "9130350000000000",
    environment: "sandbox",
    expires_at: now + 3600_000,
    refresh_expires_at: now + 100 * 24 * 3600_000,
    ...overrides,
  };
}

// Install a fake global.fetch. `handler(url, init)` returns
// { status?, body?, text? }. Returns { calls, restore }.
function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = (await handler(String(url), init)) || {};
    const status = r.status ?? 200;
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return text; },
      async json() { return JSON.parse(text); },
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// Collects log lines instead of writing to stderr.
function spyLog() {
  const lines = [];
  const fn = (...args) => lines.push(args.join(" "));
  fn.lines = lines;
  return fn;
}

export {
  fakeQbo,
  fakeCompanies,
  sanitizeSlug,
  makeTokensDir,
  validTokens,
  stubFetch,
  spyLog,
};
