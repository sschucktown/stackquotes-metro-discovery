name: CPA Phase 1b Discovery (Expanded)

on:
  workflow_dispatch:

jobs:
  discover:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm install

      - name: Build TypeScript
        run: npm run build

      # ---------- Phase 1b EN ----------
      - name: Run Phase 1b CPA discovery (EN)
        run: npm run run:cpa:phase1b -- specs/houston.cpa.phase1b.en.json

      # ---------- Phase 1b ES ----------
      - name: Run Phase 1b CPA discovery (ES)
        run: npm run run:cpa:phase1b -- specs/houston.cpa.phase1b.es.json

      # ---------- Upload Artifacts ----------
      - name: Upload Phase 1b artifacts
        uses: actions/upload-artifact@v4
        with:
          name: cpa-phase1b
          path: data/**
