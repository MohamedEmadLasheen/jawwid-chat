# Applying the confirmed values (LR-04)

**Draft, 2026-11-09. Builder W4.** Internal; not published. This is for the lead. Once the owner has
answered `owner-confirmation-sheet.md`, apply every value in **one commit**. The values below are the
*proposed* ones. Wherever the owner wrote "change to", use the owner's value instead.

## 1. Rules

1. **Replace tokens only in the files listed.** `README.md`, `public-hosting-requirements.md`,
   `outstanding-information-and-decisions.md`, `owner-confirmation-sheet.md` and this file mention the
   tokens by name. Leave them as they are.
2. **Arabic and English together.** For tokens whose AR value differs, use the AR column in `*-ar.md`.
   Keep the clause numbers identical (`README.md`, "Rules for editing").
3. **Never touch the PD-48 paragraph** (privacy-policy §14, terms-of-use §9).
4. **Arabic joins.** After replacing a token, fix the word before it:
   - `لـ {{GOVERNING_LAW}}` becomes `لقوانين ولاية …`: drop the `ـ` and the space, and attach the `ل`.
     This is in terms-of-use-ar:414, terms-teachers-ar:186 and terms-staff-ar:158.
   - `قبل {{CANCELLATION_NOTICE_HOURS}} ساعة` becomes `قبل ساعتين` when the value is 2. This is in
     terms-of-use-ar:220.
   - `خلال {{COMPLAINT_RESPONSE_DAYS}} يومًا` stays as `خلال 30 يومًا`.
5. **Only after counsel's review (J-10):** delete every `> **Drafting note (remove before publication):** …`
   block, every `[TO CONFIRM …]`, every `[legal review …]` and every `[مراجعة قانونية …]`. Change the
   front matter `status:` to `"Published"`.
6. **J-6 (no DPO):** in privacy-policy-{en,ar}, delete the second sentence of 1.5 and line 18.2, renumber
   18.3–18.7, and check that nothing cites the old numbers.

## 2. Mapping table

"Public" files are in `docs/legal/`. `{en,ar}` means both language files, at the same line numbers.
Line numbers are from `main` on 2026-11-09. After the first replacement, search by token, not by line.

