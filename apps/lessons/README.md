# The lessons engine (PD-29 materials quality, P0-3)

A Chat-owned rebuild of the lessons site, written from scratch: nothing is copied from, installed from, or run from the old `jawwid-lessons` repo. Plan: `docs/product/pd029-materials-quality-plan.md`. Contract: `docs/product/quran-dataset-contract.md`.

- **Quran text:** only from the snapshot CI builds with `scripts/lessons/build-quran-snapshot.py`, which verifies `data/quran/` first. The engine re-verifies it and fails closed.
- **Audio:** one controller per lesson. Audio is OFF until the owner confirms the recitation rights.
- **Builds:** production builds come only from CI (the `lessons-dist-<sha>` artifact). Locally, `npm ci --ignore-scripts`, `npm run typecheck` and `npx vitest run --maxWorkers=2` only. `typecheck` needs the snapshot first (`vite.config.ts` imports its manifest as the build's trust anchor): `python3 -I scripts/lessons/build-quran-snapshot.py` from the repo root.
- **Supply chain:** guarded by `bash scripts/qa/guards.sh lessons-supply-chain`. Every locked release must be at least 7 days old (CI's release-age step warns otherwise). `overrides` in `package.json` holds transitive packages (rollup, postcss, `@babel/*`, the browserslist family) at exact releases past that cooldown; to move one, re-lock from scratch (`npm install --package-lock-only --ignore-scripts` with no old lockfile) and check the release age again.
- **Hosting:** its own origin; see `deploy/headers.md`.
