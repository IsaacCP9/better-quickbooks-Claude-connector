# Third-party notices and provenance

> **Unofficial and independent.** Not affiliated with, endorsed by, or sponsored
> by Intuit Inc. or Anthropic. QuickBooks and Intuit are trademarks of Intuit
> Inc.; Claude is a trademark of Anthropic. Built by [Opzer](https://opzer.co).

## Provenance of this codebase

All source in `src/` and `.claude/`, and all documentation in this repository, is
original work by Opzer, written for this project.

- No code was copied or adapted from Intuit's own QuickBooks MCP server, from any
  Intuit sample application, or from any other project.
- Nothing is vendored: there is no bundled `node_modules/`, no copied library
  source, and no third-party code checked into this repository.
- The complete history is 16 commits in this repository, all authored under the
  Opzer account. `git log --all --diff-filter=A --name-only` lists every file ever
  added and contains no imported third-party source.

Because the work is original, this repository can be dedicated to the public
domain — see [`LICENSE`](LICENSE) (CC0 1.0). That dedication covers this
repository's own code and documentation only. It does not extend to the
dependencies below, which remain under their own licenses.

## Trademarks

CC0 waives copyright. It does not, and cannot, grant rights in anyone's
trademarks.

- **QuickBooks**, **QuickBooks Online**, and **Intuit** are trademarks of Intuit
  Inc. This project uses those names descriptively, to say what it connects to.
- **Claude** and **Anthropic** are trademarks of Anthropic.
- Neither company has reviewed, approved, or sponsored this project.

If you fork this project and distribute it, the names remain the property of
their owners. Intuit's brand guidelines restrict using its marks in the name of a
product or service, and require that any permitted use be less prominent than
your own branding — worth reading before you put "QuickBooks" in a product name
of your own.

## Runtime dependencies

Installed by `npm install`, not redistributed here.

| Package | License | Purpose |
| --- | --- | --- |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP server + stdio transport |
| [`dotenv`](https://github.com/motdotla/dotenv) | BSD-2-Clause | Loads `.env` |
| [`zod`](https://github.com/colinhacks/zod) | MIT | Tool argument schemas |

These three pull in roughly 90 transitive packages (`package-lock.json` is the
authoritative list). Each keeps its own license. To review them all:

```bash
npx license-checker --summary
```

The test suite uses Node's built-in `node:test` runner and adds no dependencies.