| Token | Value, EN files | Value, AR files | Files |
|---|---|---|---|
| `{{ENTITY_NAME}}` | Jawwid LLC | شركة Jawwid LLC | privacy-policy, terms-of-use, terms-teachers, terms-staff, user-conduct-policy, reporting-and-complaints-policy, blocking-and-enforcement-policy, child-safety-policy, support, account-deletion (all `{en,ar}`) |
| `{{ENTITY_COUNTRY}}` | the State of Wyoming, United States | ولاية وايومنغ بالولايات المتحدة الأمريكية | privacy-policy, terms-of-use, child-safety-policy, support |
| `{{ENTITY_ADDRESS}}` | *(owner: the full Play Console address)* | *(the same, in Latin letters)* | privacy-policy, terms-of-use, child-safety-policy, user-conduct-policy, reporting-and-complaints-policy, blocking-and-enforcement-policy, support, account-deletion |
| `{{ENTITY_REG_NO}}` | *(owner: the Wyoming filing ID)* | *(the same)* | terms-of-use, child-safety-policy, support |
| `{{SUPPORT_EMAIL}}` | support@jawwid.com | support@jawwid.com | privacy-policy, terms-of-use, terms-teachers, user-conduct-policy, reporting-and-complaints-policy, blocking-and-enforcement-policy, child-safety-policy, support, account-deletion; developer-implementation-guide.md; `docs/release/store-console/play-declarations.md`, `README.md` row 14 |
| `{{PRIVACY_EMAIL}}` | privacy@jawwid.com | privacy@jawwid.com | privacy-policy, terms-of-use, terms-teachers, terms-staff, reporting-and-complaints-policy, child-safety-policy, support, account-deletion; developer-implementation-guide.md |
| `{{SAFEGUARDING_EMAIL}}` | safeguarding@jawwid.com | safeguarding@jawwid.com | privacy-policy, terms-of-use, terms-teachers, terms-staff, user-conduct-policy, reporting-and-complaints-policy, blocking-and-enforcement-policy, child-safety-policy, support; app-store-compliance-checklist.md; store-console/play-declarations.md |
| `{{SAFEGUARDING_CONTACT_NAME}}` | the Academy's Child Safety Lead | مسؤول سلامة الأطفال في الأكاديمية | child-safety-policy |
| `{{DPO_CONTACT}}` | *(removed: rule 6)* | *(removed)* | privacy-policy; internal mentions in developer-implementation-guide.md and legal-research-and-compliance-matrix.md stay |
| `{{SUPPORT_URL}}` | https://admin.chat.jawwid.com/legal/en/support | https://admin.chat.jawwid.com/legal/ar/support | privacy-policy, terms-of-use; app-store-compliance-checklist.md; store-console/listing-copy.md (EN block :132, AR block :91), play-declarations.md |
| `{{ACCOUNT_DELETION_URL}}` | https://api.chat.jawwid.com/api/v1/account-deletion?lang=en | https://api.chat.jawwid.com/api/v1/account-deletion | privacy-policy, account-deletion |
| `{{ACCOUNT_DELETION_URL}}` in the store-console drafts | https://admin.chat.jawwid.com/legal/en/account-deletion | — | store-console/google-data-safety.md, play-declarations.md, apple-app-privacy.md |
| `{{PRIVACY_POLICY_URL}}` | https://admin.chat.jawwid.com/legal/en/privacy | https://admin.chat.jawwid.com/legal/ar/privacy | store-console/apple-app-privacy.md, play-declarations.md, listing-copy.md (EN :130, AR :89) |
| `{{TERMS_URL}}` | https://admin.chat.jawwid.com/legal/en/terms | https://admin.chat.jawwid.com/legal/ar/terms | store-console/listing-copy.md (EN :131, AR :90) |
| `{{CHILD_SAFETY_POLICY_URL}}` | https://admin.chat.jawwid.com/legal/en/child-safety | — | store-console/play-declarations.md |
| `{{RATING_CONTACT_EMAIL}}` | support@jawwid.com | — | store-console/age-rating.md |
| `{{SUPPORT_PHONE}}` | *(delete the row's value; leave the field empty)* | — | store-console/play-declarations.md |
| `{{MIN_ACCOUNT_HOLDER_AGE}}` | 18 | 18 | terms-of-use, child-safety-policy (privacy-policy:54 is inside a drafting note) |
| `{{COMPLAINT_RESPONSE_DAYS}}` | 30 | 30 | terms-of-use, reporting-and-complaints-policy, blocking-and-enforcement-policy, support |
| `{{NOTICE_DAYS}}` | 30 | — | developer-implementation-guide.md |
| `{{CANCELLATION_NOTICE_HOURS}}` | 2 | ساعتين (rule 4) | terms-of-use |
| `{{GOVERNING_LAW}}` | the laws of the State of Wyoming, United States | قوانين ولاية وايومنغ بالولايات المتحدة الأمريكية (rule 4) | terms-of-use, terms-teachers, terms-staff |
| `{{DISPUTE_FORUM}}` | the competent courts of the State of Wyoming, United States | المحاكم المختصة في ولاية وايومنغ بالولايات المتحدة الأمريكية | terms-of-use, terms-teachers, terms-staff |
| `{{REFUND_RULES}}` | *(J-3 text, EN)* | *(J-3 text, AR)* | terms-of-use, blocking-and-enforcement-policy |
| `{{EMERGENCY_CONTACTS}}` | the emergency number in your country | رقم الطوارئ في بلدك | child-safety-policy, reporting-and-complaints-policy, support |
| `{{CHILD_PROTECTION_REPORTING_LINES}}` | the police or the child-protection authority where you live | الشرطة أو جهة حماية الطفل في بلد إقامتك | child-safety-policy |
| `{{VERSION}}` | 1.0 | 1.0 | every public document (front matter, header, privacy-policy version history) |
| `{{EFFECTIVE_DATE}}` | *(publication date, YYYY-MM-DD)* | *(the same)* | every public document |

## 3. Outside the documents (the same values)

| Where | Setting | Value |
|---|---|---|
| `scripts/mobile/build-store.sh` environment | `PRIVACY_POLICY_URL` | `https://admin.chat.jawwid.com/legal/{lang}/privacy` |
| | `TERMS_URL` | `https://admin.chat.jawwid.com/legal/{lang}/terms` |
| | `SUPPORT_URL` | `https://admin.chat.jawwid.com/legal/{lang}/support` |
| | `SUPPORT_EMAIL` | `support@jawwid.com` |
| | `API_BASE_URL` | `https://api.chat.jawwid.com/api/v1` |
| Terms gate (`chat.publish_legal_version`, LR-02d) | `url_ar` / `url_en` | the **versioned** paths, e.g. `https://admin.chat.jawwid.com/legal/ar/terms/1.0` and `…/en/terms/1.0` (`public-hosting-requirements.md` §2) |
| Consoles | URL fields | `docs/release/legal-pages-hosting.md` §3.1 |

## 4. Checks in the same PR

- Search `docs/legal/*-en.md`, `docs/legal/*-ar.md` and `docs/release/store-console/` for `{{`. Nothing may
  remain except the review credentials, `{{FGS_VIDEO_URL}}` and `{{PAYMENTS_TAB_NAME}}`.
- Each pair has the same clause numbers, and the PD-48 paragraph is unchanged in both languages.
- Every e-mail address above has received a test message.
- After the deploy, run `public-hosting-requirements.md` §5.
