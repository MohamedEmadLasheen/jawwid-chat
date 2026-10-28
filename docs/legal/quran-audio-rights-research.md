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
4. **Sheikh Mahmoud Khalil Al-Husary is NOT cleared for paying students** (follow-up section H, below).
   - There is no single "Husary recording". There are several distinct productions: the 1961 Hafs murattal, Egyptian Radio, Sono Cairo, Saudi Radio, the Muʿallim, and the mujawwad sets.
   - The 1961 Hafs murattal was financed and supervised by Egypt's **Ministry of Awqaf**, through the Supreme Council for Islamic Affairs. That makes the Ministry the likely producer.
   - No Husary recording anywhere carries an explicit commercial licence. The King Fahd Complex distributes none.
   - Public-domain status in Egypt is **not** a safe basis:
     - Art. 183 requires a ministry licence for commercial use of public-domain recordings;
     - Art. 155 moral rights never expire;
     - Law 102/1985 still applies;
     - the pre-2002 status of these recordings is unverified;
     - abroad, the status differs.
   - Permission must be requested from the producer of the chosen edition, with the heirs' consent for the moral rights. Letter F-3 is ready.
   - **Section I (owner's direction: pursue Husary)** sets out the licensing routes and the letters:
     - Established apps disclose **no licence**. The norm is notice-and-takedown.
     - The **National Media Authority's Holy Quran Radio** openly claims all rights, holds the digitised archive (471 Husary recordings on its official portal), and has a verified contact.
     - **Recommended first letter: F-3b to the NMA (quran@maspero.eg).** Send F-3a to the Ministry of Awqaf (1961 murattal) the same week, and F-3d to the heirs.
     - Letters F-3a to F-3e plus a Schedule of Rights, in Arabic and English, and the lawyer's checklist.
     - Owner sends; nothing has been sent.
5. **Egypt adds two layers on top of copyright:**
   - **Law No. 82 of 2002:**
     - performers and producers have 50-year exclusive rights;
     - internet dissemination without written authorisation is a criminal offence;
     - commercial use of even *public-domain* recordings needs a Ministry licence (Art. 183);
     - performers' moral rights never expire (Art. 155);
     - any grant must be written and itemised (Art. 149).
   - **Law No. 102 of 1985:** the Islamic Research Academy of Al-Azhar licenses the "recording for circulation" (التسجيل للتداول) of the Mushaf. Circulating recordings without that licence is a crime, even when they were made abroad. Whether in-app streaming counts as circulation is a question for counsel.
6. **Recommended path:**
   - Build and test with the KFGQPC Hafs per-ayah set. The owner chose **Ali Al-Hudhaify** for build and test, not yet for paying students.
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
| *Law 163/2023 (added in section I)* | Since 7 Aug 2023, the **Egyptian Intellectual Property Authority** replaces "the competent ministries", including Culture and the Supreme Council for Media Regulation, in their IP functions. So the Art. 183 licence and the Art. 185 register now most likely sit with that Authority *(interpretation; confirm with counsel)*. |
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
   - Ingest **one KFGQPC Hafs per-ayah archive** into a **non-production** bucket. The owner chose **A-1, Ali Al-Hudhaify**, for build and test only, not yet for paying students.
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

## H. Follow-up: Sheikh Mahmoud Khalil Al-Husary (الشيخ محمود خليل الحصري)

Requested by the owner on 2026-10-28. Same evidence standard: every source was fetched and read on 2026-10-28 and is in the evidence log (rows 43–62). No audio was downloaded.

Labels used below:
- **[fact]**: stated by a primary source, or by the institution itself.
- **[secondary]**: reported by press or reference sources.
- **[interpretation]**: legal reading that needs Egyptian counsel.
- **[unresolved]**: could not be established.

### H-1. Who owns what: performance, recording, digital copies

**There is no single "Husary recording".** He recorded the Mushaf several times, for different producers.

The family-tribute site el-hosary.com lists these as separate Hafs editions:
- «مصحف حفص – الإذاعة المصرية» (Egyptian Radio);
- «مصحف حفص – صوت القاهرة» (Sono Cairo);
- «مصحف حفص – الإذاعة السعودية» (Saudi Radio);
- «مصحف حفص – عن طريق الشاطبية»;
- «المصحف المعلم» (the Muʿallim);
- «المصحف المجود»;
- Warsh, Qālūn and Dūrī editions.

**[fact, listing only]** https://el-hosary.com/. Each edition can have a different producer and a different date, and therefore a different rights holder and term.

| Layer | Holder | Basis | Status |
|---|---|---|---|
| **The performance** (performer's economic rights) | Sheikh Al-Husary (1917–1980), now his heirs, unless assigned by contract | Law 82/2002 Art. 156, 166 | [fact for the law]. He died 24 Nov 1980 (English Wikipedia, [secondary]). Any contract terms with the Radio or the Ministry are [unresolved]. A 1964 *Al-Ahram* report, cited by Al-Dostor, says he demanded a fee from the Radio for *broadcasting* the murattal, because his contract paid for the **records only** ([secondary], https://www.dostor.org/3541021). So the original contract was limited, not an open grant. |
| **Moral rights** (to be named; to prevent modification) | His heirs. If there are none, the competent ministry exercises them. | Art. 155: "perpetual, inalienable" | [fact for the law]. **They never expire**, including after any public-domain date. |
| **Sound recording: 1961 Hafs murattal** (the first complete recorded Mushaf) | Most likely the **Ministry of Awqaf**, through the **Supreme Council for Islamic Affairs** (المجلس الأعلى للشئون الإسلامية). The idea came from the General Society for the Preservation of the Quran (Dr. Labib al-Said). | Art. 138(11): the producer is the person or entity that "takes the initiative" and "assume[s] the responsibility" for the recording | [secondary, but from the Ministry itself]: the Ministry says it supervised the project «من خلال المجلس الأعلى للشئون الإسلامية» (https://www.dostor.org/5645145). Al-Said's memoir, quoted in Youm7, says the recording was made «بأموال وزارة الأوقاف» ("with the Ministry of Awqaf's funds") (https://www.youm7.com/story/2026/7/23/…/7490195). First records pressed 23 July 1961; first broadcast 18 Sept 1961 [secondary]. **Whether the Ministry still holds the masters, or assigned them to the Radio or Sono Cairo, is [unresolved].** |
| **Sound recording: Egyptian Radio and Quran Radio editions** | The **National Media Authority** (الهيئة الوطنية للإعلام, Maspero), successor to ERTU | Art. 157, 167 (producer); Art. 158, 168 (broadcaster, 20 years) | [fact]: the NMA runs a presidentially mandated project to digitise the archive and to "invest" the content on a digital platform, including the heritage of the great reciters (maspero.eg, 2026-08-11; El-Balad). The Quran Radio station started in 1964. Edition-level ownership is [unresolved]. |
| **Sound recording: Sono Cairo edition** | **Sono Cairo** (صوت القاهرة للصوتيات والمرئيات), an NMA company | Art. 157, 167 | [secondary]: its archive holds these reciters' studio recordings (Emarat Al Youm, 2023). **Enforcement posture [fact, from the regulator]:** in 2021 Sono Cairo won an economic-court ruling over Umm Kulthum's recordings. The Supreme Council for Media Regulation then notified channels and websites that any contract for that content goes «فقط عن طريق شركة صوت القاهرة» ("only through Sono Cairo"), and warned of criminal liability (https://scm.gov.eg/…). Expect the same stance on its Quran catalogue. |
| **Sound recording: Saudi Radio edition; the Muʿallim; mujawwad sets** | Saudi Radio for its edition. For the Muʿallim and the mujawwad studio sets: **[unresolved]**. | — | No primary source found. |
| **Digital copies on websites and streaming services** | Whoever ripped or re-released them. **They own nothing in the recording itself.** | — | **Apple's catalogue shows at least 10 different ℗ claimants** on Husary releases (Apple Search API, 2026-10-28). Counts: "Injaz Digital" 104 albums; "ASL" 50; "Sheikh Mahmoud AlHussary" 23; "Royal Music" 3; "Hedayat" 2; and "Global", "Aslim Taslam", "Awakening Worldwide", "VAS Box", plus a dozen 2026 uploads whose ℗ line is just a YouTube-style title. A ℗ line is a distributor's **claim** about a release, not proof of title. **So many conflicting claims mean the chain of title is fragmented and possibly contested.** |
| **Family association** | «جمعية الشيخ الحصري» (Sheikh Al-Husari Association) | — | [fact]: a registered charity (no. 318), founded 1996 "by a group" of admirers. Its site shows no licensing terms (https://elhosary.co/). **It is not shown to hold any rights.** It can serve as a route to the heirs for moral-rights consent [interpretation]. |

### H-2. Is any Husary recording explicitly licensed for commercial use?

**No.** None was found anywhere.

| Source | Husary audio? | Licence or terms | Verdict |
|---|---|---|---|
| **KFGQPC** | **None.** Its audio page lists 9 recordings (Al-Hudhaify ×3 riwayat, Al-Muaiqly, Ayyub, Al-Muhanna, Al-Akhdar, Al-Siddiqi, Al-Juhani). Husary is not among them. | — | Not available from KFGQPC. |
| **EveryAyah** | Yes: `Husary_128kbps`, `Husary_64kbps`, `Husary_Muallim_128kbps`, `Husary_128kbps_Mujawwad`, `Husary_Mujawwad_64kbps` | No licence (see C) | Unverified. Do not use. Their source master is unknown. |
| **Quran.com / Quran Foundation / QuranicAudio / Islamic Network / mp3quran** | Yes | As in section C: personal non-commercial use; no commercial use; or no chain of title | Excluded. |
| **el-hosary.com** (tribute site with downloads) | Yes, per edition | **No licence, no copyright statement.** Footer: a web-host credit only. Operator not identified. | Not a grant. |
| **Internet Archive** | Several items | Third-party uploaders. One item says it holds copies "from CDs ripped into lossless flac" (https://archive.org/details/al-husari). One carries a **Public Domain Mark** set by the uploader in 2023 (https://archive.org/details/hussary_202310). One is "recorded from Al-Quran Al-Kareem Radio from Cairo" (https://archive.org/details/aldiakhmadw_gmail_20180501). | **Evidence against permission:** CD rips and radio captures. A PD Mark set by an uploader is unsupported. |
| **Streaming services** (Apple Music and others) | Yes | Licensed to *listeners* under each store's terms. Ten-plus competing ℗ claimants. | No reuse right. |

### H-3. Public domain under Egyptian law

**Do not assume it.** The arithmetic below is the most favourable reading. Several barriers stand regardless.

1. **Terms under Law 82/2002** [fact for the law]:
   - performer: 50 years from the performance (Art. 166);
   - producer: 50 years from recording or publication, whichever is first (Art. 167);
   - broadcaster: 20 years from first broadcast (Art. 168).

   For the **1961** Hafs murattal, all three would have expired by about **2011** **[interpretation]**. Later editions run later. A 1968 Qālūn/Dūrī recording, for example, would expire around 2018. Any recording made after 1976 is still protected today.
2. **Pre-2002 status: [unresolved].**
   - Law 82/2002 repealed Law 354/1954, and the Commons summary says the 2002 law is not retroactive ([secondary]).
   - Whether Law 354/1954, as amended by Law 38/1992, protected performances and phonograms at all, and how the 2002 terms apply to recordings made before 2002, could **not** be checked against primary text: WIPO Lex hosts the 1954 and 1992 texts only as Arabic PDFs, not readable here.
   - **Counsel must answer this.**
3. **Even if expired, commercial use still needs a licence** [fact for the law]. Art. 183: the competent ministry "shall grant license for the commercial or professional exploitation" of public-domain works, sound recordings and performances, for a fee of at most EGP 1,000.
4. **Moral rights never expire** (Art. 155) [fact for the law]. Cutting a murattal into ayat, or any trimming or processing, risks a claim of "modification" by the heirs **[interpretation]**. Credit is mandatory.
5. **Law 102/1985 applies to the recording as a Mushaf recording, whatever its copyright status** [fact for the law, secondary transcription].
   - Al-Azhar's Islamic Research Academy licenses "recording for circulation".
   - **The Ministry of Awqaf's own recordings are exempt; the Minister of Awqaf licenses those.**
   - So a licence **from the Ministry of Awqaf** for the 1961 murattal may cover both the copyright and the regulatory layer **[interpretation]**.
6. **Which file?** A web file is usually a later *release*: a Sono Cairo cassette or CD, a remaster, a radio capture or a compilation.
   - Its date and producer may differ from the 1961 original.
   - Whether a digital remaster creates a new protected phonogram under Art. 138(11) is **[interpretation]**.
   - Jawwid could never prove which master a web file came from.
7. **Abroad, status differs [interpretation].**
   - US: foreign works still protected at home on the 1996 restoration date received US protection. If a 1961 Egyptian recording was protected in Egypt then, it could be protected in the US for decades. This depends on point 2.
   - Other countries apply their own terms and moral rights.
   - **A licence from the producer travels. A public-domain argument does not.**
8. **Comparative signal [secondary, persuasive only]:** in 2018 the Supreme Court of Jordan upheld damages against a company that distributed a reciter's recitation CDs "without a written agreement on the financial terms" (WIPO IP Judges Forum summary, https://www.wipo.int/wipolex/fr/text/591695). Recitation recordings are enforced like any other recording.

**Conclusion on H-3:** For a paid service, **public domain is not a usable legal basis for any Husary recording without:**
- (a) a written opinion from Egyptian counsel, edition by edition;
- (b) an Art. 183 ministry licence;
- (c) a Law 102/1985 clearance;
- (d) the heirs' consent on moral rights.

Once you need all four, a **licence from the producer** is simpler and stronger.

### H-4. Download, host, reproduce, stream, verse by verse?

| Use | Without permission | With the producer's written licence (and the heirs' consent) |
|---|---|---|
| Download from the web | **No.** Web copies are of unknown origin (CD rips, radio captures). | Get the **master from the licensor**, not from the web. |
| Store on our servers | **No.** Storage is "reproduction" (Art. 138(9)). | Yes, if the licence lists it (Art. 149). |
| Stream to students | **No.** Making available needs prior written authorisation (Art. 156–157). Criminal exposure under Art. 181(4). | Yes, if listed. |
| Paid subscription | **No.** | Yes, if listed. |
| Verse-by-verse playback | **No.** There are no official per-ayah Husary files from any rights holder. EveryAyah's per-ayah cuts are unlicensed. | Only with **express written consent to segmentation**, from the producer and the heirs (Art. 155). Jawwid makes the cuts from the licensed master, then a teacher QA's them, then each is fingerprinted with SHA-256. |
| Redistribution outside the app | **No.** | Don't do it. It is not needed. |

### H-5. Comparison

| | **Al-Husary** (e.g. 1961 Hafs murattal or the Muʿallim) | **KFGQPC Hafs** (Al-Hudhaify et al.) | **Commissioned Egyptian reciter** |
|---|---|---|---|
| Rights holder identified? | Partly. Likely the Ministry of Awqaf for 1961; the NMA or Sono Cairo for the radio and label editions; the heirs for moral rights. Edition ownership is unresolved. | **Yes**: the Complex, as producer. | **Yes**: Jawwid, as producer, plus the reciter by contract. |
| Written permission today? | **None.** | **Yes**: a public grant. Paid-use scope pending F-2. | Created by the contract. |
| Per-ayah files from the rights holder | **No.** Jawwid would have to segment, with consent. | **Yes**, with an official SHA-256. | **Yes**: record per ayah by design. |
| Paying students | Only after a licence, the heirs' consent, counsel's opinion and Law 102 clearance. | After F-2 and the Law 102 opinion. | After the contract, registration and Law 102 clearance. |
| Law 102/1985 position | Possibly simplest *if* the Ministry of Awqaf licenses its own 1961 recording **[interpretation]**. | Needs counsel (a foreign licensed recording). | Needs an Al-Azhar licence **[interpretation]**. |
| Worldwide use | Only as far as the licence says. A PD argument fails abroad. | **Yes** ("inside and outside the Kingdom"). | Yes, if the contract says so. |
| Time and cost to clear | **Highest uncertainty.** Several parties, a government process, unknown fee. | **Lowest**: one e-mail. | Medium: a contract, studio time and a reciter's fee (not estimated here). |
| Teaching fit for children in Egypt | Very high recognition. The **Muʿallim** edition was made for teaching (a pedagogy judgement for the teachers). | Clear, standard Hafs. | Can be designed for children: pace, repetition, an Egyptian voice. |
| Long-term risk | Highest: fragmented ℗ claims and an active state rights holder. | Low. | Lowest. |

### H-6. Recommendation

**Can Jawwid safely use Al-Husary's recordings for paying students today? No.**

Keep them **off** in every environment that real students use. It doesn't matter where the file came from. Specifically:
- **Do not** use EveryAyah, Quran.com, mp3quran, Internet Archive, el-hosary.com, YouTube or streaming-store copies.
- **Do not** rely on public domain.

**What must happen before launch (all of it, in writing):**
1. **Choose the edition.** For example, the 1961 Hafs murattal, or the Muʿallim for children. Rights differ by edition.
2. **Ask the producer for a licence** (letter F-3):
   - for the 1961 murattal: the **Ministry of Awqaf / Supreme Council for Islamic Affairs**;
   - for the radio editions: the **National Media Authority**;
   - for the label edition: **Sono Cairo**.

   Ask each to confirm what it holds, and to supply the master. If one of them says the term has expired, get that in writing too, and then step 4.
3. **The heirs' written consent** for credit and for per-ayah segmentation (Art. 155). Route: through the licensor, or the Sheikh Al-Husari Association.
4. **Egyptian counsel**, edition by edition:
   - pre-2002 status and terms;
   - whether an Art. 183 licence is needed;
   - Law 102/1985: does an Awqaf licence suffice, or is an Al-Azhar licence also needed?
   - Art. 185 registration.
5. **Ingest only the licensor's master.** Segment it per ayah, have a teacher QA it, and record a SHA-256 manifest. Keep the licence, consent and opinion with the `reciter_code`, as in section E.

**Interim:** keep building and testing with **Al-Hudhaify (KFGQPC)**. That is the owner's choice for build and test, not for paying students. If Husary matters for children's teaching, open F-3 now in parallel, because government processes are slow. If no licence arrives, commissioning an Egyptian reciter is the clean long-term route.

### H-7. Letter F-3: request to the producer of an Al-Husary edition

> Send one copy per institution: the Ministry of Awqaf (Supreme Council for Islamic Affairs) for the 1961 murattal; the National Media Authority (Egyptian Radio / Quran Radio) or Sono Cairo for their editions. Send a copy to the Sheikh Al-Husari Association, asking it to forward the moral-rights paragraph to the heirs. Ask for a **signed** reply (Law 82/2002, Art. 149).

**العربية**

> **الموضوع: طلب ترخيص غير حصري باستخدام تسجيل [المصحف المرتل برواية حفص عن عاصم – 1961 / المصحف المعلم / …] بصوت فضيلة الشيخ محمود خليل الحصري في منصة تعليمية**
>
> السادة / [وزارة الأوقاف – المجلس الأعلى للشئون الإسلامية | الهيئة الوطنية للإعلام – إذاعة القرآن الكريم | شركة صوت القاهرة للصوتيات والمرئيات] المحترمين،
> السلام عليكم ورحمة الله وبركاته،
>
> نحن **أكاديمية جوّد (Jawwid Academy)**، أكاديمية تعليمية عبر الإنترنت لتحفيظ القرآن الكريم للأطفال وتعليم اللغة العربية والعلوم الإسلامية، ومقرّ سوقنا الرئيسي جمهورية مصر العربية مع طلاب من دول أخرى.
>
> نرغب في إتاحة تلاوة فضيلة الشيخ محمود خليل الحصري – **[اسم الإصدار وتاريخه]** – لطلابنا آيةً آيةً داخل منصتنا وتطبيقنا التعليمي، ونرجو التكرم بما يلي:
>
> 1. **تأكيد صفتكم**: هل أنتم منتج هذا التسجيل أو مالك حقوقه حاليًا؟ وهل تحتفظون بالنسخة الأصلية (الماستر)؟ وإن كانت الحقوق لدى جهة أخرى فنرجو إفادتنا بها.
> 2. **منحنا ترخيصًا كتابيًا غير حصري** يحدد صراحةً الحقوق التالية ونطاقها ومدتها ومكانها:
>    - (أ) تسلُّم نسخة رقمية من التسجيل منكم وتخزينها على خوادمنا؛
>    - (ب) بثها (Streaming) لطلابنا المسجلين، وإتاحة الاستماع دون اتصال داخل التطبيق بصورة غير قابلة للاستخراج؛
>    - (ج) **تقسيم التلاوة إلى ملف مستقل لكل آية** دون حذف أو إضافة أو أي تعديل في الأداء، ومراجعة التقسيم من معلمين مجازين؛
>    - (د) تحويل الصيغة أو معدل الترميز تقنيًا فقط؛
>    - (هـ) الاستخدام ضمن خدمة تعليمية **قد تكون باشتراك مدفوع**، دون بيع الملفات منفصلة أو إعادة توزيعها خارج منصتنا.
> 3. **النطاق**: جميع الدول؛ **المدة**: [غير محددة / ١٠ سنوات قابلة للتجديد]؛ **المقابل**: [يُتفق عليه].
> 4. إن رأيتم أن مدة الحماية قد انقضت، نرجو التكرم بإفادتنا بذلك كتابيًا، وبالإجراء الواجب للحصول على ترخيص الاستغلال التجاري وفق المادة 183 من القانون رقم 82 لسنة 2002، وبموقفكم من الترخيص المنصوص عليه في القانون رقم 102 لسنة 1985 بشأن تسجيل المصحف الشريف للتداول.
> 5. **الحقوق الأدبية**: نتعهد بنسبة التلاوة إلى فضيلة الشيخ الحصري في كل موضع، وبعدم تحريفها أو تعديلها، ونرجو التكرم بإبلاغ ورثة فضيلته بطلبنا للحصول على موافقتهم على صيغة النسبة وعلى التقسيم آيةً آيةً.
> 6. **صيغة النسبة** المفضلة لديكم (مثال: «تلاوة فضيلة الشيخ محمود خليل الحصري – بإذن من [الجهة]»)، وسنعرضها في المشغّل وفي صفحة «المصادر والتراخيص»، وسنحفظ لكل ملف بصمة SHA-256.
>
> ونرجو أن يكون الرد **موقّعًا** من مفوَّض بالتوقيع، إذ يشترط القانون المصري أن يكون الترخيص كتابيًا ومفصّلًا.
>
> وجزاكم الله خيرًا،
> [الاسم والصفة] — أكاديمية جوّد
> [البريد الإلكتروني] · [الهاتف] · [الموقع]

**English**

> **Subject: Request for a non-exclusive licence to use the recording [Murattal Mushaf, Hafs ʿan ʿĀṣim, 1961 / Al-Muʿallim / …] by Sheikh Mahmoud Khalil Al-Husary in an educational platform**
>
> To [the Ministry of Awqaf, Supreme Council for Islamic Affairs | the National Media Authority, Holy Quran Radio | Sono Cairo],
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> **Jawwid Academy** is an online academy teaching children Quran memorisation, Arabic and Islamic studies. Our main market is Egypt, and we also serve students in other countries.
>
> We would like to offer Sheikh Mahmoud Khalil Al-Husary's recitation, **[edition and date]**, verse by verse, inside our educational platform and app. We kindly ask you to:
>
> 1. **Confirm your standing.** Are you the producer or current rights holder of this recording, and do you hold the original master? If another party holds the rights, please tell us who.
> 2. **Grant us a written, non-exclusive licence** that states each of the following rights with its scope, duration and territory:
>    - (a) receiving a digital copy from you and storing it on our servers;
>    - (b) streaming it to our enrolled students, with in-app offline playback in a form that cannot be extracted;
>    - (c) **splitting the recitation into one file per ayah**, with nothing removed, added or altered in the performance, and the split reviewed by certified teachers;
>    - (d) technical format or bitrate conversion only;
>    - (e) use within an educational service that **may be offered by paid subscription**, with no separate sale of files and no redistribution outside our platform.
> 3. **Territory:** worldwide. **Term:** [perpetual / 10 years, renewable]. **Fee:** [to be agreed].
> 4. If you consider the term of protection to have expired, please confirm this in writing. Please also tell us the procedure for the commercial-exploitation licence under Article 183 of Law No. 82 of 2002, and your position on the licence under Law No. 102 of 1985 for recording the Mushaf for circulation.
> 5. **Moral rights.** We undertake always to credit Sheikh Al-Husary and never to alter or distort the recitation. Please forward our request to his heirs for their consent to the credit line and to verse-by-verse segmentation.
> 6. **Your preferred credit line** (e.g. "Recitation by Sheikh Mahmoud Khalil Al-Husary, by permission of [institution]"). We will show it in the player and on our "Sources and Licences" page, and record a SHA-256 fingerprint for every file.
>
> We would be grateful for a reply **signed** by an authorised signatory, since Egyptian law requires such licences to be written and itemised.
>
> JazākumAllāhu khayran,
> [Name, title], Jawwid Academy
> [e-mail] · [phone] · [website]

---

## I. Al-Husary: practical licensing routes (the owner's direction, 2026-10-28)

**The owner's direction.** Pursue Al-Husary seriously. Find how established apps obtain the recordings, who can authorise Jawwid, and the fastest route. Prepare the letters.

**Guard rails, unchanged:**
- Husary stays **disabled for paying students** until the rights are verified.
- Other apps using the recordings does **not** prove that our use is authorised.
- **Nothing was sent to any organisation or person.** Contact is the owner's own action, using the letters in I-5.
- No audio was downloaded.

Sources were read on 2026-10-28 (evidence log, rows 63–80). The same labels apply: **[fact]**, **[secondary]**, **[interpretation]**, **[unresolved]**.

### I-1. How established apps get Al-Husary: what they publicly say

| App / platform | What it says about Husary audio rights | Label |
|---|---|---|
| **About 37 App Store apps carrying Husary**, from an App Store search on 2026-10-28 for "Husary / الحصري / المصحف المعلم" and the main app names. They include high-volume apps (Athkar, iQuran, Quran Majeed, Al Quran by Greentech, Prayer Now, Elmohafez) and many single-reciter Husary apps. | **None of the store descriptions names a licensor, a licence or a rights statement for the recitation.** | [fact, store text] |
| **Quran.com / Quran Foundation** | Content is for "personal, non-commercial use only". The developer terms disclaim non-infringement (see C and B-3). | [fact] |
| **Quran for Android** (open source; one of the most-installed Quran apps) | Its maintainer, publicly, in 2021: the content is free "as far as we know, we take anything down whenever we get copyright notices about it" (GitHub quran/quran_android #755). | [fact] **This is a notice-and-takedown posture, not a licence.** |
| **Tarteel QUL** (the source many apps take ayah-by-ayah Husary files and timings from: "resource 112", Husary Muʿallim and Murattal) | At least five public requests for written permission to use Husary audio in apps (#644, #718, #727, #823, #957), the earliest from July 2026. **None has a maintainer answer.** The only reply points to the repository's MIT licence, which covers the code, not the audio. | [fact] |
| **Islamic Network** | Copyright "still belongs to … the reciter"; they "may ask you to remove" (see C). | [fact] |
| **Egypt's official Holy Quran Radio portal and app** (`misrquran.gov.eg`; app `com.mcit.holyquranradio`, built by the Ministry of Communications for the National Media Authority, launched March 2026) | Lists **471 Husary recordings** (e.g. «المصحف المجود لفضيلة الشيخ محمود خليل الحصري», in segments). Footer: «جميع الحقوق محفوظة لإذاعة القرآن الكريم المصرية» ("all rights reserved to the Egyptian Holy Quran Radio"). No download links. Support e-mail on the official store listing: **quran@maspero.eg**. | [fact] **The only party seen distributing Husary that claims rights openly is the state Quran Radio, under the NMA.** |
| **Streaming stores** (Apple Music catalogue) | 10+ competing ℗ claimants. The largest, **Injaz Digital** (104 releases), is a YouTube rights-management and digital-distribution company with offices in Dubai and Cairo (info@injazdigital.com). Its site lists Quran-reciter partners. | [fact]. Whose rights Injaz distributes is [unresolved]. |
| Muslim Pro, Athan, Ana Muslim, Ayah, Al-Moshaf | Not established. Muslim Pro's terms URL returned 404. The others' legal pages were not reached or are JavaScript-only. | [unresolved] |

**Conclusion [interpretation].** The established-app practice is mostly **unlicensed use under a notice-and-takedown assumption**, by apps that are free and often based outside Egypt. That is no model for a **paid, Egypt-based** service. Art. 181 makes unauthorised internet dissemination a **crime**, not just a takedown. No app examined discloses a licence that Jawwid could copy or join.

### I-2. Who can authorise what

| Candidate | Can it authorise? | Which edition | Official contact | Verified? |
|---|---|---|---|---|
| **National Media Authority: Holy Quran Radio** (الهيئة الوطنية للإعلام – إذاعة القرآن الكريم) | **Most likely yes, for the radio holdings.** It claims all rights on its official portal, holds the digitised archive (a presidential digitisation mandate, 2026), and already distributes digitally. | Radio editions, including the **Mujawwad Mushaf** (listed) and other radio recordings. Possibly broadcast masters of the murattal, [unresolved]. | **quran@maspero.eg** (support e-mail on the official app's store listing). The postal address was not read on an official page. Use the Maspero head office, confirmed by phone. | E-mail: **[fact]**. Address: [unverified]. |
| **Ministry of Awqaf: Supreme Council for Islamic Affairs** (وزارة الأوقاف – المجلس الأعلى للشئون الإسلامية) | **Likely yes, for the 1961 Hafs murattal** it funded and supervised (H-1), *if* it retained the producer's rights. **Also central under Law 102/1985**: Awqaf's own recordings are exempt from Al-Azhar licensing, and the Minister of Awqaf licenses them. | 1961 Hafs murattal (and possibly the 1960s Warsh/Qālūn/Dūrī recordings). | Official site `awqaf.gov.eg`. It could not be reached from this research environment, so no contact detail was taken from it. **The owner should take the contact from the site's «اتصل بنا» page or deliver by hand to the Ministry's head office.** | [unverified] |
| **Sono Cairo** (صوت القاهرة للصوتيات والمرئيات), an NMA company | **Yes, for its own label edition.** It enforces "contracts only through Sono Cairo" (2021 precedent; regulator notice). | «مصحف حفص – صوت القاهرة» and other label releases. | No official site or contact found. **Route through the NMA** (send F-3c to the NMA, asking that it be forwarded to Sono Cairo). | [unverified] |
| **Al-Husary heirs** | **Required in every route, for moral rights** (Art. 155: credit; consent to per-ayah segmentation). Possibly residual economic rights under the original contracts [unresolved]. | All editions. | Through the **Sheikh Al-Husary Association**: 6th of October City, Central Axis, Al-Husary Square, next to Al-Husary Mosque; tel. 01143331333 (from the association's own contact page). The association is a charity founded by admirers, **not shown to represent the heirs**; ask it to forward. | Contact: [fact]. Representation: [unresolved]. |
| **Injaz Digital** (distributor) | **Only if it proves a sublicensable grant from the producer.** A distributor's ℗ claim alone is not enough. | The releases it distributes (104 on Apple). | info@injazdigital.com; WhatsApp +971 58 691 5958 (its own site). | Contact: [fact]. Rights: [unresolved]. |
| **Al-Azhar: Islamic Research Academy** (مجمع البحوث الإسلامية) | **Regulatory licence** under Law 102/1985 for "recording for circulation", unless the Awqaf exemption covers the licensed recording. **No published procedure for audio or apps was found.** In July 2026 the Academy discussed protecting digital Mushaf copies (press). | All, as a regulatory overlay. | Through counsel. | [unverified] |
| **Egyptian Intellectual Property Authority** (Law 163/2023) | **Art. 183** commercial licence for public-domain recordings, and the **Art. 185** register, now most likely with this Authority, which replaced the Ministry of Culture and the Media Council in IP functions (in force 7 Aug 2023). | Any edition treated as public domain; registration of Jawwid's licences. | Official site not reachable from here. Through counsel. | Law: [fact, secondary transcription + WIPO Lex dates]. Contact: [unverified]. |

### I-3. Routes ranked

Each route is scored by how fast it is likely to move, its likely cost, and how complete the grant can be. "Complete" means it covers a paid subscription, self-hosting, streaming, per-ayah segmentation and worldwide use.

| Rank | Route | Edition | Speed | Cost | Completeness if granted | Why |
|---|---|---|---|---|---|---|
| **1** | **NMA Holy Quran Radio** (F-3b), **plus the heirs' consent** (F-3d) | Mujawwad Mushaf and other radio holdings; possibly the murattal broadcast masters | Medium. One verified e-mail channel; the institution is actively digitising and "investing" its archive. | Unknown; likely a commercial fee | **High.** It holds the digital masters and can supply files and grant streaming and hosting. Segmentation needs the heirs' consent. | The only candidate with a **verified official contact**, **the masters already digitised**, and an **open rights claim**. |
| **2** | **Ministry of Awqaf / Supreme Council for Islamic Affairs** (F-3a), **plus the heirs** (F-3d) | **1961 Hafs murattal**, the most-used Husary set | Slow (ministerial) | Possibly nominal for education [unresolved] | **Highest legal value** if it still holds the producer's rights: it may resolve copyright **and** Law 102/1985 together *(interpretation)*. It may need the NMA for the masters. | The best legal fit for the flagship murattal. Send in parallel with rank 1. |
| **3** | **Sono Cairo via the NMA** (F-3c) | The Sono Cairo Hafs edition | Slow to medium | Commercial | High for its edition | An active enforcer. Worth it only if the owner prefers that edition. |
| **4** | **Injaz Digital** (F-3e) | Its 104 releases | **Fastest to answer** (private company) | Commercial | **Only as good as its chain of title.** Accept only with written proof that the producer authorised it to sublicense apps. | Useful mainly to *find out who it licenses from*. |
| — | "Public domain" via an Art. 183 licence (Egyptian IP Authority) | Pre-1976 editions | Slow | ≤ EGP 1,000 per work, plus counsel | Weak: moral rights, Law 102 and foreign markets remain | **Not recommended** as the main route (H-3). |

**Recommended first letter: F-3b to the National Media Authority, Holy Quran Radio (quran@maspero.eg).** Send **F-3a to the Ministry of Awqaf the same week**, delivered by hand or through its official contact, because the 1961 murattal is the edition most likely wanted. **F-3d to the heirs** goes with whichever producer answers first.

### I-4. What a valid permission must contain

Every grant must cover all of the following, in writing and itemised (Art. 149). Each letter attaches the same **Schedule of Rights**.

1. Identification of the **exact edition** (title, date, riwayah) and the grantor's **capacity** (producer or assignee), with the chain of title.
2. **Delivery of the master files** by the grantor: lossless where possible, per surah or per ayah, with a **SHA-256 for each file** and a manifest.
3. Reproduction and **storage on Jawwid's servers**, including backups and CDN caches.
4. **Streaming** to enrolled students, and **in-app offline playback** that cannot be extracted.
5. **Per-ayah segmentation** and technical transcoding, with **no change to the performance**. Segments reviewed by certified teachers.
6. Use inside a **paid educational subscription** (no separate sale of files, no redistribution outside the platform).
7. **Territory: worldwide. Term:** perpetual, or ≥ 10 years renewable. Non-exclusive. Fee stated.
8. **Credit line** (Art. 155), and a **warranty** that the grantor holds the rights and that no third-party consent is missing. Notification of any heirs' or performer's conditions.
9. Consent to **registration** of the licence (Art. 185 / Egyptian IP Authority) if counsel advises it.
10. Signature by an **authorised signatory**, on letterhead, with the institution's stamp.

### I-5. Letters F-3a to F-3e (Arabic and English)

> **To be sent by the owner, not by this research.** Each letter attaches the **Schedule of Rights**, Arabic and English, below.

#### Schedule of Rights (جدول الحقوق المطلوبة): attach to F-3a, F-3b, F-3c and F-3e

**العربية**

> **جدول الحقوق المطلوبة — ترخيص غير حصري لأكاديمية جوّد (Jawwid Academy)**
>
> 1. **التسجيل**: [اسم الإصدار، تاريخه، الرواية] بصوت فضيلة الشيخ محمود خليل الحصري، مع بيان صفة المرخِّص (منتج التسجيل أو المتنازَل إليه) وسند ملكيته.
> 2. **تسليم الملفات الأصلية (الماستر)** من المرخِّص بأعلى جودة متاحة (يُفضَّل غير مضغوطة)، مقسّمة بالسورة أو بالآية، مع **بصمة SHA-256 لكل ملف** وقائمة بها.
> 3. **النسخ والتخزين** على خوادم الأكاديمية ونسخها الاحتياطية وشبكات توزيع المحتوى التابعة لها.
> 4. **البث (Streaming)** للطلاب المسجلين، و**الاستماع دون اتصال داخل التطبيق** بصورة غير قابلة للاستخراج.
> 5. **التقسيم آيةً آيةً** والتحويل التقني للصيغة دون أي تعديل في الأداء، مع مراجعة التقسيم من معلمين مجازين.
> 6. **الاستخدام ضمن خدمة تعليمية باشتراك مدفوع**، دون بيع الملفات منفصلة أو إعادة توزيعها خارج المنصة.
> 7. **النطاق**: جميع الدول — **المدة**: غير محددة أو ١٠ سنوات قابلة للتجديد — **غير حصري** — **المقابل**: [يُحدَّد].
> 8. **صيغة النسبة** المعتمدة، و**ضمان** المرخِّص لملكيته للحقوق وعدم الحاجة إلى موافقة طرف آخر، أو بيان أي موافقة لازمة (الورثة/المؤدي).
> 9. الموافقة على **قيد الترخيص** لدى الجهة المختصة إن لزم.
> 10. **التوقيع** من مفوَّض بالتوقيع على ورق رسمي مختوم.

**English**

> **Schedule of Rights: non-exclusive licence to Jawwid Academy**
>
> 1. **Recording:** [edition, date, riwayah] by Sheikh Mahmoud Khalil Al-Husary, with the licensor's capacity (producer or assignee) and proof of title.
> 2. **Delivery of master files** by the licensor, at the best available quality (lossless preferred), per surah or per ayah, with a **SHA-256 for each file** and a manifest.
> 3. **Reproduction and storage** on the Academy's servers, backups and CDN.
> 4. **Streaming** to enrolled students, and **in-app offline playback** that cannot be extracted.
> 5. **Verse-by-verse segmentation** and technical format conversion, with no change to the performance; segments reviewed by certified teachers.
> 6. **Use within a paid educational subscription**, with no separate sale of files and no redistribution outside the platform.
> 7. **Territory:** worldwide. **Term:** perpetual, or 10 years renewable. **Non-exclusive.** **Fee:** [to be set].
> 8. The approved **credit line**, and the licensor's **warranty** of title and that no other consent is needed, or a statement of any consent required (heirs/performer).
> 9. Consent to **registration** of the licence with the competent authority if required.
> 10. **Signature** by an authorised signatory, on stamped letterhead.

#### F-3a: the Ministry of Awqaf, Supreme Council for Islamic Affairs (1961 Hafs murattal)

**العربية**

> **الموضوع: طلب ترخيص باستخدام «المصحف المرتل» (رواية حفص عن عاصم – 1961) بصوت فضيلة الشيخ محمود خليل الحصري في منصة تعليمية للأطفال**
>
> معالي وزير الأوقاف / السيد الأمين العام للمجلس الأعلى للشئون الإسلامية، المحترم،
> السلام عليكم ورحمة الله وبركاته،
>
> تتشرف **أكاديمية جوّد** — أكاديمية لتحفيظ القرآن الكريم للأطفال عبر الإنترنت تخدم الأسر في مصر وخارجها — بالتقدم بهذا الطلب، تقديرًا لدور الوزارة التاريخي في مشروع «المصحف المرتل» الذي أشرفت الوزارة على تنفيذه وتمويله من خلال المجلس الأعلى للشئون الإسلامية عام 1961.
>
> نرجو التكرم بما يلي:
> 1. إفادتنا بما إذا كانت الوزارة/المجلس يحتفظ بحقوق منتج هذا التسجيل، وبالنسخة الأصلية منه، أو بالجهة التي آلت إليها.
> 2. منحنا ترخيصًا غير حصري وفق **جدول الحقوق المرفق**، مع تسليم الملفات الأصلية مصحوبة ببصمات SHA-256.
> 3. إفادتنا — في ضوء المادة الأولى من القانون رقم 102 لسنة 1985 التي تستثني ما تقوم به وزارة الأوقاف من تسجيل وتداول المصحف الشريف وتجعل الترخيص فيه لمعالي الوزير أو من ينيبه — بما إذا كان ترخيص الوزارة يغني عن ترخيص مستقل من مجمع البحوث الإسلامية لهذا التسجيل.
> 4. التكرم بإبلاغ ورثة فضيلة الشيخ الحصري بطلبنا أو إفادتنا بطريقة التواصل المعتمدة معهم.
>
> ونتعهد بنسبة التلاوة إلى فضيلة الشيخ وإلى الوزارة في كل موضع، وبعدم إدخال أي تعديل على الأداء، وبالالتزام بما تضعونه من شروط.
>
> وتفضلوا بقبول فائق الاحترام،
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف] · [العنوان]
> المرفقات: جدول الحقوق المطلوبة · نبذة عن الأكاديمية

**English**

> **Subject: Licence request for the 1961 Murattal Mushaf (Hafs ʿan ʿĀṣim) by Sheikh Mahmoud Khalil Al-Husary, for a children's educational platform**
>
> To H.E. the Minister of Awqaf / the Secretary-General of the Supreme Council for Islamic Affairs,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> **Jawwid Academy**, an online Quran memorisation academy for children focused on Egypt, respectfully submits this request. We recognise the Ministry's historic role in the 1961 Murattal Mushaf, which it funded and supervised through the Supreme Council for Islamic Affairs.
>
> We kindly ask the Ministry to:
> 1. Confirm whether the Ministry or the Council retains the producer's rights in this recording and its original master, or which body now holds them.
> 2. Grant a non-exclusive licence under the **attached Schedule of Rights**, with delivery of the master files and their SHA-256 checksums.
> 3. Advise whether, given Article 1 of Law No. 102 of 1985 (which exempts the Ministry's own recording and circulation of the Mushaf and places its licensing with the Minister or his delegate), the Ministry's licence makes a separate licence from the Islamic Research Academy unnecessary for this recording.
> 4. Forward our request to Sheikh Al-Husary's heirs, or tell us the approved way to contact them.
>
> We undertake to credit the Sheikh and the Ministry wherever the recitation is used, never to alter the performance, and to follow any conditions the Ministry sets.
>
> With our highest respect,
> [Name, title], Jawwid Academy · [e-mail] · [phone] · [address]
> Enclosures: Schedule of Rights · Academy profile

#### F-3b: the National Media Authority, Holy Quran Radio (recommended first letter)

**العربية**

> **الموضوع: طلب ترخيص باستخدام تسجيلات فضيلة الشيخ محمود خليل الحصري المحفوظة لدى إذاعة القرآن الكريم في منصة تعليمية للأطفال**
>
> السيد رئيس الهيئة الوطنية للإعلام / السيد رئيس إذاعة القرآن الكريم، المحترم،
> السلام عليكم ورحمة الله وبركاته،
>
> نهنئكم على إطلاق البوابة والتطبيق الرسميين لإذاعة القرآن الكريم وما يحفظانه من تراث التلاوة المصرية.
>
> **أكاديمية جوّد** أكاديمية لتحفيظ القرآن الكريم للأطفال عبر الإنترنت، تخدم الأسر في مصر وخارجها، ونرغب في إتاحة تلاوة فضيلة الشيخ الحصري لطلابنا آيةً آيةً.
>
> نرجو التكرم بما يلي:
> 1. إفادتنا بإصدارات فضيلة الشيخ التي تملك الهيئة حقوقها (ومنها «المصحف المجود» المدرج على البوابة، و«المصحف المرتل» إن كان لديكم)، وبالإدارة المختصة بالترخيص التجاري والتعاقد.
> 2. منحنا ترخيصًا غير حصري وفق **جدول الحقوق المرفق** للإصدار: [المصحف المرتل / المصحف المجود / المصحف المعلم]، مع تسليم الملفات الأصلية مصحوبة ببصمات SHA-256.
> 3. إحالة الطلب إلى شركة **صوت القاهرة للصوتيات والمرئيات** إن كانت الحقوق لديها.
> 4. إفادتنا بموقف الهيئة من موافقة ورثة فضيلة الشيخ على التقسيم آيةً آيةً وصيغة النسبة.
>
> وتفضلوا بقبول وافر الاحترام،
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف] · [العنوان]
> المرفقات: جدول الحقوق المطلوبة · نبذة عن الأكاديمية

**English**

> **Subject: Licence request for Sheikh Mahmoud Khalil Al-Husary's recordings held by the Holy Quran Radio, for a children's educational platform**
>
> To the Chairman of the National Media Authority / the Head of the Holy Quran Radio,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> Congratulations on launching the official Holy Quran Radio portal and app, and on preserving Egypt's heritage of recitation.
>
> **Jawwid Academy** is an online Quran memorisation academy for children, serving families in Egypt and abroad. We would like to offer Sheikh Al-Husary's recitation to our students verse by verse.
>
> We kindly ask the Authority to:
> 1. Tell us which of the Sheikh's editions the Authority holds rights in (including the Mujawwad Mushaf listed on the portal, and the Murattal Mushaf if held), and which department handles commercial licensing and contracts.
> 2. Grant a non-exclusive licence under the **attached Schedule of Rights** for the edition: [Murattal / Mujawwad / Muʿallim], with delivery of the master files and their SHA-256 checksums.
> 3. Forward the request to **Sono Cairo** if it holds the rights.
> 4. Tell us the Authority's position on the heirs' consent to verse-by-verse segmentation and to the credit line.
>
> With our sincere respect,
> [Name, title], Jawwid Academy · [e-mail] · [phone] · [address]
> Enclosures: Schedule of Rights · Academy profile

#### F-3c: Sono Cairo (through the NMA)

**العربية**

> **الموضوع: طلب ترخيص باستخدام إصدار «مصحف حفص» بصوت فضيلة الشيخ محمود خليل الحصري من إنتاج صوت القاهرة**
>
> السيد رئيس مجلس إدارة شركة صوت القاهرة للصوتيات والمرئيات، المحترم،
> السلام عليكم ورحمة الله وبركاته،
>
> **أكاديمية جوّد** أكاديمية لتحفيظ القرآن الكريم للأطفال عبر الإنترنت. نرجو التكرم بإفادتنا بالإصدارات التي تملك الشركة حقوقها من تلاوات فضيلة الشيخ الحصري، ومنحنا ترخيصًا غير حصري وفق **جدول الحقوق المرفق** للإصدار [اسم الإصدار وتاريخه]، مع تسليم الملفات الأصلية مصحوبة ببصمات SHA-256، وبيان أي موافقة لازمة من ورثة فضيلته.
>
> وتفضلوا بقبول فائق الاحترام،
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف]
> المرفقات: جدول الحقوق المطلوبة

**English**

> **Subject: Licence request for the Sono Cairo "Hafs Mushaf" edition by Sheikh Mahmoud Khalil Al-Husary**
>
> To the Chairman of Sono Cairo,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> **Jawwid Academy** is an online Quran memorisation academy for children. Please tell us which of Sheikh Al-Husary's editions Sono Cairo holds rights in. We ask for a non-exclusive licence under the **attached Schedule of Rights** for [edition and date], with delivery of the master files and their SHA-256 checksums, and a statement of any consent needed from the Sheikh's heirs.
>
> With our highest respect,
> [Name, title], Jawwid Academy · [e-mail] · [phone]
> Enclosure: Schedule of Rights

#### F-3d: the heirs of Sheikh Al-Husary (moral-rights consent), through the Sheikh Al-Husary Association

**العربية**

> **الموضوع: طلب موافقة ورثة فضيلة الشيخ محمود خليل الحصري على نسبة التلاوة وتقسيمها آيةً آيةً لأغراض تعليمية**
>
> السادة القائمون على جمعية الشيخ الحصري — مع رجاء التكرم بإحالته إلى ورثة فضيلته،
> السلام عليكم ورحمة الله وبركاته،
>
> **أكاديمية جوّد** أكاديمية لتحفيظ القرآن الكريم للأطفال. نسعى للحصول على ترخيص من الجهة المنتجة لتسجيل فضيلة الشيخ [اسم الإصدار]، ونرجو من ورثة فضيلته الكرام:
> 1. **الموافقة الكتابية على صيغة النسبة**: «تلاوة فضيلة الشيخ محمود خليل الحصري — رحمه الله» [أو الصيغة التي يرتضونها].
> 2. **الموافقة الكتابية على تقسيم التلاوة إلى ملف لكل آية** وتحويل صيغتها تقنيًا، **دون حذف أو إضافة أو أي تعديل في الأداء**، مع مراجعة التقسيم من معلمين مجازين، لاستخدامها داخل منصتنا التعليمية (وقد تكون باشتراك مدفوع)، في جميع الدول.
> 3. إفادتنا بأي حقوق مالية يرى الورثة أنها ما زالت لهم في هذا التسجيل، أو بأي شروط يرغبون فيها.
>
> ونتعهد بصون التلاوة وإجلال صاحبها، جزاه الله عن القرآن وأهله خير الجزاء.
>
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف]

**English**

> **Subject: Request for the consent of Sheikh Mahmoud Khalil Al-Husary's heirs to credit and verse-by-verse segmentation for education**
>
> To the Sheikh Al-Husary Association, kindly forwarded to the Sheikh's heirs,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> **Jawwid Academy** teaches children to memorise the Quran. We are seeking a licence from the producer of the Sheikh's recording [edition]. We respectfully ask his heirs for:
> 1. **Written consent to the credit line**: "Recitation by Sheikh Mahmoud Khalil Al-Husary, may Allah have mercy on him" (or the wording they prefer).
> 2. **Written consent to splitting the recitation into one file per ayah**, and to technical format conversion, **with nothing removed, added or altered in the performance**, the segments reviewed by certified teachers. The use would be within our educational platform (possibly by paid subscription), worldwide.
> 3. Information on any economic rights the heirs consider they still hold in this recording, or any conditions they wish to set.
>
> We undertake to preserve the recitation and honour the reciter. May Allah reward him on behalf of the Quran and its people.
>
> [Name, title], Jawwid Academy · [e-mail] · [phone]

#### F-3e: Injaz Digital (chain-of-title inquiry, then a licence only if proven)

**العربية**

> **الموضوع: استفسار عن سند حقوق إصدارات فضيلة الشيخ محمود خليل الحصري التي توزعونها، وإمكانية الترخيص لتطبيق تعليمي**
>
> السادة / إنجاز ديجيتال، المحترمين،
> السلام عليكم ورحمة الله وبركاته،
>
> نلاحظ أن عددًا كبيرًا من إصدارات فضيلة الشيخ الحصري على المنصات الرقمية يحمل اسم شركتكم في سطر (℗). نرجو التكرم بإفادتنا:
> 1. بالجهة المنتجة/المالكة التي توزعون هذه الإصدارات نيابةً عنها، وبصفة تعاقدكم (موزع/مرخَّص له/مالك).
> 2. بما إذا كان تعاقدكم يخولكم **الترخيص من الباطن لتطبيقات تعليمية**؛ فإن كان كذلك، نرجو تقديم عرض وفق **جدول الحقوق المرفق** مع صورة من سند التخويل.
>
> [الاسم والصفة] — أكاديمية جوّد · [البريد] · [الهاتف]
> المرفقات: جدول الحقوق المطلوبة

**English**

> **Subject: Chain of title for the Sheikh Mahmoud Khalil Al-Husary releases you distribute, and possible licensing for an educational app**
>
> To Injaz Digital,
> Assalāmu ʿalaykum wa raḥmatullāhi wa barakātuh.
>
> Many of Sheikh Al-Husary's digital releases carry your company in the (℗) line. Please tell us:
> 1. On whose behalf (which producer or owner) you distribute these releases, and in what capacity (distributor, licensee or owner).
> 2. Whether your agreement authorises you to **sublicense educational apps**. If it does, please send an offer under the **attached Schedule of Rights**, with a copy of the authorisation.
>
> [Name, title], Jawwid Academy · [e-mail] · [phone]
> Enclosure: Schedule of Rights

### I-6. Next steps

1. **The owner** sends F-3b to `quran@maspero.eg`, and sends F-3a to the Ministry of Awqaf through its official contact or by hand, **in the same week**. Keep proof of sending and delivery.
2. **The owner** sends F-3d to the Sheikh Al-Husary Association, timed with whichever producer answers.
3. **Optional:** F-3e to Injaz Digital, for chain-of-title information only.
4. **Engineering, meanwhile:**
   - keep building and testing with Al-Hudhaify (KFGQPC);
   - design the ingest so a licensed Husary master can be dropped in later (per-ayah segments plus a SHA-256 manifest);
   - keep a `reciter_code` such as `husary-murattal-1961` **disabled for paying students** until the rights record exists.
5. **Follow-up:** if there's no answer within 3–4 weeks, re-send by registered post to the head office. Ask counsel whether an Art. 183 / Egyptian IP Authority route is worth running alongside.
6. **When a grant arrives:** counsel reviews it against I-4 before any file is ingested. The owner switches Husary on for paying students only after counsel's sign-off.

**Egyptian IP lawyer's checklist:**
1. Who holds the producer's rights in the chosen edition today? Verify the grantor's chain of title (the 1961 Awqaf funding; any transfer to ERTU/NMA or Sono Cairo).
2. Pre-2002 protection of performances and phonograms (Law 354/1954, as amended by Law 38/1992), and how Law 82/2002 applies to the edition. Is any right still running? When does it end?
3. Is the grant's form valid under Art. 149 (itemised rights, purpose, duration, place), signed by an authorised signatory?
4. Moral rights (Art. 155): is the heirs' consent sufficient for per-ayah segmentation, and who the heirs are.
5. Law 102/1985: does an Awqaf licence for an Awqaf recording satisfy Art. 1, or is an Islamic Research Academy licence also needed for in-app streaming and offline playback? What is the procedure?
6. Law 163/2023: is the Egyptian IP Authority now the "competent ministry" for Art. 183 (public-domain licence) and Art. 185 (register of dispositions)? Should Jawwid's licence be registered?
7. Distributor claims (Injaz Digital and others): is there any risk that a distributor's ℗ claim conflicts with the grantor's?
8. Foreign markets: does the licence's worldwide grant suffice, and are there country-specific religious-publication rules for the first non-Egyptian markets?
9. Contract terms: warranty and indemnity, termination, and what happens to segments and caches on termination.

---

## Final classification (the brief's decision rule)

| Category | Recordings |
|---|---|
| **Verified permission, no additional licence** | KFGQPC recordings (A-1 to A-5 Hafs, plus four other riwayat): verified for download, self-hosting and streaming in apps and websites by a private institution, worldwide. **For the paid-subscription context, a scope confirmation (F-2) is pending.** |
| **Open licence with conditions** | ClearQuran English translation audio (CC BY-ND 4.0 plus the author's extra grant; attribution). quran-align timing data (CC BY 4.0; data only). |
| **Permission must be requested** | **Mishary Rashid Alafasy** (Alafasy Berhad, F-1). **Mahmoud Khalil Al-Husary**, edition by edition (Ministry of Awqaf / Supreme Council for Islamic Affairs for the 1961 murattal; National Media Authority or Sono Cairo for theirs; the heirs for moral rights; F-3 and counsel). Quran Foundation (for QuranCDN audio). Other classic Egyptian murattal (Sono Cairo / National Media Authority, plus counsel on Art. 183). Any commissioned reciter. |
| **Unverified or prohibited** | EveryAyah, Quran.com, QuranicAudio, Islamic Network CDN, mp3quran, Tanzil (audio), YouTube, Internet Archive "public domain" uploads (including the Husary CD rips, radio captures and the PD-Mark item), el-hosary.com downloads, third-party CC tags on Wikimedia Commons, the self-published Commons recordings (until identity is verified). |

**Remaining uncertainty:**
- (1) Whether Law 102/1985 covers in-app audio.
- (2) Whether KFGQPC's "free general use" covers paid subscriptions.
- (3) Who holds title to Alafasy's historic murattal.
- (4) Pre-2002 Egyptian neighbouring-rights status of radio-era recordings.
- (5) Foreign-country status of any "public domain" claim.
- (6) Who holds each Al-Husary edition today, and its masters: the Ministry of Awqaf, the NMA or Sono Cairo.
- (7) The terms of Al-Husary's original contracts.
- (8) Whether a Ministry of Awqaf licence also satisfies Law 102/1985 for the 1961 murattal.

Items (1), (4), (5) and (8) need an Egyptian (and, if relevant, foreign) IP lawyer. Items (6) and (7) need the institutions' written answers (F-3).

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
| 43 | Al-Dostor: Ministry of Awqaf marks the 1961 murattal | https://www.dostor.org/5645145 | 09:29:06 | `dd063d29fbe1b934` | Secondary (the Ministry's statement): Awqaf supervised the project through the Supreme Council for Islamic Affairs |
| 44 | Youm7: 23 July 1961, first murattal records | https://www.youm7.com/story/2026/7/23/…/7490195 | 09:29:05 | `c325b937ffc75c75` | Secondary (quotes Labib al-Said's memoir): recorded "with the Ministry of Awqaf's funds"; the Society's initiative |
| 45 | Al-Dostor: did Al-Husary ask for a fee? | https://www.dostor.org/3541021 | 09:29:05 | `5df252c182d62c98` | Secondary (cites *Al-Ahram*, 18 June 1964): contract paid for records only; fee demanded for broadcasting |
| 46 | Alukah: start of the recorded Mushaf | https://www.alukah.net/sharia/0/172860/ | 09:29:22 | `fcf3a4011824eec4` | Secondary history of the 1959–61 project |
| 47 | Awqaf Online: Al-Husary page | https://awkafonline.gov.eg/content-sections/131/3683/… | 09:29:22 | **HTTP 403** | Could not be read |
| 48 | el-hosary.com: home | https://el-hosary.com/ | 09:30:30 | `f194bc14537ea98a` | Lists distinct editions (Egyptian Radio, Sono Cairo, Saudi Radio, Muʿallim …); no licence; host credit only |
| 49 | el-hosary.com: Egyptian Radio, Sono Cairo, Saudi Radio, Muʿallim pages | https://el-hosary.com/egbroadcast/ · /cairosound/ · /ksabroadcast/ · /el-moalem/ | 09:30:57–09:30:59 | `1ac4be032c479b2a` · `aecc1edf188b60a0` · `09197a4f67fc1745` · `5c5692fd5ca615ca` | Download pages; no terms |
| 50 | el-hosary.com: page index (WP API) | https://el-hosary.com/wp-json/wp/v2/pages | 09:31 | n/a | Edition pages created 2019–2025 |
| 51 | Sheikh Al-Husari Association | https://elhosary.co/ · https://elhosary.co/en/sheikh-mahmoud-khalil-al-hossari/ | 09:30:32–34 | `a0d95b30062f813d` · `f6e873ae49e68aab` | Charity no. 318, founded 1996 by admirers; no licensing terms |
| 52 | Apple catalogue search API (Husary albums, EG + US) | https://itunes.apple.com/search?term=…&entity=album | 09:29:47 | `5b13d13f1068f6d4` (raw JSON) | 206 albums; 10+ distinct ℗ claimants |
| 53 | Supreme Council for Media Regulation: Sono Cairo ruling | https://scm.gov.eg/حكم-تاريخي-صوت-القاهرة-مالكة-حقوق-أغني/ | 09:31:37 | `4a1a22ef8e43e27b` | Regulator: contracts go only through Sono Cairo; criminal liability asserted (Umm Kulthum precedent) |
| 54 | National Media Authority: Maspero digitisation | https://www.maspero.eg/radio-and-tv-magazine-media/2026/08/11/979441/… | 09:31:38 | `b6011a6259d42bc3` | NMA archive; digitisation; platform to invest the content |
| 55 | El-Balad: global Quran Radio site | https://www.elbalad.news/6666444 | 09:31:38 | `1cd59f465c32307c` | Secondary: presidential direction to preserve the reciters' heritage |
| 56 | WIPO: Jordan Supreme Court 621/2018 | https://www.wipo.int/wipolex/fr/text/591695 | 09:30:34 | `df9c88fc345c6d9a` | Comparative: recitation CDs without written consent infringe |
| 57 | WIPO Lex: Law 354/1954 | https://www.wipo.int/wipolex/en/legislation/details/7297 | 09:32:09 | `e972ca5bc261f7e2` | Repealed; Arabic PDF only (text not read) |
| 58 | WIPO Lex: Law 38/1992 | https://www.wipo.int/wipolex/en/legislation/details/17022 | 09:32:09 | `c9191e802e256ea8` | Amended 354/1954; Arabic PDF only (text not read) |
| 59 | Internet Archive: Husary items (metadata API) | https://archive.org/details/al-husari · /hussary_202310 · /aldiakhmadw_gmail_20180501 · /Hussary_201610 | 09:32–09:33 | n/a (API) | CD rips; uploader-set PD Mark; radio capture; vinyl transfer |
| 60 | EveryAyah: Husary folders | https://everyayah.com/data/ | 08:48:01 | `fc0ed8704ae3e5b9` | Five Husary folders including Muʿallim and Mujawwad; no licence |
| 61 | KFGQPC: audio page (Husary absent) | https://qurancomplex.gov.sa/quran-audios/ | 08:56:51 | `c75630d05fa24cb8` | Nine recordings, none by Al-Husary |
| 62 | English Wikipedia: Al-Husary | https://en.wikipedia.org/wiki/Mahmoud_Khalil_Al-Hussary | 09:00 (API) | n/a | Secondary: 17 Sept 1917 – 24 Nov 1980 |
| 63 | App Store search API (Husary apps and major Quran apps, EG + US) | https://itunes.apple.com/search?…&entity=software | 09:41:43 | `19a70babf6f5d92c` (raw JSON) | ~37 apps carrying Husary; no licensor named in any description |
| 64 | Quran for Android: issue #755 (maintainer, 2021-02-11) | https://github.com/quran/quran_android/issues/755 | ≈09:42 (API) | n/a | "we take anything down whenever we get copyright notices" |
| 65 | Tarteel QUL: Husary licensing requests #644, #718, #727, #823, #957 | https://github.com/TarteelAI/quranic-universal-library/issues/718 (and the others) | ≈09:49 (API) | n/a | Open since July–Oct 2026; no maintainer answer; repository LICENSE is MIT (code) |
| 66 | Muslim Pro terms | https://www.muslimpro.com/terms-of-service | 09:42:25 | `1471070119c2cd5c` (**HTTP 404**) | Not readable |
| 67 | Elmohafez | https://www.elmohafez.com/ | 09:42:26 | `78d881a4435a65e1` | No rights statement found |
| 68 | Holy Quran Radio portal: home (rendered in browser) | https://misrquran.gov.eg/home | ≈09:44 | n/a (rendered) | Footer «جميع الحقوق محفوظة لإذاعة القرآن الكريم المصرية» |
| 69 | Holy Quran Radio portal: Husary recordings (rendered in browser) | https://misrquran.gov.eg/records?id=64f361c0-7b18-4ffb-afce-a165008655c6 | ≈09:45 | n/a (rendered) | 471 Husary recordings, including «المصحف المجود»; no download links |
| 70 | Holy Quran Radio API: reciters lookup | https://api.misrquran.gov.eg/api/QuraanLookup/QuraanRecordingsRecitersLookup | 09:44:06 | `03d8922152c41285` | Husary listed with id `64f361c0-…` |
| 71 | Holy Quran Radio portal: privacy policy (rendered) | https://misrquran.gov.eg/privacy-policy | ≈09:46 | n/a (rendered) | All rights reserved to the Holy Quran Radio |
| 72 | Google Play: official Holy Quran Radio app | https://play.google.com/store/apps/details?id=com.mcit.holyquranradio | 09:43:00 | `f64e7c22604d0f43` | Developer: Ministry of Communications; support e-mail quran@maspero.eg; portal misrquran.gov.eg |
| 73 | NMA press: thanks to the Ministry of Communications for the portal and app | https://www.maspero.eg/press-center/2026/03/19/938044/… | 09:42:59 | `291f322e4520cc33` | Official launch; 60+ years of archive |
| 74 | Al-Nahar: launch of the official Quran Radio site and app | https://www.alnaharegypt.com/1169478 | 09:43:00 | `8cd9183a46d54778` | Secondary: rare recitations of the great reciters |
| 75 | Sheikh Al-Husary Association: contact page | https://elhosary.co/تواصل-معنا/ | 09:46:13 | `af806679a933e6d3` | Address and phone |
| 76 | Injaz Digital: home | https://www.injazdigital.com/ | 09:48:19 | `2e28d9c01137fd59` | Distributor and YouTube rights manager; Dubai and Cairo; info@injazdigital.com |
| 77 | WIPO Lex: Law 163/2023 (Egyptian IP Authority) | https://www.wipo.int/wipolex/en/legislation/details/22398 | 09:46:41 | `b108126941c5bc9a` | In force 7 Aug 2023 |
| 78 | Law 163/2023 text (secondary transcription) | https://alberonsy.com/?p=3853 | 09:46:43 | `bcfe0e249d459324` | The Authority replaces the ministries (incl. Culture) and the Media Council in IP functions |
| 79 | Ministry of Awqaf site | https://awqaf.gov.eg/ | 09:46:10 | **no response** (curl); the browser was not approved for this site | Contact not verified |
| 80 | Islamic Research Academy and digital Mushaf (Youm7, July 2026) | https://www.youm7.com/story/2026/7/14/…/7481642 | (search result only) | n/a | Secondary: the Academy is studying the protection of digital Mushaf copies; no audio-licence procedure published |
