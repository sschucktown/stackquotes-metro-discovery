import fs from "fs";
import path from "path";

import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";
import { mineTrustProxyCandidates } from "./trust-proxy/mineTrustProxy.js";

type RunSpec = {
  metro: string;
  category: string;
  language?: string;

  queries?: string[];
  search_queries?: string[];

  spanish_parity?: {
    enabled: boolean;
    language?: string;
    queries?: string[];
    search_queries?: string[];
  };

  trust_proxy?: any;

  output?: {
    raw_path?: string;
    scored_path?: string;
  };
};

function normalizeQueries(
  obj: { queries?: string[]; search_queries?: string[] },
  label: string
): string[] {
  const q = obj.queries ?? obj.search_queries;
  if (!Array.isArray(q) || q.length === 0) {
    throw new Error(`Run spec error: ${label} queries missing or invalid`);
  }
  return q;
}

async function runDiscoveryPass(
  metro: string,
  queries: string[],
  searchLimiter: RateLimiter,
  crawlLimiter: RateLimiter
) {
  const results: any[] = [];

  for (const query of queries) {
    console.log(`[CPA] search: ${query}`);

    const hits = await duckDuckGoSearch(query, searchLimiter, 25);

    for (const hit of hits) {
      if (!hit.url) continue;

      try {
        const res = await fetchHtml(hit.url, crawlLimiter, {
          timeoutMs: 20000,
          maxRetries: 1
        });

        if (!res.ok || !res.html) continue;

        const extracted = extractFromHtml(res.html);

        results.push({
          metro,
          source_query: hit.sourceQuery,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet ?? "",
          page: extracted
        });
      } catch {
        // swallow fetch failures
      }
    }
  }

  return results;
}

async function main() {
  const specPath =
    process.env.RUN_SPEC_PATH || process.argv[2];

  if (!specPath) {
    throw new Error("RUN_SPEC_PATH not provided");
  }

  const spec: RunSpec = JSON.parse(
    fs.readFileSync(specPath, "utf8")
  );

  const metro = spec.metro;

  const primaryQueries = normalizeQueries(
    spec,
    "primary"
  );

  const searchLimiter = new RateLimiter(950);
  const crawlLimiter = new RateLimiter(800);

  const rawResults: any[] = [];

  // ---- Pass 1: primary language
  rawResults.push(
    ...(await runDiscoveryPass(
      metro,
      primaryQueries,
      searchLimiter,
      crawlLimiter
    ))
  );

  // ---- Pass 2: Spanish parity
  if (spec.spanish_parity?.enabled) {
    const spanishQueries = normalizeQueries(
      spec.spanish_parity,
      "spanish"
    );

    rawResults.push(
      ...(await runDiscoveryPass(
        metro,
        spanishQueries,
        searchLimiter,
        crawlLimiter
      ))
    );
  }

  // ---- Trust proxy enrichment (async, 2-arg contract)
  const trustProxyResults = spec.trust_proxy
    ? await mineTrustProxyCandidates(metro, spec.trust_proxy)
    : [];

  // ---- Combine page text for evaluation
  const scored = rawResults.map((r) => {
    const combinedText = [
      r.title,
      r.snippet,
      r.page?.title,
      r.page?.h1,
      r.page?.text
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ...r,
      evaluation: evaluateCpaSite(combinedText)
    };
  });

  const rawPath =
    spec.output?.raw_path || "data/cpas_raw.json";
  const scoredPath =
    spec.output?.scored_path || "data/cpas_scored.json";

  fs.mkdirSync(path.dirname(rawPath), {
    recursive: true
  });

  fs.writeFileSync(
    rawPath,
    JSON.stringify(
      { pages: rawResults, trust_proxy: trustProxyResults },
      null,
      2
    )
  );

  fs.writeFileSync(
    scoredPath,
    JSON.stringify(scored, null, 2)
  );

  console.log(
    `CPA discovery complete: ${rawResults.length} pages, ${trustProxyResults.length} trust-proxy hits`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
