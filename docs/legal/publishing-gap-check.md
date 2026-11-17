# Publishing gap check (LR-04)

**Draft, 2026-11-09. Builder W4.** Internal; not published. This checks the pages that LR-04 needs
against `public-hosting-requirements.md` and the store rules. It was checked against the repository on
`main` (after #516–#520). No page was fetched: nothing is hosted, and the production API is not deployed
(LR-01).

## 1. Which pages exist, in which languages

| Page (`public-hosting-requirements.md` §1) | Arabic | English | State |
|---|---|---|---|
| Privacy Policy | `privacy-policy-ar.md` | `privacy-policy-en.md` | Drafted. 18 placeholder lines in each, drafting notes, counsel markers |
| Terms of Use (families) | `terms-of-use-ar.md` | `terms-of-use-en.md` | Drafted. 21 placeholder lines in each |
| Code of Conduct | `user-conduct-policy-ar.md` | `user-conduct-policy-en.md` | Drafted |
| Teacher Terms | `terms-teachers-ar.md` | `terms-teachers-en.md` | Drafted |
| Staff Terms | `terms-staff-ar.md` | `terms-staff-en.md` | Drafted |
| Reporting and Complaints Policy | `reporting-and-complaints-policy-ar.md` | `reporting-and-complaints-policy-en.md` | Drafted |
| Blocking, Suspension and Enforcement Policy | `blocking-and-enforcement-policy-ar.md` | `blocking-and-enforcement-policy-en.md` | Drafted |
| Child Safety Policy | `child-safety-policy-ar.md` | `child-safety-policy-en.md` | Drafted |
| **Support page** | `support-ar.md` | `support-en.md` | **Was missing (H-5). Drafted in this PR** |
| **Account deletion: information page** | `account-deletion-ar.md` | `account-deletion-en.md` | **Was missing. Drafted in this PR** (§3) |
| Account deletion: the form | In code: `apps/api/src/account-deletion/account-deletion-page.ts` | Same file | Exists in both languages. Arabic by default, English with `?lang=en`, and a link to switch language. Live after LR-01 |

Every page now exists in both languages. **None can be published yet:** they still contain placeholders
(`owner-confirmation-sheet.md`), drafting notes, and `[TO CONFIRM]` and `[legal review]` markers (counsel,
J-10). Nothing is hosted yet (`docs/release/legal-pages-hosting.md`).

## 2. Path correction: the deletion form is at `/api/v1/account-deletion`

The API's global prefix `api/v1` exempts only the health routes (`apps/api/src/main.ts:82-84`). The form
is therefore served at `https://api.chat.jawwid.com/api/v1/account-deletion`. This matches
`docs/security/pd040-route-permissions.md:17-18`, `docs/infrastructure/environment.md:102-103` and
`docs/mobile/store-builds.md:126`. The integration test (`apps/api/test/integration/pd056-account-deletion.spec.ts:75`)
mounts the module without the prefix, so it does not show the production path. The following drafts say
`/account-deletion` without the prefix:
- `public-hosting-requirements.md` §1 and H-3 (corrected in this PR);
- `app-store-compliance-checklist.md` G-14;
- `data-inventory-and-retention-matrix.md:91`;
- `developer-implementation-guide.md:386`;
- `docs/infrastructure/production-readiness.md:78`;
- `docs/release/first-deploy-readiness-2026-11-08.md:487`;
- `docs/release/store-console/google-data-safety.md:35,123`.

Those files are left for the lead (outside this task, or not the source of truth). The URLs in the
confirmation sheet use the correct path.

## 3. Account deletion against Google Play and Apple 5.1.1(v)

**Google Play** (Data safety, "Delete account URL"; compliance checklist G-14). The web resource must let a
user request deletion without the app. It must name the app or the developer as shown on the listing, give
the steps, and say which data is deleted and which is kept, with any retention period.

| Play requirement | The API form (`/api/v1/account-deletion`) | The new information page (`account-deletion-*.md`) |
|---|---|---|
| Works without the app, no sign-in to reach it | ✅ Public, no script (`@Public()`, `account-deletion.controller.ts:59`) | ✅ Static page; links to the form |
| Names the app or developer as on the listing | 🟡 Says "Jawwid" ("Delete your Jawwid account"); not the listing name "Jawwid: Quran Academy", not the developer | ✅ Names "Jawwid: Quran Academy" and `{{ENTITY_NAME}}` (Jawwid LLC) |
| Steps to request deletion | ✅ The form itself, and the in-app path in its intro | ✅ In the app, on the web, and by e-mail if the user cannot sign in |
| A route for someone who cannot sign in | ❌ The form needs the password | ✅ E-mail to `{{PRIVACY_EMAIL}}` (Privacy Policy 10.1.5) |
| Data deleted | ✅ Four items | ✅ Privacy Policy 10.2 in full |
| Data kept | 🟡 Payments, messages and children's records only. Reports, consent records, call records, logs and backups are not named | ✅ Privacy Policy 10.3 in full |
| Retention period of kept data | 🟡 Only "7 years" for financial records | 🟡 Same, with `[TO CONFIRM]` for messages, children's records and evidence: **owner and counsel decision J-8 (LD-6, LD-7)** |

**Recommendation:** enter the information page (`/legal/en/account-deletion`) as the Play "Delete account
URL". It meets every row once J-8 is decided, and it needs no code change. A small optional follow-up for
engineering: the form could link to the information page and name the developer. That is code in
`account-deletion-page.ts`, so it is not in this PR.

**Apple 5.1.1(v)** (in-app deletion for any app that lets people create an account):

| Apple requirement | State |
|---|---|
| Deletion starts in the app, easy to find | ✅ Settings → Delete account (`lib/features/settings/presentation/settings_screen.dart:283-285`) |
| The whole account is deleted, not only deactivated | ✅ `chat.erase_account` (Privacy Policy 10.2) |
| No "contact us" in place of deletion | ❌ **Teachers** with open lessons, students or payroll are told to contact the Academy. Launch item **LR-03** (PR #498) turns this into a deletion request. Clause 1.5 of the information page describes today's behaviour and must follow #498 when it merges. Apple allows a delayed deletion only when the user is told how long it takes |
| A web link | Optional for Apple. Use the information page as the "User Privacy Choices URL" |

## 4. Support page against Apple 1.5 and 1.2, and Google Play

| Requirement | State |
|---|---|
| Apple 1.5: the Support URL leads to working contact information | ✅ `support-*.md`: in-app conversation, `{{SUPPORT_EMAIL}}`, `{{PRIVACY_EMAIL}}`, `{{SAFEGUARDING_EMAIL}}`. Open: the mailboxes must exist (B-1 to B-3) |
| Apple 1.2 (user-generated content): published contact information, and a way to report | ✅ Contacts, in-app reporting, the Reporting Policy. The operator and address are in §6 |
| UAE Decree-Law 14/2023 Art. 6; KSA E-Commerce Law Art. 6: the provider's name, registration number and address | ✅ §6 (needs A-1 to A-4; counsel J-1) |
| Same URL in the app and the consoles | `SUPPORT_URL` build setting = `…/legal/{lang}/support` (`docs/release/legal-pages-hosting.md` §3.1) |
| Google Play: a contact e-mail on the listing | Play Console field; use B-1 |
| Links to every public policy | ✅ §5, except the Staff Terms (H-4) |

## 5. Privacy Policy and Terms of Use against R-1 to R-13

These rules are met by the renderer and the host (`docs/release/legal-pages-hosting.md` §3.2), not by the
text: R-1 to R-4, R-6, R-9, R-10 and R-12. In the text itself:

| Rule | State |
|---|---|
| R-5 version and date at the top | ✅ Header line 14 in every document, waiting for D-3 and D-4 |
| R-8 entity and contact details visible | ✅ Privacy Policy §1 and §18; Terms §1 and §24, waiting for Part A |
| R-11 no drafting markers | ❌ Until the owner confirms and counsel reviews |
| R-13 PD-48 unchanged | ✅ Not touched by this PR |

## 6. What is still open after this PR

1. The owner's answers in `owner-confirmation-sheet.md` (OA-08).
2. Counsel's review (J-1, J-2, J-6 to J-10).
3. Hosting built and deployed (`docs/release/legal-pages-hosting.md`; LR-01).
4. LR-03 (teacher deletion) merged; then the deletion pages and Privacy Policy 10.4 updated to match.
5. The path corrections in §2 applied to the other files.
