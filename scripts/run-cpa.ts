import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

/**
 * Two-pass CPA discovery spec.
 * NOTE: There is intentionally NO `search_queries` field anymore.
 */
type RunSpec = {
  metro: string;
  category: "CPA";
  target_count: number;
  search_provider: "duckduckgo";
  max_results_per_query: number;
  metro_slug?: string;

  search_queries_pass1: string[];
  search_queries_pass2: string[];
};

type FirmCandidate = {
  domain: string;
  homeUrl: string;
  bestTitle: string;
  sourceQueries: string[];
  discoveredUrls: string[];
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

async function runDiscoveryPass(
  passName: "pass1" | "pass2",
  queries: string[],
  spec: RunSpec,
  searchLimiter: RateLimiter,
  candidatesByDomain: Map<string, FirmCandidate>
) {
  if (!Array.isArray(queries)) {
    throw new Error(`${passName} queries missing or invalid in spec`);
  }

  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, searchLimiter, spec.max_results_per_query);

    for (const h of hits) {
      const domain = normalizeDomain(h.url);
      if (!domain) continue;
      if (isBannedDomain(domain)) continue;

      const homeUrl = toHomeUrl(h.url);
      if (!homeUrl) continue;

      const existing = candidatesByDomain.get(domain);
      if (existing) {
        existing.sourceQueries.push(q);
        existing.discoveredUrls.push(h.url);
        if (existing.bestTitle.length < h.title.length) {
          existing.bestTitle = h.title;
        }
      } else {
        candidatesByDomain.set(domain, {
          domain,
          homeUrl,
          bestTitle: h.title,
          sourceQueries: [q],
          discoveredUrls: [h.url]
        });
      }
    }

    console.log(
      `[${passName}] query="${q}" → total domains=${candidatesByDomain.size}`
    );
  }
}

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as RunSpec;

  // 🔒 Defensive validation
  if (!spec.search_queries_pass1 || !spec.search_queries_pass2) {
    throw new Error(
      "Spec must define search_queries_pass1 and search_queries_pass2"
    );
  }

  const metroSlug = spec.metro_slug ?? slugifyMetro(spec.metro);

  const searchLimiter = new RateLimiter(950);
  const crawlLimiter = new RateLimiter(750);

  const candidatesByDomain = new Map<string, FirmCandidate>();

  // ✅ Two-pass discovery ONLY
  await runDiscoveryPass(
    "pass1",
    spec.search_queries_pass1,
    spec,
    searchLimiter,
    candidatesByDomain
  );

  await runDiscoveryPass(
    "pass2",
    spec.search_queries_pass2,
    spec,
    searchLimiter,
    candidatesByDomain
  );

  const discovered = Array.from(candidatesByDomain.values());

  const kept: any[] = [];
  let crawledPages = 0;

  for (const c of discovered) {
    if (kept.length >= spec.target_count * 2) break;

    const homepage = await fetchHtml(c.homeUrl, crawlLimiter, {
      timeoutMs: 20000,
      maxRetries: 2
    });

    crawledPages++;
    if (!homepage.ok || !homepage.html) continue;

    const extracted = extractFromHtml(homepage.html);
    const combinedText = extracted.text;

    const evaled = evaluateCpaSite(combinedText);
    if (!evaled.keep) continue;

    kept.push({
      name: extracted.h1 || extracted.title || c.bestTitle,
      url: homepage.url,
      domain: c.domain,
      metro: spec.metro,
      category: spec.category,
      score: evaled.score,
      signals: evaled.signals,
      reasons: evaled.reasons,
      source_queries: Array.from(new Set(c.sourceQueries))
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
      target_count: spec.target_count
    },
    firms: final
  };

  const outDir = resolve("data", metroSlug);
  mkdirSync(outDir, { recursive: true });

  const outPath = resolve(outDir, "cpas_raw.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

  console.log(`✅ Wrote ${final.length} firms → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
