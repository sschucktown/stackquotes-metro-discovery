import fs from "node:fs";
import path from "node:path";

import { RateLimiter } from "./core/rateLimit.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

type RawCpaCandidate = {
  firm_name: string;
  domain: string;
  home_url: string;
  source_url: string;
  metro: string;
};

type ScoredCpa = RawCpaCandidate & {
  score: number;
  keep: boolean;
  reasons: string[];
  signals: Record<string, unknown>;
};

const DATA_DIR = "data";
const LANES = ["en", "es"] as const;

async function scoreLane(lane: typeof LANES[number]) {
  const inputPath = path.join(DATA_DIR, `cpas_raw.${lane}.json`);
  const outputPath = path.join(DATA_DIR, `cpas_scored.${lane}.json`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input file: ${inputPath}`);
  }

  const raw: RawCpaCandidate[] = JSON.parse(
    fs.readFileSync(inputPath, "utf-8")
  );

  const limiter = new RateLimiter(700);
  const scored: ScoredCpa[] = [];

  for (const cpa of raw) {
    let combinedText = "";

    if (cpa.home_url) {
      const res = await fetchHtml(cpa.home_url, limiter, {
        timeoutMs: 20000,
        maxRetries: 1
      });

      if (res.ok && res.html) {
        const extracted = extractFromHtml(res.html);
        combinedText = [
          extracted.title,
          extracted.h1,
          extracted.text
        ].join("\n");
      }
    }

    const evalResult = evaluateCpaSite(combinedText);

    scored.push({
      ...cpa,
      score: evalResult.score,
      keep: evalResult.keep,
      reasons: evalResult.reasons,
      signals: evalResult.signals
    });
  }

  fs.writeFileSync(outputPath, JSON.stringify(scored, null, 2));
  console.log(`✓ Scored ${scored.length} CPAs for lane: ${lane}`);
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const lane of LANES) {
    await scoreLane(lane);
  }

  console.log("✓ CPA scoring complete (EN + ES)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});