import semver from "semver";
import { parseManifest } from "./manifests.js";
import { queryVulns, type Vuln } from "./osv.js";
import { fetchLatest, type Ecosystem, type PackageInfo } from "./registries.js";

export type { Vuln, PackageInfo, Ecosystem };
export { detectManifest } from "./manifests.js";

export interface DepResult {
  name: string;
  spec: string;
  dev?: boolean;
  /** 4 vulnerable, 3 deprecated, 2 major behind, 1 minor/patch behind or unpinned, 0 up to date. */
  level: 0 | 1 | 2 | 3 | 4;
  latest?: string;
  drift?: string;
  deprecated?: string;
  vulns: Vuln[];
  safeVersion?: string;
  error?: string;
}

export interface AuditResult {
  deps: DepResult[];
  counts: { vulnerable: number; deprecated: number; major: number; minor: number; ok: number };
}

/** Audit a manifest's dependencies against live registries and OSV. Results are sorted most urgent first. */
export async function auditManifest(filename: string, content: string, includeDev = true): Promise<AuditResult> {
  const deps = parseManifest(filename, content).filter((d) => includeDev || !d.dev);
  const latest = await mapLimit(deps, 8, (d) => fetchLatest(d.ecosystem, d.name).catch((e: Error) => e));
  const current = deps.map((d) => currentVersion(d.ecosystem, d.spec));
  const vulnQueries = deps
    .map((d, i) => ({ ecosystem: d.ecosystem, name: d.name, version: current[i]!, i }))
    .filter((q) => q.version);
  const vulnResults = await queryVulns(vulnQueries).catch(() => undefined);
  const vulns = new Map<number, Vuln[]>(vulnQueries.map((q, k) => [q.i, vulnResults?.[k] ?? []]));

  const results: DepResult[] = deps.map((d, i) => {
    const info = latest[i];
    const base = { name: d.name, spec: d.spec, dev: d.dev };
    if (info instanceof Error) return { ...base, level: 0, vulns: [], error: info.message };
    const cur = current[i];
    const v = vulns.get(i) ?? [];
    const drift = cur ? diff(cur, info.latest) : "unpinned";
    const level = v.length ? 4 : info.deprecated ? 3 : drift === "major" ? 2 : drift === "up-to-date" ? 0 : 1;
    return {
      ...base,
      level,
      latest: info.latest,
      drift,
      deprecated: info.deprecated,
      vulns: v,
      safeVersion: minSafeVersion(v),
    };
  });

  results.sort((a, b) => b.level - a.level);
  const count = (l: number) => results.filter((r) => r.level === l).length;
  return {
    deps: results,
    counts: { vulnerable: count(4), deprecated: count(3), major: count(2), minor: count(1), ok: count(0) },
  };
}

/** Best-effort lowest version a spec resolves to ("^18.2.0" → "18.2.0", ">=2.0,<3" → "2.0.0"). */
export function currentVersion(eco: Ecosystem, spec: string): string | undefined {
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

