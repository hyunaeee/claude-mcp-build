# claude-mcp-build

MCP servers that make Claude better at finishing real projects.

| Package | What it does |
|---|---|
| [**finishline-mcp**](packages/finishline) | A project manager that gets projects shipped: kickoff interview, one next action, scope-creep guard, stall detection, ship check, live visual dashboard. |
| [**fresh-deps-mcp**](packages/fresh-deps) | Live package versions, deprecations and vulnerabilities (npm, PyPI, crates.io, Go) so Claude stops installing outdated or vulnerable packages. Also powers finishline's dependency check. |

```bash
npm install
npm run build
npm run smoke
```

Behind a corporate proxy, set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`.
