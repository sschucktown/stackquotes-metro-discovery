import pdfParse from "pdf-parse";

export function normalizeDomainFromUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function toHomeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Heuristic name cleanup for titles/snippets.
 */
export function cleanFirmName(raw: string): string {
  const s = (raw || "")
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\s+-\s+.*$/g, "")
    .replace(/\s+–\s+.*$/g, "")
    .replace(/\s+—\s+.*$/g, "")
    .trim();

  // remove obvious junk suffixes
  return s
    .replace(/\b(Houston|Texas|TX)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Extract candidate CPA/accounting firm name hints from a blob of text.
 * This is intentionally conservative and returns multiple candidates.
 */
export function extractFirmNameHints(text: string): string[] {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];

  // common firm patterns (best effort)
  const patterns: RegExp[] = [
    /\b([A-Z][A-Za-z&.\s]{2,80}?)\s+(CPA|CPAs)\b/g,
    /\b([A-Z][A-Za-z&.\s]{2,80}?)\s+(Accounting|Accountants)\b/g,
    /\b([A-Z][A-Za-z&.\s]{2,80}?)\s+(Tax|Advisors|Advisory)\b/g
  ];

  const out = new Set<string>();

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(t)) !== null) {
      const name = cleanFirmName(m[1] || "");
      if (name.length >= 3 && name.length <= 90) out.add(name);
      if (out.size >= 12) break;
    }
    if (out.size >= 12) break;
  }

  return Array.from(out);
}

export function isProbablyDirectoryDomain(domain: string): boolean {
  const banned = [
    "yelp.com",
    "facebook.com",
    "linkedin.com",
    "yellowpages.com",
    "angi.com",
    "thumbtack.com",
    "clutch.co",
    "expertise.com",
    "bbb.org",
    "mapquest.com",
    "chamberofcommerce.com",
    "dnb.com",
    "opencorporates.com"
  ];
  return banned.some((b) => domain === b || domain.endsWith(`.${b}`));
}

/**
 * Fetch raw bytes (for PDFs).
 */
export async function fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export async function extractPdfTextFromUrl(url: string): Promise<string> {
  const bytes = await fetchBytes(url, 20000);
  if (!bytes) return "";
  try {
    const data = await pdfParse(Buffer.from(bytes));
    return (data.text || "").toString();
  } catch {
    return "";
  }
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
