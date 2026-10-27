# The shared Quran dataset: a contract between PD-29 (builds it, P0-2) and PD-39 (consumes it)

Agreed 2026-10-27 between the PD-29 materials-quality session and the PD-39 session. PD-29 builds it (plan: `docs/product/pd029-materials-quality-plan.md`, P0-2); PD-39's Quran step consumes it. Nothing here is built until the owner answers both PDs' Quran-source question (text source and the teacher who signs off).

## Ownership
- **PD-29 P0-2** owns:
  - the migration, on its own PD-29 slot;
  - the loader, the API module and the tests.
- **PD-39's migration (slot 20261027120000)** holds whiteboard tables only. It does NOT create `chat.quran_ayah`.
- **One module**: `apps/api/src/quran/` (`QuranModule`, `QuranTextService`, `QuranController`).
  - Materials and the whiteboard import it.
  - `materials/quran-surahs.ts` stays the surah metadata, re-exported by QuranModule.

## Storage
- `chat.quran_dataset`: one row per pinned source file.
  - `id` text pk, e.g. `tanzil-uthmani-1.1`
  - `sha256` text not null: the SHA-256 of the vendored file, also asserted in code
  - `attribution` text not null: "Tanzil Project — tanzil.net"
  - `source_url` text not null
  - `loaded_at` timestamptz
- `chat.quran_ayah`, PK (dataset_id, surah, ayah):
  - `dataset_id` → `quran_dataset`
  - `surah` smallint → `chat.quran_surah(number)`
  - `ayah` smallint, `1..quran_surah.ayah_count`
  - `text_uthmani` text not null: VERBATIM from the file; never normalised, trimmed of nothing but the line terminator
  - `text_search` text not null: derived; diacritics and Quranic marks stripped; Arabic normalised as `lib/shared/utils/search_text.dart` does; never shown
  - `sha256` text not null: SHA-256 of `text_uthmani`'s UTF-8 bytes
- **Exactly one dataset is "current"**, through config (`quran.dataset` = id). There is no is_current column race.
- **Append-only by trigger**: no UPDATE or DELETE. No request-role grants; read only through the service.
- **Load checks** (CLI loader, `apps/api/src/cli/load-quran.ts`):
  - the file hash equals the pinned constant;
  - 6,236 rows;
  - 114 surahs;
  - each surah's count equals `quran_surah.ayah_count`;
  - every row is non-empty;
  - all of it in one transaction.
- The vendored file lives at the repo root, `data/quran/<id>.txt`, verbatim, with Tanzil's copyright notice kept in it.
- `data/quran/<id>.sha256` sits next to it. The API loader and the `apps/lessons` build both read this one file, and CI compares it with the pinned constant.
- `text_search` normalisation is defined once in the TS loader, with the same rules as `lib/shared/utils/search_text.dart`. A shared test-vector file keeps the TS and Dart versions from drifting.

## API (read-only, any signed-in account)
- `GET /quran/ayahs?surah=N&from=A&to=B`
  - at most 50 ayat;
  - 422 when out of range;
  - rate-limited.

```json
{ "dataset": {"id","sha256","attribution","sourceUrl"},
  "surah":   {"number","nameAr","nameEn","ayahCount"},
  "ayahs":   [{"ayah": 1, "text": "...", "sha256": "..."}] }
```

- Phase 2, PD-39 and PD-29 alike: `GET /quran/search?q=` over `text_search`.
- The lessons engine's static JSON snapshot (PD-29) is built from the SAME table/file by CI, carrying the same dataset id and sha256.

## How consumers reference text (never store it)
- The whiteboard verse element is `{surah, fromAyah, toAyah, datasetId, rangeSha256}`.
  - `rangeSha256` = SHA-256 of the ayat's `sha256` values joined with "\n", in ayah order.
  - On render, it is recomputed from the API answer. A mismatch shows "Verse text updated, re-insert", and the verse is never silently redrawn.

## Tajweed annotations (PD-29 builds; PD-39 Phase 2 consumes for letter colouring)
- `chat.quran_tajweed_mark`:
  - `dataset_id`, `surah`, `ayah`
  - `start`, `end`: Unicode CODE POINT offsets into `text_uthmani`, end exclusive. Not UTF-16: Dart and JS consumers convert.
  - `rule` (a fixed key set)
  - `source`
  - `reviewed_by` (account id), `reviewed_at`
  - `state`: pending | approved | rejected
  - `source_version`
- `chat.quran_tajweed_review` records one sign-off per surah, because the teacher signs a review sheet per surah:
  - `dataset_id`, `surah`, `source`, `source_version`
  - `reviewed_by`, `reviewed_at`
  - `notes`
- A mark is served only when it is `approved` **and** its surah has a sign-off for the same `source_version`.
- Rules come from a published annotation, never from hand or model classification.

## Fonts
- Amiri Quran (OFL 1.1), the same file version in both consumers.
- The Flutter app bundles it as an asset; `apps/lessons` self-hosts it.
- Never Google Fonts.

## Audio
- PD-29 only. PD-39 does not use audio in the MVP.
- One file per ayah, self-hosted, so playback needs no timing tables.
- `chat.quran_ayah_audio`, PK `(reciter_code, surah, ayah)`:
  - `reciter_code`, e.g. `alafasy-128`
  - `surah`, `ayah`
  - `object_key`
  - `sha256`
  - `duration_ms`
- Word or ayah timing segments, if ever needed, go in a separate table keyed to the audio file's `sha256`.
