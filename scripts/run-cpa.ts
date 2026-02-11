import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

/* =========================
   Types
========================= */

type RunSpec = {
  metro: string;
  lanes: ("en" | "es")[];
  max_results_per_query: number;
  queries: Record<"en" | "es", string[]>;
};

type FirmCandidate = {
  domain: string;
  homeUrl: string;
  sourceQueries: Set<string>;
  discoveredUrls: Set<string>;
};

/* =========================
   Helpers
========================= */

function normalizeDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function toHomeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function isNonFirmDomain(domain: string): boolean {
  const banned = [
    "duckduckgo.com",
    "google.com",
    "bing.com",
    "yelp.com",
    "thumbtack.com",
    "expertise.com",
    "clutch.co",
    "goodfirms.co",
    "bizjournals.com",
    "tx.cpa",
    "facebook.com",
    "linkedin.com"
  ];
  return banned.some((b) => domain === b || domain.endsWith(`.${b}`));
}

function isAssetUrl(url: string): boolean {
  return (
    /\.(js|css|json)$/i.test(url) ||
    url.includes("/y.js") ||
    url.includes("/assets")
  );
}

function slugifyMetro(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* =========================
   Main
========================= */

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as RunSpec;

  const metroSlug = slugifyMetro(spec.metro);
  const outDir = resolve("data", metroSlug);
  mkdirSync(outDir, { recursive: true });

  const searchLimiter = new RateLimiter(900);
  const crawlLimiter = new RateLimiter(750);

  /** DOMAIN-FIRST CANDIDATES */
  const firms = new Map<string, FirmCandidate>();

  /* =========================
     DISCOVERY (EN + ES)
  ========================= */

  for (const lane of spec.lanes) {
    for (const query of spec.queries[lane]) {
      const hits = await duckDuckGoSearch(
        query,
        searchLimiter,
        spec.max_results_per_query
      );

      for (const hit of hits as any[]) {
        const url = hit.url;
        if (!url || isAssetUrl(url)) continue;

        const domain = normalizeDomain(url);
        if (!domain || isNonFirmDomain(domain)) continue;

        const homeUrl = toHomeUrl(url);
        if (!homeUrl) continue;

        const existing = firms.get(domain);
        if (existing) {
          existing.sourceQueries.add(query);
          existing.discoveredUrls.add(url);
        } else {
          firms.set(domain, {
            domain,
            homeUrl,
            sourceQueries: new Set([query]),
            discoveredUrls: new Set([url])
          });
        }
      }
    }
  }

  /* =========================
     CRAWL + EVALUATE
  ========================= */

  const results: any[] = [];

  for (const firm of firms.values()) {
    const page = await fetchHtml(firm.homeUrl, crawlLimiter, {
      timeoutMs: 20000,
      maxRetries: 2
    });

    if (!page.ok || !page.html) continue;

    const extracted = extractFromHtml(page.html);
    const evaluation = evaluateCpaSite(extracted.text);

    if (!evaluation.keep) continue;

    const firmName =
      extracted.h1?.trim() ||
      extracted.title?.replace(/\s+\|.*$/, "").trim() ||
      `UNKNOWN (${firm.domain})`;

    results.push({
      name: firmName,
      domain: firm.domain,
      url: firm.homeUrl,
      metro: spec.metro,
      score: evaluation.score,
      signals: evaluation.signals,
      reasons: evaluation.reasons,
      source_queries: Array.from(firm.sourceQueries),
      discovered_urls_sample: Array.from(firm.discoveredUrls).slice(0, 5)
    });
  }

  results.sort((a, b) => b.score - a.score);

  const output = {
    meta: {
      metro: spec.metro,
      generated_at: new Date().toISOString(),
      total_unique_domains: firms.size,
      total_kept: results.length
    },
    firms: results
  };

  const outPath = resolve(outDir, "cpas_raw.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`✅ CPA Phase-1 normalized discovery complete`);
  console.log(`Domains discovered: ${firms.size}`);
  console.log(`Firms kept: ${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
