# PD-49: the edition-pinning brief for the scholar reviewer

**What this is.** Step 1 of plan §A.6 (`docs/product/pd049-children-quran-experience-plan.md`). Before any child-facing item is written, every source we cite is pinned to one printing that is itself in the public domain. That means the classical author's text with **no modern editor's apparatus**: no tahqiq footnotes, no takhrij, no added headings, no editor's introduction. The owner decided on public-domain sources only on 2026-10-29.

**How to use it.** For each work:
1. Look at the candidate printing (a library copy or the scan link).
2. Tick the physical checks.
3. Choose **Pin**, **Reject**, or **Other** (name a better printing).
An engineer then records each decision in `apps/lessons/src/content/sources.json` (`edition`: printer, place, year, page scheme, why it is free) in a reviewed commit.

**What is enforced in code.** The code refuses to approve, or to show a child, any item that cites a work whose edition is not pinned (#255).

**How this was researched.**
- Catalogue and library pages only, 2026-10-29. Nothing was downloaded and no scan was opened, so **footnotes and margin layout are unverified everywhere**: that is the scholar's check.
- The full notes, with a link on every claim, are in the department head's notes folder:
  - `pd49-edition-candidates-saadi.md`
  - `pd49-edition-candidates-others.md`
- Copyright notes are arithmetic on the terms below, not legal advice. Counsel is optional (plan §A.7).

**Terms used.**
- Saudi Arabia and Egypt: the author's life + 50 years.
- EU: life + 70, to the end of the year.
- US: a work first published abroad and still protected there on 1 Jan 1996 may have had its US term restored (URAA): 95 years from publication. This is an inference, for counsel.
- **Our own cited wording is not affected by any of these. Only verbatim text would be.** Children never see verbatim source text (plan §A.0).

---

## Decision needed first: the primary for word meanings

**Ibn al-Ha'im's *al-Tibyan fi Tafsir Gharib al-Quran* has no public-domain printing.** The plan had made it the primary.
- Only two modern critical editions were found:
  - Fathi al-Dabuli, Dar al-Sahaba, Tanta, 1412/1992;
  - Dahi 'Abd al-Baqi Muhammad, Dar al-Gharb al-Islami, Beirut, 1423/2003.
- Neither is a public-domain printing.
- Under the plan's own rule (§A.0), a work with no pinned edition **cannot be the primary**. It can still be a cross-check, read from any copy for the author's own words and cited by surah:ayah.
- *Al-Tibyan* is al-Sijistani's *Gharib* rearranged by surah and ayah, with additions marked (ز).

| Option | What it means | Cost |
|---|---|---|
| **A (recommended).** Primary: **al-Sijistani, *Nuzhat al-Qulub*, Bulaq 1295** (below). Where al-Sijistani has no entry: **al-Sa'di**'s explanation of the word inside his tafsir of the ayah. Ibn al-Ha'im: a cross-check. | A gloss cites al-Sijistani (Bulaq 1295, volume:page) or al-Sa'di (pinned printing, volume:page). | al-Sijistani is alphabetical, so authors look each word up, which is slower. Ibn al-Ha'im's own additions (ز) can be used only as a cross-check. |
| B. Primary: al-Sa'di only, for every gloss | One source for tafsir and words | Al-Sa'di explains words only in passing; many words get no gloss of their own |
| C. Keep Ibn al-Ha'im primary, citing a modern edition's pages for the author's words only | Ordered by ayah, convenient | Contradicts "pin a printing that is itself public domain" (owner, 2026-10-29). **Not recommended.** |

- ☐ A ☐ B ☐ C. Decided by: the department head with the scholar (the owner if they wish).

---

## 1. Tafsir. Primary: al-Sa'di, *Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan* (تيسير الكريم الرحمن في تفسير كلام المنان)

**Author's dates and status.**
- He died just before dawn on Thursday 23 (some sources say 22) Jumada al-Akhira 1376 = **24 January 1957**.
- Saudi Arabia and Egypt: public domain since 1 Jan 2008.
- **EU: protected until 31 Dec 2027.**
- **US: possibly protected until about 2051–2053** (URAA, 95 years from the 1955–58 first printing; for counsel). It is recorded in `sources.json` (#255).
- In both cases our own wording is unaffected. **No verbatim al-Sa'di appears anywhere in the product** (plan §A.1).

**Candidate (the only one found): the first printing, al-Matba'a al-Salafiyya wa-Maktabatuha, Cairo (Muhibb al-Din al-Khatib's press).**
- Part 5 was printed in 1375 AH, **in the author's lifetime**, with his own handwritten preface. The other parts followed in 1376–1377 AH.
- 8 parts in the manuscript; some bound together (Google Books has records for parts "1–2", "3–4", "5" and "7", all dated "1954", probably a cataloguer's estimate).
- **No online scan was found.**
- The author arranged this printing himself (his letter of 30/2/1374 AH).
- Al-Khatib died 30 Dec 1969, so his press's share is public domain under life + 50 since 2020, and under life + 70 from 2040.
- The corrector who did the work is **not named**. If any footnotes are his, his death date matters.
- **Known changes by the press,** made without notice (per al-Luwayhiq's introduction):
  - "قوله تعالى" and part headings inserted;
  - abbreviated verse quotations completed;
  - a few words added;
  - the base manuscript was not in the author's hand.
  These are mechanical, but they are not al-Sa'di's words. **Children never see verbatim text anyway; the reviewer should know which words are the press's.**

**Explicitly NOT candidates:**
- the Riyadh printing, al-Mu'assasa al-Sa'idiyya / al-Ri'asa al-'Amma, 1396–97 AH, 7 volumes. Corrected by Muhammad Zuhri al-Najjar, with his own marginal notes and changes; his death date was not found. It is the base of most later printings;
- al-Luwayhiq's critical edition (Mu'assasat al-Risala 1420/2000; Dar al-Salam; Obeikan). Shamela #42 follows it;
- al-Sumayl's edition (Dar Ibn al-Jawzi 1422);
- *Taysir al-Latif al-Mannan* (1949): a **different, shorter work**. Do not confuse the two.

**Physical checks (on a copy of the Salafiyya parts; start with part 5):**
- ☐ Title page of each part: printer, place, year (1375 for part 5; 1376/1377 for the rest), part number
- ☐ Colophon (خاتمة الطبع): base copy and any named corrector (مصحح). If named, note his name and death year.
- ☐ Footnotes: none, or whose?
- ☐ Front matter: only the author's preface (part 5); no editor's introduction
- ☐ The press's insertions noted (headings, "قوله تعالى", completed verses)
- ☐ Number of parts, binding, and whether each part is paginated separately (this fixes the citation form, e.g. "5/123")
- ☐ Any copyright notice (حقوق الطبع محفوظة) on a reprint, if a reprint is used instead

**Decision:** ☐ Pin the Salafiyya first printing ☐ Reject ☐ Other: ________

**If no copy can be reached:** al-Sa'di cannot be pinned, so the plan has no tafsir primary. The fallback is to promote al-Baghawi (§3) to primary. It is adult-level and denser, so authoring takes longer.

---

## 2. Word meanings. Recommended primary (Option A): al-Sijistani, *Nuzhat al-Qulub fi Tafsir Gharib al-Quran* (نزهة القلوب في تفسير غريب القرآن), d. 330 AH

**Candidate A (best): Bulaq (al-Matba'a al-Amiriyya), 1295/1878, 2 vols.**
- Printed **in the margin** of al-Mahaimi's (d. 835) *Tafsir al-Quran al-musamma Tabsir al-Rahman wa-Taysir al-Mannan*.
- No named editor. A specialist calls it the first printing, unedited.
- Public domain under both terms.
- **Scan:** Qatar National Library, vol. 2, "No Known Copyright": https://ediscovery.qnl.qa/islandora/object/QNL:00018280 (companion record `QNL:00018281`).

**Candidate B: Cairo, al-Matba'a al-Rahmaniyya, 1342/1923, 306 pp.**
- Mustafa 'Inani as "compiler" or "reviewer"; his death year was not found.
- Scan: https://sites.dlib.nyu.edu/viewer/node/67741

**Not candidates:** Subaih 1382/1962 (a committee's tahqiq); Jumran (Dar Qutayba 1416/1995); al-Mar'ashli (Dar al-Ma'rifa 1410/1990); the Salahiyya edition (Dar Talas).

**Physical checks:**
- ☐ The margin text is the complete *Nuzhat al-Qulub*, and is legible
- ☐ No corrector's notes, or whose
- ☐ How to cite a margin page (volume:page of the main text?)

**Decision:** ☐ Pin Bulaq 1295 ☐ Pin Rahmaniyya 1342 (after checking 'Inani's notes) ☐ Reject ☐ Other: ________

---

## 3. Tafsir cross-checks

### 3a. Ibn Kathir, *Tafsir al-Quran al-'Azim* (d. 774)

| Candidate | Details | Status |
|---|---|---|
| **A (best)** | **Bulaq, al-Matba'a al-Kubra al-Miriyya, 1300–1301/1882–83, 10 vols, in the margin of Siddiq Hasan Khan's *Fath al-Bayan*** (Columbia copy). Scan: https://sites.dlib.nyu.edu/viewer/node/59689 | Public domain under both terms (main-text author d. 1890; no modern editor) |
| B | Cairo, Matba'at al-Manar, 1343–1347/1924–28, 9 vols, supervised by Rashid Rida (d. 1935). Scan: https://sites.dlib.nyu.edu/viewer/node/66587 (vol. 9: `/66593`). Sources disagree: 9 vols in 1343, or 4 vols in 1347. | Public domain under both terms (Rida d. 1935) |

- ☐ Complete in the margin (A) ☐ Footnotes in B are Rida's only
- **Decision:** ☐ A ☐ B ☐ Other: ________

### 3b. Al-Baghawi, *Ma'alim al-Tanzil* (d. 516). **The weakest set of candidates.**

| Candidate | Details | Status |
|---|---|---|
| A | The al-Manar Ibn Kathir (3a B) catalogues al-Baghawi as a co-author. **No record says outright that it is printed in the margin.** | Public domain if present |
| B | [Bombay?] 1879, 1006 pp., British Library copy. Its reproduction is licensed (Gale), not free; the place is inferred. | Public domain (1879, no editor) |
| C | Al-Khazin's *Lubab al-Ta'wil* with al-Baghawi in the margin: al-Maktaba al-Tijariyya 1914 (partial scan: https://chughtailibrary.com/digital_library/repository_detail.php?id=53469); al-Halabi 1375/1955 (https://sites.dlib.nyu.edu/viewer/node/66631) | Check: **some al-Khazin printings carry al-Nasafi in the margin instead** |

- ☐ Confirm al-Baghawi is actually printed in the chosen copy, and complete
- **Decision:** ☐ A ☐ B ☐ C ☐ Other: ________

---

## 4. Gharib cross-check: Ibn Qutayba, *Tafsir Gharib al-Quran* (d. 276)

| Candidate | Details | Status |
|---|---|---|
| **A** | ***al-Qurtayn*** by Ibn Mutarrif al-Kinani (d. 454): Ibn Qutayba's *Gharib* and *Mushkil* merged, marked غ/ش. Cairo, Maktabat al-Khanji, 1355/1936, 2 vols. Corrector: 'Abd al-Hafiz Sa'd 'Atiyya, **death year not found**. Scan: https://sites.dlib.nyu.edu/viewer/books/aub_aco002383/display?lang=ar | Probably public domain; the corrector's notes need checking |
| Not a candidate | al-Sayyid Ahmad Saqr's edition (1378/1958; reprinted 1978) | A modern tahqiq |

- ☐ Notes by the corrector? ☐ The *Gharib* entries (غ) are complete
- **Decision:** ☐ Pin al-Qurtayn 1355 ☐ Reject (Ibn al-Ha'im and al-Sijistani suffice) ☐ Other: ________

---

## 5. Asbab: the reports and the pointers

### 5a. The reports: Sahih al-Bukhari, the Sultaniyya printing (Bulaq, al-Matba'a al-Kubra al-Amiriyya, 1311–1313, 9 parts)

- Printed on Sultan 'Abd al-Hamid II's order from the Yunini copy, reviewed by a committee under Shaykh al-Azhar Hassuna al-Nawawi (d. 1343/1925).
- Public domain under both terms.
- Scans: Wikisource, vol. 1 with links to vols. 2–9: https://ar.wikisource.org/wiki/%D9%85%D9%84%D9%81:%D8%A7%D9%84%D8%B3%D9%84%D8%B7%D8%A7%D9%86%D9%8A%D8%A91.pdf
- **The original has no hadith numbers.**
- **Avoid reprints:**
  - Dar Tawq al-Najat (1422) adds Fu'ad 'Abd al-Baqi's numbering and notes;
  - one Wikisource scan set carries Ahmad Shakir's introduction (d. 1958: EU-protected until 2028).

### 5b. The reports: Sahih Muslim, Istanbul, Dar al-Tiba'a al-'Amira, 1329–1333/1911–15

- The named correctors differ by source, and none of their death years was found:
  - Ahmad Rif'at and Muhammad 'Izzat, with Muhammad Shukri al-Anqarawi;
  - or Mehmed Zihni Efendi.
- A Qatar record titled "with al-Nawawi's commentary, 18 vols" may be a different set.

### 5c. Citing a hadith

How to cite a hadith: by **book (kitab) and chapter (bab)** plus the pinned printing's volume:page.
- Fu'ad 'Abd al-Baqi's numbers (d. 1388/1968–69) are shown only as an extra reference, if at all.
- Whether such a number is a fact or a protectable arrangement is an open question for counsel.
- ☐ Agree: cite by kitab/bab + volume:page, with the 'Abd al-Baqi number as an optional extra

**Decision 5a:** ☐ Pin Sultaniyya ☐ Other: ________
**Decision 5b:** ☐ Pin Istanbul 1329–33 ☐ Other: ________

### 5d. The pointer: al-Wahidi, *Asbab al-Nuzul*

- **Best candidate:** Cairo, al-Matba'a al-Hindiyya, 1315/1316, 353 pp., with Ibn Salama's *al-Nasikh wa-l-Mansukh* in the margin.
- No corrector named; public domain under both terms.
- Scan (marked public domain): https://ar.wikisource.org/wiki/%D9%85%D9%84%D9%81:%D8%A3%D8%B3%D8%A8%D8%A7%D8%A8_%D8%A7%D9%84%D9%86%D8%B2%D9%88%D9%84.pdf
- Reminder: al-Wahidi only **points** to reports; it never authenticates one (plan §A.3).

**Decision:** ☐ Pin Hindiyya ☐ Other: ________

### 5e. The pointer: al-Suyuti, *Lubab al-Nuqul*. Weak candidates.

- "Tunis 1302" was not found.
- Al-Halabi 1954 (248 pp.) and Damascus, Matba'at al-Mallah 1959 (276 pp.; scan: https://sites.dlib.nyu.edu/viewer/node/19566) name no editor.
- ☐ Footnotes? **Decision:** ☐ Pin ________ ☐ Drop (al-Wahidi suffices as the pointer)

### 5f. Verdict references (not pinned as text)

Al-Muzaini's *al-Muharrar* and al-Wadi'i's *al-Sahih al-Musnad* are in copyright. They are cited **by reference only**: work, volume/page, verdict (plan §A.3). Only the printing whose pages are cited is recorded, not a public-domain pin.
- ☐ *al-Muharrar*: Dar Ibn al-Jawzi, 1427, 2 vols (the edition the scholar holds)
- ☐ *al-Sahih al-Musnad*: Maktabat Ibn Taymiyya, Cairo, 4th ed., 1408 (the edition the scholar holds), or Dar al-Athar

---

## 6. After the decisions

1. An engineer writes each decision into `sources.json`, in one reviewed commit:
   - `edition`: printer, place, year, pages, and why it is free;
   - the roles, if Option A moves the word-meaning primary to al-Sijistani and Ibn al-Ha'im to cross-check.
2. The authoring guide (plan §A.6 step 2) names the citation form for each pinned printing.
3. Then the pilot (1, 112, 105, 111) is written.

Until each work is pinned, the code keeps every item that cites it held.
