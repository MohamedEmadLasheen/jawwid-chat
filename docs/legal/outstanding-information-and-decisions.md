# Outstanding information and decisions

**Version 0.1 (draft), 2026-11-06.** This is the single register of everything that blocks publication of the legal package. It contains:
- §1 placeholders;
- §2 owner decisions (LD-n);
- §3 items for qualified legal review (L-n);
- §4 developer confirmations (pointer to DEV-CONFIRM);
- §5 engineering proposals (P-n);
- §6 hosting decisions (H-n);
- §7 blockers before publication and submission.

**Numbering.** Owner decisions in this package are **LD-n**. They are distinct from the PD-57 closure plan's D-1 to D-6, from the roadmap's A-n and N-n, and from the store checklist's Q-n. Where a store or roadmap decision is the same question, both IDs are given.

---

## 1. Placeholders to fill (identical tokens in every document)

| Token | Meaning | Where | Owner of the answer |
|---|---|---|---|
| `{{ENTITY_NAME}}` | The legal entity that operates Jawwid Academy and is the data controller | All documents | Owner (LD-1) |
| `{{ENTITY_COUNTRY}}` | Its country of registration | Privacy Policy §1; Terms | Owner (LD-1) |
| `{{ENTITY_REG_NO}}` | Commercial registration or licence number (UAE Decree-Law 14/2023 Art. 6; KSA E-Commerce Law Art. 6) | Terms; support page | Owner (LD-1) |
| `{{ENTITY_ADDRESS}}` | Registered address | Privacy Policy §1; Terms | Owner (LD-1) |
| `{{SUPPORT_EMAIL}}` | Support and complaints mailbox | All | Owner |
| `{{PRIVACY_EMAIL}}` | Privacy-requests mailbox | Privacy Policy; Staff Terms | Owner |
| `{{SAFEGUARDING_EMAIL}}` | Child-safety mailbox | Child Safety Policy; Teacher Terms; Reporting Policy | Owner (LD-19) |
| `{{SAFEGUARDING_CONTACT_NAME}}` | The named child-safety point of contact (Google Child Safety Standards) | Child Safety Policy | Owner (LD-19) |
| `{{DPO_CONTACT}}` | Data protection officer, where required (Oman Art. 20; possibly KSA and UAE) | Privacy Policy §1 | Owner and counsel (LD-14) |
| `{{SUPPORT_URL}}` | The public support page | Terms; store listing | Owner (H-5) |
| `{{ACCOUNT_DELETION_URL}}` | The public deletion page | Privacy Policy §10 | Owner (H-3) |
| `{{GOVERNING_LAW}}` | Governing law | Terms | Owner and counsel (LD-2) |
| `{{DISPUTE_FORUM}}` | Courts or forum (never forced arbitration for consumers) | Terms | Owner and counsel (LD-2) |
| `{{REFUND_RULES}}` | The academy's refund rules, on top of statutory rights | Terms of Use §14 | Owner (LD-4) |
| `{{CANCELLATION_NOTICE_HOURS}}` | Notice needed to cancel or move a lesson without using it up | Terms of Use §10 | Owner (LD-4). No notice rule exists in code yet |
| `{{MIN_ACCOUNT_HOLDER_AGE}}` | Minimum age of the account holder (proposed 18) | Terms of Use | Owner (LD-5) |
| `{{COMPLAINT_RESPONSE_DAYS}}` | Response time for complaints that are not reports | Reporting Policy; Terms | Owner (LD-18) |
| `{{NOTICE_DAYS}}` | Advance notice of material changes | Terms; guide §2.3 | Owner and counsel (L-7) |
| `{{EMERGENCY_CONTACTS}}` | Emergency numbers per country | Child Safety Policy; Reporting Policy | Counsel (L-8). Never guessed |
| `{{CHILD_PROTECTION_REPORTING_LINES}}` | National child-protection reporting lines per country | Child Safety Policy | Counsel (L-8) |
| `{{VERSION}}`, `{{EFFECTIVE_DATE}}` | Set at publication | All | Owner (guide §2.2) |

## 2. Owner decisions (LD-n)

