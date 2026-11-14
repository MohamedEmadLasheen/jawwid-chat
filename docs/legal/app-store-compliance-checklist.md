# App store compliance checklist: Google Play and the Apple App Store

**Version 0.1 (draft), 2026-11-06.** Google and Apple requirements were researched on 2026-11-06 from their official pages, cited below. Some long pages were read through a summary, so before submission the key clauses are **re-read against the live page**: Google UGC, Apple 1.2 and Apple 5.1.1(v).

These are **store requirements, not law**. The legal obligations are in `legal-research-and-compliance-matrix.md`.

> **Not store-ready.** The app cannot be submitted until:
> - every document in this package has been legally reviewed and published at public URLs;
> - the URLs are configured in the store build;
> - the in-app terms gate (ENG-10 to ENG-12) is merged.
>
> **Store readiness today:** `docs/release/store-readiness-2026-11-03.md` records the App Store as NO-GO. `docs/release/google-play-readiness-2026-11-03.md` records the Play blockers.

**Status key**
- ✅ built on `main` (with the evidence path);
- 🟡 in progress or partly built;
- ⛔ missing;
- 📄 this package covers it in writing;
- 👤 the owner must provide or decide.

---

## 1. Decisions that change the answers (decide first)

| # | Question | Effect | State |
|---|---|---|---|
| Q-A | Is the **target audience** adults (parents) only, or does it include children? Children use the app on the parent's device for lessons. | **Google:** including the 5–12 age groups brings in the **Families policy** (G-6 to G-10). **Apple:** guideline 5.1.4 applies to an app that collects children's data whether or not the Kids Category is chosen. `google-play-readiness-2026-11-03.md` recommends declaring 18+ account holders. Counsel must check this against how children actually use the lessons. | 👤 N-1 / LD-5 |
| Q-B | Can a child send chat messages? | No child accounts exist, but a child could use the parent's signed-in device. If children are in the audience, Google's Families "social features" rules apply: a safety reminder before sharing, and an adult action before personal information is shared. | 👤 LD-5 |
| Q-C | Are lessons recorded or replayable? | **No** (code: no LiveKit egress). This keeps Google's one-to-one service exemption and Apple 3.1.3(d). | ✅ |
| Q-D | Are any group lessons sold in the app? | **No.** Only one-to-one live lesson packages are payable in the app (owner, 2026-11-05; `apps/api/src/billing/in-app-payability.ts`). | ✅ |
| Q-E | Is the app distributed in the US (Texas, Utah, Louisiana) or Brazil? | If yes, the app-store age laws and age-signal APIs come into scope (§4). | 👤 LD-15 |
| Q-F | Apple Kids Category? | **Recommendation: do not choose it.** The app is operated by the parent, takes payments, and uses Sentry. The Kids Category restricts third-party analytics and links and needs a parental gate. Also: "For Kids" and "For Children" in metadata are reserved for the Kids Category (Apple 2.3.8). | 👤 |

---

## 2. Google Play

**Sources:**
- UGC: https://support.google.com/googleplay/android-developer/answer/9876937
- Child Safety Standards: https://support.google.com/googleplay/android-developer/answer/14747720
- Families: https://support.google.com/googleplay/android-developer/answer/9893335
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Photo and video permissions: https://support.google.com/googleplay/android-developer/answer/14115180
- Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Payments FAQ: https://support.google.com/googleplay/android-developer/answer/10281818

### 2.1 User-generated content (UGC)

