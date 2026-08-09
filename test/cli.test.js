// The command-line entry points, exercised by spawning the real process.
//
// Covers the argv branches in src/index.js and — importantly — the entrypoint
// guard: running the file must claim stdio, importing it must not.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { makeTokensDir, validTokens } from "./helpers/fakes.js";
import { writeFile } from "node:fs/promises";

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(PROJECT, "src", "index.js");

const TOKENS_DIR = await makeTokensDir();
await writeFile(
  path.join(TOKENS_DIR, "tokens.acme.json"),
  JSON.stringify(validTokens({ realmId: "1000000000008315", environment: "sandbox" })),
  "utf8"
);

const BASE_ENV = {
  ...process.env,
  QBO_TOKENS_DIR: TOKENS_DIR,
  QBO_CLIENT_ID: "test-client-id",
  QBO_CLIENT_SECRET: "test-client-secret",
  QBO_ENVIRONMENT: "sandbox",
  QBO_REDIRECT_URI: "http://localhost:3999/callback",
  QBO_COMPANY: "",
};

// Run a command to completion, capturing output. Never inherits stdio.
function run(args, { env = {}, cwd = PROJECT, timeoutMs = 20000, script = ENTRY } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...BASE_ENV, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// Start the server, wait for a stderr line to appear, then kill it.
function runUntilStderr(args, pattern, { env = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd: PROJECT,
      env: { ...BASE_ENV, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    const finish = (result) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`never matched ${pattern}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (pattern.test(stderr)) finish({ stdout, stderr });
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

describe("default (stdio server) mode", () => {
  test("boots and reports the registered tool count on stderr", async () => {
    const { stderr } = await runUntilStderr([], /tools registered/);
    assert.match(stderr, /QBO MCP server running \(stdio\)\. 54 tools registered\./);
  });

  test("writes nothing to stdout before the protocol starts", async () => {
    // stdout is the MCP channel; a stray log there corrupts the transport.
    const { stdout } = await runUntilStderr([], /tools registered/);
    assert.equal(stdout, "");
  });
});

describe("the entrypoint guard", () => {
  test("importing src/index.js does NOT start the stdio transport", async () => {
    const probe = path.join(TOKENS_DIR, "probe.mjs");
    await writeFile(
      probe,
      `import(${JSON.stringify(ENTRY)}).then(
         (m) => { console.error("IMPORTED_OK tools=" + (m.server ? "yes" : "no")); process.exit(0); },
         (e) => { console.error("IMPORT_FAILED " + e.message); process.exit(1); }
       );`,
      "utf8"
    );
    const { code, stderr } = await run([], { script: probe });
    assert.equal(code, 0, stderr);
    assert.match(stderr, /IMPORTED_OK tools=yes/);
    assert.doesNotMatch(
      stderr,
      /running \(stdio\)/,
      "importing must not claim stdin/stdout"
    );
  });

  test("the imported module exports the configured server", async () => {
    const probe = path.join(TOKENS_DIR, "probe-exports.mjs");
    await writeFile(
      probe,
      `const m = await import(${JSON.stringify(ENTRY)});
       console.error("EXPORTS=" + Object.keys(m).sort().join(","));
       process.exit(0);`,
      "utf8"
    );
    const { stderr } = await run([], { script: probe });
    assert.match(stderr, /EXPORTS=companyCtx,server/);
  });
});

describe("--connect-batch --dry", () => {
  test("prints the plan and exits 0 without authorizing anything", async () => {
    const { code, stderr } = await run(["--connect-batch", "--dry"]);
    assert.equal(code, 0, stderr);
    assert.match(stderr, /Batch plan \(dry run — nothing authorized\)/);
  });

  test("reports the environment and redirect it would use", async () => {
    const { stderr } = await run(["--connect-batch", "--dry"]);
    assert.match(stderr, /environment : sandbox/);
    assert.match(stderr, /redirect {4}: http:\/\/localhost:3999\/callback/);
  });

  test("reports interactive mode when no count is given", async () => {
    const { stderr } = await run(["--connect-batch", "--dry"]);
    assert.match(stderr, /mode {8}: interactive \(asks 'add another\?'\)/);
  });

  test("reports a fixed count when --count is given", async () => {
    const { stderr } = await run(["--connect-batch", "--dry", "--count", "7"]);
    assert.match(stderr, /mode {8}: fixed count = 7/);
  });

  test("accepts -n as an alias for --count", async () => {
    const { stderr } = await run(["--connect-batch", "--dry", "-n", "4"]);
    assert.match(stderr, /mode {8}: fixed count = 4/);
  });

  test("falls back to interactive when --count has no value", async () => {
    const { stderr } = await run(["--connect-batch", "--count", "--dry"]);
    assert.match(stderr, /mode {8}: interactive/);
  });

  test("falls back to interactive for a non-numeric count", async () => {
    const { stderr } = await run(["--connect-batch", "--dry", "--count", "many"]);
    assert.match(stderr, /mode {8}: interactive/);
  });

  test("lists the already-connected companies", async () => {
    const { stderr } = await run(["--connect-batch", "--dry"]);
    assert.match(stderr, /already connected \(1\): acme\(sandbox\)/);
  });

  test("shows an example minted slug that avoids taken slugs", async () => {
    const { stderr } = await run(["--connect-batch", "--dry"]);
    assert.match(stderr, /example new slug for realm 9999999999123456 → "3456"/);
  });

  test("does not even need credentials, proving it never reaches Intuit", async () => {
    const { code, stderr } = await run(["--connect-batch", "--dry"], {
      env: { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "" },
    });
    assert.equal(code, 0, stderr);
    assert.match(stderr, /Batch plan/);
    assert.doesNotMatch(stderr, /Missing QBO_CLIENT_ID/);
  });

  test("does not start the MCP server", async () => {
    const { stderr } = await run(["--connect-batch", "--dry"]);
    assert.doesNotMatch(stderr, /tools registered/);
  });
});

describe("credential validation on the connect paths", () => {
  const noCreds = { env: { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "" } };

  test("--connect fails fast with an actionable message when keys are missing", async () => {
    const { code, stderr } = await run(["--connect"], noCreds);
    assert.equal(code, 1);
    assert.match(stderr, /Authorization failed: Missing QBO_CLIENT_ID \/ QBO_CLIENT_SECRET/);
  });

  test("--connect does not open a listener when credentials are missing", async () => {
    const { stderr } = await run(["--connect"], noCreds);
    assert.doesNotMatch(stderr, /Waiting for QBO login/);
  });

  test("--connect-batch fails fast when keys are missing", async () => {
    const { code, stderr } = await run(["--connect-batch", "--count", "1"], noCreds);
    assert.equal(code, 1);
    assert.match(stderr, /Batch authorization failed: Missing QBO_CLIENT_ID/);
  });

  test("a failing connect never starts the MCP server", async () => {
    const { stderr } = await run(["--connect"], noCreds);
    assert.doesNotMatch(stderr, /tools registered/);
  });
});