Each row gives a **recommendation**, so the decision can be a yes or a no.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **LD-1** | The legal entity, its country, registration number, address and contact mailboxes | Required. This is a business fact that engineering cannot infer | Publication of every document |
| **LD-2** | Governing law and dispute forum | The law of the entity's country. The courts of that country, without prejudice to the consumer's rights in their country of residence. **No arbitration for consumers** (UAE Decree-Law 14/2023 Art. 9(2)(b), contracts under AED 50,000) | Terms |
| **LD-3** | Support sessions (PD-21): tell the user? Require a second approval? | **Tell the user**: a notice in the Notification Center after each session, with the date and a reason category (guide §4.3 S-1). Logging and time limits are enough without a second approval. A monthly Super Admin review | Privacy Policy §9 (it describes today's behaviour honestly either way) |
| **LD-4** | Refund, cancellation and lesson-notice rules | Owner policy. It must keep the KSA 7-day cancellation of an unused service (E-Commerce Law Art. 13), the refund for a delay of more than 15 days (Art. 14), and the UAE refund for a non-conforming service (Decree-Law 14/2023 Art. 7) | Terms of Use §10, §14 |
| **LD-5** | Target audience and minimum account-holder age (= roadmap N-1, store Q-A and Q-B) | Account holders 18 and over; children use the app only under the parent's account. Counsel to confirm against Google's Families policy, given that children take part in lessons | Store forms; Terms |
| **LD-6** | Children's records when the last parent deletes their account (kept today: "the academy's records") | Keep only what a retention period requires (lesson and payment history). Delete the photo and the about text at once. Anonymise the child's name after the retention period (guide §4.4 E-4) | Privacy Policy §10; Child Safety Policy |
| **LD-7** | Retention periods for messages, call records, lesson records, reports, the audit log, support-session logs, sessions, feedback and payments (no purge exists) | Set a period per category with counsel (L-6). Until then the Privacy Policy says "until the account is deleted, then as set out" and marks it TO CONFIRM | Privacy Policy §10.8 |
| **LD-8** | The child's name in the Stripe payment line item (`checkout.service.ts:129`) | **Remove it**, and use the lesson package label only. It is the only place a child's name reaches a third party | Privacy Policy §4.11, §11 |
| **LD-9** | How access and export requests are answered | Phase 1: a manual, logged procedure within 30 days (guide §4.6) | Privacy Policy §13 |
| **LD-10** | Appeals of enforcement decisions | Phase 1: by e-mail within 14 days, reviewed by someone not involved in the decision. Phase 2: in the app (guide §3.3 MG-2) | Enforcement Policy; Terms |
| **LD-11** | May a user who has not accepted the terms still file a **child-safety** report? | **Yes.** Gate every other report reason (guide §3.3 MG-1) | ENG-10 |
| **LD-12** | Pre-posting content filter (Apple 1.2) | A server-side word list in Arabic and English, plus staff review of reported images (guide §3.3 MG-3) | Apple submission |
| **LD-13** | A separate, recorded parental consent for processing children's data, including religious-course data | **Yes**, through the existing parent-notice acknowledgement with a new key, at activation and once for existing families (guide §4.9a) | Child Safety Policy §3; Privacy Policy §6 |
| **LD-14** | Regulatory filings before serving each market: SDAIA registration and authorised representative (KSA); MTCIT permit for religious data and a DPO (Oman); permission for special-nature data (Qatar); a DPO (UAE, if required) | Counsel to confirm each one before that market is served (legal matrix §3) | Serving those markets |
| **LD-15** | Accept families resident in the US, EU or UK? | Not at launch. Limit store distribution to the target markets | COPPA / GDPR scope; store age-law APIs |
| **LD-16** | The public host for the legal pages (= H-1) | `public-hosting-requirements.md` §2 | Publication |
| **LD-17** | Which language prevails | Arabic prevails for consumers in Arabic-speaking markets. Counsel to confirm (L-3) | Terms §23 and every policy's language clause |
| **LD-18** | Response time for complaints that are not reports | For example 5 working days to acknowledge, 30 days to resolve. Owner's call | Reporting Policy |
| **LD-19** | The child-safety designate, their deputy, the mailbox, staff vetting (background checks) and training frequency | Owner policy. The Child Safety Policy promises nothing that is not decided (`docs/security/child-safety-escalation.md` placeholders) | Child Safety Policy §8–§10 |
| **LD-20** | The final wording of the report-reason labels (= roadmap N-4) | The draft labels are in `lib/l10n/app_*.arb` | Reporting Policy |
| **LD-21** | Liability cap in the Terms of Use (the draft proposes the fees paid in the previous 12 months) | Counsel to confirm against mandatory consumer law (L-2) | Terms of Use |
| **LD-22** | Rules drafted without code behind them: recording (lead's draft rule: nobody records a lesson or call without the Academy's prior written permission, and teachers and staff never do); no sending personal data to AI tools; communication hours | Keep them as conduct rules, enforced by report and moderation. Confirm the recording rule (families sometimes want recordings for revision) | Code of Conduct; Terms |

## 3. Items for qualified legal review (L-n)

Every document is a draft for qualified counsel. These points need a specific opinion:

| # | Item |
|---|---|
| L-1 | Re-check the UAE PDPL executive regulations (not issued as of the last sources), and update transfers, breach timing, the DPO and deadlines |
| L-2 | Liability limits and disclaimers against mandatory consumer law in each market (UAE Federal Law 15/2020 and Decree-Law 14/2023; KSA E-Commerce Law; Qatar Law 8/2008; Kuwait Law 39/2014; Bahrain Law 35/2012; Oman Royal Decree 66/2014) |
| L-3 | Language precedence, and any Arabic-language requirement (UAE Cabinet Resolution 66/2023 Arts. 8 and 25; Saudi practice) |
| L-4 | Each processor's role (processor or independent controller: Stripe in particular), the DPAs, and the transfer mechanisms. These include the SDAIA standard contractual clauses (unmodified), the Oman transfer assessment and approval for sensitive data, and the UAE PDPL Arts. 22–23 |
| L-5 | The strictest deadline for data-subject requests (KSA 30 days, extendable; Oman 45 days; UAE pending). The package uses 30 days |
| L-6 | Statutory retention periods for financial and tax records, and for employment records, in the entity's country (the "7 years" stated in the code has no recorded legal basis) |
| L-7 | Notice period for material changes, and whether re-acceptance is valid consent in each market |
| L-8 | Child-safety reporting duties per country (UAE Wadeema Art. 42 and Decree-Law 26/2025; KSA Child Protection System; others); emergency numbers; reporting lines; evidence preservation and "do not tip off" rules |
| L-9 | What evidence of electronic acceptance is enough (the record has version, time, client and locale; no IP address) under each electronic-transactions law |
| L-10 | Whether a DPIA is required (KSA for minors' data; Qatar for special-nature data), and its content |
| L-11 | The Saudi draft amendment to the Implementing Regulation Art. 23 (storage in the Kingdom): status, and its effect on hosting in the EU |
| L-12 | Whether Kuwait's CITRA regulation reaches an app provider such as Jawwid (24-hour breach notice) |
| L-13 | Whether academy announcements (Stories) are "marketing" under Oman Art. 22 and similar rules |
| L-14 | Whether consent to process children's or sensitive data may be bundled with the terms (recommendation: separate, LD-13) |
| L-15 | Whether each SDK's terms (Sentry, LiveKit, Stripe, Firebase Cloud Messaging) permit child-directed use (Google Families policy) |
| L-16 | Religious-content clauses in the Code of Conduct (respectful handling of the Quran; no sectarian attacks). These also need review by the academy's qualified religious authority |
| L-17 | Whether the Child Safety Policy's wording on co-operating with authorities and preserving evidence is lawful in each market |

## 4. Developer confirmations

The full list, with evidence, is `data-inventory-and-retention-matrix.md` §6, DEV-CONFIRM #1 to #18. Further ones raised while drafting:

| # | Question |
|---|---|
| 19 | Confirm in `apps/api/src/moderation/` that the reported person is never shown who reported them, and that a test covers it |
| 20 | Can a parent withdraw certificate Story consent in the app, or only through staff? (`chat.certificate_story_consent` is entered by staff) |
| 21 | Is there an automatic renewal anywhere, including in Jawwid Core? The draft Terms say renewal happens only when the parent pays a new request |
| 22 | `SUBSCRIPTION_LOCK_ENFORCED` is off in production: the Terms say bookings "may" pause. Confirm the plan |
| 23 | Do teachers have the block action in the app? The policies say parents and teachers can block |
| 24 | Exactly which fields a teacher sees in a student profile |
| 25 | Is the `/account-deletion` page served in Arabic and English, and reachable on the production API host? |
| 26 | **The app cannot report the official account, a department manager or the Super Admin**: the API refuses (`isProtectedSubject`, `people.ts`; `reports.service.ts`). Yet the app's `blockErrorNotAllowed` string says "You can report them instead", which contradicts it. The policies send these concerns to {{SUPPORT_EMAIL}} and {{SAFEGUARDING_EMAIL}}. **Fix the string, or allow reports about staff routed to the Super Admin** (owner decision; Apple 1.2 and Google UGC expect user reports to be possible) |
| 27 | **The A-4 lesson-pause message is not built anywhere.** A suspended account also cannot sign in, so it cannot see an in-app message. Decide the channel (e-mail, WhatsApp by staff, or a notice to the other parent) |
| 28 | The reporter sees a status (Received, Being reviewed, Resolved, Closed) and a free-text answer of up to 1,000 characters, not an outcome category. The policies say so; confirm this is the intended long-term design |
| 29 | Blocks are deleted when either party erases their account; a reporter's erasure anonymises the reporter link and keeps the report. Confirm both are intended |
| 30 | The warning text in migration `20261106130000` is marked as draft copy. The owner must approve it (with N-4) |
| 31 | The app's Delete-account screen tells teachers that payroll records are kept "for 7 years". The erasure migration states 7 years only for payments, invoices, receipts and the audit log. Align the screen, the migration header and the Privacy Policy once LD-7 and L-6 are decided |
| 32 | Production value of `TEACHER_SUPERVISOR_STRICT_SCOPE` (`apps/api/src/platform/teacher-scope.ts`). Off means a teacher supervisor reaches **every** teacher, not only their own. The policies say "within the scope the Academy sets" until this is confirmed |
| 33 | **Internal staff notes in conversations** (`Visibility = {customer, internal}`, `vocab.ts`): confirm their retention, and that an access request includes them. The Privacy Policy §4.9 now discloses them |
| 34 | **A support session can read the person's own list of reports and of blocked people** (every GET is allowed). A staff member who was reported could see that a report exists. Consider refusing `GET /me/reports` and the blocks list in a support session |
| 35 | Production values of `SUBSCRIPTION_LOCK_ENFORCED` and of WhatsApp sending; whether the account-deletion page is in both languages (with #25) |

## 5. Engineering proposals (P-n, for the lead; nothing is changed by this package)

| # | Proposal | Where |
|---|---|---|
| P-1 | Fingerprint the published text (SHA-256) in `chat.legal_document_version` | Guide §1.3; PR #462 or ENG-10 |
| P-2 | Record the acceptance method (`signup` or `gate`) | Guide §1.3 |
| P-3 | `requires_reacceptance` per version | Guide §1.3 |
| P-4 | No IP address or user agent in the acceptance record | Guide §1.3 |
| P-5 | Support URL and e-mail as build settings, shown in Settings | Guide §6 |
| P-6 | A **terminal account state** ("closed", never reactivated except by the Super Admin) and a sign-up deny-key for closed accounts. Today only suspend and reactivate exist, any Operations member can reactivate a family, and an erased e-mail can sign up again. The policies promise "closed indefinitely" as an Academy commitment until this is built | Enforcement Policy; Child Safety Policy |
| P-7 | Refuse `GET /me/reports` and the blocked-people list inside a support session (DEV-CONFIRM #34) | Guide §4.3 |

## 6. Hosting decisions (H-n)

These are in `public-hosting-requirements.md` §6: H-1 the host, H-2 the paths, H-3 the deletion URL, H-4 Staff Terms in navigation, H-5 the support page.

## 7. Blockers before publication, and before store submission

**Publication of the documents is blocked by:**

0. **PR #462 merged, with ENG-10 to ENG-12.** The Terms and the Code of Conduct describe acceptance being recorded with version and time, and that is not on `main` yet.
1. LD-1 and LD-2: the entity, contacts and governing law.
2. Qualified legal review of every document in both languages (the L-items).
3. LD-4: the refund and cancellation rules (Terms of Use).
4. LD-19: the child-safety contact (Child Safety Policy).
5. LD-16 / H-1: a public host. **Nothing is hosted yet. No URL exists.**
6. All drafting notes and placeholders removed (`public-hosting-requirements.md` R-11).

**Store submission is also blocked by:**
7. The terms gate (#462, then ENG-10 to ENG-12). Without it, the UGC requirement "accept the terms before posting" is not met.
8. Apple 1.2: the filter (LD-12) and published contact information (P-5).
9. N-1 / LD-5: the target audience; then Data safety and App Privacy (`app-store-compliance-checklist.md` §5).
10. The URLs configured in the build and in both consoles, and checked (`public-hosting-requirements.md` §5).
11. The roadmap's other blockers (N-2 package name, N-6 owner items, the release audit WP-6).

**The app is not store-ready.** It will be ready only when every item above is closed and verified.
