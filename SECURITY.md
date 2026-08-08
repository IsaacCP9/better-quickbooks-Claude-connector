# Security — Questions and Answers

This app can read and change real QuickBooks data. That is a big deal. Here are
the common safety questions, answered in plain words.

> **Unofficial and independent.** Not affiliated with, endorsed by, or sponsored
> by Intuit Inc. or Anthropic. QuickBooks and Intuit are trademarks of Intuit
> Inc.; Claude is a trademark of Anthropic.

## Reporting a vulnerability

**Please don't open a public GitHub issue for a security problem.**

- **Preferred:** open a private report through GitHub's
  [Security Advisories](https://github.com/IsaacCP9/better-quickbooks-Claude-connector/security/advisories/new)
  on this repository.
- **Or email:** [team@opzer.co](mailto:team@opzer.co) with "SECURITY" in the
  subject.

Tell us what you found, how to reproduce it, and what an attacker could do with
it. We aim to acknowledge within **5 working days** and to agree a disclosure
timeline with you from there. This is a small early-access project run by
[Opzer](https://opzer.co) — there is no bug bounty, but we will credit you if
you'd like.

If you believe **your own** keys or tokens have leaked, don't wait for us: rotate
them now (see "What if a secret gets shared by mistake?" below).

### Supported versions

| Version | Supported |
| --- | --- |
| Latest commit on `main` | ✅ |
| Anything older | ❌ |

Early access. Fixes go to `main` — update by re-downloading, and re-run your
setup if anything changed.

## What secret things does this app use?

Two things (that we've kept locally to keep them off the internet):

- **Your keys** — the Client ID and Secret from Intuit. They live in a file
  called `.env`.
- **Your tokens** — special passes that let the app open your books without your
  password each time. They live in files named `tokens.json` or
  `tokens.<nickname>.json`, one per company.

Anyone who gets these could reach your books. The app writes token files so that
**only your user account on the computer can read them**, and it writes them in
one atomic step so a crash mid-save can't corrupt them and lose the pass.

If your project folder sits in Dropbox, iCloud Drive or OneDrive, your tokens are
being synced to that cloud service. Set `QBO_DATA_DIR` in `.env` to a path outside
the synced folder to stop that.

## Are these secrets shared when I put the code online?

No. The app has a list called `.gitignore`. Files on that list are never saved to
GitHub. The list includes `.env` (and variations like `.env.local`) and **every**
token file (the rule is `tokens*.json`, which covers all of them, not just one).
Your exported reports folder and other extras are on the list too.

When someone downloads this project, they get **no** secrets. They add their own
keys and connect their own QuickBooks.

Every push also runs an automatic scan of the project's **entire history** for
leaked secrets, not just the newest change.

## What if a secret gets shared by mistake?

Treat it like a lost house key: change the locks.

1. Go to the Intuit developer site and make a new Client Secret (this turns off
   the old one).
2. Disconnect the app in QuickBooks (**Settings → Apps**) so the old passes stop
   working.
3. Run `npm run connect` again to get fresh tokens.

After that, the leaked secret no longer works. If it was ever pushed to GitHub,
assume it is public forever — deleting it from the newest version does not remove
it from the history.

## Can one company's data mix with another company's?

No. Each company has its own token file. When the app makes a request, it picks
the right file for that one company, and the company's ID comes from that file —
never from anything Claude typed. It also knows whether each company is a test
(sandbox) or a real (production) company, so requests can't go to the wrong place.

## Can it change the wrong company's books by accident?

There's a real safety gate, but "no, never" would be overselling it. Here is
exactly what it does and doesn't do.

**What it does:**

- The app will **never guess** which company a write goes to. If you haven't said
  which one, it stops and asks — even when only one company is connected.
- Every write now **tells you where it landed**: the company, its realm ID, and
  whether it was a sandbox or a **PRODUCTION** company.

**What it doesn't do:**

- Once you've said *"work on Acme"*, that choice sticks. Every write after that
  goes to Acme without asking again, until you switch. That's the convenience
  you asked for, and it's also the way a write ends up somewhere you didn't mean.
- It doesn't treat a production company differently from a sandbox one at the
  moment of writing. It labels it — it doesn't stop it.

So: a payment or invoice can't land in a company you never selected. It **can**
land in the company you selected earlier and forgot about. Read the line each
write prints, and switch companies deliberately.

## Could my tokens show up in a log or a screen somewhere?

Token **values** are never printed. The app writes its notes to a hidden channel
rather than the main output, and logs only file paths and company nicknames.

But there's an honest caveat. The `attach_file` tool will read **any file you give
it a path to** and upload it to QuickBooks — including this project's own `.env`
or `tokens.*.json`. So while nothing prints your tokens, the tool surface can
still reach the files that hold them. The `0600` permissions above stop *other
people on your computer* reading them; they don't stop a tool that's already
running as you.

If that matters to you — and if you're handling client books, it should — set
`attach_file`, `import_transactions_from_csv` and `api_request` to **Needs
approval** or **Never** in **Claude Desktop → Settings → Connectors → qbo → Tool
permissions**. Every tool is labelled read-only or destructive there, so the
risky ones are easy to spot. See
[What This Connector Can Reach](README.md#what-this-connector-can-reach).

## Do the tokens expire?

Yes, and that is good. The app refreshes them on its own before they run out.

Two clocks are running: a pass expires after about **100 days unused**, and every
pass also has a **maximum lifetime** regardless of use (Intuit
[changed this in November 2025](https://blogs.intuit.com/2025/11/12/important-changes-to-refresh-token-policy)
— currently capped at five years). The app reads the real expiry date from Intuit
rather than assuming, so it always knows the true deadline. When one lapses, run
`npm run connect` again.

## Where does my QuickBooks data actually go?

To Claude. This is the question most worth understanding.

Your **keys and tokens** only ever go to Intuit. But the **data the connector
fetches** — invoices, customer records, reports, balances, transaction
descriptions — is put into the Claude conversation so Claude can answer your
question. That means it is processed by **Anthropic**, under your Claude plan,
privacy settings and retention terms.

That's not a flaw; it's how the thing works. But "it runs on your own computer"
describes the connector, not the data flow, and the two are easy to confuse.

If you're a firm using this on client books: your clients' financial data is going
to a third party. Make sure your engagement terms and privacy notice cover it.
Details in [docs/data-and-compliance.md](docs/data-and-compliance.md).

## What is the difference between "sandbox" and "production"?

- **Sandbox** = a fake, practice company from Intuit. Safe to play in. Nothing is
  real.
- **Production** = your real books. Changes here are real. Money, invoices, and
  bills are the actual ones.

Before you run any action that changes things, make sure you know which company
is active — especially if it is a production one. Every write prints this now, in
capitals when it's production.
