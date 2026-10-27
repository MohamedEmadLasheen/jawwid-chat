# The shared Quran dataset: vendored, pinned source files

One centralized Quran text for the lessons and the whiteboard. The contract is
`docs/product/quran-dataset-contract.md`.

| File | What it is |
|---|---|
| `<id>.txt` | The source file, **verbatim**, with its copyright notice kept in it. The first one will be Tanzil Uthmani (Hafs), `surah\|ayah\|text` per line. Never edited. |
| `<id>.json` | Its manifest: `id`, `fileSha256`, `ayahsDigest`, `attribution`, `sourceUrl`. |
| `<id>.sha256` | `shasum -a 256 -c` input for the file. |
| `search-normalisation.vectors.json` | The folding rules for `text_search`, which the database derives (`chat.quran_fold`). The Dart app and the integration spec both test against them. |

**The fingerprints are pinned three times**, and the `quran-dataset` guard fails if they disagree:
1. `apps/api/src/quran/pinned.ts`
2. the manifest
3. the file itself

**Adding or replacing a dataset is a reviewed change** to all three, never configuration.
- **Consumers outside the API** (the lessons build, a JSON snapshot) must run `python3 -I scripts/db/load-quran.py --check <id>` first and fail on a refusal.
- **Ayah 1 of 112 surahs starts with the Basmala.** It is split off by rule, and never counted as the verse. See the contract, "The Basmala".
- Loading: `scripts/db/load-quran.sh`, which the deploy job runs after the migrations.
- Serving: the API, only the dataset named by `chat.config` `quran.dataset`.

**Tanzil's terms:** CC BY 3.0. Copies must be verbatim. Any site or app that uses it must credit "Tanzil Project — tanzil.net" and link to tanzil.net. The API returns that attribution with every response.
