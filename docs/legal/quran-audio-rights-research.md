# Quran recitation audio: which recordings Jawwid Academy may self-host

| | |
|---|---|
| Prepared for | The owner of Jawwid Academy, via the department head |
| Research date | 2026-10-28. Every source below was fetched and read that day. Times are UTC. |
| Scope | Recordings Jawwid can download, store on its own servers, stream to students and use inside a paid educational subscription. Egypt first, other countries second. |
| Status | Research only. **This is not legal advice.** Any conclusion that depends on Egyptian law is marked *(legal interpretation)* and needs confirmation by an Egyptian IP lawyer before production. |
| Method | Every licence claim was read on the publisher's own page, in English and Arabic. Search-engine summaries were used only to find pages, never as evidence. Quotes are kept under 15 words. No audio file was downloaded. |

---

## Executive summary

1. **No recording is cleared, with no step left, for a paid app.** Every recording either lacks a licence, forbids commercial use, or needs one written confirmation first.
2. **The best source is the King Fahd Glorious Qur'an Printing Complex (KFGQPC) in Madinah.** It is a Saudi government body and the producer of its own recordings.
   - Its audio page grants "free general use" in computer apps, websites and broadcasting, by government bodies and *private institutions*, inside and outside Saudi Arabia.
   - It publishes **official per-ayah archives**, each with a **SHA-256 fingerprint**. This matches Jawwid's planned per-ayah storage and SHA-256 manifest exactly.
   - Five recordings are in Hafs ʿan ʿĀṣim, the riwayah taught in Egypt: Ali Al-Hudhaify, Maher Al-Muaiqly, Muhammad Ayyub, Khalid Al-Muhanna and Ibrahim Al-Akhdar.
   - **One gap remains.** The grant says "free general use". It does not expressly mention paid subscriptions. A one-paragraph confirmation from the Complex (template F-2) closes that gap.
