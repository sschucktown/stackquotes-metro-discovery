import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

type RunSpec = {
  metro: string;
  category: "CPA";
  target_count: number; // 45
  search_provider: "duckduckgo";
  max_results_per_query: number; // 30+
  metro_slug?: string;

  // Two-pass discovery
  search_queries_pass1: string[]; // CPA/construction/accounting identity
  search_queries_pass2: string[]; // bookkeeping/trade terms + Spanish-first surface
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
    return u.toLowerCase();
  }
}

/**
 * Convert any deep link into a stable homepage URL:
 * scheme://host/
 */
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

/**
 * Known non-firm domains that should never be considered candidates.
 * (Keep this short and obvious; evaluator handles the rest.)
 */
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
    "foundationsupportworks.com",
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

/**
 * Pick up to 2 additional pages that tend to contain "real" service language.
 * Keep crawl light.
 */
function pickExtraPageLinks(baseUrl: string, links: Array<{ href: string; text: string }>): string[] {
  const wanted = [
    "services",
    "service",
    "industries",
    "industry",
    "construction",
    "contractor",
    "contractors",
    "builders",
    "bookkeeping",
    "outsourced",
    "about",
    "who we are"
  ];

  const chosen: string[] = [];

  for (const l of links) {
    const t = (l.text || "").toLowerCase();
    const h = (l.href || "").trim();
    if (!h) continue;

    if (!wanted.some((w) => t.includes(w))) continue;

    try {
      const abs = new URL(h, baseUrl).toString();
      if (abs.startsWith("mailto:") || abs.startsWith("tel:")) continue;

      // avoid obvious junk query params
      const u = new URL(abs);
      u.hash = "";
      chosen.push(u.toString());
    } catch {
      // ignore
    }

    if (chosen.length >= 2) break;
  }

  return Array.from(new Set(chosen));
}

/**
 * Run one "pass" of queries and add candidates domain-first.
 */
async function runDiscoveryPass(
  passName: "pass1" | "pass2",
  queries: string[],
  spec: RunSpec,
  searchLimiter: RateLimiter,
  candidatesByDomain: Map<string, FirmCandidate>
) {
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
        existing.sourceQueries.push(h.sourceQuery);
        existing.discoveredUrls.push(h.url);
        // prefer "better" title if we only have a placeholder
        if (existing.bestTitle.length < 5 && h.title.length > existing.bestTitle.length) {
          existing.bestTitle = h.title;
        }
      } else {
        candidatesByDomain.set(domain, {
          domain,
          homeUrl,
          bestTitle: h.title,
          sourceQueries: [h.sourceQuery],
          discoveredUrls: [h.url]
        });
      }
    }

    // No early break here—Houston needs breadth.
    // We cap later after evaluation.
    console.log(`[${passName}] query="${q}" hits=${hits.length} domains=${candidatesByDomain.size}`);
  }
}

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const raw = readFileSync(specPath, "utf-8");
  const spec = JSON.parse(raw) as RunSpec;

  if (spec.category !== "CPA") throw new Error("This runner only supports category=CPA");

  const metroSlug = spec.metro_slug ?? slugifyMetro(spec.metro);

  // Rate limits: DDG HTML is unofficial—be polite.
  const searchLimiter = new RateLimiter(950); // ~1 req/sec
  const crawlLimiter = new RateLimiter(750);  // modest, still polite

  // 1) Two-pass domain-first discovery
  const candidatesByDomain = new Map<string, FirmCandidate>();

  await runDiscoveryPass("pass1", spec.search_queries_pass1, spec, searchLimiter, candidatesByDomain);
  await runDiscoveryPass("pass2", spec.search_queries_pass2, spec, searchLimiter, candidatesByDomain);

  const discovered = Array.from(candidatesByDomain.values());

  // 2) Crawl + evaluate (mechanical filtering)
  const kept: any[] = [];
  let crawledPages = 0;

  for (const c of discovered) {
    // If we already have enough kept firms, we still finish crawling a bit more for quality,
    // but we don't need to exhaust everything.
    if (kept.length >= spec.target_count * 2) break;

    const homepage = await fetchHtml(c.homeUrl, crawlLimiter, {
