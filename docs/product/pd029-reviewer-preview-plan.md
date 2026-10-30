# PD-29 amendment: a reviewer preview of lessons pending teacher review (plan)

**State:** **Plan, docs only. No code until the department head says GO.** The questions are in §9.
**Claim:** proposed as a PD-29 amendment, `docs/product/pd-registry/PD-29-amendment-reviewer-preview.md`. The department head has been asked to confirm this, or to give a new PD number instead (§9 Q1). **Migration slot:** none. The design stores nothing new (§3.3); the audit row goes to the existing audit log.
**Base:** `main` @ `ea8939dc`. Paths are relative to the repository root.

**The problem.** The Arabic lessons and the PD-49 games are gated by `review.status` and by per-item holds inside each lesson's JSON. A pending lesson therefore shows only «هذا الدرس قيد المراجعة». The Teachers department must approve these lessons, but it can only read a review doc; it never sees the lesson as a child would. The owner hit this when they asked to test the Arabic lessons. Today all five built Arabic lessons (1, 3, 5, 6, 7) and every schema-1 surah file are `pending`.

**Builds on, and does not change:**
- PD-29: the `apps/lessons` engine and its fail-closed resolvers.
- PD-40: page/action keys. `PermissionGuard` is still in shadow mode.
- PD-48: voice-over.
- PD-49: the per-item review (`lesson-content` API, `lesson_content.*` keys), the signed approvals and the play approvals.

Nothing in this plan alters what a family is shown, how an item gets approved, or any approval file.

---

## 0. Summary

1. **There is a separate preview build on its own origin, and the family build has no preview code at all.** One source compiles twice. `lessons-dist` (families) is built with `__LESSONS_PREVIEW__ = false`, so the preview module is dead code that Rollup drops. `lessons-preview-dist` is built with it `true` and is served from its own origin, which only Admin Web may frame. A CI guard proves that the family bundle contains no preview marker (§3.1). No grant, flag or message can turn on something that is not in the bundle.
2. **Who may preview** is decided by the API, never by the client. The rule is PD-49's existing `lessonContentAccess`:
   - an active **staff** actor;
   - in the content organization;
   - holding `lesson_content.view` or one of the review-step keys.

   Families, students and teachers without a delegated review key are refused **in the service**. This matters because the PD-40 guard lets every non-staff actor through and is in shadow mode for staff (§1.4).
3. **How the engine learns it is a preview: a short-lived Ed25519 grant.**
   - The API signs it with a new key, `LESSON_PREVIEW_SIGNING_KEY`, which is never the approvals key.
   - The grant is bound to one lesson, the exact content hash, the preview origin, one staff member and ten minutes.
   - Admin Web posts it into the framed lesson. It is never in a URL (no query, no fragment) and never stored. The engine verifies it with WebCrypto and fails closed (§3.3–§3.4).
4. **A permanent banner.** Every preview screen carries a fixed, non-dismissable bar that says the content is not approved and that no learner sees it. Every page is also hatched. No prop, setting or section hides them (§3.5).
5. **Held items are visible and labelled.** Every word, note, question, line, item or game that a family build would hold back is shown. Each one is highlighted (with a pattern, not by colour alone) and carries its hold reason **inline**: the `review` text, the old spelling `was`, a `finalMarkException`, «held because it shows X», the missing PD-49 steps, or the unpinned edition. A summary lists them all, and its count equals the family resolver's `held` (§3.5).
6. **Families see exactly what they see today, and this is proved.**
   - Golden snapshots of every family resolver's output are committed **before** the refactor and must not change.
   - The family bundle is scanned for preview markers.
   - The API refuses every non-reviewer actor.
   - Lesson items in Materials and the Flutter WebView can never point at the preview origin.
   - Nothing in the preview writes, stores or posts anything back (§4, §5).
7. **Five PRs:** engine refactor, engine preview, API grant, Admin Web, deploy (§6). The only owner action is generating the preview key (PR-4).

---

## 1. What exists today (read on `main` @ `ea8939dc`)

### 1.1 The gates, by lesson type

