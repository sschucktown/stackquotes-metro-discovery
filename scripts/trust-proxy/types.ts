Run npm run build

> stackquotes-metro-discovery@0.1.0 build
> tsc -p tsconfig.json

Error: scripts/run-cpa.ts(9,10): error TS2305: Module '"./trust-proxy/mineTrustProxy.js"' has no exported member 'mineTrustProxyCandidates'.
Error: scripts/trust-proxy/index.ts(2,10): error TS2305: Module '"./mineTrustProxy.js"' has no exported member 'mineTrustProxyCandidates'.
Error: scripts/trust-proxy/mineTrustProxy.ts(19,3): error TS2305: Module '"./types.js"' has no exported member 'TrustProxySpec'.
Error: Process completed with exit code 2.
