import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";
import { mineTrustProxyCandidates } from "./trust-proxy/mineTrustProxy.js";

/* ---------- types ---------- */

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

/* ---------- helpers ---------- */

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
    "opencorporates.com"
  ];
  return banned.some((b) => domain === b || domain.endsWith(`.${b}`));
}

function pickCandidateName(
  fallbackTitle: string,
  extractedTitle: string,
  extractedH1: string
): string {
  const candidates = [extractedH1, extractedTitle, fallbackTitle]
    .map((x) => (x || "").trim())
    .filter(Boolean);

  return (candidates[0] ?? "Unknown Firm")
    .replace(/\s+\|\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

/* ---------- discovery ---------- */

async function runDiscoveryPass(
  passName: string,
  queries: string[],
  spec: RunSpec,
  searchLimiter: RateLimiter,
  candidatesByDomain: Map<string, FirmCandidate>
) {
  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, searchLimiter, spec.max_results_per_query);

    for (const h of hits as any[]) {
      const url = h.url || "";
      const title = h.title || "";
      if (!url) continue;

      const domain = normalizeDomain(url);
      if (!domain || isBannedDomain(domain)) continue;

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

    console.log(`[${passName}] ${q} → domains=${candidatesByDomain.size}`);
  }
}

/* ---------- main ---------- */

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as RunSpec;

  const metroSlug = spec.metro_slug ?? slugifyMetro(spec.metro);
  const outDir = resolve("data", metroSlug);
  mkdirSync(outDir, { recursive: true });

  const searchLimiter = new RateLimiter(950);
  const crawlLimiter = new RateLimiter(750);

  const candidatesByDomain = new Map<string, FirmCandidate>();

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

  if (spec.search_queries_pass3?.length) {
    await runDiscoveryPass(
      "pass3",
      spec.search_queries_pass3,
      spec,
      searchLimiter,
      candidatesByDomain
    );
  }

  /* ---- Phase 4 trust proxy ---- */

  const trustProxyCandidates = spec.trust_proxy?.enabled
    ? await mineTrustProxyCandidates(spec.metro, spec.trust_proxy)
    : [];

  writeFileSync(
    resolve(outDir, "trust_proxy_raw.json"),
    JSON.stringify(trustProxyCandidates, null, 2),
    "utf-8"
  );

  for (const tp of trustProxyCandidates as any[]) {
    const domain = tp.domain || normalizeDomain(tp.source_url);
    const homeUrl = tp.home_url || toHomeUrl(tp.source_url);
    if (!domain || !homeUrl || isBannedDomain(domain)) continue;

    const existing = candidatesByDomain.get(domain);
    if (existing) {
      existing.sourceQueries.push(`trust-proxy:${tp.source}`);
    } else {
      candidatesByDomain.set(domain, {
        domain,
        homeUrl,
        bestTitle: tp.firm_name || domain,
        sourceQueries: [`trust-proxy:${tp.source}`],
        discoveredUrls: [tp.source_url],
        origin: "trust-proxy"
      });
    }
  }

  /* ---- crawl + evaluate ---- */

  const kept: any[] = [];

  for (const c of candidatesByDomain.values()) {
    if (kept.length >= spec.target_count * 2) break;

    const page = await fetchHtml(c.homeUrl, crawlLimiter);
    if (!page.ok || !page.html) continue;

    const extracted = extractFromHtml(page.html);
    const evaled = evaluateCpaSite(extracted.text);
    if (!evaled.keep) continue;

    kept.push({
      name: pickCandidateName(c.bestTitle, extracted.title, extracted.h1),
      domain: c.domain,
      url: page.url,
      origin: c.origin,
      score: evaled.score,
      signals: evaled.signals,
      reasons: evaled.reasons,
      source_queries: Array.from(new Set(c.sourceQueries))
    });
  }

  kept.sort((a, b) => b.score - a.score);

  writeFileSync(
    resolve(outDir, "cpas_raw.json"),
    JSON.stringify(kept.slice(0, spec.target_count), null, 2),
    "utf-8"
  );

  console.log(`✅ Houston CPA discovery complete (${kept.length} evaluated)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
