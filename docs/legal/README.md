# Jawwid Academy: legal documentation package

**State: DRAFT, version 0.1 (2026-11-06).**
- Prepared for qualified legal review.
- **Nothing here is published or in force.** No document is hosted, and no URL exists yet.
- The app is **not** store-ready. The blockers are listed in `outstanding-information-and-decisions.md` §7.

## Public documents (Arabic is the primary language)

| Document | Arabic | English | Key (#462) | Kind |
|---|---|---|---|---|
| Terms of Use (families) | `terms-of-use-ar.md` | `terms-of-use-en.md` | `terms_family` | Accepted |
| Teacher Terms | `terms-teachers-ar.md` | `terms-teachers-en.md` | `terms_teacher` | Accepted |
| Staff Terms | `terms-staff-ar.md` | `terms-staff-en.md` | `terms_staff` | Accepted |
| Code of Conduct (the User Conduct Policy) | `user-conduct-policy-ar.md` | `user-conduct-policy-en.md` | `code_of_conduct` | Accepted by every account |
| Reporting and Complaints Policy | `reporting-and-complaints-policy-ar.md` | `reporting-and-complaints-policy-en.md` | — | Incorporated by reference |
| Blocking, Suspension and Enforcement Policy | `blocking-and-enforcement-policy-ar.md` | `blocking-and-enforcement-policy-en.md` | — | Incorporated by reference |
| Child Safety and Parental Responsibility Policy | `child-safety-policy-ar.md` | `child-safety-policy-en.md` | — | Incorporated by reference; also the published child safety standards |
| Privacy Policy | `privacy-policy-ar.md` | `privacy-policy-en.md` | — | Notice (never a click-through) |
| Help and Support | `support-ar.md` | `support-en.md` | — | Information page (Support URL); drafted 2026-11-09 |
| Account deletion (information) | `account-deletion-ar.md` | `account-deletion-en.md` | — | Information page (Play "Delete account URL"); links to the API form; drafted 2026-11-09 |

There are separate Teacher Terms and Staff Terms because of owner decision A-3 (`docs/release/google-play-blocker-roadmap-2026-11-03.md` §7). A-3 requires separate terms per account kind plus one shared Code of Conduct, and PR #462 stores them that way.

## Internal documents (not published)

| File | Purpose |
|---|---|
| `data-inventory-and-retention-matrix.md` | Code-verified data, processors, retention and deletion: the source of fact for the Privacy Policy |
| `developer-implementation-guide.md` | The engineering work: terms acceptance (fits PR #462), versions, moderation gaps, privacy tooling |
| `legal-research-and-compliance-matrix.md` | GCC law research, with sources and verification levels |
| `app-store-compliance-checklist.md` | Google Play and Apple requirements, and the state of each |
| `public-hosting-requirements.md` | How and where the documents must be published, and how to check them |
| `outstanding-information-and-decisions.md` | Placeholders, owner decisions (LD-n), legal-review items (L-n), developer confirmations, blockers |
| `owner-confirmation-sheet.md` | Every placeholder with a proposed value, its source and where it is used, for the owner to confirm (OA-08); plus the decisions for the owner and counsel |
| `apply-confirmed-values.md` | The placeholder → value → files table the lead applies in one commit |
| `publishing-gap-check.md` | Which pages exist in both languages; the deletion and support pages against Google Play and Apple |
| `pd048-lesson-audio-parent-notice.md` | The owner-approved PD-48 wording. It is carried verbatim in Privacy Policy §14 and Terms of Use §9 |

## Rules for editing

- Change Arabic and English **together**. Keep the clause numbers identical and the `{{PLACEHOLDERS}}` identical.
- **Never edit the PD-48 paragraph.** A change needs the owner's approval (see its file).
- **A fact in a public policy must be in the data-inventory matrix,** or marked `[TO CONFIRM]`.
- Before publication, remove the drafting notes, the `[TO CONFIRM]` and `[legal review]` markers, and the placeholders. Then run the checks in `public-hosting-requirements.md` §5.