| Route | Content | What holds it back | Where |
|---|---|---|---|
| `/lessons/arabic/lesson-N` (letters: 1, 3, 6, 7) | `apps/lessons/src/arabic/lesson-00N.json` | The file shows nothing while `review.status !== 'approved'`. A word, note or question with `review` set is held. A spelling held anywhere is held everywhere. A question that shows a held word is held. A `finalMarkException` stays held until the file is approved. | `arabic/arabic-lesson.ts` (`resolveArabicLesson`, returns `held`, `approved`), `ArabicLesson.tsx:61` |
| `/lessons/arabic/lesson-N` (reading: 5) | `arabic/lesson-005.json` | The same rules over stages, passages, title and quiz | `reading/reading.ts:116` |
| `/lessons/quran/surah-N`, schema 1 | `content/surah-NNN.json` | A line with `review` set is held. The file shows nothing until it is approved. | `content/lesson-content.ts` |
| `/lessons/quran/surah-N`, schema 2 (PD-49) | `content/quran/surah-NNN.json` (none yet) | An item shows only with a fresh signed approval for its current hash, carrying every required step, and only if every work it cites has a pinned edition | `content/quran-content.ts` (`readApprovals`) |
| `/lessons/quran/surah-N/play` (PD-49) | `play/mechanics.json` and `content/approvals/play.json` | A mechanic plays only if it is approved in the signed play file | `play/PlayLesson.tsx:93`, `play/signed.ts` |

Every resolver **refuses a whole file** if any proof fails: a word without its letter, a position outside the verified surah, or a malformed field. A refusal is a different state from "held". The preview never relaxes a proof (§3.5).

### 1.2 The engine talks to no API

`audio/audio-manifest.ts` and `arabic/voice.ts` describe the only inbound channel. The signed-in opener (Admin Web, the Flutter WebView) posts **data** with `postMessage`. The engine accepts it only from `origins.self` or a build-time `LESSONS_PARENT_ORIGINS` origin, and only in an exact shape. The engine posts back only `jawwid:lesson-ready`. It stores nothing: there is no `localStorage`, `sessionStorage` or IndexedDB anywhere in `apps/lessons/src`.

**Consequence for this design.** Checking the origin does not tell staff apart from families. The Flutter WebView injects as `origins.self`. Admin Web frames lessons for every staff member, and the family apps are allowed parents too. A preview switch that rested on origin plus message shape could be flipped by any family session. The grant must therefore be **signed by the API** and checked by the engine (§3.4).

The engine does not verify Ed25519 in the browser today: `approvals-keys.json` says "CI verifies every signature", and the engine only checks the key id. The preview grant would be its first in-browser signature check. That check uses WebCrypto `subtle.verify({ name: 'Ed25519' })`, which needs Chrome 137+, Safari 17+ or Firefox 129+. It adds **no npm dependency**, so the supply-chain guard is untouched. A browser without Ed25519 is refused, never let through.

### 1.3 Pending content is already public

The lesson JSON is imported into the bundle (`arabic/index.ts`, `content/index.ts`). Anyone who reads the deployed JS can read a pending lesson today. A client-side preview gate therefore protects **integrity**, not secrecy:
- no child is ever *taught* unreviewed tashkeel as if it were a lesson;
- no preview link can be shared to a family;
- no preview state leaks into a family view.

Keeping pending text out of the family bundle is a separate, stronger step. Once the preview exists it becomes possible, because reviewers no longer need the family build to carry pending text. It is offered as a follow-up (§9 Q6), not built here.

### 1.4 Permissions: the keys exist, and the guard is not enough

- `apps/api/src/platform/permissions/catalogue.ts:172` holds `lesson_content.view` ("See lesson content under review", PD-49, delegable). Next to it are `.check`, `.review_teacher` and `.review_scholar`, which is not delegable.
- In `legacy-bundles.ts`, `manager:teachers` holds view, check and review_teacher, and `supervisor:teachers` holds view. A plain teacher holds none of them; one becomes a reviewer only by delegation.
- `permission.guard.ts:71` returns `true` for **every non-staff actor**. For a legacy-tier staff member, `PERMISSION_GUARD_MODE = 'shadow'` (line 20) logs instead of refusing.
- What actually refuses today is `lessonContentAccess` (`apps/api/src/platform/lesson-content-policy.ts:71`), called by `LessonContentService.require`. It requires `ActorKind.STAFF`, `isActive`, the content organization, and the view key or a step key.

