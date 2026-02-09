import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

type RawCpaCandidate = {
  firm_name: string;
  domain: string;
  url: string;
  source_query: string;
  language: "en" | "es";
};

type ScoredCpa = RawCpaCandidate & {
  score: number;
  keep: boolean;
  spanish_detected: boolean;
  reasons: string[];
};

async function main() {
  const inPath = path.join("data", "houston", "cpas_raw.json");
  if (!fs.existsSync(inPath)) {
    throw new Error("Missing cpas_raw.json. Run run-cpa-search first.");
  }

  const raw: RawCpaCandidate[] = JSON.parse(
    fs.readFileSync(inPath, "utf-8")
  );

  const limiter = new RateLimiter(800);
  const scored: ScoredCpa[] = [];

  for (const cpa of raw) {
    const home = `https://${cpa.domain}`;
    const res = await fetchHtml(home, limiter, {
      timeoutMs: 20000,
      maxRetries: 1
    });

    if (!res.ok || !res.html) continue;

    const extracted = extractFromHtml(res.html);
    const combinedText = `${extracted.title}\n${extracted.h1}\n${extracted.text}`;

    const evalResult = evaluateCpaSite(combinedText);

    scored.push({
      ...cpa,
      score: evalResult.score,
      keep: evalResult.keep,
      spanish_detected: evalResult.signals.spanish_detected,
      reasons: evalResult.reasons
    });
  }

  // 🔒 Spanish parity enforcement
  const keepEn = scored.filter(
    (c) => c.keep && !c.spanish_detected
  );
  const keepEs = scored.filter(
    (c) => c.keep && c.spanish_detected
  );

  const output = {
    summary: {
      total_raw: raw.length,
      total_scored: scored.length,
      keep_en: keepEn.length,
      keep_es: keepEs.length,
      parity_met: keepEs.length >= 5
    },
    keep_en: keepEn.sort((a, b) => b.score - a.score),
    keep_es: keepEs.sort((a, b) => b.score - a.score)
  };

  fs.writeFileSync(
    path.join("data", "houston", "cpas_scored.json"),
    JSON.stringify(output, null, 2)
  );

  console.log("CPA scoring complete.");
  console.log(output.summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";
import { evaluateCpaSite } from "./evaluators/evaluateCpa.js";

type RawCpaCandidate = {
  firm_name: string;
  domain: string;
  url: string;
  source_query: string;
  language: "en" | "es";
};

type ScoredCpa = RawCpaCandidate & {
  score: number;
  keep: boolean;
  spanish_detected: boolean;
  reasons: string[];
};

async function main() {
  const inPath = path.join("data", "houston", "cpas_raw.json");
  if (!fs.existsSync(inPath)) {
    throw new Error("Missing cpas_raw.json. Run run-cpa-search first.");
  }

  const raw: RawCpaCandidate[] = JSON.parse(
    fs.readFileSync(inPath, "utf-8")
  );

  const limiter = new RateLimiter(800);
  const scored: ScoredCpa[] = [];

  for (const cpa of raw) {
    const home = `https://${cpa.domain}`;
    const res = await fetchHtml(home, limiter, {
      timeoutMs: 20000,
      maxRetries: 1
    });

    if (!res.ok || !res.html) continue;

    const extracted = extractFromHtml(res.html);
    const combinedText = `${extracted.title}\n${extracted.h1}\n${extracted.text}`;

    const evalResult = evaluateCpaSite(combinedText);

    scored.push({
      ...cpa,
      score: evalResult.score,
      keep: evalResult.keep,
      spanish_detected: evalResult.signals.spanish_detected,
      reasons: evalResult.reasons
    });
  }

  // 🔒 Spanish parity enforcement
  const keepEn = scored.filter(
    (c) => c.keep && !c.spanish_detected
  );
  const keepEs = scored.filter(
    (c) => c.keep && c.spanish_detected
  );

  const output = {
    summary: {
      total_raw: raw.length,
      total_scored: scored.length,
      keep_en: keepEn.length,
      keep_es: keepEs.length,
      parity_met: keepEs.length >= 5
    },
    keep_en: keepEn.sort((a, b) => b.score - a.score),
    keep_es: keepEs.sort((a, b) => b.score - a.score)
  };

  fs.writeFileSync(
    path.join("data", "houston", "cpas_scored.json"),
    JSON.stringify(output, null, 2)
  );

  console.log("CPA scoring complete.");
  console.log(output.summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
