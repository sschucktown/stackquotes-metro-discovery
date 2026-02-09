
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
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
  max_results_per_query: number; // 20
  search_queries: string[];
  // optional: for naming output
  metro_slug?: string;
};

type FirmCandidate = {
  name: string;
  url: string;
  sourceQueries: string[];
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

function pickCandidateName(fallbackTitle: string, extractedTitle: string, extractedH1: string): string {
  const candidates = [extractedH1, extractedTitle, fallbackTitle]
    .map((x) => (x || "").trim())
    .filter(Boolean);

  // crude cleanup
  const name = candidates[0] ?? "Unknown Firm";
  return name.replace(/\s+\|\s+.*$/, "").replace(/\s+-\s+.*$/, "").trim();
}

function pickExtraPageLinks(
  baseUrl: string,
  links: Array<{ href: string; text: string }>
): string[] {
  const wanted = ["services", "industries", "industry", "construction", "contractors", "about", "who we are"];
  const chosen: string[] = [];

  for (const l of links) {
    const t = (l.text || "").toLowerCase();
    const h = (l.href || "").trim();
    if (!h) continue;

    const match = wanted.some((w) => t.includes(w));
    if (!match) continue;

    try {
      const abs = new URL(h, baseUrl).toString();
      // Avoid mailto/tel
      if (abs.startsWith("mailto:") || abs.startsWith("tel:")) continue;
      chosen.push(abs);
    } catch {
      // ignore
    }

    if (chosen.length >= 2) break; // keep crawl light
  }

  // dedupe
  return Array.from(new Set(chosen));
}

async function main() {
  const specPath = process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";
  const raw = readFileSync(specPath, "utf-8");
  const spec = JSON.parse(raw) as RunSpec;

  if (spec.category !== "CPA") throw new Error("This runner only supports category=CPA");
  const metroSlug = spec.metro_slug ?? slugifyMetro(spec.metro);

  const searchLimiter = new RateLimiter(900); // ~1 req/sec
  const crawlLimiter = new RateLimiter(700);  // slightly faster but still polite

  // 1) Search expansion
  const candidatesByDomain = new Map<string, FirmCandidate>();

  for (const q of spec.search_queries) {
    const hits = await duckDuckGoSearch(q, searchLimiter, spec.max_results_per_query);

    for (const h of hits) {
      const domain = normalizeDomain(h.url);
      if (!domain || domain.includes("yelp.") || domain.includes("facebook.") || domain.includes("linkedin.")) {
        continue;
      }

      const existing = candidatesByDomain.get(domain);
      if (existing) {
        existing.sourceQueries.push(h.sourceQuery);
      } else {
        candidatesByDomain.set(domain, {
          name: h.title,
          url: h.url,
          sourceQueries: [h.sourceQuery]
        });
      }
    }

    // stop searching early if we already have plenty to filter down
    if (candidatesByDomain.size >= spec.target_count * 3) break;
  }

  const discovered = Array.from(candidatesByDomain.values());

  // 2) Crawl + evaluate (mechanical filtering)
  const firms: any[] = [];
  let crawled = 0;

  for (const c of discovered) {
    // Early exit once we have enough KEEP candidates comfortably above target
    // (we still sort by score later)
    if (firms.length >= spec.target_count * 2 && crawled > spec.target_count * 2) {
      // enough signal collected; avoid over-crawling
      break;
    }

    const homepage = await fetchHtml(c.url, crawlLimiter, { timeoutMs: 20000, maxRetries: 2 });
    crawled++;

    if (!homepage.ok || !homepage.html) continue;

    const extracted = extractFromHtml(homepage.html);
    const baseUrl = homepage.url;

    const extraPages = pickExtraPageLinks(baseUrl, extracted.links);

    // Crawl up to 2 extra pages
    let combinedText = extracted.text;
    const pagesChecked: string[] = ["homepage"];

    for (const p of extraPages) {
      const r = await fetchHtml(p, crawlLimiter, { timeoutMs: 20000, maxRetries: 2 });
      crawled++;
      if (!r.ok || !r.html) continue;
      const ex = extractFromHtml(r.html);
      combinedText += "\n" + ex.text;
      pagesChecked.push(p.includes("service") ? "services" : "extra");
    }

    const evaled = evaluateCpaSite(combinedText);
    if (!evaled.keep) continue;

    const firmName = pickCandidateName(c.name, extracted.title, extracted.h1);

    firms.push({
      name: firmName,
      url: baseUrl,
      metro: spec.metro,
      category: spec.category,
      signals: evaled.signals,
      score: evaled.score,
      pages_checked: pagesChecked,
      source_queries: Array.from(new Set(c.sourceQueries))
    });
  }

  // 3) Rank + cap at target_count
  firms.sort((a, b) => b.score - a.score);

  const final = firms.slice(0, spec.target_count);

  const out = {
    meta: {
      metro: spec.metro,
      metro_slug: metroSlug,
      category: spec.category,
      generated_at: new Date().toISOString(),
      search_provider: spec.search_provider,
      total_discovered: discovered.length,
      total_crawled: crawled,
      total_kept_before_cap: firms.length,
      target_count: spec.target_count
    },
    firms: final
  };

  const outDir = resolve("data", metroSlug);
  mkdirSync(outDir, { recursive: true });

  const outPath = resolve(outDir, "cpas_raw.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

  console.log(`Wrote ${final.length} firms to ${outPath}`);
  console.log(`Discovered: ${discovered.length}, Crawled: ${crawled}, Kept: ${firms.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
