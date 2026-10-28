# PD-45: a parent's country and state / province / emirate / governorate (review and plan)

**State:** plan for approval, **revision 1**. No feature code has been written. Code waits for the department head's GO (machine-load cap: two coding sessions).
**Claim:** `docs/product/pd-registry/PD-45.md`. **No migration slot is claimed.** PR-1 needs one, and the department head assigns it. It must sort after the highest slot claimed today, `20261028150000`.
**Base:** `main` @ `bba7770c9e935b6361f70443deed16e11c3a8483`. PD-42 is read from its merged plan (`docs/product/pd042-direct-enrolment-plan.md`, v3.2) and its open data PR #194 (`claude/pd42-pr1-data`). PD-40's catalogue is on `main`.

The owner's request, verbatim:

> "We need to add the country and the state/province/emirate/governorate fields to the registration form, for both new parents and parents who are already registered with us."

---

## Summary

- **Half of this already exists, in one place only.**
  - Staff can set a **country** on the PD-17 Parent Profile. It is stored in `chat.family.country_code` (ISO 3166-1 alpha-2), the same column Stories targeting reads.
  - Staff can also type a **region**. It is free text (1–80 characters) in the admin-only `chat.parent_file.region`.
  - The Admin Web offers 10 countries and a 7-emirate suggestion list. There is no governorate list, no state list and no check that a region belongs to its country (§1.3).
- **The registration forms collect neither field.**
  - Sales' subscription form, which is the parent's real registration, has only name, phone and e-mail.
  - PD-16 Assign creates the family with no country.
  - PD-42's planned intake reuses the same form.
  - Parents themselves enter nothing at sign-up: they only set a password (§1.1).
- **Proposal:**
  1. Keep the country where it is (`family.country_code`). Add **`family.subdivision_code`**, an ISO 3166-2 code for the first-level subdivision.
  2. Ship a pinned **Unicode CLDR 49** dataset (Unicode License v3) with Arabic and English names. CLDR's Arabic subdivision names are all marked *draft*, so a reviewed Arabic overlay covers Egypt, the Gulf and Jordan (§3.1).
  3. The database enforces "the subdivision belongs to the country" with a composite foreign key to a seeded reference table. The API checks the same list.
  4. One **searchable, Arabic-first location picker** goes on every staff form: Parent Profile, Sales' subscription form (and so PD-42 intake), and Stories audience data. The app gets the same picker for a parent's own location (§5).
- **Existing parents:** three options for the owner (§6). The recommendation is **(c) both**:
  - staff complete it on the Parent Profile with a **"Missing location"** filter;
  - a one-time prompt in the app asks parents.
  - Any country suggested from the phone's country code is shown as a suggestion and **never saved silently**.
- **Visibility does not change:** exactly the PD-17 matrix. Teachers, the Teachers department and other parents never see it. A parent sees only their own (§4).
- **Six small PRs**, each with tests (§11). Seven owner questions (§12).

---

## 1. Review: what exists on `main`, with evidence

### 1.1 Where a parent is created

