export type CpaSignals = {
  cpa_identity_present: boolean;
  construction_language: boolean;
  contractor_language: boolean;

  job_costing: boolean;
  wip: boolean;
  percentage_of_completion: boolean;
  progress_billing: boolean;
  retainage: boolean;
  change_orders: boolean;

  bookkeeping_language: boolean;
  quickbooks_language: boolean;

  trade_mentions: string[];
  spanish_detected: boolean;

  all_small_businesses_language: boolean;
  individual_tax_focus: boolean;

  national_firm_marketing: boolean;
  directory_or_list_site: boolean;
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

  return Array.from(found).slice(0, 12);
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
    /\bbuilder(s)?\b/i,
    /\btrade(s)?\b/i
  ];

  const jobCostingPats = [
    /\bjob\s*cost(ing)?\b/i,
    /\bcost\s*code(s)?\b/i,
    /\bjob[-\s]?costing\b/i
  ];

  const wipPats = [/\bwip\b/i, /\bwork[-\s]?in[-\s]?progress\b/i];
  const pocPats = [/\bpercentage[-\s]?of[-\s]?completion\b/i, /\bcompleted[-\s]?contract\b/i];
  const progressBillingPats = [/\bprogress\s*billing\b/i];
  const retainagePats = [/\bretainage\b/i, /\bretention\b/i];
  const changeOrderPats = [/\bchange\s*order(s)?\b/i];

  const bookkeepingPats = [/\bbookkeeping\b/i, /\bbookkeeper(s)?\b/i, /\boutsource(d)?\s+accounting\b/i];
  const quickbooksPats = [/\bquickbooks\b/i, /\bqb\b/i];

  const spanishPats = [
    /\bse\s+habla\s+español\b/i,
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

  // Suppress national/regional “construction industry page” marketing
  const nationalFirmPats = [
    /\bnationwide\b/i,
    /\bserving\s+clients\s+across\s+the\s+country\b/i,
    /\bmultiple\s+offices\b/i,
    /\boffices?\s+in\s+\d+\s+states\b/i,
    /\bglobal\b/i,
    /\binternational\b/i,
    /\btop\s+\d+\b.*\bfirm\b/i
  ];

  // Directory/list sites that should not be contact targets
  const directoryPats = [
    /\btop\s+\d+\b/i,
    /\bbest\s+of\b/i,
    /\branking(s)?\b/i,
    /\bdirectory\b/i,
    /\blist\b/i,
    /\bfind\s+a\b/i
  ];

  const cpa_identity_present = hasAny(text, cpaIdentityPats);
  const construction_language = hasAny(text, constructionPats);
  const contractor_language = /\bcontractor(s)?\b/i.test(text);

  const job_costing = hasAny(text, jobCostingPats);
  const wip = hasAny(text, wipPats);
  const percentage_of_completion = hasAny(text, pocPats);
  const progress_billing = hasAny(text, progressBillingPats);
  const retainage = hasAny(text, retainagePats);
  const change_orders = hasAny(text, changeOrderPats);

  const bookkeeping_language = hasAny(text, bookkeepingPats);
  const quickbooks_language = hasAny(text, quickbooksPats);

  const spanish_detected = hasAny(text, spanishPats);
  const all_small_businesses_language = hasAny(text, allSmallBizPats);

  const indTaxHits = countHits(text, individualTaxHeavyPats);
  const constructionDepthHits =
    (job_costing ? 1 : 0) +
    (wip ? 1 : 0) +
    (percentage_of_completion ? 1 : 0) +
    (progress_billing ? 1 : 0) +
    (retainage ? 1 : 0) +
    (change_orders ? 1 : 0) +
    (bookkeeping_language ? 1 : 0);

  const individual_tax_focus = indTaxHits >= 2 && constructionDepthHits === 0;

  const national_firm_marketing = hasAny(text, nationalFirmPats);
  const directory_or_list_site = hasAny(text, directoryPats) && !cpa_identity_present;

  const trade_mentions = detectTrades(text);

  // Kill rules (mechanical)
  const reasons: string[] = [];

  if (!cpa_identity_present) reasons.push("No CPA/accounting firm identity detected");
  if (!construction_language) reasons.push("No construction/contractor language detected");
  if (all_small_businesses_language) reasons.push("Generic 'all small businesses/all industries' positioning");
  if (individual_tax_focus) reasons.push("Appears personal-tax dominant with no construction depth");
  if (national_firm_marketing) reasons.push("National/regional firm marketing language (low local trust leverage)");
  if (directory_or_list_site) reasons.push("Directory/list site (not a firm)");

  const killed =
    !cpa_identity_present ||
    !construction_language ||
    all_small_businesses_language ||
    individual_tax_focus ||
    national_firm_marketing ||
    directory_or_list_site;

  // Scoring (ranking only)
  let score = 0;
  if (cpa_identity_present) score += 20;
  if (construction_language) score += 20;
  if (contractor_language) score += 5;

  if (job_costing) score += 20;
  if (wip) score += 18;
  if (percentage_of_completion) score += 18;
  if (progress_billing) score += 10;
  if (retainage) score += 8;
  if (change_orders) score += 10;

  if (bookkeeping_language) score += 10;
  if (quickbooks_language) score += 6;

  if (trade_mentions.length > 0) score += Math.min(12, trade_mentions.length * 2);

  if (spanish_detected) score += 6;

  if (all_small_businesses_language) score -= 30;
  if (individual_tax_focus) score -= 25;
  if (national_firm_marketing) score -= 40;

  const signals: CpaSignals = {
    cpa_identity_present,
    construction_language,
    contractor_language,
    job_costing,
    wip,
    percentage_of_completion,
    progress_billing,
    retainage,
    change_orders,
    bookkeeping_language,
    quickbooks_language,
    trade_mentions,
    spanish_detected,
    all_small_businesses_language,
    individual_tax_focus,
    national_firm_marketing,
    directory_or_list_site
  };

  return {
    keep: !killed,
    score,
    reasons,
    signals
  };
}
