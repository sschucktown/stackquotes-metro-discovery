export type TrustProxySource = "supplier" | "association" | "expert";

export type TrustProxyCandidate = {
  source: TrustProxySource;
  proxy: string;
  firm_name: string;
  domain: string;
  home_url: string;
  source_url: string;
  metro: string;
  evidence: string[];
};

export type TrustProxySpec = {
  enabled: boolean;
  max_candidates_total: number;
  max_candidates_per_source: {
    supplier: number;
    association: number;
    expert: number;
  };
  queries: {
    supplier: string[];
    association: string[];
    expert: string[];
  };
};
