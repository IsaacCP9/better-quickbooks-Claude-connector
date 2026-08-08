# 🧾 Better QuickBooks Connector

Give Claude direct access to QuickBooks Online — for **all your client companies
from one connector**, not one at a time. Pull reports, create invoices, enter
transactions, and more, all through natural conversation.

**No Terminal, no command line, at any point.** You download a folder, point
Claude Code at it, and talk to it in plain English.

> **Unofficial and independent.** This is a community project by
> [Opzer](https://opzer.co). It is **not affiliated with, endorsed by, or
> sponsored by Intuit Inc. or Anthropic**. QuickBooks and Intuit are trademarks of
> Intuit Inc.; Claude is a trademark of Anthropic. Intuit publishes its own
> QuickBooks connector separately — this is not it.

> ⚠️ **This connector can change real books.** 35 of its 54 tools create, edit,
> void, or email real records. Before you point it at a client's live company,
> read **[What this connector can reach](#what-this-connector-can-reach)** below.
> Practising in a sandbox company first is strongly recommended.

---

## Before You Start

You'll need three things:

- **Claude Desktop** — download from [claude.ai/download](https://claude.ai/download) if you don't already have it
- **Claude Code** — this is what actually does the setup for you (more on this in Step 3)
- **The project itself** — click the green **Code** button on
  [the GitHub page](https://github.com/IsaacCP9/better-quickbooks-claude-connector),
  then **Download ZIP**

### 📹 Video walkthrough

- **macOS:** *placeholder — video coming soon*
- **Windows:** *placeholder — video coming soon*

---

## Step 1: Download & Unzip

Download the zip, then unzip it:

- **macOS:** double-click the zip file
- **Windows:** right-click the zip file → **Extract All**

Move the unzipped folder (it'll be called `better-quickbooks-Claude-connector-main`)
onto your **Desktop** so it's easy to find. It doesn't *have* to live there —
anywhere on your computer works. We use the Desktop purely for ease; if you pick
somewhere else, point Claude Code at that folder in Step 3 instead.

## Step 2: Make Sure Claude Desktop Is Installed

If you haven't already, install Claude Desktop from
[claude.ai/download](https://claude.ai/download). This is the app the connector
plugs into — you'll be talking to QuickBooks through Claude conversations once
it's set up.

## Step 3: Give Claude Code Access to the Folder

This is the only slightly technical part, and Claude does the rest of the work
from here.

1. Open the **Claude Code** desktop app.
2. When it asks which folder to work in, choose the
   **`better-quickbooks-Claude-connector-main`** folder from Step 1.
3. That's it — Claude Code now starts out **scoped to this folder**. A chat box
   appears in the app. That's where you'll paste the messages in the next step.

> ℹ️ **"Scoped to this folder" is a starting point, not a sandbox.** Claude Code
> works in the folder you pick, but it can read and change things elsewhere on
> your computer if it asks and you approve — the setup in Step 4 does exactly
> that when it edits your Claude Desktop settings file. Read what it asks for
> before clicking approve, the same as you would with any other app.

## Step 4: Say These Three Things (in order)

You don't need to know any code. Paste each message below into Claude Code, one
at a time, and let it walk you through the rest.

**1. Kick off the install**

> *"Help me install this for ## clients."*

Replace `##` with however many QuickBooks companies you plan to connect. Claude
Code sets up the connector and gets everything running.

**2. Get your QuickBooks keys**

> *"Walk me through how to get the API keys from Intuit Developer."*

Claude Code walks you step by step through creating an app at
[developer.intuit.com](https://developer.intuit.com) and copying your Client ID
and Client Secret — no guessing where to click.

> 💡 **Start with Development keys and a sandbox company.** On
> [developer.intuit.com](https://developer.intuit.com), go to **My Hub →
> Sandboxes**, add a sandbox company, and use your **Development** keys. Nothing
> you do there is real, so it's the right place to learn what the connector does.
>
> **Going to production takes an extra step.** Intuit does not accept a
> `localhost` or plain-`http` Redirect URI for **Production** keys — it requires
> an `https` address that isn't localhost. The `http://localhost:3000/callback`
> address this connector uses out of the box therefore works with **Development
> keys only**. To connect real books you'll need to put an `https` address in
> front of the connector (an HTTPS tunnel such as ngrok is the usual way) and
> register that address on your Intuit app instead. Ask Claude Code to help with
> this when you get there.

**3. Add your credentials safely**

> *"Help me add the credentials locally without ever putting the credentials on
> this chat."*

This tells Claude Code to save your keys into a local settings file (`.env`) on
your computer — never typed into a chat window, never sent anywhere.

> ⚠️ **Never paste your Client ID, Client Secret, or QuickBooks login into a
> Claude conversation.** If Claude ever asks you to type a credential straight
> into the chat, stop and tell it to save it to the local file instead.

## Step 5: Restart Claude Desktop

- **macOS:** quit Claude Desktop completely (`Cmd + Q`), then reopen it
- **Windows:** right-click the Claude icon in the system tray (bottom-right, by
  the clock), choose **Quit**, then reopen it — just closing the window isn't
  enough

Your connected companies should now show up, and you can ask things like *"list
my QuickBooks companies"* or *"show me last month's profit and loss for
[client]."*

---

## What You Can Do

Once connected, you can ask Claude things like:

- *"Show me the aged receivables for Acme Corp"*
- *"Create an invoice for [client] for last month's bookkeeping fee"*
- *"Pull the P&L, balance sheet, and cash flow for all my clients"*
- *"Import this bank CSV — show me a preview before posting anything"*
- *"Switch to working on [client] and show me their overdue invoices"*

---

## Common Problems & Questions

| Problem | Solution |
| --- | --- |
| QuickBooks companies don't show up in Claude Desktop | Make sure you fully quit Claude Desktop (not just closed the window) and reopened it — see Step 5. |
| Login/authentication errors | Ask Claude Code to re-check your Client ID and Client Secret, and to confirm the Redirect URI registered on [developer.intuit.com](https://developer.intuit.com) matches your settings file exactly. |
| The `.env` file won't save, or Claude can't create it | Easiest fix: open **`.env.example`** on the project page, copy its contents into TextEdit (macOS) or Notepad (Windows), and save it as a plain **text file** inside the project folder. Then tell Claude Code *"use that text file as my `.env`"* — it'll take it from there. |
| Does it have to be on the Desktop? | No. Anywhere on your computer works. We use the Desktop in these instructions just because it's easy to find again — point Claude Code at whichever folder you actually used. |
| What if I add more clients later? | Don't repeat the setup. In Claude Code, say *"add another QuickBooks company"* (or type `/add-qbo-company`) — the built-in **add-qbo-company** skill handles the whole thing, then restart Claude Desktop. |
| Are my credentials safe? | Your **keys and login passes** stay on your own computer and only ever go to Intuit (QuickBooks) directly — never to Opzer or anyone else. There's no cloud server in the middle. More detail in [SECURITY.md](SECURITY.md). |
| Where does my QuickBooks **data** go? | To Claude. This is the part people miss: invoices, customer records, reports, balances and transaction descriptions that the connector pulls are placed into the Claude conversation, so they're processed by **Anthropic** under your Claude plan, settings and retention terms. That's not a bug — it's how Claude can answer questions about your books — but if you handle client data you need to know it, and your clients may need to have agreed to it. See [docs/data-and-compliance.md](docs/data-and-compliance.md). |
| Can this accidentally post something to the wrong client? | It's guarded, but "no" would be too strong. The connector will never **guess** which company a write goes to — if you haven't named one, it stops and asks. But once you've said *"work on Acme"*, every later write goes to Acme until you switch. To make that visible, every write now reports back which company, which realm ID, and whether it was a **sandbox** or a **PRODUCTION** company. Read that line. |

---

## What This Connector Can Reach

Most of the 54 tools do the obvious thing — pull a report, create an invoice.
Three of them reach further than people expect, and they're on by default because
they're genuinely useful. Here's the honest trade-off on each.

| Tool | What it buys you | What it can also do |
| --- | --- | --- |
| **`attach_file`** | Attach receipts, contracts and statements to records without leaving the chat. | It uploads **whatever file path it's given** to QuickBooks. Pointed at this project's own `.env` or `tokens.*.json`, it would upload your Intuit secret or a QuickBooks access pass into QuickBooks as a downloadable attachment. There's no restriction on which file it will read. |
| **`import_transactions_from_csv`** | Turn a bank CSV into categorised transactions in one go. | It reads **any file path**, and it **posts live by default** — you have to ask for a preview (`dry_run`) to get one. Categories are a keyword guess, and anything it can't match lands in an arbitrary expense account. If the file isn't a CSV, its error message quotes the file's first line back into the chat. |
| **`api_request`** | The escape hatch: reach any QuickBooks endpoint this connector doesn't wrap. | It reaches **every** operation in the API, including permanent deletes. It's limited to GET and POST, but that isn't a real limit — QuickBooks does deletes as a POST. |

**Why this matters more than it sounds.** The connector feeds Claude text that
came out of QuickBooks — customer names, invoice memos, transaction descriptions,
notes on attachments. Some of that text was written by people outside your firm.
Claude can't reliably tell an instruction written in a vendor's bill memo from an
instruction you typed. That's the real risk here: not Claude deciding to do
something odd on its own, but Claude acting on text it read out of the books.

**What to actually do about it**

- **Use Claude Desktop's tool permissions.** Open **Settings → Connectors → qbo →
  Tool permissions**. Every tool is now labelled read-only or destructive, so you
  can see at a glance which is which. Set the three tools above to **Needs
  approval** or **Never** unless you're actively using them. Reports and lookups
  can safely be **Always allow**.
- **Ask for a preview.** For the CSV importer, say *"show me a preview before
  posting anything"* — that's the `dry_run` path, and it isn't the default.
- **Read the write line.** Every write now reports the company, realm and whether
  it was sandbox or **PRODUCTION**.
- **Practise in a sandbox** before pointing any of this at a client.

Full technical detail in
[DEVELOPER.md → Powerful tools](DEVELOPER.md#powerful-tools--what-they-can-reach).

---

## Copy It, Fork It, Rip It Apart

This project is released into the **public domain** under
[CC0 1.0](LICENSE). Copy it, fork it, strip it for parts, put it inside your own
product, use it with your clients — commercially or not. You don't need our
permission and you don't need to credit us. A shout-out to
[Opzer](https://opzer.co) is appreciated, never required.

Two caveats worth knowing, because CC0 waives copyright and nothing else:

- **Trademarks aren't included.** "QuickBooks" and "Intuit" belong to Intuit;
  "Claude" belongs to Anthropic. If you ship your own product based on this, pick
  your own name. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **Dependencies keep their own licenses.** The npm packages this installs are
  not covered by our dedication — they're MIT and BSD-2-Clause, listed in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Need Further Help?

If in doubt, ask Claude Code itself — it can re-check a connection, re-authorize
a company, or add another one for you.

This is an early-access build from [Opzer.co](https://opzer.co). We'd love your
feedback — reach us at **[team@opzer.co](mailto:team@opzer.co)**.

Found a **security** problem? Please don't open a public issue — see
[SECURITY.md → Reporting a vulnerability](SECURITY.md#reporting-a-vulnerability).

> **Developers:** the technical setup, full tool list, and architecture live in
> **[DEVELOPER.md](DEVELOPER.md)**.
>
> **Handling client data?** [docs/data-and-compliance.md](docs/data-and-compliance.md)
> covers what data goes where, Intuit's expectations, API limits, and how to
> disconnect.
