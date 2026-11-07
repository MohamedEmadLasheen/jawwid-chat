# Public hosting requirements for the legal documents

**Version 0.1 (draft), 2026-11-06.**

**State:** nothing is hosted. No URL in this file exists yet. Every URL below is an **example pattern**, written with `<host>`. The host and the paths are owner decisions (H-1, H-2). This file sets out what the published pages must do and how to check them.

---

## 1. What must be published

| Document | Source files | Public in | Required by |
|---|---|---|---|
| Privacy Policy | `privacy-policy-ar.md`, `privacy-policy-en.md` | Arabic and English | Google Play (User Data), Apple 5.1.1(i), GCC laws (notice) |
| Terms of Use (families) | `terms-of-use-*.md` | Arabic and English | Google Play UGC; Apple 1.2; consumer law; the terms gate (#462 `url_ar` / `url_en`) |
| Code of Conduct | `user-conduct-policy-*.md` | Arabic and English | Google Play UGC ("defines objectionable content"); the terms gate |
| Teacher Terms | `terms-teachers-*.md` | Arabic and English | The terms gate. Public, because the gate opens a URL without signing in |
| Staff Terms | `terms-staff-*.md` | Arabic and English | The terms gate. **Option:** host them behind no login but leave them out of the site navigation (H-4) |
| Reporting and Complaints Policy | `reporting-and-complaints-policy-*.md` | Arabic and English | Apple 1.2 ("timely responses"); incorporated by reference in the terms |
| Blocking, Suspension and Enforcement Policy | `blocking-and-enforcement-policy-*.md` | Arabic and English | Incorporated by reference |
| Child Safety and Parental Responsibility Policy | `child-safety-policy-*.md` | Arabic and English | Google's Child Safety Standards (published standards); incorporated by reference |
| Account deletion | Exists in code: `GET /account-deletion` on the API host (`apps/api/src/account-deletion/`) | Check its languages (H-3) | Google Play web deletion resource |
| Support page | To create (H-5) | Arabic and English | Apple 1.5 Support URL; Apple 1.2 contact information |

**Not published:** the technical and compliance documents in this folder (this file, the implementation guide, the matrices, the checklist, and the outstanding items). They stay in the repository.

## 2. URL design (the owner decides; the pattern is a recommendation)

- **H-1, the host.** A page on the academy's public website, for example `https://<host>`, where `<host>` is a subdomain or path of `jawwid.com`. It must **not** be the API host, so that legal pages do not depend on the API being up.
  - The account-deletion page is the exception: it lives on the API because it acts.
- **H-2, the path pattern.** Use one pattern with the language in the path, because the app already substitutes `{lang}` (`lib/core/legal/legal_links.dart`):
  - `https://<host>/{lang}/privacy`
  - `https://<host>/{lang}/terms`
  - `https://<host>/{lang}/code-of-conduct`
  - `https://<host>/{lang}/terms/teachers`
  - `https://<host>/{lang}/terms/staff`
  - `https://<host>/{lang}/reporting`
  - `https://<host>/{lang}/enforcement`
  - `https://<host>/{lang}/child-safety`
  - `https://<host>/{lang}/support`
- **Versioned URLs** for acceptance documents, for example `https://<host>/{lang}/terms/<version>`. The current version is also served at the un-versioned path.
  - The terms gate stores the **versioned** URL in `chat.legal_document_version.url_ar` / `url_en`, so an acceptance always points at the exact text.
  - The app's Settings links use the **un-versioned** path, which always shows the current text.
- `{lang}` is `ar` or `en`. Each language page links to the other.

## 3. Requirements for every published page

| # | Requirement | Why | How to check |
|---|---|---|---|
| R-1 | Reachable **without signing in**, without a cookie wall, and without geoblocking | Google: "publicly accessible, non-geofenced"; Apple review | Fetch from a clean browser and from outside the GCC; response 200 |
| R-2 | **HTML**, not a PDF or an image | Google ("not a PDF") | `content-type: text/html` |
| R-3 | **Mobile-friendly**: responsive, readable at 320 px width, no horizontal scroll | Apple and Google review on phones | Device check in both languages |
| R-4 | **Arabic pages** have `lang="ar" dir="rtl"`; English pages have `lang="en" dir="ltr"`. A font that renders Arabic well, with no external font CDN required | Accessibility; Arabic is the primary language | Inspect the markup |
| R-5 | The page shows the **title, version, effective date and language** at the top, matching the front matter | Owner's brief; evidence of what was accepted | Visual check, plus the automated check in §5 |
| R-6 | A **version history** at the bottom: version, effective date, summary of changes; earlier versions linked | Evidence and transparency | Visual check |
| R-7 | **Same content as the source file.** The page is generated from the approved Markdown and never edited by hand | Owner's brief: consistency between the published pages and the source files | SHA-256 check (§5); a diff of the rendered text against the source |
| R-8 | The **legal entity and contact details** are visible (from the front matter placeholders, once filled) | Google: privacy-policy contact; UAE Decree-Law 14/2023 Art. 6; KSA E-Commerce Law Art. 6 | Visual check |
| R-9 | **No tracking**: no analytics, no third-party scripts, no cookies | Consistent with Privacy Policy §16 | Browser network panel |
| R-10 | https only, with a valid certificate; HSTS | The app refuses non-https links (`legal_links.dart`); #462 enforces `^https://` | `curl -I` |
| R-11 | **Draft markers removed**: front-matter `status`, drafting notes and `{{PLACEHOLDERS}}` must not appear on a published page | The sources carry drafting notes | Automated check (§5): fail if the rendered page contains `{{`, `Drafting note`, `DRAFT`, `TO CONFIRM`, `legal review`, or an internal ID such as LD-7, L-4, DEV-CONFIRM #6, PD-48 or H-1 |
| R-12 | **Stable URLs.** A published URL is never removed. Superseded versions stay reachable | Acceptance records point at them | Link check against every row of `chat.legal_document_version` |
| R-13 | **PD-48 paragraph** unchanged in the Privacy Policy (§14) and the Terms of Use | `docs/legal/pd048-lesson-audio-parent-notice.md` | Automated check (§5): byte-for-byte |

## 4. Publication process (owner-run; engineering supplies the tools)

1. **Legal review.** Qualified counsel approves the Arabic and English text of each document (L-items closed).
2. **Owner approval.** The owner fills every `{{PLACEHOLDER}}`, sets `version` and `effective_date`, removes the drafting notes, and approves the text in a PR. Approval is recorded in the PR.
3. **Render** the Markdown to HTML with a fixed template that meets R-3 to R-6, R-9 and R-11. Compute the SHA-256 of each rendered page.
4. **Deploy** to the public host. **This is an owner or release action, not part of this task.**
5. **Verify** with the checks in §5. Record the results in the PR.
6. **Configure:**
   - the store builds' `PRIVACY_POLICY_URL` and `TERMS_URL` (with `{lang}`);
   - the support URL and e-mail (P-5);
   - the Play Console and App Store Connect URL fields;
   - for the four acceptance documents, `chat.publish_legal_version(...)` with the versioned URLs (and hashes, if P-1 is adopted), then `legal.current.<key>`.
7. **Effective date.** For a material change, users are notified before the effective date (developer guide §2.3).

## 5. Verification checklist (run before submission, and after every change)

For each document and each language:

- [ ] `curl -sSI <url>` returns 200 and `content-type: text/html`, with no redirect to a sign-in page.
- [ ] Page text contains the version and the effective date, matching the source front matter.
- [ ] The page contains no `{{`, no `Drafting note`, no `DRAFT`, no `TO CONFIRM`, no `legal review`, and no internal ID (regex `\b(LD|L|DEV-CONFIRM|PD|H|P|MG|AP|GP)-?\s?#?\d`).
- [ ] The SHA-256 of the served page equals the hash recorded at publication.
- [ ] The Arabic page has `dir="rtl"`; each language links to the other.
- [ ] The Privacy Policy and the Terms of Use contain the PD-48 paragraph, byte-identical to `pd048-lesson-audio-parent-notice.md` for that language.
- [ ] No third-party requests in the browser network panel.
- [ ] Readable on a 320 px phone screen.
- [ ] The app's sign-in, sign-up and Settings links open the right page for each language.
- [ ] The Play Console and App Store Connect fields hold the same URLs.

Engineering ticket L-ENG-11 (developer guide §7) automates the first five checks in the release audit.

## 6. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| H-1 | The public host | A static page on the academy website under `jawwid.com`, not the API host |
| H-2 | The path pattern | §2 |
| H-3 | The account-deletion URL in the store listing: the API page itself, or a public page that links to it | Use the API page `/account-deletion` on the production API host (the route exists in code; the host `api.chat.jawwid.com` is from `docs/infrastructure/production-readiness.md`; check that it is reachable in production, and its Arabic and English versions), and link it from the support page |
| H-4 | Whether the Staff Terms appear in site navigation | Public URL, left out of the navigation |
| H-5 | The support page's content: e-mail, hours, response time, and links to all the policies | Owner provides the e-mail and hours |