| # | Requirement | Written policy | In the app | Play Console | State |
|---|---|---|---|---|---|
| G-1 | Users accept terms that **define objectionable content** and prohibit it, before they create or upload UGC | 📄 Terms of Use §acceptance; Code of Conduct (defined list of prohibited content) | Terms gate before first post (ENG-10/11/12); sign-up checkboxes. **A checkbox alone is not enough:** the server must refuse content routes without acceptance (`@RequiresLegal`) | — | 🟡 #462 (model), ENG-10 to ENG-12 not built |
| G-2 | **In-app reporting** of users and content. This applies even to closed communities | 📄 Reporting and Complaints Policy | ✅ PD-57: report on a message or a user; five reasons | — | ✅ `lib/features/moderation/` |
| G-3 | **Blocking** where users interact one to one | 📄 Blocking, Suspension and Enforcement Policy | ✅ PD-57 block, enforced on the server, with the educational exceptions | — | ✅ |
| G-4 | **Ongoing moderation** and action against violators; safeguards "particularly toward minors" | 📄 Enforcement Policy; Reporting Policy (24-hour response) | ✅ Admin moderation queue, resolutions, suspension. ⛔ No appeal workflow (LD-10). ⛔ No pre-posting filter (LD-12) | — | 🟡 |
| G-5 | **Child Safety Standards**: published standards, in-app feedback, CSAM handling, compliance with law, a named contact. Scope: social, dating, and anonymous chat apps. An Education app **appears out of scope** (unverified how Google treats education apps with one-to-one chat) | 📄 Child Safety Policy, written to serve as the published standards | ✅ Reporting with a child-safety reason | Declare it only if in scope. Prepare the URL and the contact anyway | 📄 / 👤 {{SAFEGUARDING_EMAIL}} |

### 2.2 Families policy (if the target audience includes children: Q-A)

| # | Requirement | State |
|---|---|---|
| G-6 | Honest target-audience declaration. A mixed audience needs a neutral age screen | 👤 N-1 |
| G-7 | No advertising ID, IMEI or other device identifiers; no precise location | ✅ No ads or analytics; Firebase Messaging only, no Analytics (`android/app/build.gradle.kts`). **Check the merged manifest has no `AD_ID` permission** (release audit WP-6) |
| G-8 | Only SDKs approved for child-directed services; ads only through Families Self-Certified SDKs | 🟡 No ads. Sentry, LiveKit, Stripe and FCM must each be checked against their terms for child-directed use (L-15) |
| G-9 | Social features: a safety reminder before sharing, adult controls, and an adult action before personal information is exchanged | 👤 LD-5. If children are in scope, add the reminder and treat the parent's sign-in and app lock as the "adult action" (counsel to confirm) |
| G-10 | Comply with children's privacy law | 📄 Privacy Policy §6; Child Safety Policy. 🟡 parental consent record (LD-13) |

### 2.3 User data, privacy and deletion

