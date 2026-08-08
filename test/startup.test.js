// The server must actually start when launched, and must NOT start when imported.
//
// Regression guard for a real break: the entry-point check originally compared
// path.resolve(process.argv[1]) against fileURLToPath(import.meta.url). Node's
// ESM loader resolves symlinks, process.argv[1] does not, so launching through a
// symlinked path made the server decide it was "imported" — it registered nothing
// and exited 0. In Claude Desktop that looks like the connector silently
// disappearing, with nothing in any log to explain it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Start the server, give it a moment to announce itself, then kill it. It holds
// stdio open forever by design, so a timeout is the expected way out.
async function launch(entry) {
  try {
    const { stderr } = await execFileAsync(process.execPath, [entry], { timeout: 8000 });
    return stderr;
  } catch (e) {
    // SIGTERM from the timeout means it was still running — that's success here.
    if (e.killed) return e.stderr ?? "";
    throw e;
  }
}

describe("entry-point detection", () => {
  test("starts and registers all tools when run directly", async () => {
    const stderr = await launch(path.join(ROOT, "src", "index.js"));
    assert.match(stderr, /server running/i, "the server did not start");
    assert.match(stderr, /54 tools registered/);
  });

  test("still starts when launched through a symlinked path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qbo-symlink-"));
    try {
      await symlink(ROOT, path.join(dir, "proj"));
      const stderr = await launch(path.join(dir, "proj", "src", "index.js"));
      assert.match(stderr, /server running/i,
        "launching via a symlink must still start the server");
      assert.match(stderr, /54 tools registered/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not start when imported", async () => {
    // -e so argv[1] is absent entirely; the module must stay quiet.
    const { stderr, stdout } = await execFileAsync(
      process.execPath,
      ["-e", `import(${JSON.stringify(path.join(ROOT, "src", "index.js"))}).then(m => console.log(m.registeredTools.length))`],
      { timeout: 8000 },
    );
    assert.doesNotMatch(stderr, /server running/i, "importing must not start a server");
    assert.equal(stdout.trim(), "54", "importing should still build the tool table");
  });
});
