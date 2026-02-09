import * as cheerio from "cheerio";
import { RateLimiter } from "./rateLimit.js";
import { fetchHtml } from "./fetchPage.js";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  sourceQuery: string;
};

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    // Strip tracking/query for dedupe stability
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

export async function duckDuckGoSearch(
  query: string,
  limiter: RateLimiter,
  maxResults: number
): Promise<SearchHit[]> {
  // DuckDuckGo HTML endpoint
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetchHtml(url, limiter, { timeoutMs: 20000, maxRetries: 2 });
  if (!res.ok || !res.html) return [];

  const $ = cheerio.load(res.html);

  const hits: SearchHit[] = [];
  $(".result").each((_, el) => {
    if (hits.length >= maxResults) return;

    const a = $(el).find("a.result__a").first();
    const title = (a.text() || "").trim();
    let href = (a.attr("href") || "").trim();

    // DDG sometimes returns redirect links; try to extract uddg param
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) href = decodeURIComponent(uddg);
    } catch {
      // ignore
    }

    const snippet =
      ($(el).find(".result__snippet").first().text() || "").trim() ||
      ($(el).find(".result__body").text() || "").trim();

    if (!href || !title) return;

    hits.push({
      title,
      url: normalizeUrl(href),
      snippet,
      sourceQuery: query
    });
  });

  return hits;
}

