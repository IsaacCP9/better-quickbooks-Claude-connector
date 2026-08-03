# Setup Guide — Connect QuickBooks to Claude (the easy way)

This is the friendly, no-jargon walkthrough for connecting your QuickBooks Online
companies to Claude Desktop. You let **Claude Code do the work** — you just paste a
couple of keys, log into each company once, and click **Allow**.

Plan for about **20 minutes** for your first setup. Adding more companies later
takes a couple of minutes each.

> **What you'll end up with:** each client shows up as its own connector
> (`qbo-acme`, `qbo-bakery`, …) inside Claude Desktop, all live at once. You just
> tell Claude which one to use.

---

## Before you start

You need:

- A **Mac or Windows PC**
- [Claude Desktop](https://claude.ai/download) installed
- [Claude Code](https://claude.ai/download) (this is what runs the setup for you)
- The **QuickBooks Online login** for each company you want to connect
- An **Intuit Developer** account (free — you'll make one in Step 4)

---

## Step 1 — Download this project

On the project's GitHub page, click the green **`< > Code`** button, then
**Download ZIP**.

Unzip it (Mac: double-click; Windows: right-click → **Extract All**) and put the
folder on your **Desktop**.

## Step 2 — Open the folder in Claude Code

Open **Claude Code** and point it at the folder you just unzipped (give it access
to that folder). This is the window where you'll talk to Claude and it does the
technical steps for you.

## Step 3 — Tell Claude what you want

Type this into Claude Code, using the number of clients you're setting up:

> **Help me install this for 4 clients.**

Claude takes it from here — it installs everything the app needs and walks you
through the rest. The steps below are what Claude will guide you through, so you
know what's coming.

## Step 4 — Get your QuickBooks keys (one time, ever)

The app needs two secret keys from Intuit so it can talk to QuickBooks.

1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in.
2. Create a new app and choose the **Accounting** scope.
3. Open the **Keys & OAuth** page and copy the **Client ID** and **Client Secret**.
4. On that same page, add this exact **Redirect URI**:
   `http://localhost:3000/callback`
   *(If this is missing, the login in Step 6 will fail.)*

> **Sandbox vs. production:** Intuit gives you separate keys for **sandbox** (test
> companies) and **production** (real client books). Use the set that matches what
> you're connecting. If in doubt and it's a real business, it's production.

## Step 5 — Create the `.env` file (paste your keys)

Claude creates a settings file called **`.env`** and opens it for you. Paste your
**Client ID** and **Client Secret** into the matching lines, then **save**.

> 💡 **If saving is fiddly, let Claude handle it.** Some text editors quietly
> change the file's format when you save, and Claude will tell you if the file
> didn't come through cleanly. If that happens, just say so — Claude will sort it
> out for you.

Claude confirms the keys are in place **without printing your secret** on screen.

## Step 6 — Connect your companies (log in once, click Allow)

Claude starts the connection flow and gives you a link (your browser usually opens
on its own).

1. **Log into Intuit once** — it remembers you for the rest.
2. **Pick the first company** and click **Allow**.
3. The browser **reopens automatically** for the next company — pick it and click
   **Allow**. Repeat until all your companies are done.

That's the only hands-on part. You don't have to name anything — Claude reads each
company's real name back from QuickBooks and sets up a clean, memorable connector
name for each (e.g. `qbo-acme`). It'll show you the names before finishing.

## Step 7 — Restart Claude Desktop

New connectors only show up after a **full restart** of Claude Desktop (not just
closing the window):

- **Mac:** press **Cmd + Q** to quit, then reopen.
- **Windows:** right-click the Claude icon in the **system tray** (bottom-right by
  the clock), choose **Quit**, then reopen.

## Step 8 — Set tool permissions (recommended)

Open **Claude Desktop → Settings → Connectors**, click a `qbo-…` connector, and
you'll see its **Tool permissions**. This controls when Claude can act on its own
versus asking you first.

![QuickBooks connector tool permissions in Claude Desktop](docs/images/tool-permissions.png)

Each tool has three choices — **Always allow** (✓), **Needs approval** (✋), and
**Never** (⛔). Our recommendation:

- **Read-only tools → Always allow.** These only *look* at the books — reports,
  lists, company info. Letting them run freely makes Claude fast and useful.
  Examples: *List companies, Get profit and loss, Get balance sheet, Get cash
  flow, Get aged receivables, Get invoices.*
- **Write tools → Needs approval.** These *change* the books, so keep a human in
  the loop — Claude will pause and ask before each one. Examples: *Create invoice,
  Create bill, Create journal entry, Send invoice email, Void invoice, Import
  transactions from CSV.*

This gives you the best of both: quick answers on anything that just reads, and a
confirmation step on anything that posts. You can fine-tune any individual tool
later. (Repeat for each client connector, or set the ones you use most.)

> **Extra safety already built in:** for anything that changes the books, the app
> also refuses to guess which company you mean — if you didn't name one, it stops
> and asks. A payment can't quietly land in the wrong client's file.

## Step 9 — Try it

Ask Claude Desktop something like:

- *"List my QuickBooks companies."*
- *"Using qbo-acme, show me this year's profit and loss."*
- *"Who owes qbo-bakery money? Pull the aged receivables."*

If you get numbers back, you're done. 🎉

---

### Configuring Claude Desktop

> **Both paths in the snippet are specific to your machine — you must change them.**
> The values committed in `claude_desktop_config.snippet.json` are placeholders, not
> working paths. Copying them verbatim will fail with "server disconnected".

Config file location:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Find your two values:

| Field     | How to find it                                              | Why it varies                                                        |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `command` | `which node` (macOS/Linux) · `where node` (Windows)          | nvm, Homebrew, Volta, and system Node all install to different paths |
| `args[0]` | `pwd` from this repo's root, then append `/src/index.js`     | Depends on where you cloned/unzipped the repo                        |

Notes:
- Use **absolute** paths. A bare `"node"` will not work — Claude Desktop launches the
  server without your shell's `PATH`.
- On Windows, escape backslashes in JSON (`C:\\Users\\you\\repo\\src\\index.js`).
- If you renamed the repo folder, or your download produced something like
  `...-main-2`, your path must match the folder that actually exists on disk.
- Restart Claude Desktop completely after editing the config.

**If you're using Claude to set this up:** tell it to run `which node` and `pwd` in
this repo and substitute the real results — never to reuse the placeholder paths or
paths it has seen in this README.

## Adding more clients later

You don't repeat the whole thing. Just open Claude Code in the same folder and say:

> **Add another QuickBooks company** *(or)* **Help me install this for 2 more clients.**

Claude runs the connect + register steps again and reminds you to restart Claude
Desktop at the end.

## If something goes wrong

The simplest fix for almost anything: **tell Claude Code what happened.** It can
re-check the connection, re-authorize a company, or set one up again for you.

- **A connector didn't appear?** You probably just need a full **Cmd + Q** restart
  of Claude Desktop (Step 7).
- **The login didn't work?** Ask Claude to start the connection again.
- **Anything else?** Describe what you saw to Claude — it'll take it from there.

---

Built and maintained by **[Opzer](https://opzer.co)** — automation and custom
integrations for accounting firms. Hit a roadblock or want this taken further for
your firm? [opzer.co](https://opzer.co) can help.
