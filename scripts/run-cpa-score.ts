import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

type RawCpaCandidate = {
  firm_name: string;
  domain?: string;
  home_url?: string;
  source_url: string;
  metro: string;
};

type ScoredCpa = RawCpaCandidate & {
  score: number;
  keep: boolean;
  reasons: string[];
  signals: any;
};

const RAW_PATH = "data/cpas_raw.json";
const OUT_PATH = "data/cpas_scored.json";

async function scoreOne(
  cpa: RawCpaCandidate,
  limiter: RateLimiter
): Promise<ScoredCpa | null> {
  const url = cpa.home_url || cpa.source_url;
  if (!url) return null;

  const res = await fetchHtml(url, limiter, {
    timeoutMs: 20000,
    maxRetries: 2
  });

  if (!res.ok || !res.html) return null;

  const extracted = extractFromHtml(res.html);

  // Spanish parity: DO NOT discard Spanish pages
  const combinedText = [
    extracted.title,
    extracted.h1,
    extracted.text
  ].join("\n");

  const evalResult = evaluateCpaSite(combinedText);

  return {
    ...cpa,
    score: evalResult.score,
    keep: evalResult.keep,
    reasons: evalResult.reasons,
    signals: evalResult.signals
  };
}

async function main() {
  if (!fs.existsSync(RAW_PATH)) {
    throw new Error(`Missing input file: ${RAW_PATH}`);
  }

  const raw: RawCpaCandidate[] = JSON.parse(
    fs.readFileSync(RAW_PATH, "utf-8")
  );

  const limiter = new RateLimiter(800);
  const out: ScoredCpa[] = [];

  for (const cpa of raw) {
    try {
      const scored = await scoreOne(cpa, limiter);
      if (scored) out.push(scored);
    } catch (e) {
      console.error("Scoring failed for", cpa.firm_name, e);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(
    `Scored ${out.length} CPAs → ${OUT_PATH}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});