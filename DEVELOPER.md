# Developer & technical reference

Technical setup, tooling, and architecture for the QuickBooks connector. If you
just want to install it, start with the non-technical walkthrough in
**[README.md](README.md)** — no Terminal required there.

> **Unofficial and independent.** Not affiliated with, endorsed by, or sponsored
> by Intuit Inc. or Anthropic. QuickBooks and Intuit are trademarks of Intuit
> Inc.; Claude is a trademark of Anthropic. Released into the public domain under
> [CC0 1.0](LICENSE) — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Setup (quick reference)

### 1. Install
```bash
npm install
```

### 2. Configure keys
```bash
cp .env.example .env
```
Fill in your Intuit Developer app's `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`
(from https://developer.intuit.com → your app → Keys & OAuth). The
`QBO_REDIRECT_URI` must match a redirect URI registered on the app exactly.

### 3. Authorize a company (one time each)
```bash
# Unified multi-company setup — give each company a short slug:
QBO_COMPANY=<slug> npm run connect      # writes tokens.<slug>.json

# Or a single default company:
npm run connect                          # writes tokens.json

# Or add several in one browser session (log in once, pick + Allow each):
npm run connect:batch                    # interactive
npm run connect:batch -- --count 50      # fixed number
```
A browser opens → log in to the QuickBooks company → **Allow**. The callback
listener binds `127.0.0.1` only. Tokens are written `0600` and atomically to the
project root, or to `$QBO_DATA_DIR` if set, and auto-refresh.

Refresh tokens expire after ~100 days of disuse **and** carry a hard maximum
lifetime (capped at 5 years since Intuit's
[Nov 2025 policy change](https://blogs.intuit.com/2025/11/12/important-changes-to-refresh-token-policy),
which also makes a Reconnect URL mandatory in app settings). `getValidTokens`
reads the `refresh_expires_at` Intuit returns rather than assuming a duration.

> **Production keys need an HTTPS redirect URI.** Intuit rejects `localhost` and
> plain `http` for production apps, so the default
> `http://localhost:3000/callback` works with **Development** keys only. For
> production, front the callback with an HTTPS tunnel and register that URL.

The easiest way to add companies is the bundled **`add-qbo-company` skill** (see
below) — it runs the connect flow, registers the connector, and validates both.

### 4. Connect to Claude Desktop
Add one server entry pointing at `src/index.js` to your Claude Desktop config
file. It lives at:
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

For the unified multi-company setup, use a single entry **without** `QBO_COMPANY`.

Mac:
```json
{
  "mcpServers": {
    "qbo": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/qbo-mcp-server/src/index.js"]
    }
  }
}
```
Windows (use `node.exe`, and **double** every backslash in JSON):
```json
{
  "mcpServers": {
    "qbo": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\Desktop\\qbo-mcp-server\\src\\index.js"]
    }
  }
}
```
Fully **quit and reopen** Claude Desktop. `qbo` appears under
**Settings → Connectors** with all 54 tools.

### 5. Tool permissions (recommended)

In Claude Desktop, open **Settings → Connectors**, click the `qbo` connector, and
set its **Tool permissions**. Each tool can be **Always allow** (✓), **Needs
approval** (✋), or **Never** (⛔).

Every tool is registered with MCP annotations (`readOnlyHint`, `destructiveHint`),
so that screen distinguishes a report from a payment instead of listing 54
identical rows:

| Class | Count | Annotation | Suggested setting |
| --- | --- | --- | --- |
| Read-only | 19 | `readOnlyHint: true` | **Always allow** — they only look |
| Additive writes | 18 | `readOnlyHint: false` | **Needs approval** |
| Destructive / far-reaching | 17 | `destructiveHint: true` | **Needs approval**, or **Never** for the three below |

Freshly installed connectors default every tool to "needs approval", so set this
once.

The classification lives in `READ_ONLY_TOOLS` / `DESTRUCTIVE_TOOLS` at the top of
the tool section in `src/index.js` — one table, and `test/annotations.test.js`
fails the build if a tool is registered without going through `defineTool()`.

### Powerful tools — what they can reach

Three tools reach further than their names suggest. They're on by default because
they're useful; this section is so that's a decision rather than a surprise.

#### `attach_file` (`src/index.js`)

**Buys you:** attaching receipts, contracts and statements to records from chat.

**Also does:** reads whatever `file_path` it is handed and uploads those bytes to
QuickBooks as an `Attachable`.

```js
const buf = await readFile(file_path.replace(/^~(?=$|\/)/, process.env.HOME));
```

That is the whole of the path handling — a `~` expansion. There is no base
directory, no traversal check, no `realpath`/symlink resolution, no size limit,
and no extension allowlist (`guessContentType` is a convenience map that falls
through to `application/octet-stream`, not a filter). `attach_to_entity` is passed
into `EntityRef.type` unvalidated.

Concretely: `attach_file({ file_path: "<project>/tokens.8315.json" })` uploads a
live refresh token to QuickBooks as a downloadable attachment. `.env`,
`~/.ssh/id_rsa` and `~/.aws/credentials` are equally reachable.

#### `import_transactions_from_csv` (`src/index.js`)

**Buys you:** a bank CSV turned into categorised transactions in one pass.

**Also does:**

- Same unrestricted path read as `attach_file`.
- **Posts live by default** — `dry_run` is undefined unless asked for, so the
  preview is opt-in and posting is the default.
- Leaks file contents on failure: the header-detection error interpolates
  `rows[0].join(", ")`, so pointing it at a non-CSV returns that file's first line
  verbatim into the conversation. That is a general one-line-at-a-time file read.
- Guesses GL accounts by matching the first word of an expense account name
  anywhere in the description; unmatched rows fall back to an account matching
  `/uncategorized/i`, or failing that **`accounts[0]`** — an arbitrary expense
  account.
- Posts in batches of 30 via the QBO `/batch` endpoint. Partial failures are
  reported and **not rolled back**.

#### `api_request` (`src/index.js`)

**Buys you:** any QBO endpoint this connector doesn't wrap.

**Also does:** reaches every destructive operation in the API. The `z.enum(["GET",
"POST"])` looks like a restriction but isn't one — QuickBooks expresses deletes as
`POST /invoice?operation=delete`, so hard deletes that have no dedicated tool are
reachable here. There is no endpoint allowlist or denylist; the path is only
normalised to a leading `/`. The realm still comes from the selected token file,
so this cannot cross into another company.

#### Why the combination matters

Tool results flow into Claude's context, and those results contain text authored
outside your firm — customer names, invoice memos, transaction descriptions,
attachment notes. That is a prompt-injection surface: Claude cannot reliably
distinguish an instruction embedded in a vendor's bill memo from an instruction
the user typed.

The chain that follows is short. Claude reads a memo → the memo contains
instructions → Claude calls `attach_file` on a token file → the refresh token is
now an attachment in QuickBooks. Nothing in the code prevents this; the mitigation
is Claude Desktop's approval prompt and the annotations above that make the
dangerous tools identifiable.

**If you're running against production books,** set these three to **Needs
approval** or **Never**, and prefer `dry_run` for imports.

## Multiple companies (one connector)

Each company is a `tokens.<slug>.json` file. Within one connector you choose the
company at runtime:

- **`list_companies`** — see every connected company (slug, realm, environment).
- **`select_company`** — set the active company for following calls.
- **`get_active_company`** — check which is active.
- Every tool also takes an optional **`company`** argument to override per call.

Resolution precedence per call: *explicit `company` → session default → env
`QBO_COMPANY` → sole company (reads only) → error listing choices.* Write tools
never auto-pick — see [SECURITY.md](SECURITY.md#can-it-change-the-wrong-companys-books-by-accident).

This is a **selection** gate, not a confirmation gate: once a session default is
set, every subsequent write targets it without re-confirmation. To make that
visible, `defineTool` prefixes every write's result with the company, realm ID and
environment it landed in (`PRODUCTION` in capitals when it's real books).
`resolveCompany` publishes the settled slug through an `AsyncLocalStorage` context
so concurrent calls can't read each other's company.

> Typical flow in Claude: *"list my companies"* → *"work on 8315"* → *"create a
> journal entry: debit Accounting 500, credit Checking 500"*.

### The `add-qbo-company` skill

Bundled at [`.claude/skills/add-qbo-company/`](.claude/skills/add-qbo-company/).
Invoke it in Claude Code with `/add-qbo-company` (or ask to "add another
QuickBooks company"). It handles the three moving parts — **authorize**
(browser login → token file), **register** (adds the connector to the Claude
Desktop config, with backup + idempotent edits), and **verify** (cross-checks
that a company is both authorized and registered) — with Python helpers
(`scripts/list_companies.py`, `scripts/register_connector.py`) and a
troubleshooting reference.

## Tools (54)

**Company selection (3):** `list_companies`, `select_company`, `get_active_company`

**Reports & reads (15):** `get_profit_and_loss`, `get_balance_sheet`,
`get_cash_flow`, `get_aged_receivables`, `get_aged_payables`, `get_invoices`,
`get_overdue_invoices`, `query`, `get_company_info`, `get_general_ledger`,
`get_trial_balance`, `get_transaction_list`, `get_transaction_list_by_vendor`,
`get_transaction_list_by_customer`, `get_transaction_list_with_splits`

**Core writes (8):** `create_customer`, `update_customer`, `create_item`,
`create_invoice`, `create_bill`, `create_account`, `send_invoice_email`,
`import_transactions_from_csv`

**Journal entries (2):** `create_journal_entry`, `update_journal_entry`

**Sales transactions (12):** `create_estimate`, `update_estimate`,
`send_estimate`, `update_invoice`, `void_invoice`, `create_sales_receipt`,
`update_sales_receipt`, `send_sales_receipt`, `create_credit_memo`,
`create_refund_receipt`, `create_payment`, `create_deposit`

**Purchases & vendors (8):** `create_expense`, `update_purchase`,
`create_bill_item_based`, `update_bill`, `create_vendor_credit`,
`create_purchase_order`, `create_vendor`, `update_vendor`

**People & items (3):** `create_employee`, `create_time_activity`, `update_item`

**Attachments & advanced (3):** `attach_file`, `get_attachments`, `api_request`

> `api_request` is the escape hatch for anything not wrapped: pass a path under
> `/v3/company/{realmId}` (e.g. `/reports/ProfitAndLossDetail?...`,
> `/query?query=SELECT * FROM Bill`) and it handles auth, realm, and minorversion.
> It also reaches deletes — see [Powerful tools](#powerful-tools--what-they-can-reach).

## Tests

Node's built-in runner; no test dependencies.

```bash
npm test          # node --test
```

- `test/qbo.test.js` — slug traversal safety, `0600` token permissions, atomic
  writes, `listCompanies` discovery, sandbox/production host selection.
- `test/company.test.js` — every branch of the `resolveCompany` gate, including
  that a lone company is assumed for reads but never for writes, plus the write
  banner.
- `test/helpers.test.js` — CSV parsing, report query building, content types.
- `test/annotations.test.js` — fails the build if a tool bypasses `defineTool()`
  or is misclassified.

Tests redirect token storage with `QBO_DATA_DIR`, so they never touch real
`tokens.*.json` files and need no network access. CI runs them on Node 18/20/22
alongside a full-history gitleaks scan (`.github/workflows/ci.yml`).

These are unit tests of the local logic. **There is no automated coverage of the
write tools against the QuickBooks API** — those paths are still verified by hand
against a sandbox company.

## Notes

- Line-item tools accept account/item/customer references by **name or Id**.
- Item-based tools (purchase orders, item-based bills) need **purchasable**
  items (ones with an expense account).
- `import_transactions_from_csv` supports a `dry_run` preview, but **defaults to
  live posting**; only `Expense` (QBO `Purchase`) is wired for live posting, via
  the batch API.
- Token files can be relocated out of the project with `QBO_DATA_DIR` — worth
  doing if the project folder is cloud-synced.
- Sandbox companies start empty — seed some data before expecting reads to return
  rows.
- All logging goes to **stderr**; stdout is the MCP protocol channel.

## Architecture

- `src/qbo.js` — OAuth (authorize / refresh), per-company token resolution,
  authenticated request + multipart upload helpers, company discovery.
- `src/index.js` — the MCP server: tool definitions, company-resolution +
  write-gate, line-item builders, the annotation table and `defineTool()`.

Importing either module has no side effects — `src/index.js` only claims stdio
when it is the process entry point, so the test suite can inspect the tool table
without starting a server.

## Troubleshooting

For common setup snags (port in use, refresh-token expiry, wrong realm, a
company authorized but not registered), see
[the troubleshooting guide](.claude/skills/add-qbo-company/references/troubleshooting.md).
