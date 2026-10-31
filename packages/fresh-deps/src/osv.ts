import semver from "semver";
import type { Ecosystem } from "./registries.js";

const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
  go: "Go",
};

export interface Vuln {
  id: string;
  summary: string;
  severity?: string;
  fixedIn?: string;
}

interface Query {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

/** Returns, for each query (same order), the known vulnerabilities affecting that exact version. */
export async function queryVulns(queries: Query[]): Promise<Vuln[][]> {
  if (queries.length === 0) return [];
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: queries.map((q) => ({
        package: { ecosystem: OSV_ECOSYSTEM[q.ecosystem], name: q.name },
        version: q.version.replace(/^v/, q.ecosystem === "go" ? "v" : ""),
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OSV responded ${res.status}`);
  const data = (await res.json()) as { results: { vulns?: { id: string }[] }[] };

  // The batch endpoint returns ids only; fetch details once per unique id.
  const ids = [...new Set(data.results.flatMap((r) => r.vulns?.map((v) => v.id) ?? []))];
  const details = new Map<string, any>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) details.set(id, await r.json());
      } catch {
        // Keep the id even if details are unavailable.
      }
    }),
  );

  return data.results.map((r, i) =>
    (r.vulns ?? []).map(({ id }) => {
      const d = details.get(id);
      return {
        id,
        summary: d?.summary ?? d?.details?.split("\n")[0]?.slice(0, 160) ?? "",
        severity: d?.database_specific?.severity,
        fixedIn: d ? fixedVersion(d, queries[i]) : undefined,
      };
    }),
  );
}

/** Lowest fixed version above the queried one, across this package's version ranges. */
function fixedVersion(vuln: any, q: Query): string | undefined {
  const current = semver.coerce(q.version);
  const fixes: string[] = [];
  for (const a of vuln.affected ?? []) {
    if (a.package?.name?.toLowerCase() !== q.name.toLowerCase()) continue;
    for (const range of a.ranges ?? []) {
      if (range.type === "GIT") continue;
      for (const e of range.events ?? []) if (e.fixed) fixes.push(e.fixed);
    }
  }
  const above = fixes
    .map((f) => ({ f, v: semver.coerce(f) }))
    .filter((x) => x.v && (!current || semver.gt(x.v, current)))
    .sort((a, b) => semver.compare(a.v!, b.v!));
  return above[0]?.f;
}
