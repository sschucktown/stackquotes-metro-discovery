import { RateLimiter } from "../core/rateLimit.js";
import { duckDuckGoSearch } from "../core/searchDuckDuckGo.js";
import { fetchHtml } from "../core/fetchPage.js";
import { extractFromHtml } from "../core/extractText.js";
import {
  cleanFirmName,
  extractFirmNameHints,
  extractPdfTextFromUrl,
  isProbablyDirectoryDomain,
  normalizeDomainFromUrl,
  toHomeUrl,
  uniq
} from "./common.js";
import type { TrustProxyCandidate, TrustProxySource } from "./types.js";

export type TrustProxySpec = {
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

type SearchHit = {
  title: string;
  url: string;
  sourceQuery: string;
  snippet?: string;
};

function inferProxyLabel(source: TrustProxySource, url: string): string {
  if (source === "supplier") return "Supplier surface";
  if (source === "association") return "Trade association artifact";
  if (source === "expert") return "Expert / forensic surface";
  return url;
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url) || /filetype=pdf/i.test(url);
}

function looksLikeNationalMegaFirm(text: string): boolean {
  const t = text.toLowerCase();
  const bad = [
    "nationwide",
    "serving clients across the country",
    "offices in",
    "global",
    "international",
    "top 100 firm",
    "top 50 firm"
  ];
  return bad.some((x) => t.includes(x));
}

/**
 * Convert a search hit into 0..N proxy candidates.
 * This is best-effort and conservative.
 */
async function candidatesFromHit(
  source: TrustProxySource,
  metro: string,
  hit: SearchHit,
  crawlLimiter: RateLimiter
): Promise<TrustProxyCandidate[]> {
  const domain = normalizeDomainFromUrl(hit.url);
  if (domain && isProbablyDirectoryDomain(domain)) return [];

  const evidence: string[] = [];
  const blobHints: string[] = [];

  // Include title + snippet hints
  blobHints.push(hit.title || "");
  if (hit.snippet) blobHints.push(hit.snippet);

  // If PDF, parse text; else crawl HTML and parse visible text
  let pageText = "";
  if (isPdfUrl(hit.url)) {
    pageText = await extractPdfTextFromUrl(hit.url);
  } else {
    const html = await fetchHtml(hit.url, crawlLimiter, { timeoutMs: 20000, maxRetries: 1 });
    if (html.ok && html.html) {
      const extracted = extractFromHtml(html.html);
      pageText = extracted.text;
    }
  }

  const combined = [blobHints.join(" "), pageText].join("\n").trim();
  if (!combined) return [];

  // Filter out obvious mega-firm marketing from proxy surfaces
  if (looksLikeNationalMegaFirm(combined)) return [];

  const nameHints = extractFirmNameHints(combined);

  // fallback: if no hints, try to infer from title (very conservative)
  const fallbackName = cleanFirmName(hit.title || "");
  const inferred: string[] = [];
  if (nameHints.length) inferred.push(...nameHints);
  else if (fallbackName && fallbackName.length >= 4) inferred.push(fallbackName);

  const candidates: TrustProxyCandidate[] = [];

  for (const firm of uniq(inferred).slice(0, 5)) {
    // very small guardrails — we only keep plausible firm names
    if (firm.length < 4) continue;
    if (/top\s+\d+/i.test(firm)) continue;
    if (/best\s+/i.test(firm)) continue;

    evidence.push(`Mention detected via ${source}: "${firm}"`);

    candidates.push({
      source,
      proxy: inferProxyLabel(source, hit.url),
      firm_name: firm,
      domain: domain || "",
      home_url: domain ? toHomeUrl(hit.url) : "",
      source_url: hit.url,
      metro,
      evidence: uniq(evidence).slice(0, 4)
    });
  }

  return candidates;
}

async function mineSource(
  source: TrustProxySource,
  metro: string,
  queries: string[],
  searchLimiter: RateLimiter,
  crawlLimiter: RateLimiter,
  maxOut: number
): Promise<TrustProxyCandidate[]> {
  const out: TrustProxyCandidate[] = [];

  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, searchLimiter, 25);
    for (const h of hits as any[]) {
      const hit: SearchHit = {
        title: h.title || "",
        url: h.url || "",
        sourceQuery: q,
        snippet: h.snippet || ""
      };

      if (!hit.url) continue;

      const cands = await candidatesFromHit(source, metro, hit, crawlLimiter);
      for (const c of cands) {
        out.push(c);
        if (out.length >= maxOut) break;
      }
      if (out.length >= maxOut) break;
    }
    if (out.length >= maxOut) break;
  }

  return out;
}

export async function mineTrustProxyCandidates(
  metro: string,
  spec: TrustProxySpec
): Promise<TrustProxyCandidate[]> {
  if (!spec.enabled) return [];

  const searchLimiter = new RateLimiter(950);
  const crawlLimiter = new RateLimiter(800);

  const maxSupplier = spec.max_candidates_per_source.supplier ?? 10;
  const maxAssociation = spec.max_candidates_per_source.association ?? 10;
  const maxExpert = spec.max_candidates_per_source.expert ?? 5;

  const supplier = await mineSource(
    "supplier",
    metro,
    spec.queries.supplier || [],
    searchLimiter,
    crawlLimiter,
    maxSupplier
  );

  const association = await mineSource(
    "association",
    metro,
    spec.queries.association || [],
    searchLimiter,
    crawlLimiter,
    maxAssociation
  );

  const expert = await mineSource(
    "expert",
    metro,
    spec.queries.expert || [],
    searchLimiter,
    crawlLimiter,
    maxExpert
  );

  const merged = [...supplier, ...association, ...expert];

  // Final cap
  const capped = merged.slice(0, spec.max_candidates_total ?? 20);

  return capped;
}
