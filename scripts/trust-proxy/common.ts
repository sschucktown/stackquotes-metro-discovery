import fs from "node:fs";
import path from "node:path";
import pdf from "pdf-parse";

/**
 * Normalize a firm name aggressively but safely.
 * This is used ONLY for hint extraction, not final naming.
 */
export function cleanFirmName(input: string): string {
  if (!input) return "";

  return input
    .replace(/\b(cpa|cpas|accounting|accountants?)\b/gi, "")
    .replace(/\b(llc|llp|pllc|pc|inc|ltd)\b/gi, "")
    .replace(/[-–|•].*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Attempt to extract plausible firm-name hints from free text.
 * Extremely conservative — under-inclusion is intentional.
 */
export function extractFirmNameHints(text: string): string[] {
  if (!text) return [];

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = new Set<string>();

  for (const line of lines) {
    if (line.length < 6 || line.length > 80) continue;
    if (!/[A-Za-z]/.test(line)) continue;

    if (
      /\b(cpa|accounting|accountants?)\b/i.test(line) &&
      !/\b(top|best|ranked|directory|list)\b/i.test(line)
    ) {
      const cleaned = cleanFirmName(line);
      if (cleaned.length >= 4) {
        candidates.add(cleaned);
      }
    }
  }

  return Array.from(candidates).slice(0, 8);
}

/**
 * Normalize a domain from a URL.
 */
export function normalizeDomainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Convert any URL to its homepage root.
 */
export function toHomeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return "";
  }
}

/**
 * Detect directory / aggregator domains we never want to treat as firms.
 */
export function isProbablyDirectoryDomain(domain: string): boolean {
  const bad = [
    "yelp.com",
    "angi.com",
    "angieslist.com",
    "thumbtack.com",
    "expertise.com",
    "clutch.co",
    "upcity.com",
    "bbb.org",
    "mapquest.com",
    "yellowpages.com",
    "bizapedia.com",
    "chamberofcommerce.com"
  ];

  return bad.some((d) => domain.endsWith(d));
}

/**
 * Read and extract text from a remote PDF.
 * Used only for trust-proxy surfaces.
 */
export async function extractPdfTextFromUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120"
      }
    });

    if (!res.ok) return "";

    const buffer = Buffer.from(await res.arrayBuffer());
    const parsed = await pdf(buffer);

    return parsed.text || "";
  } catch {
    return "";
  }
}

/**
 * De-duplicate while preserving order.
 */
export function uniq<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}