The preview grant reuses exactly that function. It is the PD-49 reviewer population, with no new rule.

### 1.5 The API knows PD-49 scopes, not the Arabic lessons

`lesson-content/review-subjects.json` is generated by `scripts/lessons/lesson-content-subjects.py` and covers `quran-NNN` and `play` only. The Arabic lessons are reviewed through markdown docs (`docs/product/pd029-p05-lesson*-review.md`). To mint a grant for `arabic-001`, the API needs a generated list of previewable lessons and their content hashes (§3.2).

---

## 2. What must never happen

| # | Invariant | Enforced by |
|---|---|---|
| I1 | A family, student or non-reviewer teacher session never renders preview mode | No preview code in the family bundle (§3.1). The API refuses to mint (§3.2). The engine refuses unsigned or foreign grants (§3.4). |
| I2 | A URL alone never opens preview mode | The grant arrives only by `postMessage`. Query and fragment are ignored. A preview origin opened top-level refuses (§3.4). |
| I3 | Preview content never appears without the banner | One root component renders the banner *around* the router. There is no prop to omit it (§3.5). |
| I4 | No preview path changes what families see | Golden family-resolver snapshots (PR-0). The family bundle has no preview code. The preview writes and posts nothing (§3.7, §4). |
| I5 | Seeing is never approving | The grant service never reads or writes `chat.lesson_content_review` or any approval file. The preview has no approve button. |
| I6 | A preview key can never sign an approval, and an approval key can never open a preview | The keys, key lists and payload `typ` are separate. A CI guard checks that no key id appears in both lists (§3.3). |
| I7 | A preview never relaxes a proof | Preview and family share one resolver core. A refused file is refused in both (§3.5). |
| I8 | A grant is for one lesson, one exact text, one origin, one person, ten minutes | The payload fields are checked one by one (§3.4). |

---

## 3. Design

### 3.1 Two builds from one source

- **Build constant.** `vite.config.ts` gains `__LESSONS_PREVIEW__` (boolean) in `define`, next to `__QURAN_ANCHOR__` and `__LESSONS_AUDIO__`. It comes from build mode `preview`, never from an environment variable that a family build might inherit by accident.
- **One import point.** `src/preview/**` is imported only from `main.tsx`, inside `if (__LESSONS_PREVIEW__)`, so Rollup removes it from the family bundle. No family component imports anything from `src/preview/`. A lint rule (`no-restricted-imports` scoped to `src/**` except `src/main.tsx` and `src/preview/**`) keeps it that way.
- **CI builds both** in the existing lessons job:
  - `lessons-dist-<sha>` is unchanged in name and in headers;
  - `lessons-preview-dist-<sha>` is new.

  Each is built from the same tree and the same Quran snapshot, with the same trust anchor.
- **Guard `lessons-preview-absent`** (in `scripts/qa/guards.sh`):
  - scans `lessons-dist` for every marker: the message type `jawwid:lesson-preview`, the banner's Arabic text, the CSS class `preview-banner`, and every key id in `preview-keys.json`. Any hit fails the build.
  - scans `lessons-preview-dist` and requires every marker, so the guard is proven able to see them.
- **Origins.**
  - The family origin is untouched: same headers, same `frame-ancestors` (Admin Web, teacher web), same `LESSONS_PARENT_ORIGINS`.
  - The preview origin, e.g. `lessons-preview.<domain>`, sends:
    - `frame-ancestors <admin-web origin>` only;
    - `X-Robots-Tag: noindex, nofollow`;
    - `Referrer-Policy: no-referrer`;
    - `Cache-Control: no-store` on `index.html`.

    Its `LESSONS_PREVIEW_PARENTS` is Admin Web's origin only. The preview build **never** accepts messages from its own origin. That is unlike the family audio path, which allows `self` for the WebView.

