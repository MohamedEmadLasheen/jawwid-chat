# The shared Quran dataset: a contract between PD-29 (builds it, P0-2) and PD-39 (consumes it)

Agreed 2026-10-27 between the PD-29 materials-quality session and the PD-39 session. The owner approved the approach the same day. Built by migration `20261027170000` and `apps/api/src/quran/` (PR #176).
- PD-29 builds it (plan: `docs/product/pd029-materials-quality-plan.md`, P0-2).
- PD-39's Quran step consumes it.
- The owner chose Tanzil Uthmani (Hafs). It is vendored as `data/quran/tanzil-uthmani-1.1.txt`.

## Ownership
- **PD-29 P0-2** owns:
  - the migration, on its own PD-29 slot;
  - the loader, the API module and the tests.
- **PD-39's migration (slot 20261027120000)** holds whiteboard tables only. It does NOT create `chat.quran_ayah`.
- **One module**: `apps/api/src/quran/` (`QuranModule`, `QuranTextService`, `QuranController`). Materials and the whiteboard import it.
- `materials/quran-surahs.ts` stays the surah metadata.

## The text and its fingerprints
- The vendored file lives at the repo root: `data/quran/<id>.txt`.
  - Verbatim, with Tanzil's copyright notice kept in it.
  - Next to it: `<id>.json` (id, fileSha256, ayahsDigest, attribution, sourceUrl) and `<id>.sha256` (for `shasum -c`).
- **Pinned three times**: `apps/api/src/quran/pinned.ts`, the manifest and the file itself.
  - The `quran-dataset` guard fails if they disagree, or if a pin entry can't be parsed.
  - `fileSha256` is the file.
  - `ayahsDigest` is the SHA-256 of the 6,236 per-ayah SHA-256s of the **verbatim** lines, joined with "\n" in canonical order.
- `chat.quran_dataset` holds one row per loaded file. `chat.quran_ayah` (PK dataset_id, surah, ayah) holds:
  - `text_uthmani`: VERBATIM (only the line terminator removed). `sha256` is its hash.
  - `basmala`: the Basmala prefix of ayah 1, or null (see below).
  - `verse`: the ayah without that prefix. `verse_sha256` is its hash.
  - `text_search` = `chat.quran_fold(verse)`, **derived in the database**, never supplied by a caller, never shown. The folding matches `lib/shared/utils/search_text.dart`; `data/quran/search-normalisation.vectors.json` holds both to it (a Dart test, and the integration spec for SQL).
- **Exactly one dataset is current**, chosen by the config key `quran.dataset` (an id). There's no is_current column to race on.
- **Append-only by trigger.** No UPDATE or DELETE, and no TRUNCATE of the text or the audio. No request-role grants; it is read only through the service.

## The Basmala (settled 2026-10-27)
- Tanzil writes the Basmala in front of ayah 1 of **112 surahs**: every surah except Al-Fatihah and At-Tawbah.
  - In Al-Fatihah, 1:1 IS the Basmala.
  - At-Tawbah has none.
- The file and every pinned hash stay verbatim. Each ayah is also split into `{ basmala, verse }`:
  - **Ayah 1 of surahs 2–8 and 10–114** must be `<prefix> <verse>`: one space, then a non-empty verse not starting with a space. The prefix's SHA-256 must be one of `BASMALA_SHA256`:
    - `ac1e6f8f…` — the plain spelling: 1:1 itself, prefixed to 110 surahs;
    - `5c88aa6a…` — the bi-shadda spelling, prefixed to 95 and 97.
    - Anything else refuses the load.
  - **9:1** must not start with an accepted Basmala.
  - **1:1** stays the verse, with `basmala` null.
  - A Basmala inside an ayah (27:30) is part of the verse.
- The split is computed independently by the loader, by `chat.load_quran_dataset`, and by the API's verification. Each refuses a mismatch.
- **Everything is defined against `verse`**: Tajweed code-point offsets, audio, the API's per-ayah `sha256` and the whiteboard's `rangeSha256`.

## Loading
- **Load checks.** The loader (`scripts/db/load-quran.py`, run by `scripts/db/load-quran.sh`) checks the file first. It then stages only the verbatim lines, and `chat.load_quran_dataset` checks everything again inside the database and derives the split and `text_search` itself:
  - the file hash equals the pinned constant (loader);
  - 6,236 rows, 114 surahs, and each surah's count equals `quran_surah.ayah_count`, numbered 1..n;
  - every row is non-empty;
  - the digest matches;
  - the Basmala rule holds;
  - all of it in one transaction.
- **Where the loader runs.** From a repo checkout, never inside the API image. The API image's build context is `apps/api`, so it can't see `data/`.
  - The deploy jobs run it right after `scripts/db/apply.sh`, against the same `DATABASE_URL`, as the migration authority's role.
  - It is idempotent: the same id with the same fingerprints is skipped, and the same id with different ones fails the deploy.
  - The API has no code path that writes the text.
- **Any consumer outside the API** that reads `data/quran/` directly (the `apps/lessons` CI build, a JSON snapshot) **must first run `python3 -I scripts/db/load-quran.py --check <id>`**, which checks the SHA-256, digest, counts and Basmala. The build fails on a non-zero exit. It then uses the same split, carrying the dataset id and `fileSha256`.
- `chat.loading_quran` and `chat.ingesting_quran_audio` route writes through their one function. They are **not a security boundary**: anyone who can run SQL as the owner can set them. The boundary is the grants, since no request role can touch these tables.

## API (read-only, any signed-in account)
- `GET /quran/ayahs?surah=N&from=A&to=B`:
  - at most 50 ayat;
  - 422 `COMM.QURAN_INVALID` for a bad range;
  - rate-limited (`abuse.throttle.quran_read_actor`).

```json
{ "dataset": {"id","sha256","attribution","sourceUrl"},
  "surah":   {"number","nameAr","nameEn","ayahCount"},
  "ayahs":   [{"ayah": 1, "basmala": "… | null", "text": "<verse>", "sha256": "<sha256 of text>", "audio": null}],
  "rangeSha256": "…" }
```

- `GET /quran/tajweed?surah&from&to` returns the servable marks `{ayah, start, end, rule, source, sourceVersion}`.
- **Fail closed.**
  - The API verifies the whole dataset at start-up and whenever `quran.dataset` changes: counts, numbering, every hash, the split and the digest.
  - It re-checks each served row (verbatim hash and split) on every request.
  - Any mismatch, or an unpinned, unloaded or unconfigured dataset, answers 503 `COMM.QURAN_UNAVAILABLE` to every Quran route until a fresh verification passes.
  - Any failure, a crash included, is retried at most every 30 s.
- Phase 2, PD-39 and PD-29 alike: `GET /quran/search?q=` over `text_search`.

## For consumers: the four answers (asked by PD-39, 2026-10-27)
1. **Field names.** `ayahs[i] = { ayah, basmala, text, sha256, audio }`. `basmala` is a string only for ayah 1 of the 112 surahs that carry it, otherwise null. `text` is the verse.
2. **What the per-ayah `sha256` covers.** It is the SHA-256 of `text` (the verse) in UTF-8, **only**. It never covers the Basmala.
3. **The Basmala's hash.** The API returns none. The Basmala isn't referenced, so it needs no hash in a response. The only Basmala hashes are the two accepted spellings, fixed in code (`BASMALA_SHA256`, the migration and the loader). A served `basmala` is always one of them, because the load refuses anything else.
4. **`rangeSha256`.** The formula is unchanged: SHA-256 of the range's per-ayah `sha256` values (verse hashes) joined with "\n". The value differs from the pre-split draft only for ranges that include an ayah 1.

## How consumers reference text (never store it)
- The whiteboard verse element is `{surah, fromAyah, toAyah, datasetId, rangeSha256}`.
  - `rangeSha256` = SHA-256 of the ayat's `sha256` values (the **verse** hashes) joined with "\n", in ayah order.
  - On render it is recomputed from the API answer. A mismatch shows "Verse text updated, re-insert", and the verse is never silently redrawn.
  - The Basmala is drawn from `basmala`, and is never part of the reference.

## Tajweed
- `chat.quran_tajweed_mark` is one rule over `[start, end)`, in Unicode CODE POINTS into the ayah's **`verse`**. That's code points, not UTF-16: Dart and JS consumers convert.
  - It starts `pending`.
  - It is reviewed **once** (`approved` | `rejected`), by a Tajweed reviewer, with `reviewed_by` (an FK to `chat.staff`) and `reviewed_at`.
  - It is never deleted, and its range can't reach past its verse.
- **Who reviews** (`chat.can_review_tajweed`): an active manager or member of an organization's Teachers department. This is a proposal for the owner (PR #176).
- `chat.quran_tajweed_review` is a sign-off of one surah for one `(dataset, source, source_version)`:
  - it names the **exact** approved, unwithdrawn marks it covers (`mark_ids`);
  - it records their digest, `marks_digest`: lines `ayah|start|end|rule`, sorted (rule in C order), joined with "\n", SHA-256;
  - the database refuses a sign-off whose digest isn't the digest of the marks it names;
  - it is append-only.
- `chat.quran_tajweed_withdrawal` pulls an approved mark, by a reviewer, with a reason. The mark and its history stay. Append-only.
- **A mark is served only when all of these hold:**
  - it is `approved`;
  - it is not withdrawn;
  - it is named by the **latest** sign-off of its surah, dataset, source and version;
  - that sign-off's digest still matches the marks it names;
  - its range lies inside its verse.
- A mark approved after a sign-off waits for a new one.
- Marks come from a published annotation, never from hand or model classification. None are shipped.

## Audio
- PD-29 only; PD-39 doesn't use audio in the MVP.
- One file per ayah (the verse, without the Basmala), self-hosted, so playback needs no timing tables.
- `chat.quran_ayah_audio`, PK `(reciter_code, surah, ayah)`:
  - `object_key` is **GENERATED** from (reciter, surah, ayah), with the same formula as `audioKey()`;
  - `sha256` and `byte_size` are **computed by the server's ingest** (`apps/api/src/quran/audio-ingest.ts`) from the object actually stored under that key, never supplied by a person. The database accepts a row only through the ingest path.
- **Audio is never served unverified.**
  - The API attaches audio only when `quran.audio` is configured and the stored key equals the computed key. The `sha256` it returns is the ingested one.
  - `quran.audio` stays unset, and no route calls the ingest, until the owner confirms the reciter and the right to self-host.
- Word or ayah timing segments, if ever needed, go in a separate table keyed to the audio file's `sha256`.

## Fonts
- Amiri Quran (OFL 1.1), the same file version in both consumers.
- The Flutter app bundles it as an asset; `apps/lessons` self-hosts it.
- Never Google Fonts.

## Known limits
- **TRUNCATE on the Tajweed tables** (`quran_tajweed_mark`, `quran_tajweed_review`, `quran_tajweed_withdrawal`) is not refused by a trigger. They reference `chat.staff`, and the integration harness runs `truncate chat.staff … cascade` before every suite, which reaches them. Row-level DELETE and UPDATE are refused. TRUNCATE needs the owner role, which the grants keep from every request role. (Accepted by the department head, 2026-10-27.) The text and the audio tables do refuse TRUNCATE.
- **The routing settings** (`chat.loading_quran`, `chat.ingesting_quran_audio`) are not a security boundary; see "Loading".
- **The Tajweed reviewer role** (`chat.can_review_tajweed`: an active manager or member of the Teachers department) is a proposal awaiting the owner's decision.
