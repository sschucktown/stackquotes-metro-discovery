export type CpaSignals = {
  construction_language: boolean;
  contractor_language: boolean;
  cpa_identity_present: boolean;
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
    "plumbing",
    "electrical",
    "solar",
    "siding",
    "windows",
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
    if (lower.includes(t)) found.add(t);
  }

  return Array.from(found);
}

export function evaluateCpaSite(combinedText: string): CpaEval {
  const text = combinedText.toLowerCase();

  const cpaIdentityPats = [
    /\bcertified\s+public\s+accountant\b/i,
    /\bcpa(s)?\b/i,
    /\baccounting\s+firm\b/i,
    /\baccountants?\b/i
  ];

  const constructionPats = [
    /\bconstruction\b/i,
    /\bcontractor(s)?\b/i,
    /\bsubcontract(or|ing)\b/i,
    /\bbuilder(s)?\b/i
  ];

  const jobCostingPats = [/\bjob\s*cost(ing)?\b/i];
  const wipPats = [/\bwip\b/i, /\bwork[-\s]?in[-\s]?progress\b/i];
  const pocPats = [/\bpercentage[-\s]?of[-\s]?completion\b/i];
  const progressBillingPats = [/\bprogress\s*billing\b/i];
  const retainagePats = [/\bretainage\b/i];
  const changeOrderPats = [/\bchange\s*order(s)?\b/i];

  const spanishPats = [
    /\bse\s+habla\s+español\b/i,
    /\bespañol\b/i,
    /\/es(\/|$)/i
  ];

  const allSmallBizPats = [
    /\ball\s+small\s+business(es)?\b/i,
    /\ball\s+industries\b/i
  ];

  const individualTaxPats = [
    /\b1040\b/i,
    /\bpersonal\s+tax\b/i,
    /\btax\s+prep(aration)?\b/i
  ];

  const cpa_identity_present = hasAny(text, cpaIdentityPats);
  const construction_language = hasAny(text, constructionPats);

  const job_costing = hasAny(text, jobCostingPats);
  const wip = hasAny(text, wipPats);
  const percentage_of_completion = hasAny(text, pocPats);
  const progress_billing = hasAny(text, progressBillingPats);
  const retainage = hasAny(text, retainagePats);
  const change_orders = hasAny(text, changeOrderPats);

  const spanish_detected = hasAny(text, spanishPats);
  const all_small_businesses_language = hasAny(text, allSmallBizPats);

  const individual_tax_focus =
    countHits(text, individualTaxPats) >= 2 &&
    !job_costing &&
    !wip &&
    !percentage_of_completion;

  const trade_mentions = detectTrades(text);

  const reasons: string[] = [];

  if (!cpa_identity_present)
    reasons.push("No CPA or accounting firm identity detected");
  if (!construction_language)
    reasons.push("No construction or contractor language detected");
  if (all_small_businesses_language)
    reasons.push("Generic all-industries positioning");
  if (individual_tax_focus)
    reasons.push("Appears personal-tax focused");

  const killed =
    !cpa_identity_present ||
    !construction_language ||
    all_small_businesses_language ||
    individual_tax_focus;

  let score = 0;
  if (cpa_identity_present) score += 20;
  if (construction_language) score += 20;
  if (job_costing) score += 20;
  if (wip) score += 18;
  if (percentage_of_completion) score += 18;
  if (progress_billing) score += 10;
  if (retainage) score += 8;
  if (change_orders) score += 10;
  if (trade_mentions.length) score += Math.min(10, trade_mentions.length * 2);
  if (spanish_detected) score += 6;

  return {
    keep: !killed,
    score,
    reasons,
    signals: {
      construction_language,
      contractor_language: construction_language,
      cpa_identity_present,
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
    }
  };
}