### 3.2 Who may preview: the API

`POST /lesson-content/preview-grants` with body `{ subject }`. It returns `{ grant }`, or a refusal.

- `@Requires('lesson_content.view', 'lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.review_scholar')`, the same as the PD-49 read routes. Then **`LessonContentService.require(actor)`**, which runs `lessonContentAccess`. The second check is the real refusal, for the reasons in §1.4. It holds in shadow mode and for non-staff actors.
- **`subject`** is the route being previewed: `arabic-NNN`, `surah-NNN` (schema 1 and schema 2 together, as the route shows them) or `play-NNN`. Its pattern is checked. The subject must appear in the generated `apps/api/src/lesson-content/preview-subjects.json`; anything else returns `LESSON_CONTENT_NOT_FOUND`.
- **`preview-subjects.json`** is generated by `scripts/lessons/lesson-content-subjects.py`, extended. That script already produces `review-subjects.json` and is checked for staleness by `guards.sh lessons-supply-chain`. Each entry is `{ subject, route, contentSha256 }`, where `contentSha256` is the SHA-256 of the canonical JSON (the existing `canonicalJson`) of the list of content files that route resolves from, in a fixed order. The engine build embeds the same list (`__LESSONS_PREVIEW_SUBJECTS__`, preview build only), so both sides agree on the exact text without either one trusting the other.
- **Signer.** `PreviewSigner` mirrors `ApprovalsSigner` (`approvals-signer.ts`), with its own key:
  - `LESSON_PREVIEW_SIGNING_KEY` is Ed25519, PEM or base64 DER;
  - if it is unset or unreadable, the route answers `LESSON_PREVIEW_UNAVAILABLE` (503). It fails closed.
- **Audit.** Each grant writes one `AuditService` row, `lesson_preview.granted`, with `{ subject, contentSha256, jti, exp }`, against the staff actor. The existing audit table is used, so no migration is needed.
- **Rate limit:** 30 grants per staff member per 10 minutes, enough for renewals across a few open tabs.
- **No other side effect.** The service never touches `chat.lesson_content_review`, approvals or materials items.

**Who that is today:** the super admin, Teachers managers, Teachers supervisors, and any staff member granted a delegated review role. The owner can therefore preview the Arabic lessons as the super admin as soon as this ships.

### 3.3 The grant

```json
{
  "payload": {
    "v": 1,
    "typ": "jawwid:lesson-preview",
    "env": "production",
    "aud": "https://lessons-preview.<domain>",
    "subject": "arabic-001",
    "contentSha256": "<64 hex>",
    "sub": "<staff actor id>",
    "iat": "2026-10-30T09:00:00.000Z",
    "exp": "2026-10-30T09:10:00.000Z",
    "jti": "<uuid v4>"
  },
  "keyId": "<16 hex>",
  "signature": "<base64, 64 bytes>"
}
```

- **What is signed:** `canonicalJson(payload)`, the same bytes rule as the approvals export.
- **Lifetime: 10 minutes.** Admin Web renews 60 s before `exp` while the preview is open. Nothing is revoked on close, because nothing is stored.
- **Keys.** The public keys live in `apps/lessons/src/preview/preview-keys.json`, which has the same shape and rules as `approvals-keys.json`:
  - each entry is `{id, publicKey, env, addedAt, retiredAt?, revokedAt?}`, and a key is never removed;
  - the file is CODEOWNERS-protected and is added in its own PR;
  - it starts empty, until the owner generates the first key.

  Entries are filtered at build time by `LESSONS_PREVIEW_ENV`: a staging preview build accepts only staging keys, and a production build only production keys.
- **Separation (I6):**
  - a different env var, a different key list and a different `typ`;
  - guard `lessons-key-separation` fails if any key id or public key appears in both `approvals-keys.json` and `preview-keys.json`;
  - an approvals envelope has no `typ` and a different field set, so the exact-fields check refuses it as a grant, and the reverse also holds.
