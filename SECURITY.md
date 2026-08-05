# Security — Questions and Answers

This app can read and change real QuickBooks data. That is a big deal. Here are
the common safety questions, answered in plain words.

## What secret things does this app use?

Two things (that we've kept locally to keep them off the internet):

- **Your keys** — the Client ID and Secret from Intuit. They live in a file
  called `.env`.
- **Your tokens** — special passes that let the app open your books without your
  password each time. They live in files named `tokens.json` or
  `tokens.<nickname>.json`, one per company.

Anyone who gets these could reach your books.

## Are these secrets shared when I put the code online?

No. The app has a list called `.gitignore`. Files on that list are never saved to
GitHub. The list includes `.env` and **every** token file (the rule is
`tokens*.json`, which covers all of them, not just one). Your exported reports
folder and other extras are on the list too.

When someone downloads this project, they get **no** secrets. They add their own
keys and connect their own QuickBooks.

## What if a secret gets shared by mistake?

Treat it like a lost house key: change the locks.

1. Go to the Intuit developer site and make a new Client Secret (this turns off
   the old one).
2. Run `npm run connect` again to get fresh tokens.

After that, the leaked secret no longer works.

## Can one company's data mix with another company's?

No. Each company has its own token file. When the app makes a request, it picks
the right file for that one company. It also knows whether each company is a test
(sandbox) or a real (production) company, so requests can't go to the wrong place.

## Can it change the wrong company's books by accident?

We built a safety gate to stop that.

- Every action can take a company name.
- You can also set an active company first, so you don't repeat yourself.
- For anything that **changes** your books (like making an invoice or a journal
  entry), the app will **not guess** the company. If you didn't say which one, it
  stops and asks. Only harmless "read" actions may assume the company when there
  is just one.

So a payment or invoice cannot quietly land in the wrong company.

## Do the tokens expire?

Yes, and that is good. The app refreshes them on its own before they run out. If
they ever fully expire (about 100 days unused), you just run `npm run connect`
again.

## Could my tokens show up in a log or a screen somewhere?

The app writes its notes to a hidden channel, not the main output. Your tokens
are never printed where Claude or you would normally see them.

## What is the difference between "sandbox" and "production"?

- **Sandbox** = a fake, practice company from Intuit. Safe to play in. Nothing is
  real.
- **Production** = your real books. Changes here are real. Money, invoices, and
  bills are the actual ones.

Before you run any action that changes things, make sure you know which company
is active — especially if it is a production one.
