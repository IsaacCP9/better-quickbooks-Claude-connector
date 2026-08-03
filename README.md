# Better QuickBooks Connector

Connect Claude Desktop straight to **QuickBooks Online** — and work in **all your
companies from one connector**, not one at a time. Read *and* write.

Built on the [Model Context Protocol](https://modelcontextprotocol.io).
Developed by **[Opzer](https://opzer.co)** — automation and custom integrations
for accounting firms.

## Who this is for

This is for **accountants and bookkeepers** who use QuickBooks Online for more
than one company and want Claude to help with real work — pulling reports,
cleaning up the books, sending invoices, and entering transactions.

The QuickBooks connector that comes built into Claude has two big limits:

- It is **read-only.** It can look, but it cannot make an invoice, a bill, or a
  journal entry.
- It points at **one company at a time.** If you handle 5, 20, or 50 client
  files, switching back and forth gets slow and clumsy.

This tool fixes both:

- **Many companies, one connector.** Connect all your client files once. Then
  just tell Claude which one to use — *"work on Acme."* No switching connectors,
  no restarts.
- **Read *and* write.** Create invoices, bills, journal entries, and more — the
  things you actually do in QuickBooks.
- **54 tools** covering reports, transactions, lists, attachments, and a safe
  bulk CSV import.

You do **not** need to know how to code. The setup below is copy-and-paste.

> 👉 **Prefer an even simpler walkthrough?** See
> **[SETUP_GUIDE.md](SETUP_GUIDE.md)** — the same process boiled down to just
> telling Claude Code *"help me install this for N clients"* and pasting your keys.

## What you can do

- **Pull reports:** Profit & Loss, Balance Sheet, Cash Flow, Trial Balance,
  General Ledger, A/R and A/P aging, overdue invoices.
- **Enter and edit work:** customers, vendors, items, accounts, invoices, bills,
  expenses, estimates, sales receipts, credit memos, payments, deposits, and
  journal entries.
- **Speed up month-end:** import a bank CSV (with a preview first), attach source
  documents, and run collections.
- **Work across clients:** switch between companies in one connector, or name one
  per request.

---

## Security — what we did to keep your books safe

This app can change **real** accounting data, so safety was built in from the
start. Here is **every** safety feature, in plain words.

### It all runs on your own computer

This is the biggest one, and the foundation for the rest. This app is
**local** — it lives on your own computer (Mac or Windows). There is **no
website or cloud server in the
middle**, and nothing to sign up for. The app only ever talks straight to
QuickBooks (Intuit). That means:

- Your keys and login passes **never leave your computer** (except to reach
  QuickBooks itself). You never upload them, and you never share them with us or
  any third party — there is no "us."
- There is **no online service to break into.** No shared database of client
  books sitting on someone else's server.
- You are in full control. If you delete the folder, everything — keys, tokens,
  access — is gone with it.

### Keeping companies from getting mixed up

- **You pick the company. The app never guesses on a write.** You can name the
  company on any request, or set an active one first with **`select_company`**
  (and check it with **`get_active_company`** or **`list_companies`**). For
  anything that **changes** your books — an invoice, a bill, a journal entry —
  the app will **stop and ask** if you did not say which company. It will only
  auto-pick for harmless "read" actions, and only when just one company is
  connected. So a payment can never quietly land in the wrong client's file.
- **Only real company names are accepted.** If you name a company that is not
  connected, the app refuses and shows you the list of ones that are.
- **The company name is cleaned first.** Names are stripped down to plain
  letters, numbers, dashes, and underscores. This stops a tricky name from
  reaching any file outside the app's own folder.
- **Test books and real books stay apart.** Each company remembers whether it is
  a **test (sandbox)** or **real (production)** file, and every request is sent
  to the matching QuickBooks address. A test action cannot hit real books.

### Keeping your secrets safe

- **Secrets never go online.** Your keys (`.env`) and your login passes
  (`tokens*.json`) are on the "never upload" list (`.gitignore`). When someone
  downloads this project, they get **no** secrets — they add their own.
- **Secrets stay on your computer.** Your keys and tokens are only ever sent to
  Intuit (QuickBooks). They are not shared with anyone else.
- **Keys are not baked into the code.** They are read from your private `.env`
  file, so the code can be shared safely.
- **Secrets never show up in logs.** The app writes its notes to a hidden channel
  (not the main output), and it never prints your keys or tokens.

### Keeping the login safe

- **A tamper check on every login.** Each login uses a one-time random code. If
  the code that comes back does not match, the app rejects it. This blocks a
  common web trick.
- **The "catcher" only listens on your own computer.** During login, the app
  opens a tiny helper at `localhost:3000` — *your* machine only — just long
  enough to catch the pass, then it shuts down.
- **That catcher is picky.** It answers only the exact login address and turns
  everything else away.
- **Logins refresh on their own.** Passes renew automatically before they run
  out. If one fully expires (about 100 days unused), you just log in again.

### Keeping changes from going wrong

- **Preview before you post.** The bank-CSV import has a **`dry_run`** mode: it
  shows you what it *would* do — every row and its category — before anything is
  saved. You approve, then it posts.
- **Errors are handled cleanly.** If a request fails, the app returns a clear
  message instead of crashing, so nothing is left half-done.

For a friendly Q&A version of all this, see [SECURITY.md](SECURITY.md).

> ⚠️ Before you connect a **real (production)** company, read the security notes
> above. Never share your `.env` or `tokens*.json` files.

---

## Step-by-step setup (no coding experience needed)

This takes about 20 minutes. You will copy and paste a few commands. You do not
need to understand them — just follow along in order.

**Before you start, you need:**
- A **Mac or a Windows PC**.
- The QuickBooks Online login for the company you want to connect.
- [Claude Desktop](https://claude.ai/download) installed.
- About 20 minutes.

**Step 1 — Install Node (the engine this app runs on).**
Go to [nodejs.org](https://nodejs.org), click the big button that says **LTS**,
and run the file it downloads (a `.pkg` on Mac, a `.msi` on Windows). Click
"Continue" / "Next" until it finishes.

**Step 2 — Download this project.**
On this page, click the green **Code** button, then **Download ZIP**. Unzip it
(Mac: double-click it; Windows: right-click → **Extract All**), and put the
`qbo-mcp-server` folder on your **Desktop**.

**Step 3 — Open a command window.**
- **Mac:** Press `Cmd + Space`, type `Terminal`, and press Enter.
- **Windows:** Press the `Windows` key, type `PowerShell`, and press Enter.

A window with a blinking cursor opens — this is where you paste commands. Paste
the line **for your system** and press Enter:

Mac:
```bash
cd ~/Desktop/qbo-mcp-server && npm install
```
Windows (PowerShell):
```powershell
cd $HOME\Desktop\qbo-mcp-server; npm install
```
This moves into the folder and downloads the parts the app needs. Wait for it to
finish (a minute or two).

**Step 4 — Get your QuickBooks keys.**
The app needs two secret keys from Intuit (the company that makes QuickBooks) so
it can talk to your books.
1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in with
   your Intuit account.
2. Create a new app, and choose the **Accounting** scope.
3. Find the **Keys & OAuth** page. Copy the **Client ID** and **Client Secret**.
4. On that same page, add this exact **Redirect URI**:
   `http://localhost:3000/callback`

**Step 5 — Put your keys into the app.**
Make your settings file and open it. Paste the line **for your system**:

Mac:
```bash
cp .env.example .env && open -e .env
```
Windows (PowerShell):
```powershell
copy .env.example .env; notepad .env
```
A text window opens. Paste your Client ID after `QBO_CLIENT_ID=` and your Client
Secret after `QBO_CLIENT_SECRET=`. Save and close the window.

**Step 6 — Connect a company.**
Pick a short nickname for the company (letters/numbers only, e.g. `acme`). Paste
the line **for your system**, replacing `acme` with your nickname:

Mac:
```bash
QBO_COMPANY=acme npm run connect
```
Windows (PowerShell):
```powershell
$env:QBO_COMPANY="acme"; npm run connect
```
Your web browser opens. Log in to the QuickBooks company and click **Allow**.
When you see "✅ QuickBooks connected," close that browser tab. Repeat this step
for each company you want to add (use a different nickname each time).

**Adding many companies at once?** Use the batch tool — log in once, then just
pick + Allow each company. **Same command on Mac and Windows:**
```bash
npm run connect:batch                 # keeps asking "add another?"
npm run connect:batch -- --count 50   # or do a set number in a row
```

**Step 7 — Tell Claude Desktop about the app.**
The easiest way is to let Claude do it for you: open **Claude Code** and type
`/add-qbo-company`, then follow the prompts. It sets everything up and checks it
worked. (If you'd rather do it by hand, see *Setup (quick reference)* below.)

**Step 8 — Restart Claude Desktop.**
- **Mac:** Quit Claude Desktop completely (`Cmd + Q`), then open it again.
- **Windows:** Right-click the Claude icon in the **system tray** (bottom-right,
  by the clock), choose **Quit**, then open it again. Just closing the window
  isn't enough — it keeps running in the tray.

Your companies now appear, and you can ask things like *"list my QuickBooks
companies"* or *"show me last month's profit and loss for acme."*

**Step 9 — Set tool permissions (recommended).**
In Claude Desktop, open **Settings → Connectors**, click a `qbo-…` connector, and
you'll see its **Tool permissions**. This controls when Claude acts on its own
versus asking you first.

![QuickBooks connector tool permissions in Claude Desktop](docs/images/tool-permissions.png)

Each tool can be set to **Always allow** (✓), **Needs approval** (✋), or **Never**
(⛔). Our recommendation:

- **Read-only tools → Always allow.** They only *look* at the books, so letting
  them run freely keeps Claude fast. Examples: *List companies, Get profit and
  loss, Get balance sheet, Get cash flow, Get aged receivables, Get invoices.*
- **Write tools → Needs approval.** They *change* the books, so keep a human in
  the loop — Claude pauses and asks before each. Examples: *Create invoice, Create
  bill, Create journal entry, Send invoice email, Void invoice, Import
  transactions from CSV.*

You get quick answers on anything that just reads, and a confirmation step on
anything that posts. Repeat for each client connector.

Stuck on a step? Just tell Claude Code what happened — it can re-check the
connection, re-authorize a company, or add another one for you.

> **Developers:** technical setup, the full tool list, and architecture live in
> **[DEVELOPER.md](DEVELOPER.md)**.

## Help & support

### Configure Claude Desktop

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

Built and maintained by **[Opzer](https://opzer.co)** — automation and custom
integrations for accounting firms.

Hit a technical roadblock? Setup won't finish, a tool keeps failing, or you want
something this connector doesn't do yet? **Opzer.co can help.** Opzer builds and
supports custom accounting integrations and can take this further for your firm.

- **Get development help at:** [opzer.co](https://opzer.co)
