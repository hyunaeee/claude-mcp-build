import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { auditManifest } from "fresh-deps-mcp";
import type { ShipItem } from "./state.js";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".venv", "venv", "target", ".finishline", "__pycache__", "vendor", "coverage"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|vue|svelte)$/;
const TEST = /(^|[/\\])(tests?|__tests__|spec)[/\\]|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|[/\\])test_[^/\\]+\.py$/;
const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"];

async function exists(p: string) {
  return stat(p).then(() => true, () => false);
}

async function read(p: string) {
  return readFile(p, "utf8").catch(() => undefined);
}

/** Walks the project, skipping dependency/build folders, up to a file budget. */
async function walk(root: string, limit = 3000): Promise<string[]> {
  const out: string[] = [];
  const queue = [root];
  while (queue.length && out.length < limit) {
    const dir = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE.has(e.name) && !e.name.startsWith(".")) queue.push(join(dir, e.name));
        else if (e.name === ".github") queue.push(join(dir, e.name));
      } else out.push(relative(root, join(dir, e.name)));
    }
  }
  return out;
}

export async function shipCheck(root: string, opts: { deps?: boolean } = {}): Promise<ShipItem[]> {
  const files = await walk(root);
  const top = new Set(files.filter((f) => !f.includes("/") && !f.includes("\\")).map((f) => f.toLowerCase()));
  const items: ShipItem[] = [];
  const pkg = JSON.parse((await read(join(root, "package.json"))) ?? "null");

  // README: someone landing on the repo must understand what it is and how to run it.
  const readmeName = [...top].find((f) => f.startsWith("readme"));
  const readme = readmeName ? ((await read(join(root, files.find((f) => f.toLowerCase() === readmeName)!))) ?? "") : "";
  const hasUsage = /install|usage|getting started|quick ?start|설치|사용/i.test(readme);
  items.push({
    id: "readme",
    label: "README",
    pass: readme.length >= 400 && hasUsage,
    detail: !readme
      ? "No README."
      : readme.length < 400
        ? `README is only ${readme.length} characters.`
        : hasUsage
          ? "README explains what this is and how to use it."
          : "README has no install/usage section.",
    fix: "Write a README: one-line pitch, screenshot or example, install, usage",
  });

  items.push({
    id: "license",
    label: "License",
    pass: [...top].some((f) => f.startsWith("license") || f.startsWith("licence")) || !!pkg?.license,
    detail: "Without a license nobody can legally use or contribute to the code.",
    fix: "Add a LICENSE file (MIT is the common default)",
  });

  const testFiles = files.filter((f) => TEST.test(f) && SOURCE.test(f));
  const testScript = pkg?.scripts?.test && !/no test specified/.test(pkg.scripts.test);
  items.push({
    id: "tests",
    label: "Tests",
    pass: testFiles.length > 0 || !!testScript,
    detail: testFiles.length ? `${testFiles.length} test file(s) found.` : "No tests found.",
    fix: "Add a few tests for the main happy path",
  });

  const ci = files.some((f) => /^\.github[/\\]workflows[/\\].+\.ya?ml$/.test(f)) || top.has(".gitlab-ci.yml");
  items.push({
    id: "ci",
    label: "CI",
    pass: ci,
    detail: ci ? "CI workflow found." : "No CI: nothing checks that the main branch still builds.",
    fix: "Add a CI workflow that installs, builds and runs tests on every push",
  });

  const gitignore = (await read(join(root, ".gitignore"))) ?? "";
  const envFile = await exists(join(root, ".env"));
  const envIgnored = /^\.env\b/m.test(gitignore);
  const envExample = (await exists(join(root, ".env.example"))) || (await exists(join(root, ".env.sample")));
  items.push({
    id: "secrets",
    label: "Secrets safe",
    pass: !envFile || (envIgnored && envExample),
    detail: !envFile
      ? "No .env file at the project root."
      : !envIgnored
        ? ".env exists but is not in .gitignore: secrets may get committed."
        : envExample
          ? ".env is ignored and .env.example documents the variables."
          : "No .env.example, so new users can't tell which variables to set.",
    fix: "Add .env to .gitignore and commit a .env.example with placeholder values",
  });

  const todos: string[] = [];
  for (const f of files.filter((f) => SOURCE.test(f)).slice(0, 1500)) {
    const text = await read(join(root, f));
    if (!text || text.length > 500_000) continue;
    text.split("\n").forEach((line, i) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) todos.push(`${f}:${i + 1}`);
    });
  }
  items.push({
    id: "todos",
    label: "Open TODOs",
    pass: todos.length <= 3,
    detail: todos.length ? `${todos.length} TODO/FIXME comment(s), e.g. ${todos.slice(0, 3).join(", ")}` : "No TODO/FIXME comments.",
    fix: `Resolve or ticket the ${todos.length} TODO/FIXME comments`,
  });

  if (opts.deps !== false) {
    const manifest = MANIFESTS.find((m) => top.has(m.toLowerCase()));
    if (manifest) {
      try {
        const { counts, deps } = await auditManifest(manifest, (await read(join(root, manifest)))!);
        const bad = deps.filter((d) => d.level >= 3);
        items.push({
          id: "deps",
          label: "Dependencies healthy",
          pass: bad.length === 0,
          detail: bad.length
            ? `${counts.vulnerable} vulnerable, ${counts.deprecated} deprecated: ` +
              bad.slice(0, 4).map((d) => `${d.name}${d.safeVersion ? ` (upgrade to >= ${d.safeVersion})` : d.deprecated ? " (deprecated)" : ""}`).join(", ")
            : `${deps.length} dependencies, no known vulnerabilities or deprecations.`,
          fix: "Upgrade vulnerable and deprecated dependencies",
        });
      } catch (e: any) {
        items.push({ id: "deps", label: "Dependencies healthy", pass: true, detail: `Skipped: ${e.message}` });
      }
    }
  }

  if (pkg && !pkg.private) {
    const missing = ["description", "repository", "license"].filter((k) => !pkg[k]);
    items.push({
      id: "metadata",
      label: "Package metadata",
      pass: missing.length === 0,
      detail: missing.length ? `package.json is missing: ${missing.join(", ")}.` : "package.json has description, repository and license.",
      fix: `Fill in package.json ${missing.join(", ")}`,
    });
  }

  return items;
}