3. **Mishary Rashid Alafasy (the owner's preferred reciter) is NOT cleared by any source.**
   - EveryAyah publishes no licence.
   - Quran.com allows personal, non-commercial use only.
   - Islamic Network (alquran.cloud) holds only a non-commercial licence itself. It says copyright stays with the reciters.
   - QuranicAudio forbids commercial use.
   - mp3quran's blanket statement has no chain of title behind it.
   - The Quran Foundation API is a contract with storage limits. It does not come from the rights holder.
   - Alafasy's own company, **Alafasy Berhad** (Malaysia), states that the audio is "owned by Alafasy Berhad or licensed partners".
   - **Verdict: permission must be requested.** Letter F-1 is ready to send.
4. **Egypt adds two layers on top of copyright:**
   - **Law No. 82 of 2002:**
     - performers and producers have 50-year exclusive rights;
     - internet dissemination without written authorisation is a criminal offence;
     - commercial use of even *public-domain* recordings needs a Ministry licence (Art. 183);
     - performers' moral rights never expire (Art. 155);
     - any grant must be written and itemised (Art. 149).
   - **Law No. 102 of 1985:** the Islamic Research Academy of Al-Azhar licenses the "recording for circulation" (التسجيل للتداول) of the Mushaf. Circulating recordings without that licence is a crime, even when they were made abroad. Whether in-app streaming counts as circulation is a question for counsel.
5. **Recommended path:**
   - Build and test with the KFGQPC Hafs per-ayah set.
   - Send F-2 to the Complex for paid-use confirmation.
   - Send F-1 to Alafasy Berhad.
   - Ask an Egyptian IP lawyer the Law 102/1985 question.
   - Keep audio switched off for paying users until all three answers are on file.
   - If Alafasy's rights holder declines, commissioning an Egyptian reciter under a written assignment is the long-term fallback.

---

## 1. Four layers of rights, kept apart

| Layer | Who holds it | Status for Jawwid |
|---|---|---|
| **The Quranic text** | Nobody. It is outside copyright. Note that a specific *edition* can carry a licence: Tanzil's text is CC BY 3.0, with verbatim copying only. | Already handled: Tanzil Uthmani is self-hosted, pinned by SHA-256 and attributed. |
| **The reciter's performance** | The performer. In Egypt: exclusive economic rights for 50 years from the performance (Law 82/2002 Art. 156, 166), plus moral rights that never expire, to be named and to prevent "modification, alteration or distortion" (Art. 155). | Needs a licence from the reciter, their heirs, or whoever they assigned to in writing. |
| **The sound recording (phonogram)** | The producer: the studio, label, radio station or institution that made the recording. In Egypt: 50 years from recording or publication, whichever comes first (Art. 157, 167). | Needs a licence from the producer, which is often a different party from the reciter. |
| **The files and the distribution service** | Whoever runs the website or CDN. Their terms bind *users of the service* by contract. They cannot grant rights they do not hold. | A site's terms can only **restrict** Jawwid further. They can never **replace** the reciter's and producer's permission. |

There is also a broadcast layer. Egypt gives broadcasting organisations 20 years from first broadcast (Art. 168). This matters for radio-era Egyptian recordings.

---

## A. Verified safe-to-host shortlist

**Rule applied.** A recording appears here only if the **rights holder itself** grants, in writing:
- downloading,
- storage on Jawwid's servers,
- streaming to students,
- use by a private institution,

and the grant has no geographic limit.

Nothing reaches "approved for paid production" with **no** step left (see the executive summary). The entries below are verified for every use except the paid-subscription context. That one is a scope confirmation, not a new licence.

### A-1 to A-5: KFGQPC official Hafs recordings, per-ayah archives (tied on rights evidence)

| # | Reciter | Riwayah | Collection page (official) | Per-ayah archive: SHA-256 published by KFGQPC |
|---|---|---|---|---|
| A-1 | Ali Al-Hudhaify (علي الحذيفي) | Hafs ʿan ʿĀṣim | https://qurancomplex.gov.sa/quran-audio-hafs-huthify/ | `AD50FD0D8C362F6967141B5240CDBAC4089EFAF6D3A46EF159C3C8AAA05371F5` |
| A-2 | Maher Al-Muaiqly (ماهر المعيقلي) | Hafs ʿan ʿĀṣim | https://qurancomplex.gov.sa/quran-audio-hafs-muaiqly/ | `3EDCC70407F9D19C972C002C69A43CC245A62A0FCC497D3C719406A69965E18E` |
| A-3 | Muhammad Ayyub (محمد أيوب) | Hafs ʿan ʿĀṣim | https://qurancomplex.gov.sa/quran-audio-hafs-ayyoub/ | `7D82D979B1DCB2AE543812AE03FEF71E745CDBE60C084FC9B1EE3E25E84FFCE2` |
| A-4 | Khalid Al-Muhanna (خالد المهنا) | Hafs ʿan ʿĀṣim | https://qurancomplex.gov.sa/quran-audio-hafs-muhanna/ | `0E275DD1974984035F7EBC8E5C629A1D54AE9154820290B63A405DFF9B833752` |
| A-5 | Ibrahim Al-Akhdar (إبراهيم الأخضر) | Hafs ʿan ʿĀṣim | https://qurancomplex.gov.sa/quran-audio-hafs-akhdar/ | `62FF5BE271903D8EAF632F9DB7751962E2AA54F0978B65BF8A9D215FEAAF3066` |

**How the five are ordered.** They are listed in the Complex's own order. The rights evidence is identical for all five, so choosing among them is a decision for the Quran teachers.

**Other riwayat under the same grant.** The same grant covers four non-Hafs recordings:
- Al-Hudhaify in Shuʿba and in Qālūn;
- ʿUthman Al-Siddiqi in Al-Sūsī;
- ʿAbdullah ʿAwwad Al-Juhani in Al-Dūrī.

They are useful later for qirāʾāt teaching. Their pages and hashes are in the evidence log.

**The same evidence applies to A-1 to A-5:**

| Requirement | Evidence |
|---|---|
| Rights holder / responsible institution | The **King Fahd Glorious Qur'an Printing Complex**, Madinah, under the Saudi Ministry of Islamic Affairs, Daʿwah and Guidance. The Complex produces its own recordings. Its productions page lists "recordings" (تسجيلات) among its output and describes "printing the Mushaf and recording it" (طباعة المصحف الشريف وتسجيله). Source: https://qurancomplex.gov.sa/productions/ |
| Licence: name and version | Not a standard licence. It is a **public written grant by the producer**, issued "based on the approval of" the Minister of Islamic Affairs, General Supervisor of the Complex. Arabic (live, 2026-10-28): https://qurancomplex.gov.sa/quran-audios/ under the heading «حقوق الاستخدام». English (archived 2025-09-09): http://web.archive.org/web/20250909231545/https://qurancomplex.gov.sa/en/sounds/ |
| Decisive words | «للاستخدام العام مجاناً في التطبيقات الحاسوبية ومواقع وقنوات البث الإذاعي، ومواقع الإنترنت». English version: "free general use in computer apps, broadcasting channels, internet websites". |
| Who may use it | «الجهات والمؤسسات الخاصة» ("private entities and institutions"), alongside government bodies. |
| Territory | «داخل المملكة العربية السعودية وخارجها» ("inside and outside the Kingdom"). **No geographic restriction.** |
| Downloading | Permitted in practice: the Complex itself offers per-ayah and per-surah archives for download, with a download counter. |
| Self-hosting | Covered by "computer apps … internet websites". An app cannot use the files without hosting them. *(interpretation of a plain grant)* |
| Streaming | Covered by "broadcasting channels, internet websites". |
| Commercial educational use | **Implied but not express.** Private institutions are expressly included, and nothing forbids a paid context. But «مجاناً» ("free of charge") can be read two ways: the Complex charges nothing, or the use itself must be free. **Condition C-1: get the Complex's written confirmation (template F-2) before charging for access that includes this audio.** |
| Attribution | Not required by the grant. Recommended anyway: "Recitation: Sheikh [name], King Fahd Glorious Qur'an Printing Complex, Madinah". This also satisfies the performer's moral right to be named (Egypt Art. 155(i)). |
| Modification, conversion, redistribution | The grant is silent. Jawwid needs no editing: the Complex publishes **official per-ayah files**, so Jawwid never has to cut audio. Keep each file byte-identical to the archive, or transcode only. Never trim, loudness-process or splice without written consent. Redistribution beyond Jawwid's own app and site (for example, a public download feed) is outside what Jawwid needs. Don't do it. |
| Expiry, limits | No expiry stated. The Complex disclaims responsibility for "technical or programming mistakes". The site-wide licence clause confirms that files "declared for public use" are excepted from its all-rights-reserved notice (https://qurancomplex.gov.sa/privacypolicy/, section «ترخيص الاستخدام»). Disputes about the site fall under Saudi law. |
| Extra written permission needed? | **For free use: no. For the paid subscription: a scope confirmation (F-2) is strongly recommended.** In Egypt, also the regulatory question in D-2 (Law 102/1985), which applies to *any* Quran recording, licensed or not. |
| Fit with Jawwid's design | Strong. The Complex publishes a SHA-256 for each whole archive. The ingest step can (1) verify the archive against the Complex's hash, (2) unpack it, (3) map each file to `SSSAAA`, and (4) record the per-file SHA-256 in `chat.quran_ayah_audio`. This gives an unbroken hash chain from the rights holder's own page to every served file. File naming inside the archives was **not** inspected, because no audio was downloaded. Confirm it at ingest. |

**Status: verified grant from the producer.** Use it now for development, QA and any free-of-charge lesson content. Approve it for the paid subscription once F-2 is answered "yes" and the D-2 legal answer is on file.

---

## B. Conditional options

| # | Recording / collection | Licence and source | Condition | Verdict |
|---|---|---|---|---|
| **B-1** | **KFGQPC Hafs per-ayah (A-1 to A-5) inside the paid subscription** | Same grant as section A. | Written confirmation from the Complex that a paid educational subscription is within "general use" (F-2). | The most likely route to an unconditional "yes". |
| **B-2** | **ClearQuran audio: English translation by Talal Itani** (male, female and "classic" voices; verse by verse and surah by surah). https://clearquran.com/download/ | **CC BY-ND 4.0**, plus the copyright holder's own extra grant: files are "free to use, store, convert, and distribute, including in commercial projects". Audio may be edited, cut and rearranged, provided the translation's words are not changed. | Credit line: "Translation by Talal Itani, ClearQuran.com", linked where possible. Do not change the translation's words. | **Usable for English translation audio only.** It is not an Arabic recitation. The "Classic voice: Arabic & English" files contain Arabic audio whose reciter and rights are not stated. **Unverified, do not use that variant.** |
| **B-3** | **Quran Foundation API / QuranCDN audio** (the source behind Quran.com, including Alafasy). https://api-docs.quran.foundation/legal/developer-terms (last updated 2026-10-11) | A contract, not a rights-holder licence. Paid apps are allowed: QF Content may sit in an app with subscriptions "without a separate commercial license", and serving from a private backend "is not, by itself, redistribution". | (1) No storage beyond **1 week** unless obtained through Content Sync, which requires a re-sync at least every 7 days. The sync docs list `recitations` and `chapter_recitations`, but do not say whether the audio *files* themselves are covered. (2) QF disclaims **non-infringement** and claims only content "it owns". (3) If the licence terminates, Jawwid must delete everything. (4) New York law and courts. | **Permission must be requested** from QF: confirm that audio binaries are in Content Sync scope, and that QF holds sublicensable rights from each reciter. Even then, the reciter or producer could still object. **Not a substitute for F-1.** |
| **B-4** | **Wikimedia Commons recordings self-published by the performer** under CC BY-SA 4.0 or CC0. Example: a Juz ʿAmma set of ~29 surah files from one account, 2021, "Own work", CC BY-SA 4.0, e.g. https://commons.wikimedia.org/wiki/File:سورة_الفاتحة_الكتاب.ogg | CC BY-SA 4.0 or CC0 1.0, declared by the uploader as "the copyright holder". | (1) Confirm who the uploader really is, and that they are both performer and producer. A Commons "Own work" tag is a self-declaration. (2) A teacher reviews the tajweed. (3) For BY-SA: credit, link the licence, and license any per-ayah cuts as BY-SA, since cutting is an adaptation. | **Unverified, do not use yet.** These are amateur recordings, surah-level only, Juz ʿAmma only. Acceptable only as a last resort after verification. |
| **B-5** | **cpfair/quran-align word-timing data** (segmentation, not audio). https://github.com/cpfair/quran-align | Data files: **CC BY 4.0**, per the repository README. Code: MIT. | Attribution. | Licensed, but it describes **EveryAyah** audio, which is not cleared (C-1). It becomes useful only if a matching recording is cleared. |

---

## The Alafasy section (the owner's preferred reciter)

### Who holds the rights?

- **Performer:** Sheikh Mishary Rashid Alafasy, who is alive. Under any national regime with a 50-year term, his performance is protected. The murattal widely mirrored per ayah predates 2010: EveryAyah's folder contains a file dated `000_afasy_update_aug18_2010.zip`.
- **Producer / current rights claimant:** **Alafasy Berhad**, a Malaysian company (reg. 202501010149 (1611563-T)). It publishes the official "Alafasy: Prayers & Al-Quran" app. Sources: App Store listing (developer "Alafasy Berhad"), https://apps.apple.com/us/app/id6749109446, and Wikidata Q948361, which lists alafasy.co as an official website.
  - Its Terms of Use, section 6, state that app content, **including audio**, is "owned by Alafasy Berhad or licensed partners. Unauthorized use is strictly prohibited." Source: https://www.alafasy.co/terms-of-use
  - Its user licence is "for personal, non-commercial purposes".
  - Contact on the official site: ai@alafasy.co; +603 8682 3105; Subang Jaya, Selangor, Malaysia.
- **Earlier official site** misharialafasy.net (Wikidata P856), archived 2019-12-12: footer "All right reserved". It also says the "المصحف المرتل" release was on sale ("حالياً بالأسواق"), i.e. a commercial release. Source: http://web.archive.org/web/20191212093318/https://misharialafasy.net/
- **Uncertain:** whether Alafasy Berhad holds the *historic* recordings (which may have been produced by earlier labels or by the Sheikh personally) or only licenses them. **F-1 asks this directly.**

### What each per-ayah source says

| Source | Per-ayah Alafasy? | What its terms say (checked 2026-10-28) | Self-hosting + commercial education granted? |
|---|---|---|---|
| **EveryAyah.com** (`/data/Alafasy_128kbps/`) | Yes, with `SSSAAA.mp3` naming | **No licence, terms or copyright page anywhere.** Checked: current home page, old home page (`old_index.html`), and the folder listing. The only non-audio files are archives and MD5 checksum files. The "Contact Us" link goes to `quran.zendesk.com`. The Islamic Network operator says EveryAyah is "operated by the quran.com team" (secondary source). | **No.** Silence is not permission. **Unverified, do not use.** |
| **Quran.com** (website/app) | Yes | Content is "FOR YOUR PERSONAL, NON-COMMERCIAL USE ONLY". No copying or distributing content without "the prior written consent of Quran.com". https://quran.com/terms-and-conditions (last updated 2026-07-28) | **No.** Excluded. |
| **Quran Foundation API / QuranCDN** | Yes | See B-3. Paid apps are allowed by contract, but storage is capped at 1 week outside Content Sync, there is no non-infringement warranty, and QF does not claim to own the audio. | **Not by the rights holder.** Ask QF, and still ask F-1. |
| **QuranicAudio.com** (Quran.com's surah-level source) | Surah-level | "you may not use these files for commercial purposes". Files are "hand ripped from cds" and collected from other sites. https://quranicaudio.com/about | **No.** Excluded. Also evidence that upstream catalogues lack licences. |
| **Islamic Network** (alquran.cloud API, `cdn.islamic.network`) | Yes (`ar.alafasy`) | Recitations are licensed *to them* only "for free, non-commercial redistribution". They also say you may bundle them commercially, but that the reciters "may ask you to remove the conent" [sic]. https://alquran.cloud/terms-and-conditions (last updated 2026-06-14). The operator's forum reply (thread 257, 2026-07-22) says "the copyright still belongs to the translator and the reciter", and that most audio traces back to everyayah.com. https://community.islamic.network/d/257-commercial-use-of-quran-audio-text-via-your-cdnapi-educational-app | **No.** A non-commercial licensee cannot sublicense commercial use. "We won't object" is not the rights holder's grant. Excluded. |
| **mp3quran.net** | Surah-level (plus a timing API) | Privacy policy, last line: «جميع الحقوق متاحة للجميع» ("all rights available to everyone"). https://www.mp3quran.net/ar/privacy | **No.** This is an aggregator's blanket statement with no chain of title from Alafasy or his producer. **Unverified, do not use.** |
| **Tanzil.net** | Plays audio; does not license it | Its CC BY 3.0 notice covers the **text only**. https://tanzil.net/docs/text_license. The FAQ sends audio downloads to everyayah and mp3quran, and the credits list "Verse By Verse Quran Project" for recitations. https://tanzil.net/docs/faq | **No audio licence at all.** |
| **Official: Alafasy Berhad / alafasy.co** | In-app only | "owned by Alafasy Berhad or licensed partners. Unauthorized use is strictly prohibited." | **No. Permission must be requested.** |
| **alafasy.com / alafasy.me** | No | alafasy.com is a parked "domain for sale" page. alafasy.me no longer resolves. | Not official sources. Ignore. |

### Do per-ayah (SSSAAA) segmentations carry their own terms?

- The `SSSAAA.mp3` **naming convention** is a file-naming scheme. It carries no rights.
- Each per-ayah **file** is a reproduction, and arguably an edit, of the underlying recording. Cutting a surah into ayat touches the producer's reproduction right (Art. 157). Arguably it also touches the performer's perpetual right against "modification, alteration" (Art. 155(ii)) *(legal interpretation)*. So segmented files carry **at least** the restrictions of the source recording, plus whatever the segmenting site imposes.
- EveryAyah's segmentation itself carries **no stated terms**.
- QuranCDN's verse files and **timing segments** (`audio_segment`) are "QF Content" under the QF Developer Terms. "Derived Materials … remain subject to the same restrictions".
- Timing *data* published separately can carry an open licence (quran-align, CC BY 4.0). That licenses the **timestamps, not the audio**.
- KFGQPC removes this whole question: the producer itself publishes the per-ayah files.

### Verdict on Alafasy

**Not cleared. Permission must be requested.** No source grants self-hosting plus commercial educational use of Alafasy's per-ayah recordings. The only party that claims ownership reserves all rights.

Send letter F-1 to Alafasy Berhad (ai@alafasy.co). Ask for:
- (a) confirmation of chain of title for the specific murattal recording;
- (b) a written, itemised, non-exclusive licence (Art. 149 of Law 82/2002);
- (c) confirmation of which per-ayah files are authoritative, or permission to segment from the official surah files.

**Until a signed answer is on file, Alafasy audio must stay off in every environment that real students use.**

---

## C. Excluded sources (listening allowed; commercial self-hosting not)

| Source | Why excluded | Evidence |
|---|---|---|
| Quran.com website/app | Personal, non-commercial use only | https://quran.com/terms-and-conditions §1.4, §2.3 |
| QuranicAudio.com | Commercial use prohibited; files ripped from CDs | https://quranicaudio.com/about |
| Islamic Network / alquran.cloud CDN | Its own licence is non-commercial; reciters can demand removal | https://alquran.cloud/terms-and-conditions §IV; forum thread 257 |
| EveryAyah.com | No licence at all | https://everyayah.com/ ; https://everyayah.com/old_index.html |
| mp3quran.net | Blanket claim by an aggregator; no chain of title | https://www.mp3quran.net/ar/privacy |
| Tanzil.net audio | Licences text only; points elsewhere for audio | https://tanzil.net/docs/text_license ; https://tanzil.net/docs/faq |
| YouTube (any reciter channel) | Terms forbid downloading content without YouTube's and the rights holders' permission | https://www.youtube.com/static?template=terms&gl=EG&hl=en, "Permissions and restrictions" |
| Internet Archive "Quran Recitation by Saad Al-Ghamdi" | Marked "Public Domain" by a third-party uploader in 2008. The reciter is alive and the recording is commercial. **The label is unsupported.** | https://archive.org/details/Quran-MP3-Ghamdi |
| Wikimedia Commons uploads by third parties (e.g. clips of Ali Jaber, Muhammad Ayyub, ʿAbd al-Bari al-Thubaiti and ʿAbdullah al-Matrud credited to suratmp3.com and tagged CC BY or CC BY-SA; Sultan Al-ʿEid clips from a SoundCloud account, tagged CC BY 3.0) | The uploader is not the rights holder, and the "permission" field is empty. The cited source, suratmp3.com, shows only "Suratmp3 ©" with no CC licence. **License laundering. Do not rely on it.** | e.g. https://commons.wikimedia.org/wiki/File:Ali_Jaber_Recitation_of_Surah_Nisa.wav ; https://suratmp3.com/en/quran/ |
| Wikimedia Commons "PD-Egypt" Minshawi clip (Al-Anʿām 95–98) | Dated 9 May 1957 and credited to the Egyptian Quran Radio Station. Arabic Wikipedia gives that station's first broadcast as 25 March 1964 (a secondary source), which is inconsistent. The PD-Egypt tag reasons about *author's copyright*, not the producer's and broadcaster's neighbouring rights, Art. 183 or Law 102/1985. | https://commons.wikimedia.org/wiki/File:Surat_Al-An%27am.wav |
| Classic Egyptian murattal (Al-Husary, Al-Minshawi, ʿAbd al-Basit, Mustafa Ismaʿil) from any web mirror | Rights in the radio-era catalogue sit with Egyptian state media. **Sono Cairo** (صوت القاهرة للصوتيات والمرئيات), a National Media Authority company, keeps these reciters' studio recordings (Emarat Al Youm, 2023-03-21, a secondary source). Public-domain status is **not established**; see D-3. | https://www.emaratalyoum.com/life/culture/2023-03-21-1.1730191 |

**Q6 (streaming allowed, rehosting not).** The QF API (storage capped at one week outside Content Sync), the Islamic Network CDN (non-commercial) and YouTube (no downloading) all fall here. They are excluded from the unrestricted shortlist.

---

## D. Legal risk assessment

### D-1. Egypt: Law No. 82 of 2002 on the Protection of IP Rights

Source: the English text on WIPO Lex, https://www.wipo.int/wipolex/en/legislation/details/22066. That is the 2002 version. WIPO notes the current consolidated text exists only in Arabic, amended up to Law 178 of 2020, which changed Art. 185.

| Provision | What it means for Jawwid |
|---|---|
| Art. 138(9) | "Reproduction" includes "permanent or temporary storage … in an electronic form". **Self-hosting is reproduction.** |
| Art. 156, 157 | Performers and producers may prevent exploitation "without their prior written authorization", including making recordings available "through computers". **Streaming needs written authorisation from both.** |
| Art. 155 | The performer's moral rights to be named and to prevent "modification, alteration or distortion" are "perpetual". They pass to heirs, and the competent ministry exercises them when there are none. **Credit every reciter. Never edit the recitation.** |
| Art. 149 (applied to related rights by Art. 159) | A transfer must be "certified in writing" and must list "each right", its extent, purpose, duration and place. **A vague e-mail "yes" may not hold up** *(legal interpretation)*. Hence the itemised letter F-1. |
| Art. 166, 167, 168 | Terms: performers 50 years from performance; producers 50 years from recording or publication (whichever is first); broadcasters 20 years from first broadcast. |
| Art. 171 | Exceptions are narrow. The teaching exception covers "short extracts" (171(6)) and copies "in educational institutes" (171(7)). **It cannot cover a full per-ayah Mushaf in a paid app** *(legal interpretation)*. |
| Art. 183 | Commercial exploitation of public-domain works, recordings and performances needs a **licence from the competent ministry**, for a fee of at most EGP 1,000. **Even expired recordings are not free for paid use in Egypt.** |
| Art. 185 (as amended 2020) | A register of dispositions is kept at the competent ministry. In the 2002 text, an unregistered disposition is not valid against third parties. **Ask counsel whether to register Jawwid's licences.** |
| Art. 181 | Criminal penalties: at least one month's imprisonment and/or a fine of EGP 5,000–10,000, multiplied **per work**. This includes dissemination "through computer networks, Internet" without written authorisation (181(4)). Repeat offences carry higher penalties, confiscation and possible closure. |

### D-2. Egypt: Law No. 102 of 1985 on printing the Mushaf (regulatory, not copyright)

- **Art. 1:** the Islamic Research Academy of Al-Azhar alone supervises the printing, publication and «تسجيله للتداول» ("recording it for circulation") of the Mushaf. Its Secretary-General licenses this. Activities of the **Ministry of Awqaf** are exempt from the licence requirement.
- **Art. 2:** imprisonment and a fine of EGP 3,000–10,000 for circulating these recordings «بدون ترخيص … ولو تم الطبع أو التسجيل في الخارج» ("without a licence … even if recorded abroad"). Heavier penalties apply for deliberately distorting the text. The Supreme Constitutional Court upheld Art. 2 in March 2021, including its bar on suspending sentences.
- **Sources:**
  - Manshurat (law record: issued 20 March 1985, published 4 July 1985): https://www.manshurat.org/node/4270
  - Text (secondary transcription): https://lawyeregypt.net/?p=4430
  - Constitutional ruling, quoting Art. 2: https://manshurat.org/node/71393
  - **Confirm the text against the Official Gazette.**
- **Risk.** It is open whether in-app streaming or offline download of per-ayah files is "circulation of recordings" needing an Al-Azhar licence. That applies **even to KFGQPC recordings**, which are licensed abroad. *(Legal interpretation; this is the single most important question for Egyptian counsel.)* The Al-Azhar licence is a regulatory clearance, separate from copyright. Getting it would also add a recognised accuracy review.

### D-3. "Public domain" Egyptian classics are a trap

The argument goes:
- a 1961 recording plus 50 years expired in 2011;
- Law 82/2002 is not retroactive.

Why it is not enough:
1. **Art. 183** still requires a ministry licence for commercial use.
2. **Art. 155** moral rights are perpetual.
3. **Law 102/1985** still applies.
4. Whether the 1954 law (Law 354/1954, amended by Law 38/1992) protected phonograms and performances before 2002 could **not** be verified from primary text in this research. Neither could the date each specific recording was made or first published. Web files are often later remasters or compilations with their own publication dates.
5. **Abroad, the status differs.** For example, the United States restored protection for foreign works still protected at home on its 1996 restoration date, which could keep 1960s recordings protected there for decades *(legal interpretation; US counsel if the US matters)*.

**Conclusion: treat no classic Egyptian recording as public domain without a written opinion from counsel and an Art. 183 licence. Licensing from the producer (Sono Cairo / National Media Authority) is the safer route.**

### D-4. Students in other countries

- **KFGQPC grant:** expressly worldwide ("inside and outside the Kingdom"), so licensed use travels with it. The licence itself falls under Saudi law.
- **Neighbouring rights:** they vary (terms, moral rights, who counts as producer), but a licence from the right party is valid everywhere the licence says. Open licences (CC) are worldwide by design.
- **Religious-publication rules:** other Muslim-majority countries may have their own rules for Quran publications, as Egypt does. **None was verified in this research.** Check each before marketing there.
- **Contract terms of hosting services:** these are worldwide but bind only users of those services. Self-hosting from a rights-holder grant avoids them.

### D-5. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Using Alafasy audio from EveryAyah, QF or Islamic Network without the rights holder's licence | High if done | Criminal exposure (Art. 181), takedowns, app-store removal, reputational harm to a Quran school | Keep it off. Send F-1. |
| KFGQPC "مجاناً" read as excluding paid use | Low–medium | Would need a replacement or a licence | Send F-2 before charging. Keep Quran audio itself outside the paywall if the answer is unclear. |
| Law 102/1985 applies to in-app recordings | Unknown | Criminal; no suspended sentence | Get an Egyptian counsel opinion. Apply to Al-Azhar's Islamic Research Academy if advised. |
| Editing or segmentation treated as "modification" (Art. 155) | Low with official per-ayah files | Moral-rights claim | Use the producer's own per-ayah files byte-identical. No trimming or effects. Credit every reciter. |
| A source changes or withdraws its terms | Medium (pages moved during this research: KFGQPC's English audio pages now return 404) | Lost evidence | Archive every grant page with date and SHA-256 (see E). Keep the archive SHA-256 the Complex published. |
| Relying on third-party CC labels | Medium | Infringement despite "licence" | Accept a CC licence only from the verified performer and producer. |

---

## E. Recommended implementation plan (lowest cost, lowest risk)

1. **Now, at no cost:**
   - Ingest **one KFGQPC Hafs per-ayah archive** (owner's choice from A-1 to A-5) into a **non-production** bucket.
   - Verify the archive's SHA-256 against the value on the Complex's page.
   - Unpack, map files to `SSSAAA`, and record each file's SHA-256, `duration_ms` and `reciter_code` (e.g. `kfgqpc-huthify-hafs`) in `chat.quran_ayah_audio`.
   - Do **not** trim, normalise or re-encode in v1. Serve the original bytes.
2. **Now:** e-mail the Complex (template F-2, to info@qurancomplex.gov.sa, the address on its audio page) asking it to confirm that a paid educational subscription is within "general use". Ask also for a signed letter, if possible.
3. **Now:** send F-1 to Alafasy Berhad (ai@alafasy.co) for Alafasy's per-ayah murattal.
4. **Now:** brief an Egyptian IP lawyer with three questions:
   - (a) Does Law 102/1985 require an Al-Azhar licence for in-app streaming or download of licensed recordings?
   - (b) Should licences be registered under Art. 185 (as amended 2020)?
   - (c) Do the F-1 and F-2 letters satisfy Art. 149's written, itemised form?
5. **Launch gate for paying users:** audio stays OFF for paid accounts until **F-2 is answered yes, the lawyer's opinion is on file, and any required Al-Azhar licence is held**. Free or unpaid lesson content may use the KFGQPC set once step 4(a) is answered.
6. **Alafasy:** switch on only after a signed F-1 licence. If refused or unanswered after a reasonable follow-up, either (a) keep a KFGQPC reciter as the default, or (b) **commission** an Egyptian reciter who holds an ijāza, under a written assignment drafted by counsel (see below).
7. **Evidence retention (prevents future problems):**
   - Keep a `rights/` record per `reciter_code` with:
     - the grant or licence (PDF, or signed scan);
     - the public grant page as captured (HTML plus a Wayback snapshot URL) with retrieval date and SHA-256;
     - the archive SHA-256 published by the rights holder;
     - Jawwid's per-file SHA-256 manifest;
     - the scope (uses, territory, term);
     - the credit line;
     - the review date.
   - Show the credit line in the player and on a "Sources and licences" screen.
   - Re-check every public grant page every 6 months and before every new market launch. A page that changes or disappears triggers review, not automatic removal.
8. **Commissioning (most durable option):** a written agreement with **both** the reciter (performer) and the studio (producer). If Jawwid books the studio itself, Jawwid is the producer. The agreement covers:
   - an assignment or perpetual, worldwide, sublicensable licence of all Art. 156/157 rights;
   - the reciter's written consent to per-ayah segmentation and technical processing, and their chosen credit (Art. 155);
   - a warranty of originality;
   - registration under Art. 185;
   - an Al-Azhar licence under Law 102/1985 *(legal interpretation)*.

   This gives Jawwid full control and no third-party dependency.

---

## F. Ready-to-send permission requests

> Fill in the bracketed fields. Send from an official Jawwid Academy address. Keep the reply, and ask for a **signed** copy: Egyptian law requires a written, itemised grant (Law 82/2002, Art. 149).

### F-1. To a reciter or rights holder (written for Alafasy Berhad; reusable)

**العربية**

> **الموضوع: طلب ترخيص غير حصري لاستضافة وبث تلاوات [اسم القارئ] (آية بآية) في منصة تعليمية**
>
> السادة / [Alafasy Berhad — أو اسم صاحب الحق] المحترمين،
> السلام عليكم ورحمة الله وبركاته،
>
> نحن **أكاديمية جوّد (Jawwid Academy)**، أكاديمية تعليمية عبر الإنترنت لتحفيظ القرآن الكريم للأطفال وتعليم اللغة العربية والعلوم الإسلامية، وسوقنا الرئيسي جمهورية مصر العربية مع طلاب من دول أخرى.
>
> نرغب في استخدام تلاوة **[اسم القارئ] — [اسم الإصدار/المصحف المرتل، رواية حفص عن عاصم]** آيةً آيةً داخل منصتنا وتطبيقنا التعليمي، ونطلب منكم التكرم بما يلي:
>
> 1. **تأكيد ملكية الحقوق**: هل تملكون حقوق الأداء وحقوق منتج التسجيل الصوتي لهذا الإصدار، أم ترخصونه من جهة أخرى؟ وإن كانت جهة أخرى فنرجو إفادتنا بها.
> 2. **منحنا ترخيصًا كتابيًا غير حصري** يشمل صراحةً الحقوق التالية:
>    - (أ) تنزيل ملفات التلاوة وتخزينها على خوادمنا الخاصة؛
>    - (ب) بثها (Streaming) لطلابنا المسجلين، وإتاحة تنزيلها داخل التطبيق للاستماع دون اتصال بصورة غير قابلة للاستخراج؛
>    - (ج) تحويل صيغة الملفات أو معدل ترميزها تقنيًا دون أي تغيير في التلاوة نفسها؛
>    - (د) تقسيم التلاوة إلى ملف لكل آية إن لم تتوفر لديكم ملفات آية بآية، دون حذف أو إضافة أو تعديل في الأداء؛
>    - (هـ) الاستخدام ضمن خدمة تعليمية **قد تكون باشتراك مدفوع**، دون بيع ملفات التلاوة منفصلة أو إعادة توزيعها خارج منصتنا.
> 3. **النطاق**: جميع الدول؛ **المدة**: [غير محددة / ١٠ سنوات قابلة للتجديد]؛ **المقابل**: [مجانًا / مبلغ يُتفق عليه].
> 4. **صيغة النسبة** التي تفضلونها (مثال: «تلاوة الشيخ [الاسم] — بإذن من [صاحب الحق]»)، وسنعرضها في المشغّل وفي صفحة «المصادر والتراخيص».
> 5. تحديد **الملفات المعتمدة** (روابط أو نسخة مرسلة منكم)، وسنحفظ لكل ملف بصمة SHA-256 لضمان عدم تغييره.
>
> نتعهد بعدم تعديل التلاوة أو تحريفها، وبنسبتها إلى القارئ في كل موضع، وبالالتزام بأي شروط تضعونها. ونرجو أن يكون الرد **موقّعًا** من مفوَّض بالتوقيع لديكم، لأن القانون المصري يشترط أن يكون الترخيص كتابيًا ومفصّلًا.
>
> وجزاكم الله خيرًا،
> [الاسم والصفة] — أكاديمية جوّد
> [البريد الإلكتروني] · [الهاتف] · [الموقع]

**English**

> **Subject: Request for a non-exclusive licence to host and stream [Reciter]'s verse-by-verse recitation in an educational platform**
>
> Dear [Alafasy Berhad / rights holder],
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> **Jawwid Academy** is an online academy teaching children Quran memorisation, Arabic and Islamic studies. Our main market is Egypt, and we also serve families in other countries.
>
> We would like to use **[Reciter]: [release / murattal Mushaf, Hafs ʿan ʿĀṣim]**, verse by verse, inside our educational platform and app. We kindly ask you to:
>
> 1. **Confirm the chain of title.** Do you hold both the performer's rights and the sound-recording (producer's) rights in this release, or do you license them from another party? If another party, please tell us who.
> 2. **Grant us a written, non-exclusive licence** that expressly covers:
>    - (a) downloading the recitation files and storing them on our own servers;
>    - (b) streaming them to our enrolled students, and allowing in-app offline playback in a form that cannot be extracted;
>    - (c) technical format or bitrate conversion with no change to the recitation itself;
>    - (d) splitting into one file per ayah, if you do not supply per-ayah files, with nothing removed, added or altered;
>    - (e) use within an educational service that **may be offered by paid subscription**. We would never sell the files separately or redistribute them outside our platform.
> 3. **Territory:** worldwide. **Term:** [perpetual / 10 years, renewable]. **Fee:** [none / to be agreed].
> 4. **Your preferred credit line** (e.g. "Recitation by Sheikh [Name], by permission of [rights holder]"). We will show it in the player and on our "Sources and Licences" page.
> 5. **The authoritative files** (links, or a copy you send us). We will record a SHA-256 fingerprint for each file so it can never change silently.
>
> We undertake never to alter or distort the recitation, always to credit the reciter, and to follow any conditions you set. We would be grateful for a reply **signed** by an authorised signatory, since Egyptian law requires such licences to be written and itemised.
>
> JazākumAllāhu khayran,
> [Name, title], Jawwid Academy
> [e-mail] · [phone] · [website]

### F-2. To the King Fahd Complex (scope confirmation)

**العربية**

> **الموضوع: استفسار عن نطاق «حقوق الاستخدام» للتلاوات الصوتية**
>
> إلى مجمع الملك فهد لطباعة المصحف الشريف — وحدة الإعلام الرقمي، المحترمين،
> السلام عليكم ورحمة الله وبركاته،
>
> نشكركم على إتاحة التلاوات الصوتية في صفحة «التلاوات الصوتية» للاستخدام العام في التطبيقات ومواقع الإنترنت لدى الجهات والمؤسسات الخاصة داخل المملكة وخارجها.
>
> نحن **أكاديمية جوّد**، أكاديمية تعليمية عبر الإنترنت لتحفيظ القرآن الكريم للأطفال، ونرغب في استخدام ملفات **«المصحف آيات»** لفضيلة الشيخ **[الاسم] — رواية حفص** كما هي دون أي تعديل، مع التحقق من بصمة SHA-256 المنشورة لديكم، وذلك بتخزينها على خوادمنا وبثها لطلابنا مع نسبتها إلى فضيلة الشيخ وإلى المجمع.
>
> نرجو التكرم بتأكيد أن «الاستخدام العام» يشمل استخدامها داخل خدمة تعليمية **قد تُقدَّم باشتراك مدفوع**، علمًا بأننا لن نبيع الملفات منفصلة ولن نعيد توزيعها خارج منصتنا، وإفادتنا بأي صيغة نسبة أو شروط تفضلونها. ونكون شاكرين لو تفضلتم بإرسال التأكيد بخطاب رسمي.
>
> وجزاكم الله خيرًا،
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف]

**English**

> **Subject: Scope of the "usage rights" for the Complex's audio recitations**
>
> To the King Fahd Glorious Qur'an Printing Complex, Digital Media Unit,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> Thank you for making your recitations available for general use in computer apps and websites, by private institutions, inside and outside the Kingdom.
>
> **Jawwid Academy** is an online Quran academy for children. We would like to use the **per-ayah ("المصحف آيات") files of Sheikh [Name], Hafs**, unmodified and verified against the SHA-256 you publish. We would store them on our servers and stream them to our students, credited to the Sheikh and to the Complex.
>
> Could you please confirm that "general use" includes use inside an educational service that **may be offered by paid subscription**? We would not sell the files separately or redistribute them outside our platform. Please also tell us any credit line or conditions you prefer. A confirmation on official letterhead would be greatly appreciated.
>
> JazākumAllāhu khayran,
> [Name, title], Jawwid Academy · [e-mail] · [phone]

---

## Final classification (the brief's decision rule)

| Category | Recordings |
|---|---|
| **Verified permission, no additional licence** | KFGQPC recordings (A-1 to A-5 Hafs, plus four other riwayat): verified for download, self-hosting and streaming in apps and websites by a private institution, worldwide. **For the paid-subscription context, a scope confirmation (F-2) is pending.** |
| **Open licence with conditions** | ClearQuran English translation audio (CC BY-ND 4.0 plus the author's extra grant; attribution). quran-align timing data (CC BY 4.0; data only). |
| **Permission must be requested** | **Mishary Rashid Alafasy** (Alafasy Berhad, F-1). Quran Foundation (for QuranCDN audio). Classic Egyptian murattal (Sono Cairo / National Media Authority, plus counsel on Art. 183). Any commissioned reciter. |
| **Unverified or prohibited** | EveryAyah, Quran.com, QuranicAudio, Islamic Network CDN, mp3quran, Tanzil (audio), YouTube, Internet Archive "public domain" uploads, third-party CC tags on Wikimedia Commons, the self-published Commons recordings (until identity is verified). |

**Remaining uncertainty:**
- (1) Whether Law 102/1985 covers in-app audio.
- (2) Whether KFGQPC's "free general use" covers paid subscriptions.
- (3) Who holds title to Alafasy's historic murattal.
- (4) Pre-2002 Egyptian neighbouring-rights status of radio-era recordings.
- (5) Foreign-country status of any "public domain" claim.

Items (1), (4) and (5) need an Egyptian (and, if relevant, foreign) IP lawyer.

---

## Evidence log

All entries were checked on **2026-10-28** (UTC). "Capture SHA-256" is the first 16 hex digits of the SHA-256 of the HTML as fetched. Full hashes and the text captures are retained offline with the coordinating session's notes. HTTP 200 unless noted.

| # | Source | URL | Time (UTC) | Capture SHA-256 (prefix) | What it establishes |
|---|---|---|---|---|---|
| 1 | KFGQPC: audio recitations + «حقوق الاستخدام» | https://qurancomplex.gov.sa/quran-audios/ | 08:56:51 | `c75630d05fa24cb8` | The producer's public grant: apps, websites, broadcasting; private institutions; worldwide |
| 2 | KFGQPC: English grant (Wayback 2025-09-09) | http://web.archive.org/web/20250909231545/https://qurancomplex.gov.sa/en/sounds/ | 08:56:57 | `b64df572a741705c` | English wording of the same grant; the live English URL now returns 404 |
| 3 | KFGQPC: Al-Hudhaify, Hafs | https://qurancomplex.gov.sa/quran-audio-hafs-huthify/ | 08:57:30 | `68c7616d84ea07eb` | Per-ayah and per-surah archives; official SHA-256 |
| 4 | KFGQPC: Al-Muaiqly, Hafs | https://qurancomplex.gov.sa/quran-audio-hafs-muaiqly/ | 08:57:32 | `957512c726bcb8c3` | Same |
| 5 | KFGQPC: Muhammad Ayyub, Hafs | https://qurancomplex.gov.sa/quran-audio-hafs-ayyoub/ | 08:57:34 | `25d492b4baa9e176` | Same |
| 6 | KFGQPC: Al-Muhanna, Hafs | https://qurancomplex.gov.sa/quran-audio-hafs-muhanna/ | 08:57:36 | `61a17b07201fcc74` | Same |
| 7 | KFGQPC: Al-Akhdar, Hafs | https://qurancomplex.gov.sa/quran-audio-hafs-akhdar/ | 08:57:37 | `050ca8b385021820` | Same |
| 8 | KFGQPC: other riwayat (Shuʿba, Qālūn, Sūsī, Dūrī) | https://qurancomplex.gov.sa/quran-audio-shouba-huthify/ · …-qaloon-huthify/ · …-sousi-sediki/ · …-douri-juhani/ | 08:57:39–08:57:44 | in offline log | Same grant; per-ayah archives and SHA-256 |
| 9 | KFGQPC: site licence clause | https://qurancomplex.gov.sa/privacypolicy/ | 08:58:04 | `f326c07a459bb68a` | Files declared for public use are excepted from all-rights-reserved; Saudi law |
| 10 | KFGQPC: productions | https://qurancomplex.gov.sa/productions/ | 08:58:18 | `9a1fc5de4f8d2e5c` | The Complex produces recordings |
| 11 | Alafasy Berhad: Terms of Use | https://www.alafasy.co/terms-of-use | 08:50:02 | `27db7c5e2b4519aa` | Audio "owned by Alafasy Berhad or licensed partners"; personal non-commercial licence |
| 12 | Alafasy official app (App Store) | https://apps.apple.com/us/app/id6749109446 | 08:49:25 | `edda2eabcaf69dbe` | Developer and copyright holder: Alafasy Berhad |
| 13 | misharialafasy.net (Wayback 2019-12-12) | http://web.archive.org/web/20191212093318/https://misharialafasy.net/ | 08:51:09 | `9eeecb3d2af0392c` | Earlier official site: all rights reserved; murattal sold commercially |
| 14 | alafasy.com | https://www.alafasy.com/ | 08:48:06 | `279e86e61b452e82` | Parked "domain for sale"; not official |
| 15 | EveryAyah: home | https://everyayah.com/ | 08:48:00 | `01aac4855b891fcf` | No licence or terms page |
| 16 | EveryAyah: data index | https://everyayah.com/data/ | 08:48:01 | `fc0ed8704ae3e5b9` | Alafasy_128kbps and Alafasy_64kbps folders; no licence file |
| 17 | EveryAyah: old index | https://everyayah.com/old_index.html | 08:51:41 | `4edd437ab74c13a7` | No licence |
| 18 | Quran.com: Terms | https://quran.com/terms-and-conditions | 08:48:02 | `7f1d2b08e1fe267e` | Personal, non-commercial only (last updated 2026-07-28) |
| 19 | Quran Foundation: Developer Terms | https://api-docs.quran.foundation/legal/developer-terms | 08:48:31 | `fd57ec680c27884b` | Paid apps allowed; 1-week cache cap; no non-infringement warranty (updated 2026-10-11) |
| 20 | Quran Foundation: Content Sync | https://api-docs.quran.foundation/docs/tutorials/content-sync/getting-started/ | 08:48:57 | `ba0ccc6f1ad6d82e` | `recitations` and `chapter_recitations` sync groups; 7-day re-sync |
| 21 | QuranicAudio: About | https://quranicaudio.com/about | 08:48:33 | `5d8d18a051ad036b` | No commercial use; files ripped from CDs |
| 22 | Al Quran Cloud: Terms | https://alquran.cloud/terms-and-conditions | ≈08:47 | `3f94982e8865dd01` | Non-commercial licence to them; reciters may demand removal (updated 2026-06-14) |
| 23 | Islamic Network forum, thread 257 | https://community.islamic.network/d/257-commercial-use-of-quran-audio-text-via-your-cdnapi-educational-app | 08:52:17 (page), API JSON `c4359d92f8fa31be` | `def3695d1a1074ef` | Operator: copyright stays with reciters; audio traces to everyayah; EveryAyah run by the quran.com team |
| 24 | mp3quran: privacy policy | https://www.mp3quran.net/ar/privacy | 08:55:20 | `2be5f6cf2d1165cb` | Blanket «جميع الحقوق متاحة للجميع» |
| 25 | Tanzil: text licence | https://tanzil.net/docs/text_license | 08:48:01 | `60afc5edf64af1ef` | CC BY 3.0 covers the text only |
| 26 | Tanzil: FAQ | https://tanzil.net/docs/faq | 08:51:49 | `cebec6a0ea7bf13d` | Audio downloads come from everyayah or mp3quran |
| 27 | Tanzil: credits | https://tanzil.net/docs/credits | 08:51:50 | `7343a03ad73bf1ff` | Recitations credited to the Verse By Verse Quran Project |
| 28 | ClearQuran: downloads and licence | https://clearquran.com/download/ | 08:52:18 | `33a426a7b1a9fff1` | CC BY-ND 4.0 plus extra commercial and edit grant (English translation audio) |
| 29 | cpfair/quran-align README | https://github.com/cpfair/quran-align | 08:55 (API) | n/a (GitHub API) | Timing data CC BY 4.0; code MIT |
| 30 | Commons: CC0 Fatiha (self-published) | https://commons.wikimedia.org/wiki/File:AlF%C4%81tihatulKit%C4%81b.ogg | 08:52:19 | `3089a25137f4b960` | Example of a self-declared CC0 recording |
| 31 | Commons: metadata for 50 recitation files | Commons API (`prop=imageinfo&iiprop=extmetadata`) | 08:53 | n/a | Licence, author and uploader per file; third-party CC tags identified |
| 32 | Commons: Minshawi "PD-Egypt" | https://commons.wikimedia.org/wiki/File:Surat_Al-An%27am.wav | 08:53:26 | `1df48d38f728d9e0` | PD claim reasoned on author's copyright; date inconsistent |
| 33 | suratmp3.com | https://suratmp3.com/en/quran/ | 08:59:19 | `ae8459b2793ea974` | "Suratmp3 ©"; no CC licence for the Commons uploads that cite it |
| 34 | Internet Archive: Ghamdi item | https://archive.org/details/Quran-MP3-Ghamdi | 08:52:20 | `1e724940cd14f782` | "Public Domain" label set by a third-party uploader in 2008 |
| 35 | YouTube Terms (Egypt) | https://www.youtube.com/static?template=terms&gl=EG&hl=en | 08:59:34 | `ea9f4c14280e749e` | No downloading without permission |
| 36 | WIPO Lex: Egypt Law 82/2002 | https://www.wipo.int/wipolex/en/legislation/details/22066 | 08:53 | `df7ce8e4e02dccc2` | Art. 138, 147, 149, 155–159, 166–168, 171, 181, 183–186; amended to Law 178/2020 |
| 37 | Commons: Egypt copyright rules | https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_territory/Egypt | 08:53:35 | `358706d5d5699455` | Secondary: non-retroactivity of 2002 law; URAA dates |
| 38 | Law 102/1985: record | https://www.manshurat.org/node/4270 | 08:54:45 | `c4cb116b81c77217` | Issued 20 March 1985; published 4 July 1985 |
| 39 | Law 102/1985: text (secondary) | https://lawyeregypt.net/?p=4430 | 08:54:59 | `7900d77d8820f100` | Art. 1 (Al-Azhar licensing of recording) and Art. 2 (penalties, including recordings made abroad) |
| 40 | Constitutional Court, March 2021 | https://manshurat.org/node/71393 | 08:54:45 | `3da5d5d08bc0ad34` | Art. 2 upheld; quotes Art. 2 in full |
| 41 | Sono Cairo archive (Emarat Al Youm) | https://www.emaratalyoum.com/life/culture/2023-03-21-1.1730191 | 08:59:19 | `d665daac1fb72d4b` | Secondary: Sono Cairo (National Media Authority) holds the classic reciters' studio recordings |
| 42 | Arabic Wikipedia: Egyptian Quran Radio | ar.wikipedia.org, «إذاعة القرآن الكريم (مصر)» | 09:00 (API) | n/a | Secondary: first broadcast 25 March 1964 |
