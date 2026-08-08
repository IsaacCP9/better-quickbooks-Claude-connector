# Data, compliance and your obligations

> **Unofficial and independent.** Not affiliated with, endorsed by, or sponsored
> by Intuit Inc. or Anthropic. QuickBooks and Intuit are trademarks of Intuit
> Inc.; Claude is a trademark of Anthropic.

This page is for anyone running the connector against **real client books** —
accounting firms and bookkeepers especially. It covers what data moves where, who
processes it, and which obligations are yours rather than ours.

It is a practical summary, not legal advice. If you handle client financial data
under an engagement letter, a DPA, or a professional-body rule, check this against
those before you connect a production company.

---

## What data the connector touches

The connector requests the single OAuth scope
`com.intuit.quickbooks.accounting`. That is the full QuickBooks Online accounting
scope — it is not narrowed per tool, and there is no read-only variant of it.
Practically, an authorized company exposes:

- **Reports** — P&L, balance sheet, cash flow, general ledger, trial balance,
  aged receivables and payables, transaction lists.
- **Records** — invoices, bills, estimates, sales receipts, credit memos, refunds,
  payments, deposits, purchases, journal entries, purchase orders, time activities.
- **People** — customers, vendors, employees, including names and contact details.
- **Setup** — chart of accounts, items, company info.
- **Attachments** — notes and files stored against records.

`query` and `api_request` can reach anything else in that scope that the wrapped
tools don't cover.

## Where that data goes

Three places, and the middle one is the one people miss.

**1. Your computer.** The connector runs locally. Tokens live in
`tokens.<slug>.json` files (owner-readable only, `0600`), your Intuit keys live in
`.env`. Neither is transmitted anywhere except to Intuit. Set `QBO_DATA_DIR` in
`.env` to keep token files outside the project folder — worth doing if the project
sits in Dropbox, iCloud Drive, OneDrive or any other synced location.

**2. Anthropic.** Everything the connector returns is placed into the Claude
conversation. That is the entire point — it is how Claude can answer a question
about your books — but it means invoice contents, customer names, balances and
transaction descriptions are **transmitted to and processed by Anthropic**, under
whichever Claude plan, privacy settings, and retention terms you're on. Business
and Enterprise plans have different data-handling terms from consumer plans;
check which you're on.

**3. Intuit.** OAuth credentials and API calls, as you'd expect.

Nothing is sent to Opzer.

### If you are a firm acting for clients

- You are likely the **controller** for your clients' data; Anthropic is a
  **processor or sub-processor** in this flow. Confirm your client agreements and
  privacy notice actually permit it, and that Anthropic appears on your
  sub-processor list where you maintain one.
- Get client authorisation before connecting their books. "It runs locally" is
  true of the connector and not true of the data flow.
- Decide deliberately whether client financial data should be going into a
  consumer Claude plan.

## Retention and deletion

| What | Where | How to delete |
| --- | --- | --- |
| Access + refresh tokens | `tokens.<slug>.json` (or `$QBO_DATA_DIR`) | Delete the file |
| Intuit app keys | `.env` | Delete or clear the file |
| QuickBooks data | Only in Claude conversations | Delete the conversations; retention follows your Anthropic plan |

The connector keeps **no** database, cache, or copy of your accounting data. It
requests what a tool needs and passes it straight to Claude.

## Revoking access

Do both — deleting the local file does not revoke the grant at Intuit:

1. **At Intuit** — in QuickBooks Online, go to **Settings → Apps** (or
   [Intuit account → Data and privacy → Apps and connections](https://accounts.intuit.com))
   and disconnect the app. This invalidates the tokens server-side.
2. **Locally** — delete that company's `tokens.<slug>.json`.

To disconnect everything, also delete `.env` and remove the `qbo` entry from your
Claude Desktop config.

## Token lifetimes

- The **access token** lasts about an hour. The connector refreshes it
  automatically.
- The **refresh token** expires after roughly **100 days without use**, and every
  refresh token also carries a **hard maximum lifetime** — Intuit
  [changed this policy in November 2025](https://blogs.intuit.com/2025/11/12/important-changes-to-refresh-token-policy),
  capping refresh tokens at five years, returning the expiry in the token
  response, and making a **Reconnect URL** a required field in app settings. So a
  connection that never goes idle will still eventually need re-authorising.
- The connector reads the expiry Intuit sends rather than assuming a number, so it
  tracks the real deadline. When it lapses, re-run
  `QBO_COMPANY=<slug> npm run connect`.

## Intuit platform obligations

Intuit's platform, security and data-stewardship expectations apply to apps using
**production** QuickBooks data — including private and unlisted apps. Publishing to
the marketplace is not what triggers them, and running locally does not exempt you.

The parts that bear on this connector:

- **Purpose limitation.** Use the data for what the customer connected you for.
- **Sharing with third parties.** Sending QuickBooks data onward is exactly what
  this connector does, every time it answers a question. Whether that is permitted
  for your use is a question to resolve against your Intuit agreement and your
  client engagement — deliberately, not by assumption.
- **Security.** Protect the credentials. See [SECURITY.md](../SECURITY.md).
- **Production credentials** require an `https`, non-localhost Redirect URI. See
  the note in the [README](../README.md).

## API cost and rate limits

Apps are enrolled in the **Intuit App Partner Program**. Usage is metered in API
credits split into Core and CorePlus categories:

- The free **Builder** tier includes **unlimited Core** calls and **500,000
  CorePlus credits per month**. Past that, CorePlus calls are **blocked** — the
  Builder tier has no overage.
- Paid tiers (Silver, Gold, Platinum) raise the allowance and permit overage.

Reports and queries are the calls most likely to be metered as CorePlus, and this
connector is report-heavy by design. A firm pulling full report packs across many
clients should watch usage in the developer portal rather than assume the free
allowance is effectively infinite. Check the
[current program terms](https://developer.intuit.com/app/developer/qbo/docs/develop)
for the figures that apply to you — tiers and pricing change.

## Reporting a problem

Security issues: [SECURITY.md](../SECURITY.md#reporting-a-vulnerability).
Anything else: [team@opzer.co](mailto:team@opzer.co).
