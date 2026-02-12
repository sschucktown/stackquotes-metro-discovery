import fs from "fs";
import path from "path";
import process from "process";

/**
 * Phase 1b — Expanded Discovery
 *
 * This script:
 * - Validates spec schema
 * - Executes discovery queries
 * - Writes raw phase1b artifact
 *
 * It does NOT:
 * - Score
 * - Filter
 * - Enrich
 * - Kill firms
 */

type DiscoverySpec = {
  metro: string;
  role: "cpa" | "lawyer" | "supplier";
  language: "en" | "es";
  queries: string[];
};

async function fetchDuckDuckGo(query: string): Promise<string[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`Search failed for query: ${query}`);
  }

  const html = await res.text();

  // Extremely simple link extraction (discovery only)
  const matches = Array.from(html.matchAll(/<a[^>]+href="([^"]+)"/g));

  const urls = matches
    .map((m) => m[1])
    .filter((u) => u.startsWith("http"))
    .map((u) => {
      try {
        const parsed = new URL(u);
        return parsed.origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];

  return urls;
}

function dedupeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains));
}

async function main() {
  const specPath = process.argv[2];

  if (!specPath) {
    throw new Error("Spec file path required");
  }

  const absoluteSpecPath = path.resolve(specPath);

  if (!fs.existsSync(absoluteSpecPath)) {
    throw new Error(`Spec file not found: ${absoluteSpecPath}`);
  }

  const raw = fs.readFileSync(absoluteSpecPath, "utf-8");
  const spec: DiscoverySpec = JSON.parse(raw);

  // Schema validation (strict per Spec Schema)
  if (
    !spec.metro ||
    !spec.role ||
    !spec.language ||
    !Array.isArray(spec.queries)
  ) {
    throw new Error("Invalid discovery spec schema");
  }

  const discovered: string[] = [];

  for (const query of spec.queries) {
    console.log(`Running query: ${query}`);
    const results = await fetchDuckDuckGo(query);
    discovered.push(...results);
  }

  const uniqueDomains = dedupeDomains(discovered);

  const outputDir = path.join(
    "data",
    spec.metro.toLowerCase(),
    spec.role
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `cpas_raw.phase1b.${spec.language}.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        metro: spec.metro,
        role: spec.role,
        language: spec.language,
        phase: "phase1b",
        domainCount: uniqueDomains.length,
        domains: uniqueDomains
      },
      null,
      2
    )
  );

  console.log(`Wrote ${uniqueDomains.length} domains → ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
