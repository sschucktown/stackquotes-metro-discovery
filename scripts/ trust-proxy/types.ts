export type TrustProxySource = "supplier" | "association" | "expert";

export type TrustProxyCandidate = {
  source: TrustProxySource;
  proxy: string;          // e.g., "AGC Houston", "Supplier event", "Expert listing"
  firm_name: string;      // best-effort extracted name
  domain: string;         // normalized domain if available, else ""
  home_url: string;       // best-effort homepage if available, else ""
  source_url: string;     // where we found it (search hit or doc)
  metro: string;
  evidence: string[];     // short strings explaining why we believe it’s a CPA/accounting firm
};