| # | Requirement | Written policy | In the app | Play Console | State |
|---|---|---|---|---|---|
| G-11 | **Privacy policy:** linked in the Console and in the app; public; not geofenced; not a PDF; labelled; includes contact details, data collected and shared, and retention and deletion | 📄 Privacy Policy (§1, §4, §10, §11) | ✅ Links on sign-in, sign-up and Settings (`lib/core/legal/legal_links.dart`), **if the URL is set at build** | Privacy policy URL | 🟡 URL pending (LD-16) |
| G-12 | **Prominent disclosure** before runtime permissions where use is unexpected | — | Microphone (calls, voice notes) and notifications: check that the in-app explanation comes before the system prompt (WP-5, #411) | — | 🟡 |
| G-13 | **Data safety form**, consistent with the policy and including SDKs | `data-inventory-and-retention-matrix.md` §2–§3 is the input | — | Data safety | 👤 Fill in from the matrix (§5 below) |
| G-14 | **Account deletion:** an in-app path, plus a **web resource** to request deletion without reinstalling; disclose retained data | 📄 Privacy Policy §10 | ✅ Settings → Delete account; ✅ web page `/account-deletion` (`account-deletion.controller.ts`). ✅ Teachers with open lessons request deletion in the app and are deleted within 30 days (O-3, 2026-11-07; `docs/release/app-review-notes-account-deletion.md`). Google allows retention for legitimate reasons; the policy discloses it | Deletion URL | 🟡 URL choice (H-3) |
| G-15 | Photo and video permissions: use the system picker | — | Check the merged manifest (release audit) | Declaration only if they are kept | 🟡 |

### 2.4 Payments

| # | Requirement | State |
|---|---|---|
| G-16 | A one-to-one online service between two individuals, not replayable, may use other payment methods (FAQ answer/10281818). Group lessons or replayable content would lose this | ✅ Only one-to-one live packages are payable in the app; no recording. The question "two individuals" when the academy employs the teacher is unverified (`docs/release/app-review-notes-payments.md`) |

### 2.5 Listing and forms

- 👤 Organization developer account (A-7).
- 👤 Final package name (N-2).
- 👤 Content rating (IARC): answer that users interact and share content.
- 👤 Target audience (N-1).
- 👤 Data safety (G-13).
- 👤 Demo accounts: parent, teacher and staff.
- 👤 Full-screen intent declaration (`USE_FULL_SCREEN_INTENT`, roadmap §3).

---

## 3. Apple App Store

**Sources:**
- Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app
- App Privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Age ratings: https://developer.apple.com/news/?id=ks775ehf and https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/
- Privacy manifests: https://developer.apple.com/news/?id=3d8a9yyh
- Age assurance: https://developer.apple.com/support/age-assurance/

| # | Guideline | Written policy | In the app | App Store Connect | State |
|---|---|---|---|---|---|
| AP-1 | **1.2 UGC:** a **filter** for objectionable material; **reporting** with timely responses; **blocking** abusive users; **published contact information** | 📄 Code of Conduct; Reporting Policy (24 h); Enforcement Policy | ✅ Report, ✅ Block. ⛔ **Filter: none** (LD-12). Proposal: a server-side word list plus staff review (guide §3.3 MG-3). ⛔ Contact information in the app (P-5) | Review notes explaining moderation | 🟡 **Filter and contact info are submission risks** |
| AP-2 | 1.3 Kids Category (optional) | — | — | Category | 👤 Recommendation: not chosen (Q-F) |
| AP-3 | 2.3.8: "For Kids" / "For Children" in metadata is reserved | — | — | Name, subtitle, description: describe it as for families and parents | 👤 |
| AP-4 | **5.1.4 Kids:** applies to any app that collects data from minors (chat, photos, identifiers); a privacy policy; comply with children's privacy law; a parental gate is **not** parental consent | 📄 Privacy Policy §6; Child Safety Policy | Parent-created child profiles ✅. Consent record 🟡 (LD-13) | — | 🟡 |
| AP-5 | **5.1.1(i)** privacy policy link in App Store Connect **and** in the app; what is collected, how, and its uses; third parties give equal protection; retention and deletion; how to withdraw consent | 📄 Privacy Policy §4, §10, §11, §13 | ✅ Links (if set) | Privacy Policy URL | 🟡 LD-16 |
| AP-6 | 5.1.1(ii)–(iii): consent; purpose strings; data minimisation; the out-of-process picker | — | Check `ios/Runner/Info.plist` purpose strings, in Arabic and English (release audit) | — | 🟡 |
| AP-7 | **5.1.1(v) account deletion** in the app: delete the account record and personal data; deactivation is insufficient; say how long it takes | 📄 Privacy Policy §10 (immediate; backups up to 56 days) | ✅ Settings → Delete account. 🟡 Teachers with open lessons are referred to the academy. Apple allows retention where required; explain this in the review notes | Review notes: the path | 🟡 |
| AP-8 | 5.1.2: no sharing without permission | 📄 Privacy Policy §11 (no sale; processors only) | — | — | 📄 |
| AP-9 | **App Privacy details** (labels), including SDK data | Matrix §2–§3 | — | App Privacy questionnaire | 👤 (§5) |
| AP-10 | **Privacy manifest** and required-reason APIs | — | `ios/Runner/PrivacyInfo.xcprivacy` exists (no tracking). Generate Xcode's privacy report on the archive. Check that the Flutter plugins ship manifests. DEV-CONFIRM #17 (phone number collected by staff) | — | 🟡 |
| AP-11 | **1.5 Support URL** with an easy way to contact | `public-hosting-requirements.md` | Support e-mail and link in Settings (P-5) | Support URL | ⛔ 👤 {{SUPPORT_URL}} |
| AP-12 | **3.1.3(d)** person-to-person services between two individuals may use other payment methods; one-to-few must use in-app purchase | — | ✅ One-to-one only | Review notes (`docs/release/app-review-notes-payments.md`) | ✅ |
| AP-13 | 4.8 login services | — | Not applicable (no social login) | — | ✅ |
| AP-14 | **Age rating questionnaire** (4+, 9+, 13+, 16+, 18+): "Messaging and Chat" = yes; declare parental controls if any | — | — | Age rating | 👤 |
| AP-15 | Sign-in demo accounts and review notes | — | — | Review notes | 👤 N-6 |

---

## 4. Age-assurance laws and store APIs (2025–2026)

Relevant **only** if the app is distributed in those territories (Q-E).

| Item | Detail | Source |
|---|---|---|
| Apple Declared Age Range API and PermissionKit | Where the law requires: check the age; get parental consent for significant changes; handle consent revocation | https://developer.apple.com/support/age-assurance/ |
| Texas SB 2420 | Apple: from 4 June 2026 (litigation ongoing) | https://developer.apple.com/news/?id=8jzbigf4 |
| Utah, Louisiana | Apple dates: 6 May 2026 and 1 July 2026 (Utah unverified) | https://developer.apple.com/news/?id=f5zj08ey |
| Google Play Age Signals API (beta) | Age range and parental approval | https://support.google.com/googleplay/android-developer/answer/16569691 |

**Recommendation:** at first launch, limit distribution to the target markets (GCC and other Arab countries) unless the owner decides otherwise (LD-15).

---

## 5. Data declarations (input for Google's Data safety form and Apple's App Privacy)

Engineering's draft is below. The owner fills in the forms, after DEV-CONFIRM items #6 and #17 are answered.

| Data type (store wording) | Collected? | Linked to the user? | Purpose | Shared with a third party? | Source in the matrix |
|---|---|---|---|---|---|
| Name | Yes | Yes | App functionality | Stripe (the child's name in the payment line item, LD-8) | §3 |
| E-mail address | Yes | Yes | Account management | E-mail provider (codes) | §3 |
| Phone number | Yes (typed by staff) | Yes | App functionality | WhatsApp: activation codes relayed by the family's supervisor today, and automated recovery codes if enabled | §3; DEV-CONFIRM #17 |
| Approximate location (country and region typed by the user) | Yes | Yes | App functionality | No | §3, PD-45. **Declare it as "address" or approximate location: decide with counsel (no device location)** |
| Messages | Yes | Yes | App functionality | No (processors only) | §3 |
| Photos and videos | Yes | Yes | App functionality | No | §3 |
| Audio (voice notes) | Yes | Yes | App functionality | No | §3. Live call audio is relayed, not stored |
| Files and documents | Yes | Yes | App functionality | No | §3 |
| Purchase history | Yes | Yes | App functionality | Stripe | §3 |
| Payment info | **No** (entered with Stripe) | — | — | — | §2 |
| Crash logs and diagnostics | Yes | Hashed id (counsel: "linked" or "not linked") | Analytics/diagnostics | Sentry (processor) | §2 |
| Device or other IDs (push token) | Yes | Yes | App functionality | Apple, Google (push delivery) | §2 |
| Advertising data, tracking | **No** | — | — | — | §2 |
| Precise location, contacts, health, browsing history | **No** | — | — | — | §2 |

**Data encrypted in transit:** yes (https and TLS). **Users can request deletion:** yes.

---

## 6. Evidence pack for submission (to assemble)

1. Screenshots: sign-up with the terms, Code of Conduct and PD-48 checkboxes; the legal gate; Report; Block; Settings → Delete account; Settings legal links and support contact.
2. A demo video of report → moderation queue → resolution → reporter answered (#479 end-to-end).
3. The live URLs of every document, in Arabic and English, checked without signing in (`public-hosting-requirements.md` §5).
4. Review notes:
   - payments under 3.1.3(d) (existing draft);
   - moderation and the 24-hour response;
   - the filter approach;
   - account deletion and what is retained;
   - no recording;
   - children use the app under the parent's account.
5. The merged-manifest and privacy-report outputs from the release audit (WP-6).
