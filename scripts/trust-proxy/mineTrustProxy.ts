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

import type {
  TrustProxyCandidate,
  TrustProxySource,
  TrustProxySpec
} from "./types.js";

type SearchHit = {
  title: string;
  url: string;
  sourceQuery: string;
  snippet?: string;
};

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

async function candidatesFromHit(
  source: TrustProxySource,
  metro: string,
  hit: SearchHit,
  crawlLimiter: RateLimiter
): Promise<TrustProxyCandidate[]> {
  const domain = normalizeDomainFromUrl(hit.url);
  if (domain && isProbablyDirectoryDomain(domain)) return [];

  let text = "";

  if (isPdfUrl(hit.url)) {
    text = await extractPdfTextFromUrl(hit.url);
  } else {
    const res = await fetchHtml(hit.url, crawlLimiter, {
      timeoutMs: 20000,
      maxRetries: 1
    });
    if (res.ok && res.html) {
      text = extractFromHtml(res.html).text;
    }
  }

  if (!text) return [];

  const names =
    extractFirmNameHints(text).length > 0
      ? extractFirmNameHints(text)
      : [cleanFirmName(hit.title || "")];

  const out: TrustProxyCandidate[] = [];

  for (const name of uniq(names)) {
    if (name.length < 4) continue;

    out.push({
      source,
      proxy: source,
      firm_name: name,
      domain,
      home_url: domain ? toHomeUrl(hit.url) : "",
      source_url: hit.url,
      metro,
      evidence: [`Mention via ${source}`]
    });
  }

  return out;
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
    const hits = await duckDuckGoSearch(q, searchLimiter, 20);

    for (const h of hits) {
      const cands = await candidatesFromHit(
        source,
        metro,
        {
          title: h.title,
          url: h.url,
          sourceQuery: q,
          snippet: h.snippet
        },
        crawlLimiter
      );

      out.push(...cands);
      if (out.length >= maxOut) break;
    }

    if (out.length >= maxOut) break;
  }

  return uniq(out).slice(0, maxOut);
}

export async function mineTrustProxyCandidates(
  metro: string,
  spec: TrustProxySpec
): Promise<TrustProxyCandidate[]> {
  if (!spec.enabled) return [];

  const searchLimiter = new RateLimiter(900);
  const crawlLimiter = new RateLimiter(800);

  const supplier = await mineSource(
    "supplier",
    metro,
    spec.queries.supplier,
    searchLimiter,
    crawlLimiter,
    spec.max_candidates_per_source.supplier
  );

  const association = await mineSource(
    "association",
    metro,
    spec.queries.association,
    searchLimiter,
    crawlLimiter,
    spec.max_candidates_per_source.association
  );

  const expert = await mineSource(
    "expert",
    metro,
    spec.queries.expert,
    searchLimiter,
    crawlLimiter,
    spec.max_candidates_per_source.expert
  );

  return uniq([...supplier, ...association, ...expert]).slice(
    0,
    spec.max_candidates_total
  );
}
