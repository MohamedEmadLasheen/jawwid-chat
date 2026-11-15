# Owner confirmation sheet: the facts the public legal pages need (LR-04, OA-08)

**Draft, 2026-11-09. Builder W4.** Internal; not published.

**What this is for.** The legal pages can be published once every `{{PLACEHOLDER}}` is filled and counsel has
reviewed the text. This sheet proposes a value for each placeholder wherever the repository or the store
consoles show it, so most items need only a tick. Part A lists facts. Part B is the short list of decisions
that need your judgement or counsel's, each with a recommended default.

**How to answer.** For each row, tick **confirm**, or write the value in **change to**. The lead then
applies everything in one commit, using `apply-confirmed-values.md`.

**Sources.**
- **Console, 2026-11-08:** read in App Store Connect and Google Play Console on 2026-11-08 (launch tracker
  OT-1, evidence E-08). Proposed only, pending your confirmation (OA-08).
- **Repo:** the file named in the row.
- **Register:** `outstanding-information-and-decisions.md` (the LD-n recommendation).
- **New:** a proposal made in this sheet. Nothing in the repository shows it already exists.

**"Used in".** "Public" means the published policies. `{en,ar}` means the same line number in both language
files. The new pages `support-{en,ar}.md` and `account-deletion-{en,ar}.md` are included. Internal files and
the store-console drafts (`docs/release/store-console/`) are listed separately.

---

## Part A. Facts to confirm

### A. The operator (LD-1)

