# Legal research and compliance matrix

**Version 0.1 (draft), 2026-11-06.** This file is research for qualified counsel. It is **not legal advice**, and it is not a compliance statement.

**How it was researched:** web research from 2026-11-06, with every source cited.

**Verification levels**
- **Official**: read in the official text, or on the regulator's or government's own page.
- **Secondary**: from a reputable law-firm or reference summary (DLA Piper, Clyde & Co, Hogan Lovells, Mayer Brown, CMS, Chambers). Check it against the official Arabic text before relying on it.
- **Unverified**: the article number or detail could not be confirmed.

Several official portals refused automated access (`uaelegislation.gov.ae`, the SDAIA regulation PDF, `ncsa.gov.qa`, `pdp.gov.bh`), so many rows are only **Secondary**. Items describing events of 2026 come only from secondary sources and must be confirmed:
- Oman's Royal Decree 68/2026;
- SDAIA's overseas registration (October 2026);
- SDAIA's draft amendments (consultation 6 October to 5 November 2026).

> **The legal operating entity, its country of registration and the governing law are not decided (LD-1, LD-2).** They decide which consumer law binds most directly, who the "controller" is, and which regulator is the lead. Until they are decided, this matrix assumes that the target markets' laws reach Jawwid **because it serves residents there**. It does not assume that one country's law applies everywhere.

---

## 1. Findings that shape every document