- **No PII beyond the staff id.** `sub` is shown nowhere and exists only for audit correlation.

### 3.4 How the engine accepts a grant (preview build only)

The order of events:
1. The frame loads at the plain lesson path (`/lessons/arabic/lesson-1`), with no parameters.
2. If `window.top === window`, the frame shows «تُفتح المعاينة من لوحة الإدارة.» and renders nothing else.
3. Otherwise it posts `{ type: 'jawwid:preview-ready', subject }` to each `LESSONS_PREVIEW_PARENTS` origin.
4. It accepts one `{ type: 'jawwid:lesson-preview', grant }` message.

The message is refused, and nothing changes, unless **every** check passes:

1. `event.origin` is in `LESSONS_PREVIEW_PARENTS`. `self` is **not** accepted.
2. The message has exactly the fields `type` and `grant`. The grant has exactly `payload`, `keyId` and `signature`. The payload has exactly the ten fields above, and `v === 1`.
3. `typ === 'jawwid:lesson-preview'`, and `env` equals the build's `LESSONS_PREVIEW_ENV`.
4. `keyId` is in this build's `preview-keys.json`, for this env, and is not revoked. `iat` is before the key's `retiredAt`.
5. `crypto.subtle.verify('Ed25519', key, signature, canonicalJson(payload))` is true. If the browser cannot run it, the grant is refused with the message «هذا المتصفح لا يدعم التحقق من إذن المعاينة.»
6. `aud === window.location.origin`.
7. `subject` is the route's own subject, so a grant for lesson 1 never opens lesson 3.
8. `contentSha256` equals this build's value for that subject. Otherwise the frame shows «هذه المعاينة لنسخة أخرى من الدرس.»
9. `exp` is later than now, `iat <= now + 120 s`, and `exp - iat <= 600 s`.

**Keeping and losing the grant.**
- The grant lives in one React state value. It is never written to storage, never put in the URL, and never posted on.
- When `exp` passes without a renewal, the lesson is **replaced** by «انتهت مدة المعاينة.» It never falls back to a bannerless view.
- Query strings and fragments are never read. A test proves that `?preview=1`, `#grant=…` and similar do nothing (§5).

**The limit, stated plainly.** Someone who opens the preview origin and edits its JS in devtools can render anything in the bundle. The family origin is no different (§1.3). The gate exists to stop accidental exposure, link-based exposure and family-session exposure. It does not hide text from a person who modifies the page. Secrecy is §9 Q6.

### 3.5 What a preview shows

**The banner (I3).**
- `PreviewFrame` wraps the router in `main.tsx` and is the preview build's root. Every route renders inside it. The banner is a sibling *outside* the lesson's scroll container, so no section, quiz, game or full-screen request can scroll it away or cover it.
- Text: «معاينة للمراجعة — هذا المحتوى لم يُعتمد بعد ولا يراه أي طالب.» A second line gives the subject, the first 8 hex of `contentSha256`, the minutes left on the grant, and the file's status (`pending` / `approved`) with its `review.note`.
- The bar uses a solid, high-contrast fill (at least 4.5:1). The lesson background also carries a fixed diagonal hatch, so any screenshot is recognisable as a preview. Both apply in `@media print`.
- Accessibility: `role="note"` and `aria-label`. It is announced once and has no close control.
- The family `.note` copy «هذا الدرس قيد المراجعة» never appears in a preview. The preview always renders the content.

**Held items (the reason a reviewer opens the preview).**
- Each resolver is split into a **core** that parses, proves and returns every element with `held: HoldReason | null`, plus:
  - a **family wrapper** that filters out held elements and returns today's exact shape and `held` count;
  - a **preview wrapper** (in `src/preview/`) that keeps them.

  One core means one set of proofs (I7). PR-0's golden snapshots prove the family wrapper's output did not move by a byte.
