#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { auditManifest } from "./audit.js";
import { detectManifest } from "./manifests.js";
import { queryVulns } from "./osv.js";
import { fetchLatest } from "./registries.js";

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

    const { deps, counts } = await auditManifest(name, text, include_dev);
    if (deps.length === 0) return { content: [{ type: "text", text: "No registry dependencies found." }] };

    const rows = deps.map((d) => {
      if (d.error) return `- ${d.name} ${d.spec}: could not check (${d.error})`;
      const parts = [`- ${d.level >= 2 ? "**" + d.name + "**" : d.name} ${d.spec || "(any)"} → latest ${d.latest} [${d.drift}]`];
      if (d.deprecated) parts.push(`  ⚠ DEPRECATED: ${d.deprecated}`);
      for (const x of d.vulns.slice(0, 5)) {
        parts.push(`  🔴 ${x.id}${x.severity ? ` (${x.severity})` : ""}: ${x.summary}${x.fixedIn ? ` — fixed in ${x.fixedIn}` : ""}`);
      }
      if (d.vulns.length > 5) parts.push(`  …and ${d.vulns.length - 5} more`);
      if (d.safeVersion) parts.push(`  ✅ upgrade to >= ${d.safeVersion} to fix all known vulns (latest: ${d.latest})`);
      return parts.join("\n");
    });

    const summary =
      `${deps.length} dependencies checked: ${counts.vulnerable} vulnerable, ${counts.deprecated} deprecated, ` +
      `${counts.major} major version behind, ${counts.minor} minor/patch behind or unpinned, ${counts.ok} up to date.`;
    const note = "Note: for ranges like ^1.2.0 the lowest allowed version is checked.";
    return { content: [{ type: "text", text: `${summary}\n${note}\n\n${rows.join("\n")}` }] };
  },
);

await server.connect(new StdioServerTransport());