| # | Finding | Level | Consequence |
|---|---|---|---|
| F-1 | Religious belief is **sensitive data** in the UAE, Saudi Arabia, Qatar, Bahrain and Oman. Enrolment in Quran or Islamic-studies lessons, and Quran memorisation records, may reveal a family's religion. | Secondary (UAE: Primerus summary of PDPL Art. 1; Oman: MTCIT, Official) | Treat course data and Quran progress as sensitive. Use it only to teach, restrict who can see it, never use it for marketing, and send it to no processor beyond what delivery needs. Possible regulatory filings: an Oman permit, Qatar permission, Saudi registration (§3) |
| F-2 | **Children's data needs a guardian's explicit consent** in the UAE (under 13), Qatar (child-directed sites), Oman, and Saudi Arabia (the guardian of a person lacking capacity). | UAE: Official (u.ae); others: Secondary | The parent's consent for each enrolled child must be explicit, recorded and withdrawable. Today Jawwid records only the PD-48 notice, so a consent record for children's data is needed (LD-13) |
| F-3 | Most of these laws **reach a controller outside the country** that serves its residents: UAE PDPL Art. 2, Saudi PDPL Art. 2, Saudi E-Commerce Law Art. 2(b), UAE Decree-Law 14/2023 Art. 2(1)(b), and Oman since the 2026 amendment. | KSA E-Commerce and UAE 14/2023: Official; others: Secondary | Jawwid cannot rely on being registered elsewhere |
| F-4 | **Breach notification:** 72 hours (KSA, Bahrain, Oman, and Qatar's guidelines); 24 hours (Kuwait CITRA, if it applies); "immediately" (UAE, with no clock until the executive regulations are issued). | Secondary | One privacy-incident runbook that aims for 24 hours |
| F-5 | **Data-subject request deadlines:** KSA 30 days (extendable by 30); Oman 45 days; UAE not yet set. | Secondary | An internal deadline of 30 days |
| F-6 | **Consumer law limits the terms:** UAE consumer contracts under AED 50,000 cannot impose arbitration (Decree-Law 14/2023 Art. 9(2)(b)). KSA gives a 7-day cancellation right for a service not yet received (E-Commerce Law Art. 13), and a refund right if delivery is late by more than 15 days (Art. 14). | **Official** (MoE and MISA texts) | Terms of Use: no forced arbitration for consumers, and the statutory cancellation and refund rights are preserved |
| F-7 | The UAE Child Digital Safety law (Federal Decree-Law 26/2025) has been **in force since 1 January 2026**, with a roughly one-year grace period. It requires: privacy-protective defaults; age verification; parental tools; reporting tools; no targeted advertising to children; and immediate reporting of child sexual abuse material. A Cabinet resolution may exempt education platforms. | Official (u.ae) and Secondary (Hogan Lovells) | The most time-critical item. See §2.1 |

---

## 2. Matrix by country

Columns:
- **Type** is one of: **Law** (a mandatory legal obligation), **Store** (an app-store requirement), or **Jawwid** (internal policy or best practice).
- **Clause** names the document and section that carries it.
- **Tech** is the technical implementation, with references to `developer-implementation-guide.md`.

### 2.1 United Arab Emirates

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| Scope, including controllers outside the UAE | Federal Decree-Law 45/2021 (PDPL), Art. 2 | https://uaelegislation.gov.ae/en/legislations/1972 ; https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws | Secondary | Applies when UAE families enrol | Privacy Policy §1, §15 | — |
| Status of the executive regulations | Not issued, as of August 2026 sources | businessdubai.ae (secondary) | Secondary | Transfer rules, breach timing, DPO thresholds and response deadlines are **not yet defined** | Privacy Policy: "as required by applicable law" | Re-check before publication (L-1) |
| Sensitive data (religious belief) | PDPL Art. 1 (definitions) | as above | Secondary | F-1 | Privacy Policy §6 | Role restrictions (guide §4.1) |
| Consent; legal bases | PDPL Arts. 4–6 (articles unverified) | as above | Unverified | Contract for lessons; explicit consent for children's and sensitive data | Privacy Policy §7 | Consent record (LD-13) |
| Children: parental consent, defaults, reporting, no targeted ads | Federal Decree-Law 26/2025 on Child Digital Safety | https://u.ae/en/information-and-services/social-affairs/Priority-groups/children/Childrens-digital-safety | Official (u.ae) / Secondary (details) | Children aged 5–12 are served. Jawwid has no ads or tracking and no child accounts | Child Safety Policy; Privacy Policy §6 | Consent record; reporting is built (PD-57); default lock-screen names off (built) |
| Child protection, and the duty of educators to report | Federal Law 3/2016 (Wadeema), Art. 42 (some sources say 43) | https://u.ae (children's rights pages) | Secondary | Teachers educate UAE children | Child Safety Policy; Teacher Terms | Child-safety report path (built) |
| Cross-border transfers | PDPL Arts. 22–23 | as above | Secondary | Hosting is in the EU (Frankfurt); processors are in the US | Privacy Policy §11 | Processor register (guide §4.9) |
| Rights | PDPL Arts. 13–19 | as above | Secondary | The parent acts for the child | Privacy Policy §13 | Export, phase 1 (guide §4.6) |
| Breach | PDPL Art. 9 | as above | Secondary | — | Privacy Policy §12 | Runbook (guide §4.8) |
| Data protection officer | PDPL Art. 10 (thresholds pending) | as above | Secondary | Possible: sensitive and children's data | Privacy Policy §1 ({{DPO_CONTACT}}) | — |
| E-commerce: scope, disclosures, invoice, complaints, **no arbitration under AED 50,000** | Federal Decree-Law 14/2023 on Modern Technological Means of Trading: Arts. 2(1)(b), 5, 6, 7, 9(2)(b), 10 | https://www.moet.gov.ae/documents/20121/0/Federal+Decree-Law+No.+14+of+2023+on+Trading+by+Modern+Technological+Means.pdf | **Official** | Lesson packages sold to UAE parents | Terms of Use: payments, refunds, disputes | Receipts (built: PD-27) |
| Consumer protection; Arabic information | Federal Law 15/2020, as amended; Cabinet Resolution 66/2023, Arts. 8 and 25 | https://uaelegislation.gov.ae/en/legislations/2157 | Secondary | Mandatory if the entity is UAE-based; best practice otherwise | Terms of Use: language clause | Arabic receipts and checkout text |
| Electronic contracts | Federal Decree-Law 46/2021 on Electronic Transactions | uaelegislation.gov.ae | Unverified (articles) | Click-through acceptance is valid | Terms of Use §1 | Acceptance record (#462) |
| Age of majority | Civil Transactions Law, Federal Decree-Law 25/2025 (18 Gregorian years from 1 June 2026) | press sources | Secondary | The account holder must be an adult | Terms of Use: eligibility | — |

### 2.2 Saudi Arabia

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| Scope, including foreign controllers | PDPL, Royal Decree M/19 (1443H), amended by M/148 (1444H), Art. 2; enforceable since 14 September 2024 | https://laws.boe.gov.sa ; https://sdaia.gov.sa | Secondary | Saudi families | Privacy Policy §1 | — |
| Sensitive data | PDPL Art. 1 ("religious … belief") | as above | Secondary | F-1 | Privacy Policy §6 | — |
| Minors: guardian consent; a DPIA for minors' data | PDPL Implementing Regulation (article unverified) | https://sdaia.gov.sa/en/SDAIA/about/Documents/ImplementingRegulation.pdf | Secondary | Core | Privacy Policy §6; Child Safety Policy | Consent record; DPIA document (L-10) |
| Registration on the National Data Governance Platform; DPO | Implementing Regulation (Art. 32 per secondary sources). Overseas registration through an authorised representative (October 2026) | https://dgp.sdaia.gov.sa | Secondary | **Likely mandatory** (sensitive and minors' data) | Privacy Policy §1 | Owner and legal action (LD-14) |
| Rights: 30 days, extendable by 30 | Implementing Regulation | as above | Secondary | — | Privacy Policy §13 | 30-day internal deadline |
| Breach: SDAIA within 72 hours | Implementing Regulation Art. 24 (a draft makes it unconditional) | as above | Secondary | — | Privacy Policy §12 | Runbook |
| Transfers: adequacy, SDAIA standard contractual clauses (not to be modified), risk assessment | PDPL Art. 29; Transfer Regulation (amended, in force 1 September 2024) | sdaia.gov.sa | Secondary | US processors | Privacy Policy §11 | SDAIA clauses with processors (L-4) |
| **Draft in-Kingdom storage rule** | Draft amendment, Implementing Regulation Art. 23 (consultation closed 5 November 2026) | Clyde & Co, October 2026 | Secondary, **pending** | A risk for EU hosting, if adopted | — | Watch (L-11) |
| E-commerce: scope, disclosures, invoice, **7-day cancellation**, **refund after 15 days' delay** | E-Commerce Law, Royal Decree M/126 (1440H): Arts. 2(b), 5–10, 13, 14 | https://misa.gov.sa/app/uploads/2025/07/E-Commerce-Law.pdf | **Official** | Lesson packages | Terms of Use: payments and refunds | Package state, used or unused (exists: PD-30 balance) |
| Child protection | Child Protection System, Royal Decree M/14 (1436H) | laws.boe.gov.sa | Secondary | Teachers of Saudi children | Child Safety Policy | — |
| Cybercrime (privacy, content) | Anti-Cyber Crime Law, Royal Decree M/17 (1428H) | laws.boe.gov.sa | Unverified (articles) | Recording lessons; abusive content | Code of Conduct | Moderation (built) |

### 2.3 Kuwait

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| **No general data-protection law.** E-Transactions Law 20/2014 (data provisions, Arts. 32–35) | Law 20/2014 | https://citra.gov.kw | Secondary / Unverified | Consent for processing in electronic transactions | Privacy Policy §7 | — |
| CITRA Data Privacy Protection Regulation (Decision 26/2024): **24-hour breach notice**; guardian consent | CITRA | citra.gov.kw | Secondary | Probably applies only to CITRA licensees; "service provider" may be read broadly | Privacy Policy §12 | Runbook at 24 hours (L-12) |
| Consumer protection | Law 39/2014 | — | Unverified | — | Terms of Use (generic) | — |

### 2.4 Qatar

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| Personal data | Law 13/2016 (PDPPL); territorial scope not defined | https://www.almeezan.qa ; https://ncsa.gov.qa | Secondary | Uncertain reach | Privacy Policy §1 | — |
| Special-nature data (religion; most sources also list children): permission and a DPIA | PDPPL Art. 16 | as above | Secondary (sources conflict on children) | F-1 | Privacy Policy §6 | Legal action (LD-14) |
| **Child-directed sites:** a notice, express parental consent, and the parent's right to a copy, deletion, or a stop to processing | PDPPL Art. 17 | as above | Secondary | Directly relevant | Privacy Policy §6, §13 | Export and deletion (guide §4.4, §4.6) |
| Breach: 72 hours (from the guidelines) | 2021 guidelines | — | Secondary | — | Privacy Policy §12 | Runbook |
| Transfers: permissive (Art. 15) | PDPPL Art. 15 | — | Secondary | — | Privacy Policy §11 | — |
| Consumer protection; e-commerce (pre-contract terms, cooling-off) | Law 8/2008; Law 16/2010, ch. 8 | almeezan.qa | Unverified (periods) | Lesson sales | Terms of Use | Terms shown before payment |

### 2.5 Bahrain

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| Scope: residents and businesses in Bahrain, or processing "by means available in the Kingdom" | Law 30/2018 (PDPL), Art. 2 | https://www.pdp.gov.bh ; https://www.legalaffairs.gov.bh | Secondary | Probably **not** reached today: no Bahrain entity, and hosting is in the EU. Counsel to confirm | Privacy Policy §1 | Keep hosting out of Bahrain unless intended |
| Sensitive data; prior authorisation for certain processing | PDPL | as above | Secondary | If in scope | — | — |
| Transfers: adequacy list (Order 42/2022) | Order 42/2022 | https://www.pdp.gov.bh/assets/pdf/executive-decisions/eng/trans-order-countries-and-territories-with-adequate-protection-en.pdf | Official (document exists) / Unverified (contents) | — | — | — |
| Breach: 72 hours | Order 43/2022, Art. 4(2) | pdp.gov.bh | Secondary | — | — | — |
| Consumer protection | Law 35/2012 | — | Unverified | — | — | — |

### 2.6 Oman

| Requirement | Law and article | Official source | Level | How it applies to Jawwid | Clause | Tech |
|---|---|---|---|---|---|---|
| Scope, extraterritorial since 7 September 2026 | Royal Decree 6/2022 (PDPL); Executive Regulation (Ministerial Decision 34/2024); amended by Royal Decree 68/2026 | https://mtcit.gov.om/sectors/governance/personal ; https://decree.om/2022/rd20220006/ | Official (MTCIT page) / Secondary (the 2026 amendment, CMS) | Omani families | Privacy Policy §1 | — |
| **A permit before processing religious data** | PDPL Art. 5 | MTCIT | Official | F-1. **High impact** | Privacy Policy §6 | Owner and legal action (LD-14) |
| Children: guardian approval | PDPL Art. 6; Executive Regulation | decree.om | Secondary | Core | Privacy Policy §6 | Consent record (LD-13) |
| Explicit consent for marketing | PDPL Art. 22 | — | Secondary | Jawwid sends no marketing today. Stories are service announcements (L-13) | Privacy Policy §8 | — |
| Rights: 45 days | PDPL Art. 11; Executive Regulation | — | Secondary | — | Privacy Policy §13 | 30-day internal deadline |
| Breach: 72 hours to the Ministry, and to people at serious risk | PDPL Art. 19; Executive Regulation | MTCIT | Official (MTCIT page) | — | Privacy Policy §12 | Runbook |
| **DPO mandatory** | PDPL Art. 20 | MTCIT | Official | — | Privacy Policy §1 | {{DPO_CONTACT}} |
| Transfers: assessment; approval for sensitive data | PDPL Art. 23; Executive Regulation | MTCIT | Secondary | US processors | Privacy Policy §11 | Transfer assessment |
| Delete when the purpose is met | 2026 amendment | CMS | Secondary | Purges (guide §4.5) | Privacy Policy §10 | LD-7 |

### 2.7 Other jurisdictions (only where they are directly triggered)

| Law | When it applies | Status for Jawwid |
|---|---|---|
| US COPPA | Services directed at US children, or with actual knowledge of collecting data from US children under 13. Using US processors does **not** trigger it. | Applies if families resident in the US are accepted (LD-15) |
| EU GDPR / UK GDPR | The service is offered to people in the EU or UK (Art. 3(2)) | Applies if EU or UK families are accepted (LD-15). Hosting in the EU does not by itself make GDPR apply to a non-EU controller's processing of GCC residents, but the processor (DigitalOcean, EU) has its own GDPR duties (L-4) |

---

## 3. Regulatory filings that may be needed before serving a market

These are owner and legal actions, not engineering tasks. All are **Secondary** and must be confirmed by counsel.

| Market | Filing | Trigger |
|---|---|---|
| Saudi Arabia | Registration on the National Data Governance Platform, with an authorised representative for an overseas controller; a DPO | Sensitive data and minors' data |
| Oman | An MTCIT permit for religious data; a DPO; a transfer assessment | Religious data (F-1) |
| Qatar | Permission for special-nature data; a DPIA | Religious and children's data |
| UAE | A DPO if the executive regulations require one; the child digital safety duties | Children |

---

## 4. Store requirements (not law)

These are in `app-store-compliance-checklist.md`. They are contractual requirements of Google and Apple, not legal obligations. This package keeps them separate.

## 5. Jawwid's own policies (not law, not store)

Several rules in this package are Jawwid's own choices. Counsel may keep or change them:
- no private teacher–parent channel (BR-1);
- teachers never see family contact details;
- lessons are not recorded;
- no advertising, analytics or tracking;
- a 24-hour report response (PD-57 D-1);
- a 60-minute cap on support sessions;
- the PD-48 two-teacher approval of lesson audio.

They must be described accurately. Where one is stricter than the law, the policy must not present it as a legal duty.

## 6. Items for qualified legal review

The full list is in `outstanding-information-and-decisions.md` §3: L-1 to L-17.
