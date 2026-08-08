# Developer & technical reference

Technical setup, tooling, and architecture for the QuickBooks connector. If you
just want to install it, start with the non-technical walkthrough in
**[README.md](README.md)** — no Terminal required there.

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
A browser opens → log in to the QuickBooks company → **Allow**. Tokens are saved
locally and auto-refresh (~100 days).

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

### 5. Tool permissions (important)

In Claude Desktop, open **Settings → Connectors**, click a `qbo-…` connector, and
set its **Tool permissions**. Each tool can be **Always allow** (✓), **Needs
approval** (✋), or **Never** (⛔).

This is not just a convenience setting. **The server itself has no confirmation
gate, no destructive-action flag, and no read-only mode** — the client's approval UI
is the only thing standing between a model decision and a live write. Freshly
installed connectors default every tool to "needs approval", so the risk is in
loosening it, not in leaving it alone.

- **Read-only reports → Always allow** (`list_companies`, `select_company`,
  `get_active_company`, the `get_*` reports) — they only look, so Claude stays fast.
- **Write tools → Needs approval** — everything `create_*` / `update_*` / `send_*`,
  plus `void_invoice`.
- **Keep these four on Needs approval no matter what.** They reach much further than
  their names suggest, and each is documented in
  [SECURITY.md](SECURITY.md#the-escape-hatch-tools):
  - `api_request` — raw call to any QBO endpoint. The `GET`/`POST` enum is not a
    safety boundary: QBO does *all* mutation over POST, including
    `?operation=delete`, `?operation=void`, `/send`, and 30-op `/batch`. It reaches
    the company's entire write and delete surface, with no allowlist.
  - `query` — arbitrary `SELECT` against any entity, no row cap. Read-only, but one
    call can pull a whole ledger into context. Unlike writes, it auto-picks the
    company when only one is connected.
  - `attach_file` — reads **any** local path (no allowlist, extension check, or size
    cap) and uploads it to QuickBooks. That includes this project's own `.env` and
    `tokens.*.json`.
  - `import_transactions_from_csv` — also reads any local path, and batch-posts. Use
    its `dry_run` first.

*(A screenshot of this settings pane belongs at `docs/images/tool-permissions.png`;
it hasn't been captured yet.)*

## Multiple companies (one connector)

Each company is a `tokens.<slug>.json` file. Within one connector you choose the
company at runtime:

- **`list_companies`** — see every connected company (slug, realm, environment).
- **`select_company`** — set the active company for following calls.
- **`get_active_company`** — check which is active.
- Every tool also takes an optional **`company`** argument to override per call.

Resolution precedence per call (`resolveCompany`, `src/index.js:174-202`): *explicit
`company` → session default → env `QBO_COMPANY` → sole company (reads only) → error
listing choices.*

Write tools don't auto-pick **when several companies are discovered** — but note two
gaps before relying on that as a guarantee:

- `listCompanies()` skips the legacy `tokens.json` filename by design
  (`src/qbo.js:107-128`), so on a `npm run connect` install with no slug, resolution
  returns `""` at `src/index.js:194` *before* the write check and every write posts
  unnamed.
- `sanitizeSlug` (`src/qbo.js:34-36`) strips invalid characters rather than rejecting,
  so a wrong `company` value can collapse into a different valid slug and pass
  validation.

Both are tracked in [SECURITY.md → Known limitations](SECURITY.md#known-limitations).

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
>
> Its `GET`/`POST` enum is **not** a privilege boundary — QBO mutates exclusively over
> POST, so this tool reaches deletes (`?operation=delete`), voids, sends, and `/batch`.
> The path is also not validated against `..`, so it can escape the
> `/v3/company/{realmId}` prefix (`src/qbo.js:330-332`). Treat it as full access to the
> selected company.

## Notes

- Line-item tools accept account/item/customer references by **name or Id**.
- Item-based tools (purchase orders, item-based bills) need **purchasable**
  items (ones with an expense account).
- `import_transactions_from_csv` supports a `dry_run` preview; live posting is
  wired for `Expense` (QBO `Purchase`) via the batch API.
- Sandbox companies start empty — seed some data before expecting reads to return
  rows.
- All logging goes to **stderr**; stdout is the MCP protocol channel.

## Architecture

- `src/qbo.js` — OAuth (authorize / refresh), per-company token resolution,
  authenticated request + multipart upload helpers, company discovery.
- `src/index.js` — the MCP server: tool definitions, company-resolution +
  write-gate, line-item builders.

## Troubleshooting

For common setup snags (port in use, refresh-token expiry, wrong realm, a
company authorized but not registered), see
[the troubleshooting guide](.claude/skills/add-qbo-company/references/troubleshooting.md).

## Security & data flow

Before pointing this at a client's books, read [SECURITY.md](SECURITY.md). The two
things developers most often miss:

- **Everything a tool returns enters the Claude conversation** and is processed by
  Anthropic under the operator's plan and settings. Credentials stay local; accounting
  data does not.
- Tokens and `.env` are plaintext at default file permissions inside the project
  directory — the same directory users are told to hand to Claude Code.

## License

**MIT No Attribution** — see [LICENSE](LICENSE). Provenance and dependency licenses are
documented in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). MIT-0 grants copyright
permissions only; it grants no trademark rights and carries an "as is" warranty
disclaimer.

Independent project — not affiliated with, endorsed by, or sponsored by Intuit Inc. or
Anthropic, PBC. QuickBooks and Intuit are trademarks of Intuit Inc.; Claude and
Anthropic are trademarks of Anthropic, PBC.