| # | Path | What the parent's data is | Location today |
|---|---|---|---|
| C1 | **Sales' subscription form** (the parent's registration). API: `POST /trials/:id/outcome`, `/correction` and `/subscription` (`apps/api/src/lessons/trial.controller.ts:180,187,194`, `@Requires('trials.manage')`), validated by `NewStudentsService.validate` (`apps/api/src/new-students/new-students.service.ts:68-99`). Stored in the confined `chat.trial_subscription` (`apps/api/prisma/schema.prisma:1966-1984`). Admin Web: `apps/admin-web/src/features/trials/SubscriptionForm.tsx` (draft at `:29-31`; parent fieldset at `:143-149`), mounted in `TrialCardDialog.tsx:196` and `NewStudentsPage.tsx:252-281`. | `parent { name, email?, phone }` (`new-students.service.ts:44,70-72`) | **none** |
| C2 | **PD-16 Assign**: the only production code that creates `family`, `account` and `contact`. `POST /trials/new-students/:trialId/assign` (`trial.controller.ts:92-96`, `@Requires('new_students.manage')`) → `apps/api/src/new-students/enrolment.service.ts:145-287`. It creates the family at `:181-182` with `language: 'ar'` hard-coded, then calls `seedFromEnrolment` (`apps/api/src/parent-profile/parent-record.service.ts:274-305`), which writes the parent file's phone and e-mail. Admin Web: `AssignDialog` (`features/trials/NewStudentSetup.tsx:247-307`). | copied from C1 | **none**: no country, no region |
| C3 | **PD-42 intake** (planned; plan merged in #173, data in #194, intake form is PD-42 PR-2). "The same `SubscriptionForm`, with its fields made optional" (`pd042-direct-enrolment-plan.md:405-406`). The transaction writes family, contact, optional account, and the parent file (phone, e-mail) (`:199-211`). | name, phone or e-mail, children (`:337-352`) | `Country \| no \| PD-17 Parent Profile` (`:352`). **No region.** |
| C4 | **Parent sign-up** (PD-16/PD-23/PD-32). `POST /auth/signup/request\|verify` (`apps/api/src/platform/auth/parent-signup.controller.ts:26-46`, `@Public`) only creates the credential (`parent-signup.service.ts:149`). Flutter `ParentSignupScreen` (`lib/features/auth/presentation/parent_signup_screen.dart:20`): e-mail, code, password. | none: the family exists already | n/a |
| C5 | **Trial booking and prospects**: student display names only, by design (`apps/api/src/lessons/trial.service.ts:50-52`, `:79-99`, `:151-195`) | none | n/a |
| C6 | Dev seed only: `apps/api/src/cli/org-chat-seed.ts:321-350` | n/a | n/a |

### 1.2 Where a parent's details are edited

| # | Path | Fields |
|---|---|---|
| E1 | **PD-17 Parent Profile** (staff). `POST /parent-profiles/:contactId` (`apps/api/src/parent-profile/parent-record.controller.ts:32-37`, `@Requires('parents.edit')`) → `parent-record.service.ts:108-166`. Admin Web `EditContactDialog` (`apps/admin-web/src/features/profiles/ProfileDialogs.tsx:73-147`). | name, phone, e-mail, **`countryCode`** (`/^[A-Z]{2}$/`, `:119-123`, written to `family` with `segmentSource: 'admin'`, `:146-151`), **`region`** (free text ≤80, `:116`), admin note |
| E2 | **Stories audience data**. `POST /stories/audience/families/:familyId` (`apps/api/src/communication/api/story.controller.ts:89-99`, `@Requires('stories.publish')`) → `story.service.ts:1080-1145`. It applies the same `/^[A-Z]{2}$/` check (`:1088-1093`). Admin Web `features/stories/AudienceDataPanel.tsx:106-147`. | country, plan |
| E3 | **The parent's own profile in the app**. `PATCH /me/profile` (`communication/api/parent-profile.controller.ts:43-50`, `@NotForStaff`). Flutter `MyProfileScreen` (`lib/features/profile/presentation/my_profile_screen.dart:35`, edit form `:254`). | name, About, photo |
| E4 | **App settings**: language (device only, `lib/features/settings/application/locale_preference.dart`), PD-22 time zone (`lib/features/settings/presentation/date_time_screen.dart:16`) | — |

No other path writes a parent's details. Billing, avatar, login stamp and deactivation touch other columns only.

### 1.3 Location data today

- **Country:** `chat.family.country_code`. The column was added by `supabase/migrations/20261017120000_chat_stories_v2.sql:57`, with CHECK `^[A-Z]{2}$` at `:64-66`.
  - `segment_source` (`admin|core`) records the writer. Nothing writes `core` yet (Core ingest handles only `subscription.*`).
  - It is indexed with the plan for Stories (`:88-89`).
  - Stories and `docs/product/STORIES.md:454` read it, and so does PD-25's phone matching (§1.4).
- **Region:** `chat.parent_file.region`, `text check (length(btrim(region)) between 1 and 80)`, in `supabase/migrations/20261021150000_chat_pd017_parent_student_profiles.sql:66-68`. The comment says "Emirate (UAE) or governorate (Egypt and others): free text, the country is chat.family.country_code."
- **The Admin Web lists:**
  - `COUNTRIES = ['AE','SA','EG','KW','QA','BH','OM','JO','GB','US']` (`apps/admin-web/src/features/profiles/copy.ts:197`), plus an "other" box that takes any two letters (`ProfileDialogs.tsx:81,113-130`).
  - `EMIRATES` (`copy.ts:200`) is offered as a datalist only when the country is AE (`ProfileDialogs.tsx:134-137`).
  - Stories has its own 31-code `SUGGESTED_COUNTRIES` and `allCountryCodes()` (`features/stories/copy.ts:262-268`).
  - Names come from `Intl.DisplayNames` (`profiles/copy.ts:211`).
- **No subdivision dataset exists** anywhere: API, Admin Web, Flutter or docs.
- **Display:** the Parent Profile shows country and region (`ParentProfilePage.tsx:174-178`). The Parents list (`ParentsPage.tsx:47-64`) and its API (`parent-record.service.ts:67`) carry neither, so "who is missing a location" cannot be asked today.

### 1.4 Time zones and phone numbers

- **PD-22 zones:**
  - A zone is per actor (`chat.actor_time_zone`, `schema.prisma:680-688`) and is self-service only (`me/time-zone`, `communication/api/time-zone.controller.ts:18-41`).
  - The source is the device, never the location (`docs/architecture/TIME-ZONES.md:26-34`; boundary doc `:2131-2137`).
  - A family's zone is that of its most recently updated parent (`apps/api/src/platform/time-zone.service.ts:115`).
  - Staff cannot set a parent's zone, and **nothing suggests a zone from a country**.
- **Phone numbers:**
  - Phones are parsed only in `apps/api/src/parent-profile/parent-phone-directory.ts`, using `libphonenumber-js/min` with `DEFAULT_PHONE_REGION = 'EG'`.
  - The stored phone is free text. It is parsed **with the family's `country_code`** (`:38-46`), which PD-25's forgot-e-mail flow relies on (`docs/admin/pd025-parent-self-recovery.md:37-40`).
  - PD-42's contact key (#194, `apps/api/src/new-students/contact-key.ts`) hashes the E.164 form.
  - **So the country already changes how a stored local-format phone is read.** This matters in §9.

### 1.5 Who can see a parent's details today

- **The PD-17 matrix** (`docs/admin/pd017-parent-student-profiles.md:11-17`; boundary doc `:1717-1734`), implemented by `decideBillingAccess` (`apps/api/src/platform/pd012-policy.ts:112-131`):
  - **Read:** the super admin and the Operations manager see every parent; Operations supervisors and coverage see the families they reach (PD-8 scope); Sales sees every parent, read-only.
  - **Edit:** the super admin, the Operations manager and Operations in scope. PD-42 adds the Sales owner (§8 of PD-42).
  - **Never:** the child's teacher, the Teachers department, and the parents themselves.
- **Confinement guards** (`apps/api/test/unit/privacy/`):
  - `parent-file-confinement.spec.ts` allows `parent_file` only inside `src/parent-profile`.
  - `new-students-confinement.spec.ts` allows `trial_subscription` only inside `src/new-students`.
  - `no-contact-channel-columns.spec.ts` blocks phone-like columns (G-07, `docs/qa/release-gate.md:52`).
- **The app never calls a Parent Profile route** (the Contact File rule, boundary doc `:2000-2004`). A Flutter guard (`test/features/profile/profile_view_test.dart:161-199`) fails on fields named `phone|email|msisdn|mobile|whatsapp|address…` under `lib/features/profile`.
- **PD-35** adds no access to parent data (boundary `:3339-3373`). **PD-40**'s keys are `parents.view` and `parents.edit`, risk `family_contact` (`apps/api/src/platform/permissions/catalogue.ts:72-73`).

### 1.6 Gaps

| Gap | Effect |
|---|---|
| G1 | New parents are registered with no location: C1 has no field, and C2 copies none. |
| G2 | The region is free text with no list, so "Giza", "الجيزة", "giza " and "6 October" are four values. It cannot be reported, filtered or validated. |
| G3 | Nothing checks that the region belongs to the country. |
| G4 | The "other" country box and Stories accept any two letters, so `UK` (not ISO) or `ZZ` can be saved. |
| G5 | There is no way to list parents missing a location. |
| G6 | Parents cannot see or correct their own location. |
| G7 | Two country pickers (Profiles and Stories) with two different lists. |

---

## 2. Design principles

1. **One source of truth per value.** Country stays in `family.country_code`. The subdivision sits next to it, not in a second table.
2. **Codes in the database, names in the dataset.** Store `EG` and `EG-GZ`, never "Giza". Names come from one pinned, licensed dataset, in Arabic and English.
3. **Validated twice.** The API checks against the dataset. The database checks against a seeded reference table. A code that is not in the list cannot be saved by any path, including SQL.
4. **Location is personal data, not a contact channel.** It follows the PD-17 read matrix exactly: no new reader. It is never in a push, a realtime event, a teacher's view or another parent's view.
5. **Suggest, never assume.** A country inferred from the phone, or from the device's time zone, is shown as a suggestion that a person confirms. It is never written by itself.
6. **Arabic first.** Arabic names and labels come first, in RTL. Search works in both languages whatever the interface language.

---

## 3. Data model

### 3.1 The codes and the dataset

**Codes:**
- **Country:** ISO 3166-1 alpha-2 (`EG`), as today.
- **Subdivision:** ISO 3166-2, **first level only** (`EG-GZ`, `AE-DU`, `SA-01`, `US-CA`).
  - "First level" means the governorates of Egypt, the seven emirates, the 13 Saudi regions and the 50 US states plus DC and the outlying areas.
  - It never means districts, cities or the second ISO level.

**Source: Unicode CLDR 49** (tag `release-49`, the latest release; checked on 2026-10-28).

| Option | Licence | Verdict |
|---|---|---|
| **Unicode CLDR** (`common/subdivisions/{ar,en}.xml`, `common/supplemental/subdivisions.xml`, `common/validity/subdivision.xml`, territory names in `common/main/{ar,en}.xml`) | **Unicode License v3**: permissive (MIT-like). It requires the copyright and permission notice to ship with copies of the data. | **Chosen.** CLDR's subdivision ids are ISO 3166-2 codes with the hyphen removed and lower-cased (`eggz` ↔ `EG-GZ`). CLDR keeps retired codes as aliases, so an upgrade never loses a stored value. |
| Debian `iso-codes` | LGPL-2.1-or-later | Rejected. It has the ISO type names (governorate, emirate) we want, but it is copyleft, and we would ship its data inside the Admin Web bundle and the app. |
| ISO's own Online Browsing Platform | Commercial; no redistribution | Rejected |
| Wikidata | CC0 | Not needed. It could fill a gap later. |

**What CLDR 49 actually contains** (measured on the downloaded files, 2026-10-28):
- 200 countries have subdivisions, with **3,590 first-level rows** in all.
- Every first-level subdivision of the core markets has both an English and an Arabic name:

| Country | First-level rows | en | ar | ar marked draft | ar with a type prefix ("محافظة …", "منطقة …", "إمارة …") |
|---|---|---|---|---|---|
| Egypt | 27 | 27 | 27 | 27 | 14 |
| Saudi Arabia | 13 | 13 | 13 | 13 | 12 |
| UAE | 7 | 7 | 7 | 7 | 2 |
| Kuwait | 6 | 6 | 6 | 6 | 6 |
| Qatar | 8 | 8 | 8 | 8 | 0 |
| Bahrain | 4 | 4 | 4 | 4 | 2 |
| Oman | 11 | 11 | 11 | 11 | 11 |
| Jordan | 12 | 12 | 12 | 12 | 1 |
| United States | 57 | 51 | 51 | 51 | 0 |

**Two consequences:**
1. **All CLDR Arabic subdivision names are draft**, and they are prefixed inconsistently: "محافظة القاهرة" but "الإسكندرية".
   - PR-1 ships a small **reviewed overlay**, `data/geo/overlay.json`, for Egypt, the six Gulf states and Jordan: 88 names.
   - The overlay strips the type word, because the field label already says it (§3.1.1). It also fixes any name a reviewer rejects.
   - An Arabic-speaking member of Operations reviews it. Per G-20, the reviewer is recorded by role, never by name, outside `docs/`.
2. **Some first-level rows lack names** (6 of 57 for the US). The generator falls back to English, and then to the code, and lists every fallback in its report. Nothing is silently blank.

**Countries:** CLDR's regular regions, which are ISO 3166-1 plus `XK` (Kosovo, as CLDR does). Arabic and English territory names come from `common/main/{ar,en}.xml`, which are not draft.

**Build, not runtime.** `scripts/geo/build-dataset.py` (run with `python3 -I`) reads the pinned CLDR files and the overlay. It writes:
- `apps/api/src/geo/dataset.json`: codes, names in ar and en, label per country, pinned order, retired codes, and the CLDR version;
- the reference-table seed for the migration;
- `apps/api/src/geo/LICENSE-CLDR.txt`: the Unicode License v3 notice.

The SHA-256 of every CLDR input is recorded in the JSON, so a rebuild is reproducible. Upgrading CLDR means a new build plus a new migration (§3.3).

#### 3.1.1 The field label, per country

CLDR has no type names, so the label is a short hand-written table in the overlay. A country that is not in it gets the fallback.

| Country | English label | Arabic label | Note |
|---|---|---|---|
| Egypt | Governorate | المحافظة | 27 governorates |
| UAE | Emirate | الإمارة | 7 |
| Saudi Arabia | Province | المنطقة | ISO 3166-2:SA says "province". In Arabic they are مناطق (منطقة الرياض), so the Arabic label is المنطقة, not "المقاطعة". |
| Kuwait, Bahrain, Oman, Jordan | Governorate | المحافظة | |
| Qatar | Municipality | البلدية | |
| United States | State | الولاية | includes DC and outlying areas, sorted last |
| Canada | Province / territory | المقاطعة / الإقليم | |
| *everything else* | Region | المنطقة | the fallback |

#### 3.1.2 Order and search

- **Default order:** Egypt, then Saudi Arabia, UAE, Kuwait, Qatar, Bahrain, Oman, Jordan. Then a divider and every other country A–Z in the interface language. Owner question Q3.
- **Search:**
  - matches the Arabic name, the English name and the ISO code, whatever the interface language;
  - normalises Arabic the way PD-42 §7 does: tatweel removed; أ/إ/آ→ا; ى→ي; ة→ه;
  - matches anywhere in the name, so "جيزة" finds "الجيزة".
- **Subdivisions** are listed A–Z in the interface language. Outlying areas (for example `US-PR`) come last.

### 3.2 Where it is stored

| Column | Table | Type | Rule |
|---|---|---|---|
| `country_code` | `chat.family` (**exists**) | `text` | CHECK `^[A-Z]{2}$` (exists); **new** FK → `chat.geo_country(code)` |
| `subdivision_code` | `chat.family` (**new**) | `text`, nullable | **Composite FK** `(country_code, subdivision_code)` → `chat.geo_subdivision(country_code, code)`, plus CHECK `subdivision_code is null or (country_code is not null and subdivision_code like country_code \|\| '-%')` |
| `location_source` | `chat.family` (**new**) | `text`, nullable | `staff \| parent \| backfill`: who last set the location |
| `location_updated_at`, `location_updated_by` | `chat.family` (**new**) | `timestamptz`, `uuid` | the actor (staff or contact) |
| `country_code`, `subdivision_code` | `chat.trial_subscription` (**new**) | `text`, nullable | The same two FKs. Sales' form holds them until Assign copies them to the family (C1 → C2). |

**Why the family and not the parent.** A family is one household. Its location is already the family's country, the column Stories and phone parsing read. A second guardian is deferred (PD-42 Q4), so today a family has one primary guardian. A per-contact location would split one value in two and ask staff to keep them equal.

If the owner later wants a guardian abroad recorded separately, a per-contact override can be added without moving this data.

**Why not `parent_file`, next to `region`.** `parent_file` is confined to `src/parent-profile` by a guard. Its job is to keep **contact channels** (phone, e-mail) away from every other module. A location is not a contact channel, and three other readers need it:
- Stories targeting (country, today);
- the time-zone estimate (§7);
- the aggregate counts (§7).

Putting the subdivision on `parent_file` would either break that guard or force every reader through the parent-profile module. Keeping it on `family` beside `country_code` avoids both. §4 adds a **new confinement guard** for `subdivision_code`, so the wider table does not mean wider reading.

**`segment_source` is left alone.** It still means "who last wrote the Stories segmentation (country, plan)", and the Parent Profile keeps setting it when the country changes, as today (`parent-record.service.ts:146-151`). `location_source` is the new, separate provenance for the location as a whole.

### 3.3 Validation

**The reference tables**, seeded by the PR-1 migration from the generated dataset. They hold codes only; names live in the dataset JSON.

```
chat.geo_country     (code text primary key, retired_at timestamptz)
chat.geo_subdivision (country_code text references chat.geo_country, code text,
                      retired_at timestamptz, primary key (country_code, code))
```

**Rules:**
- **The subdivision belongs to the country.** The composite FK enforces it. With `subdivision_code` null the FK is not checked (`MATCH SIMPLE`), so "country only" is valid.
- **A subdivision without a country** is refused by the CHECK.
- **Codes are never deleted.**
  - A code ISO retires gets `retired_at`, so the FK never breaks on stored data.
  - The API refuses to *write* a retired code.
  - The UI shows a stored one as "«name» (no longer used: please update)".
- **Existing countries.** The "other" box and Stories accepted any two letters (G4), so existing rows may hold codes that are not ISO.
  - The country FK is added `NOT VALID`.
  - PR-5's backfill report lists the offending rows, and staff fix them.
  - A later migration runs `VALIDATE CONSTRAINT`. Nothing is rewritten silently.
- **API:** one shared helper, `parseLocation(body)` in a new `src/geo` module, used by every writer (§5). It:
  - upper-cases;
  - checks `^[A-Z]{2}$` and `^[A-Z]{2}-[A-Z0-9]{1,3}$`;
  - looks the codes up in the dataset (not retired);
  - checks that the subdivision is the country's;
  - answers `400 INVALID_LOCATION` with the field name.
- **Required for a given form:** see Q1 and Q2. When the owner makes the subdivision required, it is required only when the country has subdivisions in the dataset (a few small states have none).
- **Parity:** a unit spec loads the dataset JSON and the migration's seed and fails unless the two code sets are equal. It follows the pattern of PD-40's `pd040-catalogue-seed.spec.ts`.

### 3.4 The old free-text region

- `parent_file.region` stays readable but is **no longer written** once PR-2 lands.
- The Parent Profile shows it under the picker as "Old note: «text»" until the subdivision is set.
- PR-5's backfill tries to match each region to a subdivision of the family's country (§6.3).
- Dropping the column is a later, separate migration, after the report shows nothing left to match. Q7.

---

## 4. Who may see and change it

**No new reader.** The location follows the PD-17 matrix row for row:

| Actor | Sees the location | Changes it |
|---|---|---|
| Super admin, Operations manager | every family | yes |
| Operations supervisor or coverage | families they reach (PD-8) | yes |
| Sales | every family (read-only, as PD-17) | Sales' own subscription form (C1) and, after PD-42, families they own (`parents.edit` for `supervisor:sales`, PD-42 §8) |
| Stories publishers (`stories.publish`, manager or super admin) | **country only**, as today | country, as today |
| **The parent** | **their own family only** | yes, through `/me/location` (§5.4) |
| A child's teacher, the Teachers department, PD-35 supervisors | **never** | never |
| Other parents | never | never |

**Why this is safe under the existing rules:**
- **G-07 (no phone anywhere):** a location is not a phone. The suggestion from the phone (§6.2) is computed inside `src/parent-profile`. Only the suggested *country code* leaves that module, never the number.
- **The Contact File rule:** the app still never calls `/parent-profiles`. `/me/location` returns only the family's two codes and an optional suggested country. The Flutter field is named `country`/`subdivision`, never `address…`, so the existing guard (`profile_view_test.dart:161-199`) stays meaningful.
- **PD-8 / PD-35:** reach is decided by the existing `decideBillingAccess` (`pd012-policy.ts:112-131`). PD-35 gives no parent data, and this keeps it so.
- **PD-40:** no new key for reading or editing (§8).

**A new guard,** `apps/api/test/unit/privacy/family-location-confinement.spec.ts`. It is a static scan, like the other confinement specs. `subdivision_code` / `subdivisionCode` may be read only in:
- `src/parent-profile` (the profile and `/me/location`);
- `src/new-students` (Sales' form and Assign);
- `src/geo` (the dataset);
- the aggregate counts (§7).

The guard lists any other file that reads the column, so a teacher-facing service cannot start returning it by accident.

**Audit:** the PD-17 audit already records changed field *names*, never values (`parent-record.service.ts:153-163`). `subdivisionCode` is added to `FIELD_NAME`. A parent's own change is audited the same way, with the contact as actor.

---

## 5. The forms

### 5.1 One picker component, two platforms

- **`LocationPicker`** in Admin Web: `apps/admin-web/src/shared/location/`. **`LocationPicker`** in Flutter: `lib/shared/location/`.
- **Country:** a searchable list. Pinned countries come first (§3.1.2), and each row shows the flag emoji and the name in the interface language, with the other language in muted text.
- **Subdivision:** a second searchable list, **filtered by the chosen country** and labelled per country (§3.1.1). Changing the country clears the subdivision. It is disabled until a country is chosen and hidden when the country has none.
- **Shown everywhere as** "مصر · الجيزة" / "Egypt · Giza".
- **Data:**
  - `GET /geo/countries` returns code, ar, en, label, pinned, and hasSubdivisions.
  - `GET /geo/countries/:cc/subdivisions` returns code, ar, en and retired.
  - Both are `@SelfService()`, which `route-access.ts` defines to include "shared reference data that holds nothing about anyone (the Quran text)". They are served with an `ETag` equal to the dataset version, so clients cache them indefinitely.
  - Because the app reads the API, a CLDR upgrade needs no app release.
- **Replaces** the hard-coded `COUNTRIES`/`EMIRATES` (`profiles/copy.ts:197-208`) and Stories' `SUGGESTED_COUNTRIES`/`allCountryCodes()` (`stories/copy.ts:262-268`). That closes G7.

### 5.2 Every form in the audit

| Form | Change | PR |
|---|---|---|
| **C1 Sales' subscription form** (`SubscriptionForm.tsx`; API `new-students.service.ts:68-99`) | A "Location" block in the parent fieldset, after phone and e-mail. It writes `trial_subscription.country_code / subdivision_code`. The form opens with no country pre-filled (the EGP currency default stays as it is). After the phone is typed, it offers a suggestion chip (§6.2). Required or not: **Q1**. | PR-3 |
| **C2 PD-16 Assign** (`enrolment.service.ts:181-182`) | Copies the two codes from the subscription form into the new `family` row, in the same transaction, with `location_source='staff'`. **No UI change.** | PR-3 |
| **C3 PD-42 intake** (PD-42 PR-2, not built) | **The same `SubscriptionForm`**, so it inherits the block. The intake body takes the same `location` object, validated by the same `parseLocation`. PD-42's required-fields table (§6, `:352`) gains a row, "Country, governorate/emirate/state", required per **Q2**. See §9 for the order of work. | PR-3, or PD-42 PR-2 (§9) |
| **E1 Parent Profile** (`ProfileDialogs.tsx:73-147`; API `parent-record.service.ts:108-166`) | The country `<select>`, "other" box and region input become the `LocationPicker`. The API accepts `subdivisionCode`, stops writing `region`, and returns `subdivisionCode`, `location` (names) and `suggestedCountryCode` (§6.2). | PR-2 |
| **Parents list** (`ParentsPage.tsx:47-64`; API `parent-record.service.ts:67`) | A "Location" column ("مصر · الجيزة", or "—"), plus a **"Missing location"** filter: no country, or a country with subdivisions but none set. The API gains `?location=missing` and returns the two codes per row, under the same scope as today. | PR-2 |
| **E2 Stories audience data** (`AudienceDataPanel.tsx:106-147`; API `story.service.ts:1088-1093`) | The country picker becomes `LocationPicker` in country-only mode. The API validates against the dataset instead of `/^[A-Z]{2}$/`. Subdivision targeting is **not** added (§13). | PR-2 |
| **C4 Parent sign-up** | **No change.** The family and its location exist before the parent signs up. A parent who signs up into a family without a location gets the prompt (§5.4). | — |
| **E3 App: my profile** | A read-and-edit "Location" row in `MyProfileScreen` (§5.4) | PR-4 |

### 5.3 Copy

- Arabic first, RTL, checked at phone width, as PD-42 §10 requires.
- Field labels come from §3.1.1.
- Error: "اختر المحافظة من القائمة" / "Choose a governorate from the list", using the country's label.
- Suggestion chip: "الرقم يبدأ بـ ‎+971: الإمارات؟" / "The number starts with +971: UAE?", with **Use** and **Dismiss**. It is shown to staff only, never to the parent.

### 5.4 The app (parents only)

- **`GET /me/location`** (`@NotForStaff`, in `src/parent-profile`, so it may read `parent_file` for the suggestion). It returns:
  - `{ countryCode, subdivisionCode, location: {ar, en}, prompt: boolean, suggestedCountryCode? }`;
  - `prompt` is true when the family has no location and this contact has not answered the prompt (§6.1 option b).
- **`PUT /me/location { countryCode, subdivisionCode }`** (`@NotForStaff`). Any active contact of the family with an account may call it.
  - It is validated by `parseLocation` and written with `location_source='parent'`.
  - It is audited, rate-limited like `/me/profile`, and records that this contact answered.
- **Flutter:**
  - a "Location" row in `MyProfileScreen` (`lib/features/profile/presentation/my_profile_screen.dart:254`) opens the picker;
  - the one-time prompt reuses the `AppLockOffer` pattern (`lib/features/app_lock/presentation/app_lock_gate.dart:78`), but the "answered" state lives **on the server**, so it is not shown again on a second device;
  - the arb keys go in `lib/l10n/app_{ar,en}.arb`.
- **Never** in a push payload, a realtime event, a chat header or a teacher-facing screen.

---

## 6. Existing parents

### 6.1 Three options for the owner (Q4)

| Option | How | For | Against |
|---|---|---|---|
| **(a) Staff complete it** | Parents list → "Missing location" → Parent Profile → picker. Operations supervisors work their own families; the Operations manager sees the count. | Accurate (staff can ask), no app release, works for parents who never open the app. | Staff time: one family at a time. |
| **(b) Parents are asked once in the app** | On next app open, a sheet: "أين تقيم الأسرة؟ / Where does the family live?", with the picker. Choices **Save** and **Later**. "Later" counts as the one time: it is not shown again, and the row stays in Settings. Shown only to parents whose family has no location. | No staff time, and the parent knows best. | Reaches only parents who have signed up and open the app (PD-42 migrated families without an e-mail have no account). One more interruption. |
| **(c) Both (recommended)** | (a) from PR-2; (b) from PR-4. Either source fills the same columns; the "Missing location" filter shrinks from both sides. A parent's answer is never overwritten by staff without the staff member seeing "Set by the parent on «date»". | Fastest to complete; covers parents without the app. | Two PRs instead of one; both are small. |

### 6.2 The suggestion from the phone (never saved silently)

- **Inside `src/parent-profile` only** (G-07), the stored phone is parsed with `libphonenumber-js`, which is already a dependency. Two cases give a suggestion:
  - **An international number:** `+971…` gives `AE`.
  - **A local-format number:** it gives nothing, because parsing it would need the very country we are trying to guess. **No suggestion is made from a local number.**
- **What is returned:** `suggestedCountryCode` only, never the number. Ambiguous calling codes (`+1` without a resolvable area code, `+7`, `+44` crown dependencies) give no suggestion.
- **Who sees it:**
  - **staff:** a chip on the Parent Profile and in Sales' form, with **Use** and **Dismiss**;
  - **the parent:** the prompt opens with that country pre-selected but **not saved**, and they must press Save.
- **In the app, the next fallback is the device's PD-22 zone:** `Asia/Dubai` gives `AE`, from the IANA `zone1970.tab`, which is public domain. It is used only to pre-select the country, never to save it.
- **The subdivision is never suggested.** A phone or a zone cannot tell Cairo from Giza.

### 6.3 Backfill of the old region text (PR-5)

`npm run geo:backfill -- --dry-run`, then `--apply` (a CLI in `apps/api/src/cli`, with no request role) works through every family:

1. **Country check:** a `country_code` not in `geo_country` (G4) goes on the report as "fix by hand". It is never rewritten.
2. **Region match:** with a valid country and a non-empty `parent_file.region`, the CLI matches the text against that country's subdivisions in both languages:
   - after Arabic normalisation (§3.1.2);
   - with type words removed ("محافظة", "emirate"…);
   - with a short reviewed alias list in the overlay ("Dubayy", "6th of October" → `EG-GZ`).
   - **Only an exact, unique match is applied**, with `location_source='backfill'`. Everything else goes on the report.
3. **Report:** counts per outcome, plus the family ids to fix. **Never names, phones or region text** in the log (G-07 hygiene).
4. **Then** the `VALIDATE CONSTRAINT` migration for the country FK, once the report shows zero invalid countries.

---

## 7. Time zones (PD-22) and reports

**Time zones: PD-22 stays as decided.** The zone comes from the device, and a manual pick wins. A location never writes `chat.actor_time_zone`. PD-45 adds two read-only uses:

- **An estimate where no zone exists.**
  - `familyZonesOf` (`time-zone.service.ts:115`) returns nothing for a family whose parent has never opened the app. Staff then see "≈ توقيت القاهرة (حسب الموقع)" / "≈ Cairo time (from location)" instead of nothing.
  - This applies only when the country has **one** IANA zone in `zone1970.tab` (Egypt and every Gulf state do) or the subdivision decides it.
  - The subdivision-to-zone table is in the overlay, **US, Canada and Australia only**, as a follow-up. Without it, multi-zone countries show no estimate.
- **A mismatch hint on the Parent Profile:** "Location: UAE · App clock: Cairo". It is a hint for staff (travel, or a wrong entry), never an automatic change.

**Reports:**
- **Story analytics** already group by country (`story.service.ts:907-919`). They improve by themselves once country data is complete.
- A **"Families by country and governorate"** count belongs on the PD-44 manager dashboard (#189). It is handed to PD-44 as a follow-up, not built here. Rules:
  - aggregate counts only;
  - cells under 5 families shown as "<5";
  - under that dashboard's existing key.
- **No export.** No CSV of parents exists today (§1.6), and this does not add one.

---

## 8. Permissions (PD-40 keys; deny by default; row scope in Layer 2)

**No new permission key.** A location is part of the parent record, and every route that writes it is already guarded:

| Route | Key / marker | Layer-2 row scope |
|---|---|---|
| `GET /geo/countries`, `GET /geo/countries/:cc/subdivisions` (new) | `@SelfService()`: reference data about no one (`route-access.ts` header) | none needed |
| `GET /parent-profiles`, `?location=missing` (extended) | `parents.view` (exists) | PD-17 reach, unchanged |
| `GET /parent-profiles/:contactId`, `POST /parent-profiles/:contactId` (extended) | `parents.view` / `parents.edit` (exist) | PD-17 `canEditParent`; PD-42 adds the Sales owner |
| `POST /trials/:id/outcome\|correction\|subscription` (extended) | `trials.manage` (exists) | Sales standing, unchanged |
| PD-42 intake (planned) | `new_students.manage` (PD-42) | PD-42 §4.3 |
| `POST /stories/audience/families/:familyId` (validation only) | `stories.publish` (exists) | `canManageStoryAudienceData`, unchanged |
| `GET /me/location`, `PUT /me/location` (new) | `@NotForStaff()` | the caller's own family only |

- PD-40's route table is regenerated with `PD040_WRITE_ROUTE_TABLE=1` in PR-2 and PR-4, so the `pd040-routes` guard passes.
- **The PD-40 plan's label for `parents.edit`** ("Edit a parent's contact record", `catalogue.ts:73`) still describes it well. PD-40 owns that wording, and this plan proposes no change.

---

## 9. How it meets the other decisions

| Decision | Interaction |
|---|---|
| **PD-42** (intake) | **Order of work:** PD-42 PR-2 is first in the builder queue and builds the intake on `SubscriptionForm`. **Recommendation: PD-45 does not block it.** If PD-45 PR-1 and PR-3 land first, the intake inherits the block and only passes `location` through. If PD-42 PR-2 lands first, PD-45 PR-3 adds the block to both modes of the shared form and the field to the intake body. The department head decides the order. |
| **PD-42 S1 contact key and PD-25 phone matching** | Both read a stored *local-format* phone with the family's country (§1.4). **Setting or changing a country can change that phone's E.164, and so its contact key and whether "forgot e-mail" finds the parent.** Rule for PR-2: when the country changes, the parent-profile service re-derives the phone's E.164 with the new country, in the same transaction. If the E.164 changes, it updates the `family_contact_key` row (PD-42 #194). If the new key collides with another family, it refuses with `PARENT_EXISTS` (as PD-42 §7) instead of saving. PR-2 depends on #194 being merged for this. |
| **PD-17** | The matrix is unchanged (§4). Region becomes a picker (§3.4). |
| **PD-22** | Unchanged. The estimate and the hint are read-only (§7). |
| **Stories** | Country targeting is unchanged and validated by the dataset. `docs/product/STORIES.md:462-468` says country "belongs to Jawwid Core"; PD-45 makes Chat its owner in practice. The STORIES.md note is updated in PR-6, and `segment_source='core'` stays allowed for a future Core feed. |
| **G-07, Contact File** | No phone leaves `src/parent-profile`, and the app never reads `/parent-profiles` (§4). |
| **G-20** | No staff names in code, data or fixtures. The overlay reviewer is recorded by role. |
| **PD-40** | No new key; the route table is regenerated (§8). |

---

## 10. Tests

**API unit:**
- `parseLocation`:
  - valid codes;
  - lower case;
  - a retired code (refused);
  - a subdivision of another country;
  - a subdivision with no country;
  - `null` clears both.
- Dataset parity: the JSON equals the migration's seed.
- The phone suggestion: `+971` gives AE, `+1` with an ambiguous area code gives nothing, and a local format gives nothing. A test asserts the number never appears in the response.
- The new confinement guard (§4).
- The PD-40 route table.

**API integration** (on the verifier's own DB):
- The composite FK refuses `EG` + `AE-DU` from raw SQL.
- The CHECK refuses a subdivision without a country.
- Assign copies the location.
- The Parent Profile: edit, `?location=missing`, and scope (an Operations supervisor outside their reach gets 403 before any lookup).
- `/me/location`: only the caller's own family; staff get 403.
- **The country change re-keys the contact** (§9), including the collision case.
- The backfill CLI: dry run and apply, exact matches only, and the report contains no names.

**Admin Web (vitest):**
- The picker: search in Arabic with folding ("جيزه" finds "الجيزة"), the English name and the ISO code; pinned order; country change clears the subdivision; per-country label.
- The Parent Profile dialog and the "Missing location" filter.
- Sales' form validation per Q1.
- The Stories panel uses the shared picker.

**Flutter:**
- The picker widget in RTL and at phone width.
- The prompt appears once, and "Later" counts as the answer.
- The suggestion is pre-selected but not saved until Save.
- The profile guard (`profile_view_test.dart`) still passes.

**Release gates:** `bash scripts/qa/guards.sh` on the committed tree for every PR.

---

## 11. PR breakdown (each merged by hand after green CI)

| PR | Contents | Depends on |
|---|---|---|
| **PR-1, data** (waits for the GO and a slot) | <ul><li>`scripts/geo/build-dataset.py` + `data/geo/overlay.json` (reviewed Arabic names, labels, pinned order, aliases)</li><li>the generated `apps/api/src/geo/dataset.json` + `LICENSE-CLDR.txt`</li><li>the migration: `chat.geo_country`, `chat.geo_subdivision` (seeded); `family.subdivision_code` and `location_*`; the composite FK and CHECK; the country FK `NOT VALID`; `trial_subscription.country_code/subdivision_code` with the same FKs; no grants to request roles (as `country_code`)</li><li>Prisma fields</li><li>the parity spec</li></ul>No behaviour change. | the head's slot |
| **PR-2, staff edit: option (a)** | <ul><li>`src/geo` (dataset service, `parseLocation`, `GET /geo/...`)</li><li>Parent Profile: `subdivisionCode`, stop writing `region`, the "Old note" display, `suggestedCountryCode`, the re-key on country change (§9)</li><li>Parents list: column and `?location=missing`</li><li>Stories validation</li><li>Admin Web `LocationPicker`, `EditContactDialog`, Parents filter, Stories panel</li><li>the confinement guard</li><li>the route table</li><li>the time-zone estimate and the hint (§7)</li></ul> | PR-1, #194 |
| **PR-3, new parents** | <ul><li>Sales' subscription form and its API (`new-students`)</li><li>Assign copies the codes</li><li>the suggestion chip</li><li>Q1's required rule</li><li>the intake pass-through if PD-42 PR-2 is merged (§9)</li></ul> | PR-2 |
| **PR-4, the app: option (b)** | <ul><li>`GET/PUT /me/location` and the server-side "answered" stamp (a small table, `chat.contact_location_prompt(contact_id, answered_at, outcome)`, in PR-1's migration so only one slot is needed)</li><li>the Flutter picker, profile row and one-time prompt</li><li>the arb strings</li></ul> | PR-2 |
| **PR-5, backfill** | <ul><li>`geo:backfill` CLI (§6.3)</li><li>the report</li><li>after a clean report, the `VALIDATE CONSTRAINT` migration (a second slot from the head)</li></ul> | PR-2 |
| **PR-6, docs** | <ul><li>PD-45 in the boundary doc §4</li><li>the PD-17 doc (region → subdivision)</li><li>the STORIES.md ownership note</li><li>a `docs/admin/` page for supervisors on completing locations</li><li>the PD-44 hand-off for the aggregate counts</li></ul> | PR-3, PR-4 |

PR-3 and PR-4 are independent of each other once PR-2 is merged. Under the two-session cap they run one after the other.

---

## 12. Owner questions

| # | Question | Recommendation | Why |
|---|---|---|---|
| **Q1** | For **new** parents on Sales' subscription form: is the location **required** or optional? | **Country required; governorate, emirate or state required when the country has them in the list.** | Sales are talking to the parent at that moment, so it costs one question. It stops the "missing" list from growing again. |
| **Q2** | For families entered by hand under **PD-42** (moving families from the old system): required or optional? | **Optional, but shown on the form**, and every family without it lands in "Missing location". | PD-42's minimum fields were decided to keep the migration fast (PD-42 §6). Making this required would slow every entry, and option (a) or (b) completes it afterwards. |
| **Q3** | Which countries come first in the list? | **Egypt first**, then Saudi Arabia, UAE, Kuwait, Qatar, Bahrain, Oman, Jordan; then every other country A–Z. | Egypt is the main market; the Gulf is next. Search finds every other country in Arabic or English. |
| **Q4** | For parents **already registered**: (a) staff fill it in, (b) a one-time prompt in the app, or (c) both? | **(c) both**: staff start at once (PR-2), and the prompt follows (PR-4). | Staff reach parents who never open the app. The prompt reaches parents staff have not reached yet. Neither alone completes the list. |
| **Q5** | May a child's **teacher** see the family's country (not the governorate)? | **No**, as PD-17 decided for all parent details. | The teacher already sees the family's local time, which is what lessons need. Adding the country would be a new reader of personal data with no task that needs it. |
| **Q6** | When a parent has set their own location, may staff change it? | **Yes**, and staff see "Set by the parent on «date»" before saving. The change is audited. | Staff must be able to fix a mistake. The note stops them from overwriting a correct answer without knowing. |
| **Q7** | After the backfill, may the old free-text "region" be **deleted**? | **Yes, once the report shows nothing left to match**, in a separate small migration. Until then it stays visible as "Old note". | Keeping two region fields invites drift. Deleting it early would lose the only hint for the unmatched families. |

---

## 13. Out of scope

- Cities, districts, street addresses, postcodes. The owner asked for the country and the first-level subdivision only. An address would be a contact channel under the Contact File rule.
- Story targeting by governorate. It is possible later on the same column, but it is a Stories decision.
- A per-guardian location for a second guardian abroad. That waits for PD-42's deferred second guardian.
- Location for teachers or staff.
- Writing a time zone from a location (PD-22).
- Any change in Jawwid Core.
