# Owner decisions register: Jawwid on Google Play (updated 2026-11-18)

## A. CONFIRMED DECISIONS (owner)
| # | Decision | Date | Notes |
|---|---|---|---|
| D1 | App name: **Jawwid** (Play title, Android launcher, iOS display name) | 2026-11-18 | Required file changes are listed, not made: `NAMING-DECISION-AND-REQUIRED-CHANGES.md` |
| D2 | ~~Target audience: children, parents and teachers~~ **superseded later 2026-11-18 by D2b** | 2026-11-18 | |
| D2b | Primary user is the parent/guardian; children are beneficiaries, not intended direct users. The console age-group declaration is **not** decided: see `LAUNCH-BLOCKERS-AND-GO-NO-GO.md` section 3 (counsel) | 2026-11-18 | Own policy says lessons are designed primarily for ages 5 to 12 (`child-safety-policy-en.md:39`) |
| D3 | Price: free to download | 2026-11-18 | |
| D4 | Distribution: worldwide where Play distribution is available and legally permitted | 2026-11-18 | |
| D5 | Category: Education is **proposed**, final confirmation pending | 2026-11-18 | |

## B. VERIFIED requirements (official Google page, as extracted by WebFetch; not checked against raw HTML; no live-console confirmation)
- Families Policy applies once children are a target audience; no ads means the Families self-certified ad SDK program does not apply; AD_ID absent; no location permission. (Part C)
- Child Safety Standards currently cover anonymous/random chat apps and the Social and Dating categories; Education is not listed. (Part A5, Part C)
- Data safety form is mandatory for a published app; an account-deletion web link and an in-app path are required for any app with accounts. (Part A)
- Foreground-service declaration (description and video per type); full-screen-intent declaration mechanics; 12 testers for 14 days for personal accounts created after 2023-11-13; listing limits and asset specs; country targeting path. (Part B)

## C. UNRESOLVED (no source settles them)
1. **Payments exemption (OPEN).** `verification-part-D.md` section 1. Free installation does not exempt paid services. The explainer page and the policy page differ; bank transfer and showing payment information are unaddressed.
2. Whether Firebase Cloud Messaging, Sentry and LiveKit are acceptable for a child-directed app.
3. Whether the family chat and calls are a "social feature that includes children" (needs an in-app safety reminder and adult-action evidence).
4. Whether a neutral age screen is required (Google ties it to ads).
5. Organization-account exemption from the 12-tester rule, and how to read the account type in the console.
6. First-bundle API upload, video length and hosting rules, service-account permission, Education category rules, Designed for Families eligibility.
7. Quran wording in the title, tagline, descriptions and feature graphic.

## D. NEEDS LEGAL OR GOOGLE APPROVAL
| Item | Who | What to ask |
|---|---|---|
| Play Billing exemption for live one-to-one lessons and bank-transfer payments | Google Play Support, then counsel | Exact written question in `verification-part-D.md` |
| COPPA (US), GDPR Article 8 (EU), UK Children's code, Brazil ECA Digital, India DPDP, other countries | Counsel | Facts in `verification-part-D.md` section 2 |
| Age-group selection in the console; mixed-audience position | Counsel | `verification-part-C.md` section 2 |
| Child data in the Data safety form and privacy policy | Counsel and owner | Gap list rows in Part C |
| Privacy-policy title and wording | Owner (legal approval) | |
| Religious wording | Owner / qualified reviewer | |

## E. Not decided yet but needed for the first Internal testing release
Developer account type and creation date (read in the console); foreground-service video link; full-screen-intent "core functionality" answer; account-deletion URL; decision to use #591's card-free text.
