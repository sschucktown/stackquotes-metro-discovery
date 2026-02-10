import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { duckDuckGoSearch } from "./core/searchDuckDuckGo.js";

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
  const outDir = path.join("data");
  ensureDir(outDir);

  // ============================
  // ENGLISH — VERY BROAD
  // ============================
  const enQueries = [
    "CPA Houston",
    "Accounting firm Houston",
    "Tax and accounting Houston",
    "Certified Public Accountant Houston",
    "Small business accounting Houston",
    "Industries we serve CPA Houston",
    "Business accounting Houston TX",
    "Professional accounting services Houston"
  ];

  // ============================
  // SPANISH — VERY BROAD
  // ============================
  const esQueries = [
    "contador público Houston",
    "contador Houston TX",
    "servicios contables Houston",
    "CPA en español Houston",
    "impuestos y contabilidad Houston",
    "firma contable Houston español",
    "contador para negocios Houston"
  ];

  console.log("Running Phase 1 CPA discovery — EN");
  const en = await runLane("en", enQueries);

  console.log("Running Phase 1 CPA discovery — ES");
  const es = await runLane("es", esQueries);

  const enPath = path.join(outDir, "cpas_raw.phase1.en.json");
  const esPath = path.join(outDir, "cpas_raw.phase1.es.json");

  fs.writeFileSync(enPath, JSON.stringify(en, null, 2));
  fs.writeFileSync(esPath, JSON.stringify(es, null, 2));

  console.log(`Wrote ${en.length} EN CPA firms → ${enPath}`);
  console.log(`Wrote ${es.length} ES CPA firms → ${esPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
