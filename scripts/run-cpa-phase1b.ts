import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";

type DiscoverySpec = {
  metro: string;
  role: "cpa" | "lawyer" | "supplier";
  language: "en" | "es";
  queries: string[];
};

type RawCpaFirm = {
  name: string;
  url: string;
  domain: string;
  source_query: string;
  lane: "en" | "es";
};

function normalizeDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function runLane(
  lane: "en" | "es",
  queries: string[],
  maxPerQuery = 30
): Promise<RawCpaFirm[]> {
  const limiter = new RateLimiter(900);
  const results: RawCpaFirm[] = [];
  const seenDomains = new Set<string>();

  for (const q of queries) {
    const hits = await duckDuckGoSearch(q, limiter, maxPerQuery);

    for (const h of hits) {
      const domain = normalizeDomain(h.url);
      if (!domain) continue;
      if (seenDomains.has(domain)) continue;

      seenDomains.add(domain);

      results.push({
        name: h.title || "",
        url: h.url,
        domain,
        source_query: q,
        lane
      });
    }
  }

  return results;
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    throw new Error("Spec file path required");
  }

  const absoluteSpecPath = path.resolve(specPath);
  if (!fs.existsSync(absoluteSpecPath)) {
    throw new Error(`Spec file not found: ${absoluteSpecPath}`);
  }

  const raw = fs.readFileSync(absoluteSpecPath, "utf-8");
  const spec: DiscoverySpec = JSON.parse(raw);

  if (
    !spec.metro ||
    !spec.role ||
    !spec.language ||
    !Array.isArray(spec.queries)
  ) {
    throw new Error("Invalid discovery spec schema");
  }

  console.log(
    `Running Phase 1b discovery — ${spec.metro} — ${spec.role} — ${spec.language}`
  );

  const results = await runLane(spec.language, spec.queries);

  const outputDir = path.join(
    "data",
    spec.metro.toLowerCase(),
    spec.role
  );

  ensureDir(outputDir);

  const outputPath = path.join(
    outputDir,
    `cpas_raw.phase1b.${spec.language}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(
    `Wrote ${results.length} ${spec.language.toUpperCase()} firms → ${outputPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
