import fs from "fs";
import path from "path";
import { RateLimiter } from "./core/rateLimit.js";
import { fetchHtml } from "./core/fetchPage.js";
import { extractFromHtml } from "./core/extractText.js";

type ScoredCpa = {
  firm_name: string;
  domain?: string;
  home_url?: string;
  score: number;
  keep: boolean;
  signals: any;
};

type SpanishSupport = {
  confirmed: boolean;
  confidence: "high" | "medium" | "low" | "none";
  evidence: string[];
};

const limiter = new RateLimiter(800);

const SPANISH_STRONG = [
  /se habla español/i,
  /servicios en español/i,
  /hablamos español/i,
  /lang\s*=\s*["']es["']/i,
  /\/es(\/|$)/i
];

const SPANISH_MEDIUM = [
  /bilingual/i,
  /spanish[-\s]?speaking/i,
  /habla español/i
];

function detectSpanish(text: string): SpanishSupport {
  const evidence: string[] = [];

  if (SPANISH_STRONG.some(r => r.test(text))) {
    evidence.push("Explicit Spanish service detected");
    return { confirmed: true, confidence: "high", evidence };
  }

  if (SPANISH_MEDIUM.some(r => r.test(text))) {
    evidence.push("Spanish-capable staff inferred");
    return { confirmed: false, confidence: "medium", evidence };
  }

  if (text.includes("houston") || text.includes("texas")) {
    evidence.push("Regional Spanish inference only");
    return { confirmed: false, confidence: "low", evidence };
  }

  return { confirmed: false, confidence: "none", evidence: [] };
}

async function enrichFirm(firm: ScoredCpa): Promise<SpanishSupport> {
  if (!firm.home_url) {
    return { confirmed: false, confidence: "none", evidence: [] };
  }

  const res = await fetchHtml(firm.home_url, limiter, { timeoutMs: 15000 });
  if (!res.ok || !res.html) {
    return { confirmed: false, confidence: "none", evidence: [] };
  }

  const extracted = extractFromHtml(res.html);
  const combined = `${extracted.title}\n${extracted.h1}\n${extracted.text}`.toLowerCase();

  return detectSpanish(combined);
}

async function main() {
  const inputPath = path.join("data", "cpas_scored.en.json");
  if (!fs.existsSync(inputPath)) {
    throw new Error("Missing input file: data/cpas_scored.en.json");
  }

  const firms: ScoredCpa[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const kept = firms.filter(f => f.keep);

  const out = [];

  for (const firm of kept) {
    const spanish = await enrichFirm(firm);
    out.push({
      ...firm,
      spanish_support: spanish
    });
  }

  const outputPath = path.join("data", "cpas_final.json");
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote ${out.length} enriched CPAs to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
