import type { Ecosystem } from "./registries.js";

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** The spec as written in the manifest, e.g. "^18.2.0" or ">=2.0". */
  spec: string;
  dev?: boolean;
}

export function detectManifest(filename: string): Ecosystem | undefined {
  const base = filename.split(/[\\/]/).pop()!.toLowerCase();
  if (base === "package.json") return "npm";
  if (base.endsWith(".txt") && base.includes("requirements")) return "pypi";
  if (base === "pyproject.toml") return "pypi";
  if (base === "cargo.toml") return "crates";
  if (base === "go.mod") return "go";
  return undefined;
}

export function parseManifest(filename: string, content: string): Dependency[] {
  const eco = detectManifest(filename);
  const base = filename.split(/[\\/]/).pop()!.toLowerCase();
  switch (eco) {
    case "npm":
      return parsePackageJson(content);
    case "pypi":
      return base === "pyproject.toml" ? parsePyproject(content) : parseRequirements(content);
    case "crates":
      return parseCargo(content);
    case "go":
      return parseGoMod(content);
    default:
      throw new Error(
        `Unsupported manifest "${filename}". Supported: package.json, requirements*.txt, pyproject.toml, Cargo.toml, go.mod`,
      );
  }
}

function parsePackageJson(content: string): Dependency[] {
  const pkg = JSON.parse(content);
  const out: Dependency[] = [];
  for (const [field, dev] of [
    ["dependencies", false],
    ["devDependencies", true],
    ["peerDependencies", false],
    ["optionalDependencies", false],
  ] as const) {
    for (const [name, spec] of Object.entries<string>(pkg[field] ?? {})) {
      // Skip workspace, git, file and URL specs: there is no registry version to compare.
      if (/^(workspace:|file:|link:|git|github:|https?:)/.test(spec) || spec.includes("/")) continue;
      out.push({ ecosystem: "npm", name, spec, dev });
    }
  }
  return out;
}

const PEP508 = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;#]*)/;

function parseRequirements(content: string): Dependency[] {
  const out: Dependency[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = PEP508.exec(line);
    if (m) out.push({ ecosystem: "pypi", name: m[1], spec: m[2].trim() });
  }
  return out;
}

function parsePyproject(content: string): Dependency[] {
  // PEP 621: dependencies = ["requests>=2.0", ...]
  const block = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(content);
  if (!block) return [];
  return [...block[1].matchAll(/["']([^"']+)["']/g)]
    .map((s) => PEP508.exec(s[1]))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ ecosystem: "pypi" as const, name: m[1], spec: m[2].trim() }));
}

function parseCargo(content: string): Dependency[] {
  const out: Dependency[] = [];
  let section = "";
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (!/(^|\.)(dev-|build-)?dependencies$/.test(section)) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{.*version\s*=\s*"([^"]+)".*\})/.exec(line);
    if (m) out.push({ ecosystem: "crates", name: m[1], spec: m[2] ?? m[3], dev: section.includes("dev-") });
  }
  return out;
}

function parseGoMod(content: string): Dependency[] {
  const out: Dependency[] = [];
  const add = (line: string) => {
    const m = /^\s*([^\s]+)\s+(v[^\s]+)(\s*\/\/\s*indirect)?/.exec(line);
    if (m && !m[3]) out.push({ ecosystem: "go", name: m[1], spec: m[2] });
  };
  for (const block of content.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) block[1].split("\n").forEach(add);
  for (const single of content.matchAll(/^require\s+([^\s(].*)$/gm)) add(single[1]);
  return out;
}
