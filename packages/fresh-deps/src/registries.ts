export type Ecosystem = "npm" | "pypi" | "crates" | "go";

export interface PackageInfo {
  ecosystem: Ecosystem;
  name: string;
  latest: string;
  publishedAt?: string;
  /** Deprecation / yank notice for the latest version or the package as a whole. */
  deprecated?: string;
  homepage?: string;
  repository?: string;
}

const UA = "fresh-deps-mcp (+https://github.com/hyunaeee/claude-mcp-build)";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new Error("package not found");
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  return res.json();
}

async function npm(name: string): Promise<PackageInfo> {
  const d = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  const latest: string = d["dist-tags"]?.latest;
  if (!latest) throw new Error("no latest dist-tag");
  const v = d.versions?.[latest] ?? {};
  const repo = typeof d.repository === "string" ? d.repository : d.repository?.url;
  return {
    ecosystem: "npm",
    name,
    latest,
    publishedAt: d.time?.[latest],
    deprecated: v.deprecated || undefined,
    homepage: d.homepage,
    repository: repo?.replace(/^git\+/, "").replace(/\.git$/, ""),
  };
}

async function pypi(name: string): Promise<PackageInfo> {
  const d = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  const latest: string = d.info.version;
  const files: any[] = d.releases?.[latest] ?? [];
  const urls = d.info.project_urls ?? {};
  const inactive = (d.info.classifiers ?? []).includes("Development Status :: 7 - Inactive");
  return {
    ecosystem: "pypi",
    name: d.info.name ?? name,
    latest,
    publishedAt: files[0]?.upload_time_iso_8601,
    deprecated: d.info.yanked
      ? `yanked: ${d.info.yanked_reason ?? "no reason given"}`
      : inactive
        ? "project marked Inactive"
        : undefined,
    homepage: d.info.home_page || urls.Homepage || urls.homepage,
    repository: urls.Source || urls.Repository || urls.source,
  };
}

async function crates(name: string): Promise<PackageInfo> {
  const d = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  const c = d.crate;
  const latest: string = c.max_stable_version || c.newest_version;
  const v = (d.versions as any[] | undefined)?.find((x) => x.num === latest);
  return {
    ecosystem: "crates",
    name: c.name,
    latest,
    publishedAt: v?.created_at,
    deprecated: v?.yanked ? "latest version is yanked" : undefined,
    homepage: c.homepage ?? undefined,
    repository: c.repository ?? undefined,
  };
}

async function go(name: string): Promise<PackageInfo> {
  // The Go module proxy requires upper-case letters to be escaped as "!x".
  const escaped = name.replace(/[A-Z]/g, (ch) => "!" + ch.toLowerCase());
  const d = await getJson(`https://proxy.golang.org/${escaped}/@latest`);
  return {
    ecosystem: "go",
    name,
    latest: d.Version,
    publishedAt: d.Time,
    repository: d.Origin?.URL,
  };
}

const fetchers: Record<Ecosystem, (name: string) => Promise<PackageInfo>> = { npm, pypi, crates, go };

export function fetchLatest(ecosystem: Ecosystem, name: string): Promise<PackageInfo> {
  return fetchers[ecosystem](name);
}
