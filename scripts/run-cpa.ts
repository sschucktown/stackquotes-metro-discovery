import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RateLimiter } from "./core/rateLimit";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo";
import { fetchHtml } from "./core/fetchPage";
import { extractFromHtml } from "./core/extractText";
import { evaluateCpaSite } from "./evaluators/evaluateCpa";
import { mineTrustProxyCandidates } from "./trust-proxy/mineTrustProxy";


type TrustProxySpec = {
  enabled: boolean;
  max_candidates_total: number;
  max_candidates_per_source: {
    supplier: number;
    association: number;
    expert: number;
  };
  queries: {
    supplier: string[];
    association: string[];
    expert: string[];
  };
};

type RunSpec = {
  metro: string;
  category: "CPA";
  target_count: number;
  search_provider: "duckduckgo";
  max_results_per_query: number;
  metro_slug?: string;

  search_queries_pass1: string[];
  search_queries_pass2: string[];
  search_queries_pass3?: string[];

  trust_proxy?: TrustProxySpec;
};

type FirmCandidate = {
  domain: string;
  homeUrl: string;
  bestTitle: string;
  sourceQueries: string[];
  discoveredUrls: string[];
  origin: "search" | "trust-proxy";
};

function slugifyMetro(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeDomain(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function toHomeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isBannedDomain(domain: string): boolean {
  const banned = [
    "yelp.com",
    "facebook.com",
    "linkedin.com",
    "yellowpages.com",
    "angi.com",
    "thumbtack.com",
    "clutch.co",
    "expertise.com",
    "bbb.org",
    "mapquest.com",
    "chamberofcommerce.com",
    "dnb.com",
    "opencorporates.com",
    "constructionexec.com",
    "foundationsoftware.com"
  ];
  return banned.some((b) => domain === b || domain.endsWith(`.${b}`));
}

function pickCandidateName(fallbackTitle: string, extractedTitle: string, extractedH1: string): string {
  const candidates = [extractedH1, extractedTitle, fallbackTitle]
    .map((x) => (x || "").trim())
    .filter(Boolean);

  const name = candidates[0] ?? "Unknown Firm";
  return name.replace(/\s+\|\s+.*$/, "").replace(/\s+-\s+.*$/, "").trim();
}

async function runDiscoveryPass(
  passName: "pass1" | "pass2" | "pass3",
  queries: string[],
  spec: RunSpec,
  searchLimiter: RateLimiter,
  candidatesByDomain: Map<string, FirmCandidate>
) {
  if (!Array.isArray(queries)) return;

  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, searchLimiter, spec.max_results_per_query);

    for (const h of hits as any[]) {
      const url = h.url || "";
      const title = h.title || "";
      if (!url) continue;

      const domain = normalizeDomain(url);
      if (!domain) continue;
      if (isBannedDomain(domain)) continue;

      const homeUrl = toHomeUrl(url);
      if (!homeUrl) continue;

      const existing = candidatesByDomain.get(domain);
      if (existing) {
        existing.sourceQueries.push(q);
        existing.discoveredUrls.push(url);
        if (existing.bestTitle.length < title.length) existing.bestTitle = title;
      } else {
        candidatesByDomain.set(domain, {
          domain,
          homeUrl,
          bestTitle: title,
          sourceQueries: [q],
          discoveredUrls: [url],
          origin: "search"
        });
      }
    }

    console.log(`[${passName}] query="${q}" → domains=${candidatesByDomain.size}`);
  }
}

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as RunSpec;

  if (spec.category !== "CPA") throw new Error("This runner only supports category=CPA");
  if (!spec.search_queries_pass1 || !spec.search_queries_pass2) {
    throw new Error("Spec must define search_queries_pass1 and search_queries_pass2");
  }

  const metroSlug = spec.metro_slug ?? slugifyMetro(spec.metro);

  const searchLimiter = new RateLimiter(950);
  const crawlLimiter = new RateLimiter(750);

  const candidatesByDomain = new Map<string, FirmCandidate>();

  // Phase 1-3 discovery
  await runDiscoveryPass("pass1", spec.search_queries_pass1, spec, searchLimiter, candidatesByDomain);
  await runDiscoveryPass("pass2", spec.search_queries_pass2, spec, searchLimiter, candidatesByDomain);
  if (spec.search_queries_pass3?.length) {
    await runDiscoveryPass("pass3", spec.search_queries_pass3, spec, searchLimiter, candidatesByDomain);
  }

  // Phase 4 trust-proxy mining
  const trustProxyEnabled = !!spec.trust_proxy?.enabled;
  const trustProxyCandidates = trustProxyEnabled
    ? await mineTrustProxyCandidates(spec.metro, spec.trust_proxy as any)
    : [];

  // Write trust-proxy raw file (always if enabled)
  const outDir = resolve("data", metroSlug);
  mkdirSync(outDir, { recursive: true });

  if (trustProxyEnabled) {
    const tpPath = resolve(outDir, "trust_proxy_raw.json");
    writeFileSync(
      tpPath,
      JSON.stringify(
        {
          meta: {
            metro: spec.metro,
            metro_slug: metroSlug,
            generated_at: new Date().toISOString(),
            total_candidates: trustProxyCandidates.length
          },
          candidates: trustProxyCandidates
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log(`Wrote trust proxy candidates → ${tpPath}`);
  }

  // Convert trust-proxy candidates into firm candidates (domain-first)
  for (const tp of trustProxyCandidates as any[]) {
    const sourceUrl = tp.source_url || "";
    const homeUrl = tp.home_url || (sourceUrl ? toHomeUrl(sourceUrl) : "");
    const domain = tp.domain || (sourceUrl ? normalizeDomain(sourceUrl) : "");

    if (!domain) continue;
    if (isBannedDomain(domain)) continue;

    const resolvedHome = homeUrl || (sourceUrl ? toHomeUrl(sourceUrl) : "");
    if (!resolvedHome) continue;

    const existing = candidatesByDomain.get(domain);
    const label = `trust-proxy:${tp.source}`;

    if (existing) {
      existing.sourceQueries.push(label);
      if (sourceUrl) existing.discoveredUrls.push(sourceUrl);
      if (existing.bestTitle.length < (tp.firm_name || "").length) {
        existing.bestTitle = tp.firm_name || existing.bestTitle;
      }
    } else {
      candidatesByDomain.set(domain, {
        domain,
        homeUrl: resolvedHome,
        bestTitle: tp.firm_name || domain,
        sourceQueries: [label],
        discoveredUrls: sourceUrl ? [sourceUrl] : [],
        origin: "trust-proxy"
      });
    }
  }

  const discovered = Array.from(candidatesByDomain.values());

  // Crawl + evaluate
  const kept: any[] = [];
  let crawledPages = 0;

  for (const c of discovered) {
    if (kept.length >= spec.target_count * 2) break;

    const homepage = await fetchHtml(c.homeUrl, crawlLimiter, { timeoutMs: 20000, maxRetries: 2 });
    crawledPages++;

    if (!homepage.ok || !homepage.html) continue;

    const extracted = extractFromHtml(homepage.html);
    const combinedText = extracted.text;

    const evaled = evaluateCpaSite(combinedText);
    if (!evaled.keep) continue;

    const firmName = pickCandidateName(c.bestTitle, extracted.title, extracted.h1);

    kept.push({
      name: firmName,
      url: homepage.url,
      domain: c.domain,
      metro: spec.metro,
      category: spec.category,
      origin: c.origin,
      signals: evaled.signals,
      score: evaled.score,
      reasons: evaled.reasons,
      source_queries: Array.from(new Set(c.sourceQueries)),
      discovered_urls_sample: c.discoveredUrls.slice(0, 5)
    });
  }

  kept.sort((a, b) => b.score - a.score);
  const final = kept.slice(0, spec.target_count);

  const out = {
    meta: {
      metro: spec.metro,
      metro_slug: metroSlug,
      category: spec.category,
      generated_at: new Date().toISOString(),
      search_provider: spec.search_provider,
      total_discovered_domains: discovered.length,
      total_crawled_pages: crawledPages,
      total_kept_before_cap: kept.length,
      target_count: spec.target_count,
      trust_proxy_enabled: trustProxyEnabled,
      trust_proxy_candidates: trustProxyCandidates.length
    },
    firms: final
  };

  const outPath = resolve(outDir, "cpas_raw.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

  console.log(`✅ Wrote ${final.length} firms → ${outPath}`);
  console.log(
    `Discovered domains: ${discovered.length}, Crawled pages: ${crawledPages}, Kept: ${kept.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
