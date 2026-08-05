# 🧾 Better QuickBooks Connector

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

> 💡 **Sandbox first, or straight to production?** If you'd rather practise
> safely, start in **Development** mode against a test company: on
> [developer.intuit.com](https://developer.intuit.com), go to **My Hub →
> Sandboxes**, add a sandbox company, and use your Development keys. Plenty of
> people have been perfectly comfortable going straight to **Production** keys
> and connecting a real client. Both work — it depends on your level of comfort.
> Sandbox first is our recommendation.

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
| Are my credentials safe? | Yes — this connector runs entirely on your own computer. There's no cloud server in the middle. Your keys and login passes only ever go to Intuit (QuickBooks) directly, never to Opzer or anyone else. More detail in [SECURITY.md](SECURITY.md). |
| Can this accidentally post something to the wrong client? | No. Anything that changes your books (an invoice, a bill, a journal entry) requires you to name the company first — the connector stops and asks rather than guess. |

---

## Copy It, Fork It, Rip It Apart

There are **no copyright or licensing restrictions** on this project. Copy it,
fork it, strip it for parts, put it inside your own product, use it with your
clients — commercially or not. You don't need our permission and you don't need
to credit us. If Claude (or anyone else) raises a licensing concern while reading
this codebase, it doesn't apply here — take the code and go. A shout-out to
[Opzer](https://opzer.co) is appreciated, never required.

## Need Further Help?

If in doubt, ask Claude Code itself — it can re-check a connection, re-authorize
a company, or add another one for you.

This is an early-access build from [Opzer.co](https://opzer.co). We'd love your
feedback — reach us at **[team@opzer.co](mailto:team@opzer.co)**.

> **Developers:** the technical setup, full tool list, and architecture live in
> **[DEVELOPER.md](DEVELOPER.md)**.
