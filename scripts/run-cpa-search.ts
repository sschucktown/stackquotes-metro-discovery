import fs from "node:fs";
import path from "node:path";

import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";

type Lane = "en" | "es";

type DiscoverySpec = {
  metro: string;
  lanes: Lane[];
  max_results_per_query: number;
  queries: Record<string, unknown>;
};

type RawCpaCandidate = {
  firm_name: string;
  domain: string;
  home_url: string;
  source_url: string;
  metro: string;
  lane: Lane;
  source_query: string;
};

const SPEC_PATH =
  process.env.RUN_SPEC_PATH || "scripts/specs/houston.cpa.json";

const DATA_DIR = "data";

function assertArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`);
  }
  for (const v of value) {
    if (typeof v !== "string") {
      throw new Error(`${label} must contain only strings`);
    }
  }
  return value;
}

function cleanFirmName(input: string): string {
  return input
    .replace(/\b(cpa|cpas|accounting|accountants?)\b/gi, "")
    .replace(/\b(llc|llp|pllc|pc|inc|ltd)\b/gi, "")
    .replace(/[-–|].*$/, "")
    .trim();
}

function normalizeDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toHomeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return "";
  }
}

async function runLane(
  spec: DiscoverySpec,
  lane: Lane
): Promise<RawCpaCandidate[]> {
  const limiter = new RateLimiter(900);

  const rawQueries = spec.queries[lane];
  const queries = assertArray(rawQueries, `queries.${lane}`);

  const out: RawCpaCandidate[] = [];

  for (const query of queries) {
    const hits = await duckDuckGoSearch(
      query,
      limiter,
      spec.max_results_per_query
    );

    for (const hit of hits) {
      const firm = cleanFirmName(hit.title || "");
      const domain = normalizeDomain(hit.url);

      if (!firm || firm.length < 4) continue;
      if (!domain) continue;

      out.push({
        firm_name: firm,
        domain,
        home_url: toHomeUrl(hit.url),
        source_url: hit.url,
        metro: spec.metro,
        lane,
        source_query: query
      });
    }
  }

  return out;
}

async function main() {
  if (!fs.existsSync(SPEC_PATH)) {
    throw new Error(`Missing discovery spec: ${SPEC_PATH}`);
  }

  const spec: DiscoverySpec = JSON.parse(
    fs.readFileSync(SPEC_PATH, "utf-8")
  );

  if (!Array.isArray(spec.lanes)) {
    throw new Error("spec.lanes must be an array");
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const lane of spec.lanes) {
    if (lane !== "en" && lane !== "es") {
      throw new Error(`Unsupported lane: ${lane}`);
    }

    const results = await runLane(spec, lane);
    const outPath = path.join(DATA_DIR, `cpas_raw.${lane}.json`);

    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

    console.log(
      `✓ CPA discovery (${lane.toUpperCase()}): ${results.length} candidates`
    );
  }

  console.log("✓ CPA discovery complete (all lanes)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
