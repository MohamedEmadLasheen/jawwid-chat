# Regional availability and differences

Apple App Review, Guideline 2.1 "Information Needed", item 5. Verified on 2026-11-19 against the code of the
submitted build (`2e4127015`).

**Owner's objective:** worldwide distribution from the first release. This replaces the earlier draft position,
"academy markets (GCC and Arab countries), not the US until age assurance", in `store-console/README.md:71`,
`age-rating.md:29,131` and `store-package/CONSOLE-ENTRY.md` §1.4. Those files are superseded on this point.

## 1. What is the same everywhere

| Topic | Fact | Evidence |
|---|---|---|
| Features | Identical in every country. There is no country check, IP-country lookup, allow list or block list anywhere in the app or the API | Code search for `geoip`, `cf-ipcountry`, `allowed_countr`, `sanction` and `embargo` in `lib/` and `apps/api/src`: no matches |
| Content | Identical. The content is the academy's own lessons and the conversations between a family, its teacher and the academy | — |
| Language | Arabic and English, fully translated (1,597 strings each, none missing). The app follows the phone's language; Settings > Language changes it | `lib/l10n/app_*.arb`; `ios/Runner/Info.plist` `CFBundleLocalizations` |
| Registration and access | The same process everywhere. A family enrols with the academy (public page `https://jawwid.com/enroll/`, any country); the academy creates the parent's account; the parent activates it in the app. Teachers are engaged by the academy. Phone numbers are accepted for every country (libphonenumber) | `apps/api/src/platform/auth/parent-signup.*`; `forgot_email_screen.dart` |
| Services | The API is hosted in Frankfurt and serves every country. LiveKit Cloud and APNs are global | `EXTERNAL_SERVICES.md` |
| Payments | Lesson packages are priced per family in any ISO currency. Card payment, when switched on, falls back to bank transfer for currencies the card processor does not support. Card payments are off at launch | `apps/api/src/billing/currency-rules.ts` |
| Encryption | Exempt: `ITSAppUsesNonExemptEncryption = false` (standard HTTPS/TLS and WebRTC only) | `ios/Runner/Info.plist` |

## 2. Required storefront exclusion

| Storefront | Why | Action in App Store Connect |
|---|---|---|
| **China mainland** | Two documented reasons. (1) **Technical:** build 2 links Apple's CallKit framework (`ios/Runner/CallKitBridge.swift`; `UIBackgroundModes` includes `voip`), and Apple does not allow apps that use CallKit on the China mainland storefront. (2) **Legal:** distribution there requires an ICP filing number, which Jawwid does not have. Removing CallKit from the binary would not lift (2) | Pricing and Availability: select every country or region **except China mainland** |

No other storefront requires a restriction for this app. Apple has no storefront for the territories under
comprehensive sanctions, so nothing more is needed for a free download.

## 3. Console steps that are not restrictions

| Region | Step |
|---|---|
| European Union | Complete the **Digital Services Act trader** declaration: Jawwid LLC is a trader, so its address, phone and e-mail appear on the product page. Without it, App Store Connect will not distribute in the EU |

**EU trader checklist** (App Store Connect > Business > your account > Digital Services Act; the owner types every
value; nothing below is filled in for you):

| # | Field | Value to prepare | Note |
|---|---|---|---|
| 1 | Trader status | **Trader** (Jawwid LLC sells lessons as a business) | Choosing "non-trader" would be false |
| 2 | Legal name | Jawwid LLC, exactly as registered | Same as on the legal pages |
| 3 | Address | A business address that is published on the EU product page | Decide whether the registered agent's address may be shown (open item B-ADDR) |
| 4 | Phone number | A business number that can receive Apple's verification code | Shown publicly in the EU |
| 5 | E-mail | A business mailbox that receives Apple's verification code (for example `info@jawwid.com`) | Shown publicly in the EU |
| 6 | Verification | Enter the codes Apple sends to the phone and the e-mail | Until verified, EU storefronts stay unavailable |

## 4. Legal questions for counsel (not App Review blockers)

These do not change the app or its availability today. They are listed so that nothing is presented as settled when
it is not. Owner and counsel decide; this document makes no legal claim.

- **United States:** Jawwid LLC is a US company, so US law applies whatever storefronts are chosen. Questions for
  counsel:
  - Does COPPA apply? Children have no accounts, but parents and the academy provide children's data.
  - Do the state app-store age-assurance laws apply?
- **EU and UK:** GDPR and UK GDPR apply when EU or UK families enrol. The privacy policy (§15) names only GCC law
  today. Counsel should decide whether to add GDPR and UK sections and whether a representative is needed.
- **GCC personal-data laws:** possible registrations or permits, and guardian consent for children's data. A separate
  recorded consent (decision LD-13) is not built yet.
- **Tutoring permits:** local licensing for online tutoring in particular markets has not been analysed.

## 5. Answer for App Review (summary)

Jawwid works the same way in every country where it is available: the same features, the same content, Arabic and
English, the same registration process (enrolment with the academy, then the account), and the same globally
available services. There are no regional feature differences or restrictions in the app. The app is not offered
on the China mainland storefront, because it uses CallKit for incoming calls and Jawwid has no ICP filing.
