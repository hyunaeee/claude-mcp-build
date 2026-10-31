#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import semver from "semver";
import { z } from "zod";
import { detectManifest, parseManifest } from "./manifests.js";
import { queryVulns, type Vuln } from "./osv.js";
import { fetchLatest, type Ecosystem } from "./registries.js";

const ecosystem = z.enum(["npm", "pypi", "crates", "go"]);

const server = new McpServer({ name: "fresh-deps", version: "0.1.0" });

server.registerTool(
  "latest_version",
  {
    title: "Latest package version",
    description:
      "Look up the CURRENT latest stable version of packages from the live registry (npm, PyPI, crates.io, Go proxy), " +
      "plus deprecation notices and known vulnerabilities. Your training data is out of date: ALWAYS call this before " +
      "writing an install command, adding a dependency, or pinning a version, instead of guessing from memory.",
    inputSchema: {
      ecosystem,
      packages: z.array(z.string()).min(1).max(50).describe('Package names, e.g. ["react", "@types/node"]'),
    },
  },
  async ({ ecosystem, packages }) => {
    const infos = await Promise.all(
      packages.map((name) => fetchLatest(ecosystem, name).catch((e: Error) => ({ name, error: e.message }))),
    );
    const found = infos.filter((i) => !("error" in i)) as Awaited<ReturnType<typeof fetchLatest>>[];
    const vulns = await queryVulns(found.map((i) => ({ ecosystem, name: i.name, version: i.latest }))).catch(
      () => undefined,
    );

    const lines = infos.map((i) => {
      if ("error" in i) return `- ${i.name}: ERROR ${i.error}`;
      const v = vulns?.[found.indexOf(i)] ?? [];
      return [
        `- ${i.name}: **${i.latest}**${i.publishedAt ? ` (released ${i.publishedAt.slice(0, 10)})` : ""}`,
        i.deprecated && `  ⚠ DEPRECATED: ${i.deprecated}`,
        v.length > 0 && `  ⚠ latest version has ${v.length} known vuln(s): ${v.map((x) => x.id).join(", ")}`,
        i.repository && `  repo: ${i.repository}`,
      ]
        .filter(Boolean)
        .join("\n");
    });
    return { content: [{ type: "text", text: `Live ${ecosystem} registry data:\n${lines.join("\n")}` }] };
  },
);

server.registerTool(
  "check_deps",
  {
    title: "Check dependency manifest",
    description:
      "Audit a dependency manifest (package.json, requirements*.txt, pyproject.toml, Cargo.toml, go.mod) against live " +
      "registries and the OSV vulnerability database. Reports outdated, deprecated and vulnerable dependencies with the " +
      "version to upgrade to. Call this when starting work on a project, before upgrading dependencies, or after editing a manifest.",
    inputSchema: {
      path: z.string().optional().describe("Path to the manifest file on disk"),
      content: z.string().optional().describe("Manifest contents, if not reading from disk"),
      filename: z
        .string()
        .optional()
        .describe('Manifest filename used to pick the parser when passing content, e.g. "package.json"'),
      include_dev: z.boolean().default(true).describe("Include dev dependencies"),
    },
  },
  async ({ path, content, filename, include_dev }) => {
    const name = filename ?? path;
    if (!name) throw new Error("Provide `path`, or `content` together with `filename`.");
    if (!detectManifest(name)) throw new Error(`Cannot tell manifest type from "${name}".`);
    const text = content ?? (await readFile(path!, "utf8"));

    const deps = parseManifest(name, text).filter((d) => include_dev || !d.dev);
    if (deps.length === 0) return { content: [{ type: "text", text: "No registry dependencies found." }] };

    const latest = await mapLimit(deps, 8, (d) => fetchLatest(d.ecosystem, d.name).catch((e: Error) => e));
    const current = deps.map((d) => currentVersion(d.ecosystem, d.spec));
    const vulnQueries = deps
      .map((d, i) => ({ ecosystem: d.ecosystem, name: d.name, version: current[i]!, i }))
      .filter((q) => q.version);
    const vulnResults = await queryVulns(vulnQueries).catch(() => undefined);
    const vulns = new Map<number, Vuln[]>(vulnQueries.map((q, k) => [q.i, vulnResults?.[k] ?? []]));

    const rows = deps.map((d, i) => {
      const info = latest[i];
      if (info instanceof Error) return { level: 0, text: `- ${d.name} ${d.spec}: could not check (${info.message})` };
      const cur = current[i];
      const v = vulns.get(i) ?? [];
      const drift = cur ? diff(cur, info.latest) : "unpinned";
      const level = v.length ? 4 : info.deprecated ? 3 : drift === "major" ? 2 : drift === "up-to-date" ? 0 : 1;
      const parts = [`- ${level >= 2 ? "**" + d.name + "**" : d.name} ${d.spec || "(any)"} → latest ${info.latest} [${drift}]`];
      if (info.deprecated) parts.push(`  ⚠ DEPRECATED: ${info.deprecated}`);
      for (const x of v.slice(0, 5)) {
        parts.push(`  🔴 ${x.id}${x.severity ? ` (${x.severity})` : ""}: ${x.summary}${x.fixedIn ? ` — fixed in ${x.fixedIn}` : ""}`);
      }
      if (v.length > 5) parts.push(`  …and ${v.length - 5} more`);
      const safe = minSafeVersion(v);
      if (safe) parts.push(`  ✅ upgrade to >= ${safe} to fix all known vulns (latest: ${info.latest})`);
      return { level, text: parts.join("\n") };
    });

    rows.sort((a, b) => b.level - a.level);
    const count = (l: number) => rows.filter((r) => r.level === l).length;
    const summary =
      `${deps.length} dependencies checked: ${count(4)} vulnerable, ${count(3)} deprecated, ` +
      `${count(2)} major version behind, ${count(1)} minor/patch behind or unpinned, ${count(0)} up to date.`;
    const note = "Note: for ranges like ^1.2.0 the lowest allowed version is checked.";
    return { content: [{ type: "text", text: `${summary}\n${note}\n\n${rows.map((r) => r.text).join("\n")}` }] };
  },
);

/** Best-effort lowest version a spec resolves to ("^18.2.0" → "18.2.0", ">=2.0,<3" → "2.0.0"). */
function currentVersion(eco: Ecosystem, spec: string): string | undefined {
  if (!spec || spec === "*" || spec === "latest" || /^\s*(<|!=)/.test(spec)) return undefined;
  if (eco === "go") return spec;
  if (eco === "npm") {
    try {
      return semver.minVersion(spec)?.version;
    } catch {
      return undefined;
    }
  }
  const m = /(?:==|~=|>=|\^|~|=)?\s*(\d+(?:\.\d+){0,2})/.exec(spec);
  return m ? semver.coerce(m[1])?.version : undefined;
}

function minSafeVersion(vulns: Vuln[]): string | undefined {
  const fixes = vulns.map((v) => v.fixedIn && semver.coerce(v.fixedIn)).filter((v): v is semver.SemVer => !!v);
  return fixes.length ? fixes.sort(semver.compare).at(-1)!.version : undefined;
}

function diff(current: string, latest: string): string {
  const a = semver.coerce(current);
  const b = semver.coerce(latest);
  if (!a || !b) return current === latest ? "up-to-date" : "differs";
  if (semver.gte(a, b)) return "up-to-date";
  return semver.diff(a, b) === "major" || semver.diff(a, b) === "premajor" ? "major" : "minor/patch";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

await server.connect(new StdioServerTransport());
