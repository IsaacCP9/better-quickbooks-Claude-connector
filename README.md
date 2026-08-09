# 🧾 Better QuickBooks Connector

> **Independent open-source project.** Not affiliated with, endorsed by, or sponsored
> by Intuit Inc. or Anthropic, PBC. QuickBooks and Intuit are trademarks of Intuit
> Inc.; Claude and Anthropic are trademarks of Anthropic, PBC. Both are used here
> only to describe what this software works with.

Give Claude direct access to QuickBooks Online — for **all your client companies
from one connector**, not one at a time. Pull reports, create invoices, enter
transactions, and more, all through natural conversation.

**No Terminal, no command line, at any point.** You download a folder, point
Claude Code at it, and talk to it in plain English.

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
3. That's it — Claude Code now has access to just this one folder, nothing else
   on your computer. A chat box appears in the app. That's where you'll paste
   the messages in the next step.

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

> 💡 **Start in a sandbox.** This is an early-access build that can write to real
> books, so practise somewhere nothing is real first: on
> [developer.intuit.com](https://developer.intuit.com), go to **My Hub →
> Sandboxes**, add a sandbox company, and use your **Development** keys. Once
> you've seen how the tools behave — especially the ones that create invoices,
> bills, and journal entries — switch to **Production** keys for real client
> books. Production works fine; the point is to understand what you're pointing
> at a client's ledger before you do it.

**3. Add your credentials safely**

> *"Help me add the credentials locally without ever putting the credentials on
> this chat."*

This tells Claude Code to save your keys into a local settings file (`.env`) on
your computer, rather than having you type them into a chat window. That file
stays on your machine, and the connector sends its contents only to Intuit when
it signs in.

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
| Are my credentials safe? | Your Intuit keys and access tokens are stored locally, in plain files inside the project folder, and are transmitted only to Intuit — never to Opzer or anyone else. There's no cloud server in the middle. That covers the *credentials*; it does not describe where your accounting data goes — see the next row. Full detail in [SECURITY.md](SECURITY.md). |
| Where does my QuickBooks data go? | Into your Claude conversation. Every invoice, customer record, report, balance, and transaction description a tool returns is passed to Claude as part of the chat, and is therefore processed by Anthropic under your Claude plan, privacy settings, and any organizational policies that apply. If you're a firm using this on client books, read the [data-flow section of SECURITY.md](SECURITY.md#where-does-my-quickbooks-data-go) before you connect a client. |
| Can this accidentally post something to the wrong client? | It's guarded, not impossible. When several companies are connected, anything that changes your books (an invoice, a bill, a journal entry) will not guess which one — it stops and asks you to name the company. But that guard has a known gap on single-company installs, and a mistyped company name can resolve to a different company. See [Can it change the wrong company's books by accident?](SECURITY.md#can-it-change-the-wrong-companys-books-by-accident) and the [known limitations](SECURITY.md#known-limitations). |
| Which tools should I be careful with? | Four have much broader reach than their names suggest: `api_request` (can call any QuickBooks endpoint, including deletes), `query` (can pull an entire company's ledger in one call), and `attach_file` / `import_transactions_from_csv` (both read any file on your computer). Keep them on **"ask every time"** in Claude Desktop. Details in [SECURITY.md](SECURITY.md#the-escape-hatch-tools). |

---

## Copy It, Fork It, Rip It Apart

This project is released under **[MIT No Attribution](LICENSE)** (MIT-0). Copy it,
fork it, strip it for parts, put it inside your own product, use it with your
clients — commercially or not. You don't need our permission, and MIT-0 is the rare
license that doesn't even ask you to keep our copyright notice, so you genuinely
don't need to credit us. A shout-out to [Opzer](https://opzer.co) is appreciated,
never required.

Two things the license does **not** do:

- **No warranty.** The code is provided "as is" — see the disclaimer in
  [LICENSE](LICENSE). It writes to real accounting records; you're responsible for
  what it does on your books.
- **No trademark rights.** MIT-0 covers copyright only. QuickBooks and Claude are
  other companies' trademarks, and this project isn't affiliated with either of them.

The three npm packages this depends on keep their own licenses —
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which also documents where
the code came from.

## Need Further Help?

If in doubt, ask Claude Code itself — it can re-check a connection, re-authorize
a company, or add another one for you.

This is an early-access build from [Opzer.co](https://opzer.co). We'd love your
feedback — reach us at **[team@opzer.co](mailto:team@opzer.co)**.

It's provided as-is, with no warranty, and it isn't accounting, tax, or legal
advice. You're responsible for reviewing anything it posts to real books.

> **Developers:** the technical setup, full tool list, and architecture live in
> **[DEVELOPER.md](DEVELOPER.md)**.
