
export type CpaSignals = {
  construction_language: boolean;
  contractor_language: boolean;
  job_costing: boolean;
  wip: boolean;
  percentage_of_completion: boolean;
  progress_billing: boolean;
  retainage: boolean;
  change_orders: boolean;
  trade_mentions: string[];
  spanish_detected: boolean;
  all_small_businesses_language: boolean;
  individual_tax_focus: boolean;
};

export type CpaEval = {
  keep: boolean;
  score: number;
  reasons: string[];
  signals: CpaSignals;
};

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function countHits(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n++;
  return n;
}

function detectTrades(text: string): string[] {
  const trades = [
    "roofing",
    "hvac",
    "heating",
    "air conditioning",
    "plumbing",
    "electric",
    "electrical",
    "solar",
    "siding",
    "windows",
    "doors",
    "gutters",
    "concrete",
    "fencing",
    "deck",
    "patio",
    "flooring",
    "drywall",
    "painting",
    "remodel",
    "kitchen",
    "bathroom"
  ];

  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const t of trades) {
    if (lower.includes(t)) {
      // Normalize a few
      if (t === "heating" || t === "air conditioning") found.add("hvac");
      else if (t === "electric") found.add("electrical");
      else found.add(t);
    }
  }

  return Array.from(found).slice(0, 10);
}

export function evaluateCpaSite(combinedText: string): CpaEval {
  const text = combinedText.toLowerCase();

  const constructionPats = [
    /\bconstruction\b/i,
    /\bcontractor(s)?\b/i,
    /\btrade(s)?\b/i,
    /\bsubcontract(or|ing)\b/i,
    /\bhome\s*builder(s)?\b/i
  ];

  const jobCostingPats = [
    /\bjob\s*cost(ing)?\b/i,
    /\bcost\s*code(s)?\b/i,
    /\bjob[-\s]?based\b/i
  ];

  const wipPats = [/\bwip\b/i, /\bwork[-\s]?in[-\s]?progress\b/i];

  const pocPats = [
    /\bpercentage[-\s]?of[-\s]?completion\b/i,
    /\bcompleted[-\s]?contract\b/i
  ];

  const progressBillingPats = [/\bprogress\s*billing\b/i];

  const retainagePats = [/\bretainage\b/i, /\bretention\b/i];

  const changeOrderPats = [/\bchange\s*order(s)?\b/i];

  const spanishPats = [
    /\bse\s*habla\s*español\b/i,
    /\bespañol\b/i,
    /\bservicios?\s+en\s+español\b/i,
    /lang\s*=\s*["']es["']/i,
    /\/es(\/|$)/i
  ];

  const allSmallBizPats = [
    /\ball\s+small\s+business(es)?\b/i,
    /\bany\s+small\s+business\b/i,
    /\bwe\s+serve\s+all\s+industries\b/i,
    /\ball\s+industries\b/i
  ];

  const individualTaxHeavyPats = [
    /\bpersonal\s+tax\b/i,
    /\bindividual\s+tax\b/i,
    /\b1040\b/i,
    /\btax\s+prep(aration)?\b/i
  ];

  const construction_language = hasAny(text, constructionPats);
  const contractor_language = /\bcontractor(s)?\b/i.test(text);

  const job_costing = hasAny(text, jobCostingPats);
  const wip = hasAny(text, wipPats);
  const percentage_of_completion = hasAny(text, pocPats);
  const progress_billing = hasAny(text, progressBillingPats);
  const retainage = hasAny(text, retainagePats);
  const change_orders = hasAny(text, changeOrderPats);

  const spanish_detected = hasAny(text, spanishPats);
  const all_small_businesses_language = hasAny(text, allSmallBizPats);

  // "Individual tax focus" if lots of individual-tax terms and *no* construction depth
  const indTaxHits = countHits(text, individualTaxHeavyPats);
  const constructionDepthHits =
    (job_costing ? 1 : 0) +
    (wip ? 1 : 0) +
    (percentage_of_completion ? 1 : 0) +
    (progress_billing ? 1 : 0) +
    (retainage ? 1 : 0) +
    (change_orders ? 1 : 0);

  const individual_tax_focus = indTaxHits >= 2 && constructionDepthHits === 0;

  const trade_mentions = detectTrades(text);

  // Kill rules (mechanical)
  const reasons: string[] = [];
  if (!construction_language) reasons.push("No construction/contractor language detected");
  if (all_small_businesses_language) reasons.push("Generic 'all small businesses/all industries' positioning");
  if (individual_tax_focus) reasons.push("Appears personal-tax dominant with no construction depth");

  const killed = !construction_language || all_small_businesses_language || individual_tax_focus;

  // Scoring (only for ranking/capping)
  let score = 0;
  if (construction_language) score += 20;
  if (contractor_language) score += 5;

  if (job_costing) score += 20;
  if (wip) score += 18;
  if (percentage_of_completion) score += 18;
  if (progress_billing) score += 10;
  if (retainage) score += 8;
  if (change_orders) score += 10;

  if (trade_mentions.length > 0) score += Math.min(10, trade_mentions.length * 2);

  if (spanish_detected) score += 6;

  // Penalize generic positioning
  if (all_small_businesses_language) score -= 30;
  if (individual_tax_focus) score -= 25;

  const signals: CpaSignals = {
    construction_language,
    contractor_language,
    job_costing,
    wip,
    percentage_of_completion,
    progress_billing,
    retainage,
    change_orders,
    trade_mentions,
    spanish_detected,
    all_small_businesses_language,
    individual_tax_focus
  };

  return {
    keep: !killed,
    score,
    reasons,
    signals
  };
}
