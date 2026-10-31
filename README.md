# fresh-deps-mcp

**Stop Claude from installing outdated, deprecated or vulnerable packages.**

Claude's knowledge of package versions is frozen at its training cutoff. It confidently writes
`npm install react@17`, reaches for long-deprecated libraries like `request`, and pins versions with
known CVEs. `fresh-deps-mcp` gives it live answers from the registries and the
[OSV](https://osv.dev) vulnerability database.

- **Zero config**: no API key, no account. One line to install.
- **Four ecosystems**: npm, PyPI, crates.io, Go modules.
- **Small**: two tools, so it uses few context tokens.

## Install

**Claude Code**

```bash
claude mcp add fresh-deps -- npx -y fresh-deps-mcp
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "fresh-deps": { "command": "npx", "args": ["-y", "fresh-deps-mcp"] }
  }
}
```

## Tools

### `latest_version`

Current latest stable version of one or more packages, with deprecation notices and known vulns.

```
Live npm registry data:
- react: **19.3.1** (released 2026-10-14)
- request: **2.88.2** (released 2020-02-11)
  ⚠ DEPRECATED: request has been deprecated, see https://github.com/request/request/issues/3142
  ⚠ latest version has 1 known vuln(s): GHSA-p8p7-x288-28g6
```

### `check_deps`

Audits `package.json`, `requirements*.txt`, `pyproject.toml`, `Cargo.toml` or `go.mod`, from a path
or from inline content. Results are sorted by urgency, and each one shows the minimum safe version.

```
3 dependencies checked: 2 vulnerable, 0 deprecated, 0 major version behind, 1 minor/patch behind or unpinned, 0 up to date.

- **django** ==3.2.0 → latest 6.1.2 [major]
  🔴 GHSA-2gwj-7jmv-h26r (CRITICAL): SQL Injection in Django — fixed in 3.2.13
  …and 65 more
  ✅ upgrade to >= 5.2.17 to fix all known vulns (latest: 6.1.2)
```

## Development

```bash
npm install
npm run build
npm run smoke   # spawns the server and calls every tool against live registries
```

Behind a corporate proxy, run with `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`.

## Roadmap

- Lock file support (`package-lock.json`, `poetry.lock`, `uv.lock`, `Cargo.lock`) to check exact installed versions
- `changelog_between`: breaking changes between two versions, from GitHub Releases
- `verify_import`: check that an API actually exists in a given version
- Maven, NuGet, RubyGems, Packagist
- One-click Claude Desktop extension (`.mcpb`) and MCP Registry listing

## License

MIT