- **A held element is drawn in place**, where the child would see it, with a dashed outline and a hatched background. It is never marked by colour alone. Under it is a chip with the reason, **visible without hover** (tablets):

  | Lesson type | Element | Reason shown |
  |---|---|---|
  | Arabic letters / reading | word, note, title, passage, stage item | the `review` text; «الرسم السابق: …» from `was`; «علامة آخر الكلمة: …» from `finalMarkException`; «محجوزة لأنها وردت محجوزة في: …» (a spelling held elsewhere) |
  | Arabic letters / reading | quiz question | its own `review`, or «محجوز لأنه يعرض: X» listing the held words it shows |
  | Arabic letters | distractor | as for a word, marked «خيار خاطئ فقط» |
  | Surah, schema 1 | tafsir line, meaning, quiz, lesson learned | the `review` text |
  | Surah, schema 2 | item | «ينقصه: تحقق / معلّم / عالِم» (the missing steps); «الاعتماد لنص أقدم» (stale hash); «لا طبعة مثبّتة لـ: <source>»; the asbab display rule |
  | Play | mechanic | «اللعبة غير معتمدة», with its missing steps |

- **Interaction.** Held quiz questions and games are playable in the preview, so the reviewer can try them. Stars stay in memory as today.
- **The summary.** A «المحجوز (N)» button in the banner opens a list of every held element, grouped by section. Each one jumps to its place. N equals the family resolver's `held` for the same file, and a test asserts this.
- **A refused file stays refused** (I7). The preview shows the same «تعذّر التحقق…» as families do, plus a pointer to the CI checker's output. Showing *which* proof failed is §9 Q7.
- **Audio and voice-over: none in v1.**
  - PD-48 clips exist only for approved text (`ArabicLesson.tsx:47`), and their reviewers already listen in Admin Web.
  - Admin Web's recitation handoff checks `VITE_LESSONS_ORIGIN`, which is the family origin, so the preview frame receives none.

  The banner says «بلا صوت في المعاينة». See §9 Q5.

### 3.6 Admin Web