| # | Placeholder | Proposed value (EN / AR) | Source | Used in | Confirm | Change to |
|---|---|---|---|---|---|---|
| A-1 | `{{ENTITY_NAME}}` | **Jawwid LLC** / **شركة Jawwid LLC** (the legal name stays in Latin letters in both languages) | Console, 2026-11-08: the developer and legal name on both App Store Connect and Google Play | Public: privacy-policy-{en,ar}:20,22,741; terms-of-use-{en,ar}:20; terms-teachers-{en,ar}:18; terms-staff-{en,ar}:18; user-conduct-policy-en:16,432, -ar:16,388; reporting-and-complaints-policy-en:19,77,307, -ar:19,71,280; blocking-and-enforcement-policy-en:19,300, -ar:19,263; child-safety-policy-{en,ar}:18; support-{en,ar}:16,63; account-deletion-{en,ar}:16,69 | [ ] | ___ |
| A-2 | `{{ENTITY_COUNTRY}}` | **the State of Wyoming, United States** / **ولاية وايومنغ بالولايات المتحدة الأمريكية** | Console, 2026-11-08: Play lists the organization address in Sheridan, Wyoming. That the company is also *registered* (formed) in Wyoming is an inference; confirm it from the company's formation papers | Public: privacy-policy-{en,ar}:20; terms-of-use-{en,ar}:20; child-safety-policy-{en,ar}:18; support-{en,ar}:63 | [ ] | ___ |
| A-3 | `{{ENTITY_ADDRESS}}` | **The organization address exactly as Play Console shows it** (street line, Sheridan, WY, ZIP code, United States). Written in Latin letters in both languages, as a postal address | Console, 2026-11-08 (only the city and state were recorded; copy the full line from Play Console → Settings → Developer account) | Public: privacy-policy-{en,ar}:20,741; terms-of-use-{en,ar}:20; child-safety-policy-{en,ar}:18; user-conduct-policy-en:432, -ar:388; reporting-and-complaints-policy-en:307, -ar:280; blocking-and-enforcement-policy-en:300, -ar:263; support-{en,ar}:63; account-deletion-{en,ar}:69 | [ ] | ___ |
| A-4 | `{{ENTITY_REG_NO}}` | **The Wyoming Secretary of State filing ID** of Jawwid LLC (on the Articles of Organization or the Secretary of State's business search) | Not in the repository or the consoles: **the one fact in Part A you must type** | Public: terms-of-use-{en,ar}:20; child-safety-policy-{en,ar}:18; support-{en,ar}:63 | — | ___ |

### B. Contact mailboxes

None of these mailboxes appears anywhere in the repository. The only address under `jawwid.com` in the
repository is the sender `no-reply@jawwid.com` (`scripts/infra/production-setup.py:94`), and nothing should
be sent to that. The names below are **new** proposals on the jawwid.com domain. Before publication, each
one must exist and receive a test message. They may all deliver to one inbox, but someone must read
`safeguarding@` every day (LD-19).

| # | Placeholder | Proposed value | Source | Used in | Confirm | Change to |
|---|---|---|---|---|---|---|
| B-1 | `{{SUPPORT_EMAIL}}` | **support@jawwid.com** | New | Public: privacy-policy-{en,ar}:332,739; terms-of-use-{en,ar}:142,354,440; terms-teachers-{en,ar}:38,176,190; user-conduct-policy-en:324,409,415,432, -ar:290,366,371,388; reporting-and-complaints-policy-en:38,73,85,125,241,253,275,307, -ar:35,67,79,113,220,232,250,280; blocking-and-enforcement-policy-en:246,300, -ar:219,263; child-safety-policy-{en,ar}:57,226; support-{en,ar}:28,38,44; account-deletion-{en,ar}:28,67. Also the build setting `SUPPORT_EMAIL` (`scripts/mobile/build-store.sh:10,92`). Internal: developer-implementation-guide.md:198; store-console/play-declarations.md:180 | [ ] | ___ |
| B-2 | `{{PRIVACY_EMAIL}}` | **privacy@jawwid.com** | New | Public: privacy-policy-{en,ar}:28,69,332,446,663,733; terms-of-use-{en,ar}:448; terms-teachers-{en,ar}:98,190; terms-staff-{en,ar}:134; reporting-and-complaints-policy-en:39,244,308, -ar:36,222,281; child-safety-policy-{en,ar}:59,118; support-{en,ar}:30; account-deletion-{en,ar}:24,67. Internal: developer-implementation-guide.md:292 | [ ] | ___ |
| B-3 | `{{SAFEGUARDING_EMAIL}}` | **safeguarding@jawwid.com** | New | Public: privacy-policy-{en,ar}:737; terms-of-use-{en,ar}:30,260,442; terms-teachers-{en,ar}:78,190; terms-staff-{en,ar}:136; user-conduct-policy-en:259,409,416,432, -ar:233,366,372,388; reporting-and-complaints-policy-en:38,73,85,89,131,157,308, -ar:35,68,79,82,119,144,281; blocking-and-enforcement-policy-en:301, -ar:264; child-safety-policy-{en,ar}:36,170,226; support-{en,ar}:22,32. Internal: app-store-compliance-checklist.md:57; store-console/play-declarations.md:101 | [ ] | ___ |
| B-4 | `{{RATING_CONTACT_EMAIL}}` (store console only) | Same as B-1: **support@jawwid.com** | New | store-console/age-rating.md:89 | [ ] | ___ |
| B-5 | `{{SUPPORT_PHONE}}` (store console only, optional) | **Leave empty.** No phone line is published | New | store-console/play-declarations.md:182 | [ ] | ___ |

### C. Where the pages live (H-1, H-2, H-3, H-5)

Recommended host: Option A in `docs/release/legal-pages-hosting.md`. The pages are served by the Admin Web
container under `https://admin.chat.jawwid.com/legal/`. This adds no new resource and no cost. The
production hosts come from the repository (`docs/infrastructure/production-readiness.md` §3) and match
the console check of 2026-11-08 (API `api.chat.jawwid.com`, Admin `admin.chat.jawwid.com`).

| # | Placeholder or setting | Proposed value (AR file / EN file) | Source | Used in | Confirm | Change to |
|---|---|---|---|---|---|---|
| C-1 | Host for the legal pages (H-1) | `https://admin.chat.jawwid.com/legal/` | Repo (hosting analysis) | Every URL below | [ ] | ___ |
| C-2 | `{{SUPPORT_URL}}` | `https://admin.chat.jawwid.com/legal/ar/support` / `…/legal/en/support`; build setting `SUPPORT_URL` = `https://admin.chat.jawwid.com/legal/{lang}/support` | Follows C-1 | Public: privacy-policy-{en,ar}:739; terms-of-use-{en,ar}:444. Internal: app-store-compliance-checklist.md:119; store-console/listing-copy.md:91,132; play-declarations.md:181 | [ ] | ___ |
| C-3 | `{{ACCOUNT_DELETION_URL}}` (the deletion **form**) | `https://api.chat.jawwid.com/api/v1/account-deletion` / `https://api.chat.jawwid.com/api/v1/account-deletion?lang=en` | Repo: route `apps/api/src/account-deletion/account-deletion.controller.ts:60` under the global prefix `api/v1` (`apps/api/src/main.ts:82`); `docs/infrastructure/environment.md:102-103` | Public: privacy-policy-{en,ar}:440; account-deletion-{en,ar}:22 | [ ] | ___ |
| C-4 | Store-console deletion URL (H-3) | `https://admin.chat.jawwid.com/legal/en/account-deletion`: the new information page. It names the app and the developer, gives the steps, lists what is deleted and kept, and links to the form | Follows C-1; `publishing-gap-check.md` §3 | store-console/google-data-safety.md:35,123; play-declarations.md:68; apple-app-privacy.md:274 (these use `{{ACCOUNT_DELETION_URL}}`; the console value is this page, not the form) | [ ] | ___ |
| C-5 | `{{PRIVACY_POLICY_URL}}` (store console and build) | `https://admin.chat.jawwid.com/legal/{lang}/privacy` | Follows C-1 | Build setting `PRIVACY_POLICY_URL`; store-console/apple-app-privacy.md:273; play-declarations.md:100; listing-copy.md:89,130 | [ ] | ___ |
| C-6 | `{{TERMS_URL}}` (store console and build) | `https://admin.chat.jawwid.com/legal/{lang}/terms` | Follows C-1 | Build setting `TERMS_URL`; store-console/listing-copy.md:90,131 | [ ] | ___ |
| C-7 | `{{CHILD_SAFETY_POLICY_URL}}` (store console) | `https://admin.chat.jawwid.com/legal/en/child-safety` | Follows C-1 | store-console/play-declarations.md:101 | [ ] | ___ |
| C-8 | Website in the store listings | `https://jawwid.com/` (already set) | Console, 2026-11-08 | Store listings | [ ] | ___ |

### D. Numbers and versions

| # | Placeholder | Proposed value | Source | Used in | Confirm | Change to |
|---|---|---|---|---|---|---|
| D-1 | `{{MIN_ACCOUNT_HOLDER_AGE}}` | **18** | Register LD-5; store-console/README.md row 1 ("account holders 18+") | Public: terms-of-use-{en,ar}:94; child-safety-policy-{en,ar}:42; privacy-policy-{en,ar}:54 (a drafting note, removed at publication) | [ ] | ___ |
| D-2 | `{{COMPLAINT_RESPONSE_DAYS}}` | **30** (acknowledgement within 5 working days, as a practice; not published) | Register LD-18; the same 30 days as data-subject requests (LD-9, L-5) | Public: terms-of-use-{en,ar}:446; reporting-and-complaints-policy-en:249, -ar:228; blocking-and-enforcement-policy-en:255, -ar:226; support-{en,ar}:48 | [ ] | ___ |
| D-3 | `{{VERSION}}` | **1.0** for every document at first publication | Developer guide §2.2 | Every public document: front matter (line 6) and header (line 14); privacy-policy-{en,ar}:729 (version history) | [ ] | ___ |
| D-4 | `{{EFFECTIVE_DATE}}` | **The publication date**, in `YYYY-MM-DD` form, the same date for every document. The lead sets it on the day of the deploy | Developer guide §2.2 | Every public document: lines 8 and 14; privacy-policy-{en,ar}:729 | [ ] | ___ |
| D-5 | `{{NOTICE_DAYS}}` (internal only) | **30** days' notice of a material change | Register L-7 (counsel confirms) | developer-implementation-guide.md:146 only. No public document uses it | [ ] | ___ |

---

## Part B. Decisions that need your judgement or counsel's

Each item has a recommended default. If you and counsel accept it, tick it; the lead applies it.

| # | Decision | Recommended default | Who | Accept | Change to |
|---|---|---|---|---|---|
| J-1 | **Counsel's check that Jawwid LLC, a Wyoming company, may be the operator for families in the Gulf**: local registration, e-commerce disclosures (UAE Decree-Law 14/2023 Art. 6; KSA E-Commerce Law Art. 6), and the data-protection filings in LD-14 | Name Jawwid LLC as operator and controller (A-1 to A-4). Counsel confirms before publication, and before each market is served | Owner + counsel | [ ] | ___ |
| J-2 | `{{GOVERNING_LAW}}` and `{{DISPUTE_FORUM}}` (LD-2). Used in terms-of-use-{en,ar}:414,418 (and the note at 424); terms-teachers-{en,ar}:186; terms-staff-{en,ar}:158 | Law: **"the laws of the State of Wyoming, United States"** / **"قوانين ولاية وايومنغ بالولايات المتحدة الأمريكية"**. Forum: **"the competent courts of the State of Wyoming, United States"** / **"المحاكم المختصة في ولاية وايومنغ بالولايات المتحدة الأمريكية"**. Clause 22.4 already keeps the consumer's own law and courts, and 22.5 rules out arbitration. This follows LD-2: the law of the entity's country | Owner + counsel | [ ] | ___ |
| J-3 | `{{REFUND_RULES}}` (LD-4). Used in terms-of-use-{en,ar}:304 (and the note at 312); blocking-and-enforcement-policy-en:273, -ar:242 | EN: "unused lessons in a paid Lesson package are refunded in proportion on request; lessons held, and lessons missed without an excused apology, are not refunded; a refund request is answered within {{COMPLAINT_RESPONSE_DAYS}} days" / AR: «تُستردّ قيمة الحصص غير المستخدمة من باقة الحصص المدفوعة بنسبتها عند الطلب، ولا تُستردّ قيمة الحصص التي عُقدت أو التي غاب عنها الطفل دون اعتذار مقبول، ويُردّ على طلب الاسترداد خلال {{COMPLAINT_RESPONSE_DAYS}} يومًا». Clause 14.4 keeps the mandatory rights (for example the KSA 7-day cancellation) on top | Owner (business) + counsel | [ ] | ___ |
| J-4 | `{{CANCELLATION_NOTICE_HOURS}}`. Used in terms-of-use-{en,ar}:220 (and the note at 234) | **2** hours, as a request only. The app already treats any apology sent before the start as excused, so nothing changes in the app. In Arabic, write «ساعتين» rather than "2 ساعة". If you want short notice to use up a lesson, the app must change first | Owner | [ ] | ___ |
| J-5 | `{{SAFEGUARDING_CONTACT_NAME}}` (LD-19). Used in child-safety-policy-{en,ar}:36 | Publish a role, not a person's name: **"the Academy's Child Safety Lead"** / **«مسؤول سلامة الأطفال في الأكاديمية»**. Name the person, and a deputy, internally and in the Play Console declaration if Play asks. Vetting and training stay as LD-19 says | Owner | [ ] | ___ |
| J-6 | `{{DPO_CONTACT}}` (LD-14). Used in privacy-policy-{en,ar}:28,735 | **No data protection officer at launch.** As the drafting note at line 30 says, delete the second sentence of clause 1.5 and line 18.2 in both languages, then renumber 18.3 to 18.7. Counsel confirms that no market served at launch requires one. Oman, for example, does (LD-14) | Counsel | [ ] | ___ |
| J-7 | `{{EMERGENCY_CONTACTS}}` and `{{CHILD_PROTECTION_REPORTING_LINES}}` (L-8; "never guessed"). Used in child-safety-policy-{en,ar}:166,172; reporting-and-complaints-policy-en:27,154, -ar:26,142; support-{en,ar}:20 | Until counsel supplies a verified list for each country, use wording that names no number. Emergency contacts: **"the emergency number in your country"** / **«رقم الطوارئ في بلدك»**. Reporting lines: **"the police or the child-protection authority where you live"** / **«الشرطة أو جهة حماية الطفل في بلد إقامتك»** | Counsel | [ ] | ___ |
| J-8 | **Retention periods shown on the deletion page** (LD-6, LD-7). The account-deletion pages, §3, carry `[TO CONFIRM]` for messages, children's records, reports and session records. Google Play asks for the retention period of the data that is kept | Messages: "while the conversation exists for its other members". Children's records: as in LD-6 (lesson and payment history only; the photo and "about" text deleted when the last parent leaves; the name anonymised after the period). Reports and evidence: "as long as needed for safety and legal claims, then deleted". Financial records and the audit log: 7 years, once counsel confirms (L-6). Stating a fixed period needs a purge job; until one exists, publish only what the code does | Owner + counsel | [ ] | ___ |
| J-9 | **Language precedence** (LD-17). Every document says that Arabic prevails, marked `[legal review]` | Arabic prevails, as drafted | Counsel | [ ] | ___ |
| J-10 | **Counsel review of every document** (L-1 to L-17). The `[TO CONFIRM]` and `[legal review]` markers must all go before publication (R-11) | One counsel pass over the Arabic and English text of the eight policies and the two new pages | Counsel | [ ] | ___ |

**Not in this sheet** (not legal facts): the review-account credentials, `{{FGS_VIDEO_URL}}` and
`{{PAYMENTS_TAB_NAME}}` in `docs/release/store-console/`.

## Afterwards

The lead applies the confirmed values in one commit (`apply-confirmed-values.md`). Engineering builds the
hosting (`docs/release/legal-pages-hosting.md` §3.2). After the first production deploy, the checks in
`public-hosting-requirements.md` §5 are run.
