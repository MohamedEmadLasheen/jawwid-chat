# Countries and subdivisions (PD-45): pinned source, reviewed overlay

The list of countries and of first-level subdivisions (governorates, emirates, provinces, states) a family may live in. The plan is `docs/product/pd045-parent-location-plan.md` §3.

| File | What it is |
|---|---|
| `cldr-49.json` | The pin: Unicode CLDR 49 (tag `release-49`), and the SHA-256 of every CLDR file the build reads |
| `overlay.json` | What CLDR gets wrong or lacks for our markets: the 88 Arabic subdivision names of Egypt, the six Gulf states and Jordan; the field label per country; the pinned order (Egypt, then the Gulf, then Jordan); a few country names |
| `overlay-review.json` | **Release gate R-45a**: the human sign-off of the overlay's Arabic, recorded by role (never by name, G-20), with the date and the SHA-256 of the overlay it covers |

**Generated from these** by `scripts/geo/build-dataset.py`, and never edited by hand:
- `apps/api/src/geo/dataset.json`: codes, Arabic and English names, labels, order, and every name that fell back to the other language;
- `apps/api/src/geo/LICENSE-CLDR.txt`: CLDR's notice, verbatim;
- the GENERATED block of `supabase/migrations/20261030030000_chat_pd045_parent_location.sql`: the reference tables' seed, codes only.

## Rebuild or verify

```
bash scripts/geo/fetch-cldr.sh <new-empty-dir-outside-the-repo>
python3 -I scripts/geo/build-dataset.py --cldr <that-dir> --check   # or without --check to write
```

`fetch-cldr.sh` refuses a file whose SHA-256 is not its pin, and so does the build. The CLDR files are data: they are read by fixed patterns, never executed.

## Rules

- **Codes in the database, names in the dataset.** The migration seeds codes only, so correcting an Arabic name never needs a migration.
- **Why CLDR:** Unicode License v3, a permissive licence. CLDR's notice restricts only the LDML specification document (UTS #35), which is not shipped. Debian's `iso-codes` was rejected because it is LGPL.
- **Why an overlay:** every CLDR 49 Arabic subdivision name is marked *draft*, and the type word is used unevenly ("محافظة القاهرة" beside "الإسكندرية"). The overlay names drop the type word, because the field label carries it.
- **First level only.** The UK is its four nations, not its counties. US territories that are countries themselves (PR, GU, …) are listed as countries, not as US states.
- **Some names fall back.** Outside the eight core markets, a subdivision with no Arabic name in CLDR shows its English name. The dataset's `fallbacks` lists every one.
- **A CLDR upgrade** is a new pin, a rebuild, and a new migration. A code CLDR retires is never deleted: it gets `retired_at`, so a stored value never dangles.
- **Changing `overlay.json`** changes its SHA-256. The R-45a sign-off then no longer covers it, and the reviewer must sign it off again.
- **Three CLDR Arabic names are withheld** (`overlay.json` → `arabicWithheld`): Cundinamarca (CO-CUN), Vojvodina (RS-VO) and one Slovenian municipality (SI-159). Each contains one of the protected staff names of G-20 as a substring, so the guard would rightly stop the file. They are shown in English, and `fallbacks` lists them. A future CLDR name that trips G-20 is handled the same way, never by weakening the guard.
