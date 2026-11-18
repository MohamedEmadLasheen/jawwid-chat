# Official name: **Jawwid** (owner decision, final)

> **Update 2026-11-18, confirmed owner decisions (these supersede earlier drafts in this folder):**
> 1. **Target audience:** children, parents and teachers. 2. **Price:** free to download. 3. **Distribution:** worldwide, in every country where Google Play distribution is available and legally permitted. 4. **App name:** Jawwid. 5. **Category:** Education stays *proposed*, pending final confirmation.
> Earlier text that says "18 and over only", "Families not applicable" or lists a country shortlist is **superseded** and kept only for history. Status labels used below: CONFIRMED DECISION (owner), VERIFIED (an official page as extracted directly states it), UNVERIFIED (not established), COUNSEL/GOOGLE (needs legal or Google approval).
>
> **Listing consequences of the audience decision (CONFIRMED DECISION; wording and imagery still need approval):** Google's rule against appeal-to-children imagery without a declared child audience no longer blocks child-friendly art; the earlier internal rule "no child imagery" is optional now (`verification-part-C.md` R32). The product description must still be honest: it says Jawwid helps parents communicate with their child's teacher and supervisor. Keep one name, **Jawwid**. Free price and worldwide availability are console settings and change no copy. Quran wording remains an open owner decision.


Applied as follows. Nothing in the repository, in iOS configuration, or in any console was changed by this document; the changes in section 2 are listed for separate review and authorization.

## 1. Where the name already is "Jawwid" (verified from the repo and the signed bundle)
| Place | Value | Evidence |
|---|---|---|
| Android launcher label (English) | Jawwid | `android/app/src/main/res/values/strings.xml:6`; `aapt2 dump badging` of the release bundle: `application-label:'Jawwid'` |
| Android launcher label (Arabic) | جَوِّد | `values-ar/strings.xml:5` |
| iOS permission prompts | "Jawwid uses the camera..." etc. | `ios/Runner/en.lproj/InfoPlist.strings` |
| Proposed store copy in PR #591 | The app is called "Jawwid" in the description and in "What's new" ("The first release of Jawwid.") | #591 `listing-copy.md` sections 5 and 7 |
| Google Play title (proposal) | Jawwid (6 of 30 characters) | to be entered by the owner |

## 2. Required changes, for review (not made)
| # | Where | Now | Change to | Needs |
|---|---|---|---|---|
| 1 | `ios/Runner/Info.plist:14-15` `CFBundleDisplayName` | Jawwid Chat | Jawwid | iOS code change, then a new build (3 or later) and upload. Build 2 is already prepared for review, so do this with the next iOS build, not now. |
| 2 | App Store Connect app name | (whatever is entered; check) | Jawwid, if the name is free | Owner, console only; no build needed. Apple expects the store name and the name under the icon to be recognisably the same, and "Jawwid" is in both. |
| 3 | `docs/release/store-console/listing-copy.md` section 1 table (main and #591) | "Jawwid: Quran Academy" / "جَوِّد: أكاديمية القرآن" for App Store and Play | "Jawwid" / "جَوِّد" | Docs PR; #591 is unmerged, so fold into it or a follow-up. |
| 4 | `docs/release/store-console/README.md` (2 occurrences of the old names) | "Jawwid Chat" / "Quran Academy" | "Jawwid" | Docs PR. |
| 5 | `pubspec.yaml:2` description | "Jawwid Chat — the parent and teacher mobile application..." | "Jawwid — ..." | Internal only (not shown to users); optional. |
| 6 | Code comments in `lib/` that say "Jawwid Chat" (bootstrap.dart, router.dart, attachment_opener.dart, currency_digits.dart) | | | Not user-visible; leave. |
| 7 | Privacy policy page title "Jawwid Academy" | | | **Legal text; owner approval only.** It names the operator (Jawwid LLC) and the Service; it does not need to equal the app name. |

The product description may state what Jawwid does: it helps parents communicate with their child's teacher and the academy supervisor (the #591 description already does).

## 3. Quran wording (separate decision, not finalized)
"Quran" appears in: the old store titles (now dropped by this decision), the Play short description ("Live one-to-one Quran lessons, and your family's chat with the teacher."), the Arabic and English descriptions in #591, and the feature graphic tagline. This is religious and educational wording that needs the owner's approval before it is entered in a console or published. Proposed neutral fallback for the short description if the owner prefers not to name the subject in the headline: "Live one-to-one lessons, and your family's chat with the teacher and supervisor." (79 characters; check the limit in the console.) Not entered anywhere.

## 4. Listing draft inputs (from #591, nothing merged)
Use #591's card-free text: Payments section reads "Pay for a lesson package by bank transfer, with the transfer receipt uploaded in the app." and "See your payments and invoices." (`listing-copy.md` line 116-117 on the #591 branch). The current `main` text still says card on Stripe and must not be used.
