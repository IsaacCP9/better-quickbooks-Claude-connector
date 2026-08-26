# Troubleshooting: adding a QBO company

Read this when a step in `SKILL.md` fails. Each entry is symptom → cause → fix.

## "Token exchange failed" during `npm run connect`

Almost always a mismatch between the app you're authorizing against and the keys
in use.

- **Production company, sandbox keys.** Sandbox `QBO_CLIENT_ID/SECRET` cannot
  mint production tokens. Re-run with production keys and
  `QBO_ENVIRONMENT=production` (see SKILL step 2).
- **Redirect URI not registered, or (production only) not a public HTTPS URL.**
  For **sandbox/Development** keys, the exact URI `http://localhost:3000/callback`
  must be listed under the app's Redirect URIs in the Intuit developer portal.
  For **Production** keys, Intuit does not accept `localhost` at all — it requires
  a real, publicly reachable `https://` URL. See "Production redirect URI" below;
  do not tell the user to just register their homepage or some other page that
  doesn't forward the callback — see the warning there.
- **State mismatch — possible CSRF.** A stale browser tab replayed an old
  callback. Close all localhost:3000 tabs and re-run connect fresh.

## Production redirect URI ("what URL do I register?")

Intuit's Production keys reject `localhost` as a Redirect URI — it must be a
real, public `https://` URL. But the connect flow still needs to catch the
callback locally to save tokens, so **a plain, unmodified website URL (a
homepage, a random page on the user's site) does not work**: Intuit will
redirect the browser there fine (the Allow screen and redirect both "succeed"),
but that page has no idea it needs to forward `code`/`realmId`/`state` back to
`localhost:3000` — so `npm run connect` just sits there waiting and no tokens
ever get written. It can look like it worked (no error, browser lands on a real
page) while nothing was actually saved. Don't suggest a custom Cloudflare
Worker or other bespoke redirect handler either — one already exists in this
project.

Use **[`redirect-uri.sample.html`](../../../../redirect-uri.sample.html)**
instead: a static page with no secrets that the user hosts anywhere over HTTPS
(their own site, GitHub Pages, Netlify), which forwards the callback straight
to their local connector. Full walkthrough in
[DEVELOPER.md → Production redirect URI](../../../../DEVELOPER.md#production-redirect-uri-public-https-page).

## Browser didn't open

`openBrowser` (`src/qbo.js`) shells out to `open`. If it's blocked, the command's
stderr prints the full authorize URL — have the user paste it into a browser
manually. Everything else is unchanged.

## `EADDRINUSE` / port 3000 already in use

Another `connect` (or an unrelated process) holds port 3000. Only one connect can
run at a time. Find and stop it:
```bash
lsof -i :3000        # identify the PID
kill <pid>           # stop it, then re-run connect
```

## Company authorized but tools return nothing / wrong data in Claude Desktop

- **Didn't restart.** New connectors load only on a full relaunch (Cmd-Q). Closing
  the window isn't enough.
- **Wrong slug in the connector.** Confirm the `env.QBO_COMPANY` in the config
  matches the `tokens.<slug>.json` filename exactly. `list_companies.py` flags
  this as REGISTERED but not AUTHORIZED (or vice-versa).

## "Refresh token expired (100+ days)"

Intuit refresh tokens expire after ~100 days of disuse. Re-authorize that one
company: `QBO_COMPANY=<slug> npm run connect`. No config change or restart needed
if the connector already exists — the token file is refreshed in place.

## Wrong company's data appearing

Two connectors point at the same `realmId`, or a token file was copied without
re-authorizing. Run `list_companies.py`; if two slugs share a realmId, re-run
connect for the one that's wrong so it captures the intended company.

## Claude Desktop config got corrupted

`register_connector.py` refuses to write over invalid JSON and always backs up
first (`claude_desktop_config.json.bak-<timestamp>`). Restore the most recent
`.bak-*` file, fix the JSON, and re-run the script.
