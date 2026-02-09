import fs from "fs";
import path from "path";

import { rateLimit } from "./core/rateLimit.js";
import { searchDuckDuckGo } from "./core/searchDuckDuckGo.js";
import { fetchPage } from "./core/fetchPage.js";
import { extractText } from "./core/extractText.js";
import { evaluateCpa } from "./evaluators/evaluateCpa.js";
import { mineTrustProxyCandidates } from "./trust-proxy/index.js";

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
  output?: {
    raw_path?: string;
    scored_path?: string;
  };
};

function normalizeQueries(
  spec: RunSpec,
  label: string
): string[] {
  const queries =
    spec.queries ??
    spec.search_queries ??
    [];

  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error(
      `Run spec error: ${label} queries missing or not an array`
    );
  }

  return queries;
}

async function runDiscoveryPass(
  queries: string[],
  label: string
) {
  const results: any[] = [];

  for (const query of queries) {
    console.log(`[${label}] Searching: ${query}`);

    await rateLimit();

    const urls = await searchDuckDuckGo(query);

    for (const url of urls) {
      try {
        await rateLimit();

        const html = await fetchPage(url);
        const text = extractText(html);

        results.push({
          query,
          url,
          text
        });
      } catch (err) {
        console.warn(`Failed to fetch ${url}`);
      }
    }
  }

  return results;
}

async function main() {
  const specPath =
    process.env.RUN_SPEC_PATH ||
    process.argv[2];

  if (!specPath) {
    throw new Error("RUN_SPEC_PATH not provided");
  }

  const rawSpec = fs.readFileSync(specPath, "utf8");
  const spec: RunSpec = JSON.parse(rawSpec);

  // --- Normalize primary queries ---
  const primaryQueries = normalizeQueries(
    spec,
    "primary"
  );

  const allResults: any[] = [];

  // --- Pass 1: English / primary ---
  const primaryResults = await runDiscoveryPass(
    primaryQueries,
    "primary"
  );
  allResults.push(...primaryResults);

  // --- Pass 2: Spanish parity (optional) ---
  if (spec.spanish_parity?.enabled) {
    const spanishQueries = normalizeQueries(
      spec.spanish_parity as any,
      "spanish"
    );

    const spanishResults = await runDiscoveryPass(
      spanishQueries,
      "spanish"
    );

    allResults.push(...spanishResults);
  }

  // --- Trust proxy enrichment ---
  const enriched = mineTrustProxyCandidates(allResults);

  // --- Scoring ---
  const scored = enriched.map(evaluateCpa);

  // --- Output ---
  const rawPath =
    spec.output?.raw_path ||
    "data/cpas_raw.json";

  const scoredPath =
    spec.output?.scored_path ||
    "data/cpas_scored.json";

  fs.mkdirSync(path.dirname(rawPath), {
    recursive: true
  });

  fs.writeFileSync(
    rawPath,
    JSON.stringify(allResults, null, 2)
  );

  fs.writeFileSync(
    scoredPath,
    JSON.stringify(scored, null, 2)
  );

  console.log(
    `CPA discovery complete: ${allResults.length} raw results`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
