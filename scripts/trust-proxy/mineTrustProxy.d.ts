import type { TrustProxySpec } from "../run-cpa";

export type TrustProxyCandidate = {
  source: "supplier" | "association" | "expert";
  proxy: string;
  firm_name: string;
  domain: string;
  home_url: string;
  source_url: string;
  metro: string;
  evidence: string[];
};

export declare function mineTrustProxyCandidates(
  metro: string,
  spec: TrustProxySpec
): Promise<TrustProxyCandidate[]>;
