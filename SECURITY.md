# Security — Questions and Answers

This app can read and change real QuickBooks data. That is a big deal. Here are
the common safety questions, answered in plain words.

Where a question has a caveat, the caveat is stated rather than rounded off. The
[known limitations](#known-limitations) at the end list the gaps we're aware of, with
pointers into the code so you can check them yourself.

## What secret things does this app use?

Two things (that we've kept locally to keep them off the internet):

- **Your keys** — the Client ID and Secret from Intuit. They live in a file
  called `.env`.
- **Your tokens** — special passes that let the app open your books without your
  password each time. They live in files named `tokens.json` or
  `tokens.<nickname>.json`, one per company.

Anyone who gets these could reach your books.

## Where does my QuickBooks data go?

This is the question people most often get wrong, so it's worth being precise. There
are two separate flows, and they have different answers.

**Your credentials go to Intuit only.** The Client ID, Client Secret, and the access
and refresh tokens are stored on your own computer and transmitted only to Intuit's
servers. There is no cloud service in the middle. They never reach Opzer, Anthropic,
or anyone else.

**Your accounting data goes to Claude.** Everything a tool *returns* — invoices,
customer records, vendor details, reports, balances, transaction descriptions,
general ledger lines — is placed into the Claude conversation so Claude can answer
you. That means it is processed by Anthropic, subject to your Claude plan, your
privacy settings, your retention terms, and any policies your organization has set.

That is not a flaw; it is how any MCP connector works. Claude cannot tell you your
aged receivables without being shown your aged receivables. But it does mean
"nothing leaves my computer" is **not** an accurate description of this connector,
and you should not describe it that way to a client.

Two practical consequences:

- A single `query` or a broad report can move a large amount of a company's ledger
  into the conversation at once. Ask for what you need.
- Whatever your Claude settings do with conversation content — retention, training
  preferences, team or enterprise administration — applies to that accounting data.

### If you're a firm using this on client books

Treat this as a data-processing decision, not just a tooling one:

- **Anthropic is a processor (or subprocessor) of your client's financial data** the
  moment you run a tool against their books. Disclose it where your engagement
  letters, privacy notice, or subprocessor list require it.
- **Confirm the client has authorized this flow** before you connect their company.
  "We use AI internally" is usually not specific enough consent for pushing their
  ledger through a third-party model.
- Check whether your plan is the right one. Consumer, team, and enterprise Claude
  plans differ in retention and administrative control; that difference matters more
  for client financial records than for your own notes.
- Jurisdiction-specific rules (GDPR/UK GDPR, state privacy laws, professional-body
  guidance for accountants) may impose additional requirements. This document isn't
  legal advice.

## Are these secrets shared when I put the code online?

No — `.env` and every token file are on the `.gitignore` list, so `git` won't commit
them. The rule for tokens is `tokens*.json`, which covers all of them, not just one.
Your exported reports folder and other extras are on the list too. When someone
downloads this project, they get **no** secrets; they add their own keys and connect
their own QuickBooks.

Two things `.gitignore` can't do for you:

- It only protects files **in this project folder, with these names**. A token file
  you copy to your Desktop, a `.env` you paste into a note, or a backup of your
  Claude Desktop config is not covered.
- It doesn't help with anything already committed. If a secret ever did get pushed,
  removing it in a later commit doesn't remove it from history — rotate it (below).

## How are my secrets stored on disk?

Honestly: in plain text, with no encryption and no special file permissions.

- `.env` and `tokens*.json` are ordinary readable files in the project folder. The
  code that writes tokens (`saveTokens`, `src/qbo.js:97-101`) sets no file mode, so
  they land at your system default — typically `0644`, meaning other user accounts on
  the same machine can read them.
- Nothing goes into the macOS Keychain, Windows Credential Manager, or any secret
  store. A refresh token is valid for ~100 days, so a copied token file keeps working
  for a long time.
- They live **inside the same folder you point Claude Code at** during setup. Any
  agent or process with read access to the project can read every connected
  company's tokens.
- If you registered a production company with the `add-qbo-company` skill, your
  Client ID and Secret were also written in plain text into your Claude Desktop
  config (`register_connector.py:85`), and that script leaves timestamped
  `claude_desktop_config.json.bak-*` backups behind (`register_connector.py:75-78`)
  which are never cleaned up. Those backups contain the secret too. Delete old ones.

If you're on a shared or managed machine, there are two things you can do:

**Tighten the file permissions:**

```bash
chmod 600 .env tokens*.json
```

**Move the token files out of the project folder** by setting `QBO_TOKENS_DIR` in
your `.env` (or in the connector's `env` block in the Claude Desktop config):

```bash
QBO_TOKENS_DIR=~/.config/qbo-mcp
```

Tokens then live outside the directory you hand to Claude Code, so an agent with
file access to the project can no longer read them. Leave it unset and everything
behaves exactly as before. Note this moves the *tokens* only — `.env` itself, and
the copy of your client secret that the `add-qbo-company` skill writes into the
Claude Desktop config, are unaffected.

## What if a secret gets shared by mistake?

Treat it like a lost house key: change the locks.

1. Go to the Intuit developer site and make a new Client Secret (this turns off
   the old one).
2. Run `npm run connect` again to get fresh tokens.

After that, the leaked secret no longer works. If the leak was a *token* file rather
than the keys, revoking the app's access from inside the QuickBooks company
(Settings → Apps) also invalidates it.

## Can one company's data mix with another company's?

Each company has its own token file, and both the company ID (`realmId`) and the
sandbox-vs-production server address are read from that file for every request
(`src/qbo.js:326-332`). So a request for one company carries that company's
credentials and goes to that company's environment — the two aren't interleaved.

What that does **not** rule out is picking the wrong file in the first place. That's
the next question.

## Can it change the wrong company's books by accident?

There is a safety gate, and it works in the normal multi-company case. It is not
absolute.

**What the gate does:**

- Every action can take a company name.
- You can set an active company first, so you don't repeat yourself.
- For anything that **changes** your books (an invoice, a journal entry, a payment),
  the app will not guess the company when several are connected. If you didn't say
  which one, it stops and asks. Only read actions may assume the company when there
  is exactly one.

**Where it can still go wrong:**

- **Single-company installs skip the gate.** If you authorized with plain
  `npm run connect` (which writes `tokens.json` rather than `tokens.<slug>.json`),
  company resolution returns early before the write check runs
  (`src/index.js:194`). Every write then posts to that one company without you
  naming it. That's usually what you want — but it is not the "always asks first"
  behaviour described above, and if that file is a production company, writes go
  straight to real books. Prefer `QBO_COMPANY=<slug> npm run connect`.
- **A mistyped company name can resolve to a real one.** The name you pass is
  cleaned up rather than rejected (`sanitizeSlug`, `src/qbo.js:34-36`), so
  `"acme corp"` becomes `acmecorp` and `"acme/prod"` becomes `acmeprod`. If the
  cleaned-up version happens to match a connected company, the call succeeds against
  *that* company with no warning.
- **The active company is sticky.** Once set, it stays set for the whole session, and
  no write result tells you which company or which environment it landed in.
- **Nothing warns you that a company is production.** Sandbox and production
  companies sit side by side in the same connector and look the same at the moment
  you run a tool.

So: the gate meaningfully reduces wrong-company writes. It does not make them
impossible. Before a batch of writes, run `get_active_company` and read the answer.

## The escape hatch tools

Most of the 54 tools do one narrow thing. Four are much broader than their names
suggest, and they're the ones worth understanding before you connect a client.

Nothing in the server asks you to confirm before any of these run. The only real gate
is Claude Desktop's per-tool approval, so **leave all four on "ask every time"** —
see the tool-permissions section of [DEVELOPER.md](DEVELOPER.md).

### `api_request` — can reach anything in QuickBooks

A raw authenticated call to any QuickBooks endpoint for the selected company
(`src/index.js:1639`). It exists so you're never blocked by a missing wrapper tool,
and it's genuinely useful for that.

It only accepts `GET` and `POST`, which sounds restrictive but isn't: the QuickBooks
API performs **every** mutation over POST. That includes deleting records
(`?operation=delete`), voiding them (`?operation=void`), emailing them (`/send`), and
batching up to 30 operations in one call (`/batch`). So `api_request` can reach the
entire write and delete surface of the company's books, including things no other
tool in this server exposes.

There is no allowlist, no denylist, and no confirmation in the code. The write gate
does apply — a POST won't auto-pick among several companies — but within the selected
company it is unrestricted.

### `query` — can pull an entire ledger in one call

Runs an arbitrary QuickBooks SQL-style `SELECT` against any entity
(`src/index.js:582`). It cannot change anything: the QuickBooks query language is
read-only and this always issues a GET.

The risk is volume, not damage. There's no entity restriction and no row cap, so one
call can pull every customer, vendor, employee, account, and transaction in a company
into the Claude conversation. Combined with the [data-flow
section](#where-does-my-quickbooks-data-go) above, that's a lot of client data moving
at once. Note also that unlike write tools, `query` **will** auto-select the company
when only one is connected.

### `attach_file` and `import_transactions_from_csv` — can read any file on your computer

Both take a file path and read it with no restriction on location, extension, or size
(`src/index.js:1580` and `src/index.js:909`). They're meant for a client's receipt or
a bank CSV.

`attach_file` then **uploads that file's contents to QuickBooks** and links it to a
record, where anyone with access to that company's books can download it. Because
there's no path restriction, the file it uploads could be this project's own `.env`
or `tokens.*.json`, or anything else your user account can read. Nothing in the code
prevents that.

`import_transactions_from_csv` doesn't upload the file, but it will batch-post
transactions from it. It has a `dry_run` option that previews without posting — use
it first, every time.

## Do the tokens expire?

Yes, and that is good. The app refreshes them on its own before they run out. If
they ever fully expire (about 100 days unused), you just run `npm run connect`
again.

## Could my tokens show up in a log or a screen somewhere?

Not in normal operation. All of the app's logging goes to a side channel (stderr),
never to the main output Claude reads, and it doesn't log token values on the success
path.

One exception: if signing in to Intuit *fails*, the app includes Intuit's response in
the error message it returns (`src/qbo.js:205`, `:267`, `:420`). Those responses
normally contain an error code rather than a credential, but they aren't filtered, so
treat a token-exchange failure message as potentially sensitive and don't paste it
into a public issue without reading it first.

## What is the difference between "sandbox" and "production"?

- **Sandbox** = a fake, practice company from Intuit. Safe to play in. Nothing is
  real.
- **Production** = your real books. Changes here are real. Money, invoices, and
  bills are the actual ones.

Before you run any action that changes things, make sure you know which company
is active — especially if it is a production one. Nothing in the connector will warn
you that you're pointed at production.

## Known limitations

These are real, we know about them, and they aren't fixed yet. They're listed here
rather than smoothed over so you can decide what it means for your setup.

Items 1-3 each have a test that pins the current behaviour, marked `KNOWN GAP` in
the suite. That's deliberate: it means fixing one turns a test red and forces a
conscious decision, instead of the behaviour drifting unnoticed in either
direction.

1. **The write gate is bypassed on legacy single-file installs.** Company resolution
   returns early for a plain `tokens.json` setup before the write check runs
   (`src/index.js:194`), because company discovery deliberately skips that filename
   (`src/qbo.js:107-128`). Writes post without an explicit company. Use
   `QBO_COMPANY=<slug> npm run connect` to avoid it.
2. **Company names are cleaned rather than validated.** `sanitizeSlug`
   (`src/qbo.js:34-36`) strips unexpected characters instead of rejecting the input,
   so a typo or a mistaken guess can silently collapse into a *different* connected
   company that then passes validation.
3. **`api_request` paths aren't checked for `..`.** The path you pass is concatenated
   onto the company URL (`src/qbo.js:330-332`), and URL parsing resolves `..`
   segments, so a path can escape the `/v3/company/{realmId}` prefix the tool
   description promises. Intuit's tokens are scoped to one company, so such a call
   should be rejected at their end — but this server doesn't stop it from being sent.
4. **No read-only mode.** There's no flag to run the connector with the 35 mutating
   tools disabled. A read-only deployment currently means editing the code.
5. **No audit log.** Nothing records which company, tool, or payload was executed.
   If you need an audit trail of what an AI did to a client's books, this doesn't
   provide one — check the QuickBooks audit log instead.
6. **No rate limiting or size caps.** No request budget, no cap on rows returned, no
   cap on file size read or uploaded.
7. **Secrets are stored unencrypted at default file permissions.** See
   [How are my secrets stored on disk?](#how-are-my-secrets-stored-on-disk) above.

## Reporting a problem

Found something worse than the above? Email **[team@opzer.co](mailto:team@opzer.co)**
rather than opening a public issue, and give us a chance to fix it first.

---

This connector is provided as-is with no warranty (see [LICENSE](LICENSE)), and
nothing in this document is accounting, tax, or legal advice. It is also an
independent project — not affiliated with, endorsed by, or sponsored by Intuit Inc.
or Anthropic, PBC.
