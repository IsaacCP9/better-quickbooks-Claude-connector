# Third-party notices & provenance

This project is licensed under **MIT No Attribution** ([`LICENSE`](LICENSE)). MIT-0 has no
`NOTICE` mechanism, so provenance and third-party terms are documented here instead.

## Provenance

The code in `src/` is original work. Specifically:

- No third-party source is vendored into this repository. There is no `vendor/` directory, no
  bundled or copied library, and no squashed third-party import anywhere in the commit history.
- There is no Intuit SDK or QuickBooks client library dependency. The OAuth 2.0 authorization
  flow and the authenticated REST client in `src/qbo.js` are written directly against Intuit's
  publicly documented HTTP endpoints (`appcenter.intuit.com`, `oauth.platform.intuit.com`,
  `quickbooks.api.intuit.com` / `sandbox-quickbooks.api.intuit.com`).
- Implementing a documented public API is not, by itself, derivative of any other client for that
  API.

**Not derived from Intuit's own MCP server.** Intuit publishes
[`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server)
under Apache-2.0. This project is unrelated to it: Intuit's is TypeScript with a compiled build
step and roughly 144 tools; this is ~2,200 lines of plain JavaScript with 54 tools and a different
architecture (a single connector with runtime company selection). No code, text, or structure was
taken from it. If you are looking for Intuit's officially supported server, use theirs.

If any part of this project is ever adapted from another codebase in future, the required
copyright, license, and notice material for that project must be added to this file at the same
time as the code.

## Dependencies

Runtime dependencies are resolved from the npm registry at install time and are **not** vendored
or redistributed by this repository. Each remains under its own license, which travels with it in
`node_modules`:

| Package | License |
| --- | --- |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [`dotenv`](https://github.com/motdotla/dotenv) | BSD-2-Clause |
| [`zod`](https://github.com/colinhacks/zod) | MIT |

Transitive dependencies carry their own licenses; run `npm ls` or inspect `package-lock.json` for
the full resolved tree. The MIT-0 grant in [`LICENSE`](LICENSE) covers this project's own code
only — it does not and cannot relicense anything you install alongside it.

## Trademarks

This is an independent open-source project. It is not affiliated with, endorsed by, sponsored by,
or supported by Intuit Inc. or Anthropic, PBC.

- QuickBooks, QuickBooks Online, and Intuit are trademarks of Intuit Inc.
- Claude and Anthropic are trademarks of Anthropic, PBC.

These marks are used here only to describe what this software interoperates with. No trademark
rights are granted by [`LICENSE`](LICENSE) — MIT-0 grants copyright permissions and is silent on
trademarks. If you fork or redistribute this project, you are responsible for your own use of
those marks, including Intuit's developer and platform terms.
