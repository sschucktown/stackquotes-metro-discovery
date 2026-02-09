import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";

type SearchSpec = {
  metro: string;
  max_per_query: number;
  english_queries: string[];
  spanish_queries: string[];
};

type RawCpaCandidate = {
  firm_name: string;
  domain: string;
  url: string;
  source_query: string;
  language: "en" | "es";
};

function normalizeDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function inferFirmName(title: string): string {
  return title
    .replace(/[-|].*$/, "")
    .replace(/\bCPA(s)?\b/i, "")
    .trim();
}

async function runQueries(
  queries: string[],
  language: "en" | "es",
  limiter: RateLimiter,
  maxPerQuery: number
): Promise<RawCpaCandidate[]> {
  const out: RawCpaCandidate[] = [];

  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, limiter, maxPerQuery);
    for (const h of hits) {
      const domain = normalizeDomain(h.url);
      if (!domain) continue;

      out.push({
        firm_name: inferFirmName(h.title),
        domain,
        url: h.url,
        source_query: q,
        language
      });
    }
  }

  return out;
}

async function main() {
  const specPath =
    process.env.RUN_SPEC_PATH ||
    "scripts/specs/houston.cpa.search.json";

  const spec: SearchSpec = JSON.parse(
    fs.readFileSync(specPath, "utf-8")
  );

  const limiter = new RateLimiter(900);

  const en = await runQueries(
    spec.english_queries,
    "en",
    limiter,
    spec.max_per_query
  );

  const es = await runQueries(
    spec.spanish_queries,
    "es",
    limiter,
    spec.max_per_query
  );

  // de-dupe by domain, preserving language if either is Spanish
  const merged = new Map<string, RawCpaCandidate>();

  for (const c of [...en, ...es]) {
    const existing = merged.get(c.domain);
    if (!existing) {
      merged.set(c.domain, c);
    } else if (existing.language === "en" && c.language === "es") {
      merged.set(c.domain, c);
    }
  }

  const output = Array.from(merged.values());

  const outDir = path.join("data", "houston");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, "cpas_raw.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(
    `CPA discovery complete: ${output.length} raw firms (${en.length} EN hits, ${es.length} ES hits)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
