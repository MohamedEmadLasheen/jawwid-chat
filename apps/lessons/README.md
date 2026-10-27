# The lessons engine (PD-29 materials quality, P0-3)

A Chat-owned rebuild of the lessons site, written from scratch: nothing is copied from, installed from, or run from the old `jawwid-lessons` repo. Plan: `docs/product/pd029-materials-quality-plan.md`. Contract: `docs/product/quran-dataset-contract.md`.

- **Quran text:** only from the snapshot CI builds with `scripts/lessons/build-quran-snapshot.py`, which verifies `data/quran/` first. The engine re-verifies it and fails closed.
- **Audio:** one controller per lesson. Audio is OFF until the owner confirms the recitation rights.
- **Builds:** production builds come only from CI (the `lessons-dist-<sha>` artifact). Locally, `npm ci --ignore-scripts`, `npm run typecheck` and `npx vitest run --maxWorkers=2` only.
- **Supply chain:** guarded by `bash scripts/qa/guards.sh lessons-supply-chain`.
- **Hosting:** its own origin; see `deploy/headers.md`.