- **Where.** The Materials preview dialog (#166, full window) and the PD-49 lesson-content review page both gain «معاينة كما يراها الطالب». It is shown only when `GET /lesson-content/access` returns `view: true`. That is a convenience only; the API decides.
- **Steps:**
  1. Mint a grant.
  2. Open the full-window dialog with `<iframe src="${VITE_LESSONS_PREVIEW_ORIGIN}${route}">`. The route has no query and no fragment, and `sandbox="allow-scripts allow-same-origin"`.
  3. Wait for `jawwid:preview-ready` from exactly that origin, then `postMessage` the grant to exactly that origin.
  4. Renew 60 s before `exp`.
  5. Drop everything on close.
- **No preview origin configured** (`VITE_LESSONS_PREVIEW_ORIGIN` unset): no button.
- **Not in v1:** teacher web and the Flutter app (§9 Q4). Their WebView and lesson allowlists **must not** include the preview origin, and a test proves this (§5).

### 3.7 Nothing flows back

The preview build posts only `jawwid:preview-ready`. It never posts the grant, the content, stars or answers. It has no API client. It never calls `READY_MESSAGE` for audio or voice, because the family audio and voice hooks are not mounted in preview routes. Nothing a reviewer does in the preview reaches a family, a report, progress data or an approval.

---

## 4. Families are unchanged: how each claim is proven

| Claim | Proof |
|---|---|
| Family resolvers return exactly today's output | PR-0 commits golden JSON of `resolveArabicLesson`, `resolveReadingLesson`, `resolveContent` (schema 1) and the `quran-content` resolver output for **every** content file, before the core/wrapper split. PR-0 and every later PR must leave them byte-identical. |
| The family bundle cannot enter preview mode | `__LESSONS_PREVIEW__ = false`, plus guard `lessons-preview-absent` on `lessons-dist`, plus the family-build tests in §5.2 |
| Family headers, origins and parents are unchanged | The PR-1 diff touches no file under `deploy/` except the new preview section. `deploy/headers.md` gains a preview section, and the family block stays verbatim. |
| No family app can open the preview origin | Materials item validation in the API refuses a lessons item whose origin is the preview origin. The Flutter allowlist and the teacher-web allowlist exclude it. Tests are in §5.4. |
| Viewing never approves | The grant service has no DB write but the audit row. A spec asserts that `chat.lesson_content_review` and the approvals export are unchanged after N grants. |

---

## 5. Tests

### 5.1 API (`apps/api`, integration spec on a private database)

- **Refused, with the `LESSON_CONTENT_DENIED` code**, for each of:
  - a parent;
  - a student;
  - a teacher with no delegated key;
  - a **support session** in which the super admin acts as a parent;
  - a staff member of another organization;
  - an inactive staff member;
  - a staff member without any `lesson_content.*` key.

  All of these run with `PERMISSION_GUARD_MODE === 'shadow'`, as on `main`. The refusal must come from the service, not from the guard.
- **Allowed** for:
  - `supervisor:teachers` (view only);
  - `manager:teachers`;
  - a teacher with a delegated review role;
  - the super admin.
- **Unknown or malformed subject:** 404.
- **No key configured:** 503 and no audit row.
- **Payload:**
  - exactly the ten fields;
  - `exp - iat` = 600 s;
  - `aud` equals the configured preview origin;
  - `contentSha256` equals the generated value;
  - the signature verifies under the public key.
- **One audit row per grant.** Approvals and reviews are unchanged.
- **Rate limit:** the 31st grant within 10 minutes is refused.
- **Parity vectors:** one fixed grant, signed by a TEST-ONLY key, verifies identically in the API, the engine and a Python check. This is the `approvals.golden.json` pattern, file `preview-grant.golden.json`.

### 5.2 Engine, family build (`define __LESSONS_PREVIEW__ = false`)

- For every route kind (`arabic-001`, `003`, `005`, `006`, `007`, a schema-1 surah, play), posting a **validly signed** test grant from an allowed parent leaves the page at «هذا الدرس قيد المراجعة» (or today's play state), with no banner and no held element in the DOM.
- `?preview=1`, `?grant=<valid grant JSON>`, `#preview` and `#grant=…` change nothing.
- The golden snapshots from §4 pass.
- Guard: the built `lessons-dist` contains no preview marker.

### 5.3 Engine, preview build (`define … = true`)

- **No grant:** «بانتظار إذن المعاينة», and no content is rendered.
- **Opened top-level:** the refusal message from §3.4, and no `ready` is posted.
- **Each check in §3.4 fails on its own**, with the page unchanged:
  - wrong origin, including `self`;
  - an extra field, or a missing field;
  - wrong `typ` or `env`;
  - unknown, revoked or retired key;
  - bad signature;
  - **an approvals envelope signed by an approvals key**;
  - wrong `aud`;
  - grant for another subject;
  - stale `contentSha256`;
  - expired, future `iat`, or a lifetime over 600 s;
  - no Ed25519 in the browser (`subtle.verify` stubbed to throw).
- **Valid grant:** the banner is present on **every** section of every route kind and in the quiz and games. Test: iterate the sections and assert the banner and the hatch. Held elements render with their exact reasons. The summary count equals the family `held`. When the grant expires, the lesson is replaced, not shown bare. A renewal keeps it.
- **No storage:** `localStorage`, `sessionStorage` and IndexedDB are untouched (spy). No `postMessage` other than `preview-ready` (spy).

### 5.4 End to end and clients

- **Playwright, family dist:** pending lessons show the pending note, and there is no banner.
- **Playwright, preview dist:**
  - opened directly, it refuses;
  - framed by a test parent page that posts a test-key grant, it shows the banner and the held chips;
  - the same parent page served from a non-allowed origin gets nothing.
- **Admin Web:**
  - the button shows only when `access.view` is true;
  - the iframe `src` never has a query or fragment;
  - the grant is posted only to the preview origin, after `preview-ready` from it;
  - renewal happens before `exp`.
- **Flutter and teacher web:** a materials URL on the preview origin is refused by the lesson allowlist. Run the full Flutter suite.

---

## 6. PRs (after GO; one at a time, each waits for the previous one to merge)

| PR | Scope | Behaviour change |
|---|---|---|
| **PR-0** engine refactor | Golden snapshots of every family resolver's output, then the core/wrapper split with `HoldReason`. Family output is byte-identical. | None |
| **PR-1** engine preview | `__LESSONS_PREVIEW__` and the second dist artifact. `src/preview/`: grant check, `PreviewFrame` and banner, held rendering, summary. `preview-keys.json` (empty). `preview-subjects.json` and the generator extension. Guards `lessons-preview-absent` and `lessons-key-separation`. The tests in §5.2 and §5.3. `deploy/headers.md` preview section. | None for families. The preview dist exists but is not deployed. |
| **PR-2** API grant | `PreviewSigner`, `POST /lesson-content/preview-grants`, audit, rate limit, `LESSON_PREVIEW_SIGNING_KEY` in `.env.example` and `docs/infrastructure/environment.md`. The materials-URL refusal of the preview origin. The tests in §5.1. | Unset key → 503 (fail closed) |
| **PR-3** Admin Web and clients | The preview button and frame, renewal, `VITE_LESSONS_PREVIEW_ORIGIN`. The Flutter and teacher-web allowlist tests. | Staff only; no button while unset |
| **PR-4** deploy and key | Preview origin and headers, deploy of `lessons-preview-dist` from `main` CI only, staging first. **Owner:** generates the Ed25519 key, puts the private key in the API env, and lands the public key in its own CODEOWNERS PR. | Preview becomes usable |

There is no migration and no new permission key (§9 Q2).

---

## 7. Out of scope

- Approving from inside the preview. Approvals stay in the review page and the PD-49 flow (I5).
- Previews for parents, students or teachers outside review, ever.
- Keeping pending text out of the family bundle (§9 Q6).
- Islamic Studies lessons (not on the engine yet).
- Audio in the preview (§9 Q5).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| A refactor of the resolvers changes what families see | PR-0 is golden-first. The snapshots are committed in a commit before the split, and the PR diff must show them unchanged. |
| A future import pulls `src/preview/` into the family bundle | The lint rule, plus guard `lessons-preview-absent` on every CI run |
| A key is reused across purposes | Guard `lessons-key-separation`, separate env vars and `typ` |
| A staff browser lacks Ed25519 | Refused with a clear message. The Admin Web staff fleet is current Chrome or Safari. |
| Grants leak through logs | The grant is never in a URL, so it never reaches access logs or `Referer`. The API logs `jti` only. |
| The preview origin is framed elsewhere | `frame-ancestors` is Admin Web only. The origin check is Admin Web only. A top-level open is refused. |

---

## 9. Questions for the department head

| # | Question | Recommendation |
|---|---|---|
| Q1 | A PD-29 amendment (`PD-29-amendment-reviewer-preview.md`), or a new PD number? Migration slot? | **Amendment of PD-29; no migration slot.** Asked 2026-10-30. |
| Q2 | Reuse PD-49's `lesson_content.view` (plus the step keys) as the preview permission, or add `lesson_content.preview`? | **Reuse.** Its label is already "See lesson content under review". It reaches exactly the reviewers, and a second key would only drift from it. |
| Q3 | A separate preview build and origin, or one build where the grant unlocks preview on the family origin? | **Separate.** It turns "families can't reach preview" from a runtime check into a compile-time fact. The cost is one more artifact and one more origin. |
| Q4 | Admin Web only in v1, or teacher web too (delegated teacher reviewers)? | **Admin Web only.** Teacher web is a follow-up if delegated teachers ask for it. |
| Q5 | Audio and voice-over in the preview? | **None in v1.** It would need a second handoff to a second origin, and PD-48 clips are reviewed elsewhere. |
| Q6 | After this ships, strip pending text from the family bundle, so pending lessons are not public at all? | **Yes, as a separate PD-29 item** (the owner's call). Reviewers would then get content only through the preview build. |
| Q7 | Show *which* proof failed for a refused file, in the preview only? | **Yes, as a later PR.** It needs the core to return a reason instead of `null`. Families still see only the refusal. |
| Q8 | Grant lifetime of 10 minutes with renewal? | **Yes.** |
