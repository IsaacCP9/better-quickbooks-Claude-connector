---
name: add-qbo-company
description: >-
  Connect an additional QuickBooks Online company (a second/third "accounting
  file" or realm) to this local qbo-mcp-server so multiple companies are usable
  at once, each as its own qbo-<slug> connector. Use this whenever the user wants
  to add, connect, hook up, onboard, or authorize another QBO company / client /
  business / sandbox / production file — phrasings like "add another company",
  "connect a second QuickBooks", "hook up my client's books", "authorize a new
  realm", "set up production QBO", or "I need both companies at once". Also use it
  to switch which company is active, or to check which companies are already
  wired up. This is the safe, foolproof path — prefer it over hand-running
  npm run connect or hand-editing the Claude Desktop config.
---

# Add a QBO company

This server can talk to many QuickBooks companies at once. Each company is
selected by the `QBO_COMPANY` env var, which maps to its own `tokens.<slug>.json`
file (`src/qbo.js`). One Claude Desktop connector per company (`qbo-<slug>`)
means every company shows up as its own toolset, all live simultaneously.

> **Two setups exist.** This skill wires up the **one-connector-per-company**
> layout described above. The setup in [README.md](../../../README.md) uses a
> single unified `qbo` connector where you pick the company at runtime with
> `select_company` or a per-call `company` argument. Both work against the same
> token files; the unified one is what a fresh install gets. Use this skill when
> you want a company to have its own dedicated connector entry.

Adding one has exactly three moving parts, and only the middle one needs a human:

1. **Authorize** — a browser login to Intuit that writes `tokens.<slug>.json`.
2. **Register** — add a `qbo-<slug>` connector to the Claude Desktop config.
3. **Restart** — relaunch Claude Desktop so it loads the new connector.

The scripts in this skill make steps 2 and validation bulletproof. Follow the
steps in order; do not skip the verification checkpoints — a company that's
authorized but not registered (or vice-versa) silently does nothing, and the
checkpoints catch exactly that.

## Before you start

Confirm you're operating on this project. Resolve `PROJECT_DIR` (the
`qbo-mcp-server` folder, e.g. `~/Desktop/qbo-mcp-server`) and `NODE` (absolute
node path — get it with `which node`, since Claude Desktop can't rely on `$PATH`).
Use absolute paths everywhere; the Claude Desktop config requires them.

## Step 1 — Gather the details

Ask the user for these (don't guess — a wrong environment silently hits the wrong
API, and a bad slug creates a phantom company):

- **Slug**: a short, lowercase, `a-z0-9-` label identifying the company (e.g.
  `8315`, `acme`, `client-bakery`). This becomes the token filename and the
  connector name. Keep it stable — renaming later means re-authorizing.
- **Environment**: `sandbox` or `production`. Sandboxes are Intuit's test
  companies; production is real books. If the user is unsure and the email/company
  is a real business, it's production.
- **For production only**: that app's own `QBO_CLIENT_ID` and
  `QBO_CLIENT_SECRET`, since sandbox keys can't reach production. Ask the user to
  paste them, or confirm the `.env` values already point at the production app.
  **Never type the user's credentials into the Intuit login yourself** — that's
  theirs to enter in the browser (step 2).

Sanity-check the slug isn't already taken:
```bash
python3 .claude/skills/add-qbo-company/scripts/list_companies.py --project-dir "$PROJECT_DIR"
```
If the slug already appears as authorized, adding it again re-authorizes/overwrites
it — confirm that's the intent before proceeding.

## Step 2 — Authorize (the human's part)

Run the connect flow with `QBO_COMPANY` set so tokens land in the right file. Run
it **in the background** — it starts a localhost:3000 server and blocks until the
browser callback arrives.

Sandbox (uses `.env` keys as-is):
```bash
cd "$PROJECT_DIR" && QBO_COMPANY=<slug> npm run connect
```

Production (override keys + environment for just this run):
```bash
cd "$PROJECT_DIR" && QBO_COMPANY=<slug> QBO_ENVIRONMENT=production \
  QBO_CLIENT_ID=<prod-id> QBO_CLIENT_SECRET=<prod-secret> npm run connect
```

The connect flow tries to auto-open the browser, but don't rely on that alone —
auto-open can silently misfire (no default browser, a sandboxed shell). To make
this foolproof, **always give the user the link too**: read the command's output,
lift the line between the `AUTHORIZE_URL>>> ... <<<` delimiters, and present it as
a clickable Markdown link right away. Then tell the user, in plain terms:
> Your browser should open to Intuit — if it doesn't, click this link: <link>.
> Log into the company you want, pick the right one if prompted, and click
> **Allow**. You'll see "✅ QuickBooks connected" — close that tab.

Because the command runs in the background and blocks on the callback, read its
output file a second or two after launching to grab that URL; don't wait for the
command to finish (it won't, until the user logs in).

Only one `connect` can run at a time (they all use port 3000), so never launch two
in parallel.

**Checkpoint** — confirm the token file was actually written and shows the
expected realm/environment before moving on:
```bash
python3 .claude/skills/add-qbo-company/scripts/list_companies.py --project-dir "$PROJECT_DIR"
```
The new slug should read `AUTHORIZED=yes` with the right `ENV`. If token exchange
failed for a production company, it's almost always sandbox keys or an
unregistered redirect URI — see [references/troubleshooting.md](references/troubleshooting.md).

## Step 3 — Register the connector

Let the script edit the Claude Desktop config — it backs up first, refuses to
touch corrupt JSON, and is idempotent, which hand-editing is not:
```bash
python3 .claude/skills/add-qbo-company/scripts/register_connector.py \
  --slug <slug> --project-dir "$PROJECT_DIR" --node "$NODE"
```
For production, pass the same key overrides so the connector runs against
production every time it launches (config `env` overrides `.env`):
```bash
  ... --env QBO_ENVIRONMENT=production \
      --env QBO_CLIENT_ID=<prod-id> --env QBO_CLIENT_SECRET=<prod-secret>
```

**Checkpoint** — run `list_companies.py` once more. The slug should now read
`AUTHORIZED=yes` **and** `REGISTERED=yes`. Both must be `yes`; the script prints a
targeted nudge if either is missing.

## Step 4 — Restart Claude Desktop

The new connector only appears after a full relaunch — **Quit** Claude Desktop
(Cmd-Q, not just closing the window) and reopen it. Tell the user this explicitly;
it's the most common "why isn't it showing up" cause. After relaunch, the company
appears under Settings → Connectors as `qbo-<slug>` with all 54 tools.

While you're there, set the connector's **Tool permissions**. Tools are annotated
read-only vs destructive, so the screen distinguishes them. `attach_file`,
`import_transactions_from_csv` and `api_request` reach further than their names
suggest — see [DEVELOPER.md → Powerful tools](../../../DEVELOPER.md#powerful-tools--what-they-can-reach)
— and are worth setting to **Needs approval** or **Never** on a production company.

> Note: the currently-running MCP server in *this* session reads whichever token
> file its own `QBO_COMPANY` points at, so a brand-new connector won't be callable
> here until Desktop is restarted. That's expected.

## Wrap up

Summarize for the user: the slug, its realmId + environment, the connector name,
and the reminder that its books are separate from the other companies'. If they
added a production company, remind them those are **real** books — writes
(invoices, bills) post for real.

## Related tasks

- **Switch the default/legacy `qbo` connector** to a different company: overwrite
  `tokens.json` via `npm run connect` with no `QBO_COMPANY` set. This overwrites,
  so back up first (`cp tokens.json tokens.<oldslug>.json`).
- **Remove a company**: delete its `tokens.<slug>.json` and remove the
  `qbo-<slug>` block from the Claude Desktop config, then restart.
- **Deeper failures** (port in use, refresh-token expiry, wrong realm): see
  [references/troubleshooting.md](references/troubleshooting.md).
