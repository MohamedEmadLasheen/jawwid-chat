---
document_key: account_deletion_info
title: "Delete your Jawwid account"
language: en
counterpart: account-deletion-ar.md
version: "{{VERSION}}"
draft_revision: "0.2 (2026-11-09)"
effective_date: "{{EFFECTIVE_DATE}}"
status: "DRAFT for qualified legal review. Not published and not in force."
---

# Delete your Jawwid account

**Version** {{VERSION}} · **Effective** {{EFFECTIVE_DATE}} · **Language:** English · [العربية](account-deletion-ar.md)

This page explains how to delete your account in **Jawwid: Quran Academy**, the app of Jawwid Academy, published by {{ENTITY_NAME}}. You do not need the app to delete your account. Section 10 of the Privacy Policy gives the full detail.

## 1. How to delete your account

1.1 **In the app:** Settings → Delete account. You confirm with your password.

1.2 **On the web, without the app:** open the account deletion form at {{ACCOUNT_DELETION_URL}}. Enter your sign-in name and your password, tick that you understand that deletion is final, and press "Delete my account for good".

1.3 **If you cannot sign in:** write to {{PRIVACY_EMAIL}} from the e-mail address on your account and ask us to delete it. We will verify your identity before acting.

1.4 Parents and teachers can delete their own accounts. A staff account is closed by the Academy when the staff member leaves.

1.5 **Teachers:** a teacher cannot delete their account while a future lesson, an assigned student, or this month's or last month's payroll is still open. The app and the form tell you so. Contact the Academy at {{SUPPORT_EMAIL}} so that your students can be moved and your payroll completed.

1.6 Deletion is final and cannot be undone.

## 2. What is deleted at once

2.1 Deletion takes effect immediately. We delete:

(a) your sign-in name, your password, your devices, your push tokens, any pending reset codes and your own notifications; you are signed out everywhere;

(b) your profile photo and "about" text; your name is replaced by "Deleted user" wherever it appears;

(c) the contact details the Academy's staff hold for you (phone, e-mail and region), and the staff note;

(d) your location prompt and your own family contact keys; and

(e) any block you made, and any block made against you.

2.2 For a teacher, we also delete the teacher's phone number, e-mail address, professional profile, certificate files and payout account.

## 3. What is kept, and for how long

3.1 Some records are kept after deletion, because other people rely on them, for the Academy's legal and financial duties, or as evidence.

| Record | How long it is kept |
|---|---|
| Payments, invoices, receipts and payment requests, including the payer's and the child's names | 7 years [legal review] |
| The audit log of staff actions | 7 years [legal review] |
| For a teacher: pay and supervision records, including recorded violations and suspensions | As the Academy's employment records [TO CONFIRM — LD-7] |
| Messages and attachments you sent, shown as from "Deleted user" | For as long as the conversation is kept for the other people in it [TO CONFIRM — LD-7] |
| Your children's records at the Academy (profiles, lessons, lesson reports and rewards), and your family's country and region on the family record | As the Academy's records [TO CONFIRM — LD-6] |
| Reports you made or that were made about you, consent and acceptance records, call records, the support-session log and the whiteboard access log | As evidence and for safety and accountability [TO CONFIRM — LD-7] |
| Feedback you sent to the administration, and the Academy's response | Kept after deletion [TO CONFIRM — LD-7] |
| Records of your Stories and of who viewed them (the Story photos and videos themselves are deleted 72 hours after the Story expires) | Kept after deletion [TO CONFIRM — LD-7] |
| Records of ended sign-in sessions (a keyed hash of the IP address, the user agent and the times) | For security [TO CONFIRM — period] |
| Trial-lesson request details | Not removed by account deletion today; you can ask us to delete them [TO CONFIRM] |
| Encrypted backups, and previous versions of stored files | Encrypted backups up to 56 days, and any additional copy the Academy keeps under its backup procedure until that copy is destroyed [TO CONFIRM]; previous file versions 30 days. Used only to restore the Service after a failure |

3.2 Our service providers keep some records under their own rules, for example our card-payment provider's records of card payments. The Privacy Policy (section 10.7) explains each one.

## 4. Questions

4.1 Privacy questions: {{PRIVACY_EMAIL}}. Other help: {{SUPPORT_EMAIL}} or the [Help and Support](support-en.md) page.

4.2 {{ENTITY_NAME}}, {{ENTITY_ADDRESS}}.

4.3 **Language.** This page is published in Arabic and English with the same meaning. If they conflict, the Arabic version prevails [legal review — LD-17].

> **Drafting note (remove before publication):** This is the static information page for the Google Play "Delete account URL" (Data safety) and Apple's optional User Privacy Choices URL. It names the app as listed and the developer, gives the steps, and lists what is deleted and what is kept, as Google Play requires; the form itself is the API page `GET /api/v1/account-deletion` (`apps/api/src/account-deletion/`), which this page links to through {{ACCOUNT_DELETION_URL}}. Every fact above is from Privacy Policy §10 and must change with it; one addition: "recorded violations and suspensions" in the teacher row is from `data-inventory-and-retention-matrix.md` (Teacher employment records: discipline and pay records kept), which the policy's "supervision records" (§10.4.3) covers but does not name. Three points must be settled before publication: (1) the retention periods marked LD-6 and LD-7, because Google Play asks for the retention period of kept data; (2) teacher deletion: launch item LR-03 (PR #498) turns the teacher block into a deletion request; when it merges, clause 1.5 must describe that instead; (3) the "7 years" has no recorded legal basis yet (L-6).
