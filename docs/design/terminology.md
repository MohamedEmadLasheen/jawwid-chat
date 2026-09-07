> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Display-label rules stand; concept names are governed by `docs/contracts/DOMAIN-VOCABULARY.md` (e.g. `super_admin` exists as a role even though the label 'super admin' is not shown).
> Canonical index: `docs/README.md`.

# Jawwid Chat — Terminology (English / العربية)

**Owner:** AI #6 · **Status:** authoritative for all UI strings on both platforms.

One concept, one word, one translation, everywhere. If a concept is not in this file, it does
not get a new name invented for it — it gets added here first.

Rules:

1. **Never translate the same concept two ways.** "Case" is always `حالة` internally and
   `موضوع` customer-facing — those are two *concepts*, not two translations (§3).
2. **Never expose an internal word to a family.** The customer column is a separate vocabulary,
   not a politer register of the same one.
3. **Never show a raw enum.** `waiting_internal` is a database value; the UI shows
   *"Waiting on our team"* / *"بانتظار فريقنا"*.
4. **Never show a score.** Attention is a section heading plus a sentence, never a number.

---

## 1. People and responsibility

| Concept | English UI | Arabic UI | Usage rule |
|---|---|---|---|
| `family` | Family | الأسرة | The unit of ownership and of the inbox row. Never "customer" in UI. |
| `contact` | Contact | جهة التواصل | A person inside a family. Show `name + relationship`. |
| `learner` | Student | الطالب | Customer-facing word for a learner. Never "learner" in UI. |
| `family.owner_id` | **Primary Owner** | **المسؤول الأساسي** | The PRD's term. Permanent. Changes only through *Change owner*. Always visible on the family header. |
| `on_duty(family, now)` | **Current Handler** | **المسؤول الحالي** | The PRD's term (*"Primary Owner ≠ Current Handler"*). Who may act *right now*. Additive to the Primary Owner, never a replacement for it. |
| `on_behalf_mode=owner` | (no label) | (بدون تسمية) | The default. Showing a label here would make the normal case look exceptional. |
| `on_behalf_mode=coverage` | Covering | تغطية | Shown on the message and on the family header. |
| `on_behalf_mode=assist` | Assist | مساندة | Shown on the message. Always paired with the reason. |
| `on_behalf_mode=escalation` | Escalated | تصعيد | Shown on the message and on the case. |
| `sticky_handler_id` | Keeping this | محتفظ بها | Set by the *"I'll keep this"* action. Expires. |
| coverage relationship | Covering for {name} | يغطي عن {الاسم} | Never "assigned to". Assignment language implies ownership moved. |
| `on_duty()` returns NONE | **Unattended** | **بدون مناوب** | Manager-only. Never shown to an admin or a family. |
| `staff.role=manager` | Manager | المدير | |
| `staff.role=finance/technical/academic` | Finance / Technical / Academic | المالية / التقنية / الأكاديمية | Department staff. They see tasks, never families. |
| teacher (see OQ-2) | Teacher | المعلم | Mobile only. |

**Forbidden words:** *assigned to*, *ticket*, *agent*, *queue*, *super admin*, *SLA*, *priority*,
*P1/P2/P3*, *score*. Each one either contradicts an invariant or names something that does not exist.

## 2. Conversation

| Concept | English UI | Arabic UI | Usage rule |
|---|---|---|---|
| `thread` | Conversation | المحادثة | One per family, forever. It is never "opened", "closed" or "resolved". |
| `message.visibility=customer` | (no label) | (بدون تسمية) | The default. |
| `message.visibility=internal` | **Internal note** | **ملاحظة داخلية** | Always labelled, always visually distinct, never visible to a family. |
| `system` message | (rendered as a card) | (تُعرض كبطاقة) | Never a bubble. Never attributed to a person. |
| `handoff` | Handover | تسليم | The card the receiving admin sees. Not "transfer" — that word is reserved for ownership. |
| away summary | What happened while you were away | ماذا حدث أثناء غيابك | Owner's morning digest. Exact string; it is a promise, not a heading. |
| `attachments` | Attachment | مرفق | |
| voice note *(mobile)* | Voice note | رسالة صوتية | |
| Student Group *(mobile, OQ-3)* | Student Group | مجموعة الطالب | The official teacher ↔ family channel. Always named after the student. |

## 3. Cases and work — internal vs customer-facing

This is the one place where the same underlying record has two vocabularies. That is deliberate.

| Record | Staff sees | العربية (داخلي) | Family sees | العربية (للأسرة) |
|---|---|---|---|---|
| `case` | Case | حالة | **Topic** | **موضوع** |
| `case.status=open` | Open | مفتوحة | We're on it | نعمل عليه |
| `case.status=waiting_customer` | Waiting on family | بانتظار الأسرة | We're waiting for your reply | بانتظار ردك |
| `case.status=waiting_internal` | Waiting on our team | بانتظار فريقنا | We're checking with our team | نراجعه مع فريقنا |
| `case.status=scheduled` | Scheduled | مجدولة | Scheduled | مجدول |
| `case.status=resolved` | Resolved | تم الحل | Done | تم |
| `case.status=closed` | Closed | مغلقة | *(not shown)* | *(لا يُعرض)* |
| `case.owner_locked` | For the owner | للمسؤول الأساسي | *(never shown)* | *(لا يُعرض)* |
| `case.is_blocking` | Blocking | معطِّل | *(never shown)* | *(لا يُعرض)* |
| `task` | Task | مهمة | *(never shown)* | *(لا يُعرض)* |
| follow-up (`due_at` + reason) | Follow-up | متابعة | *(never shown)* | *(لا يُعرض)* |
| `escalation_level > 0` | Escalated | مُصعَّدة | *(never shown)* | *(لا يُعرض)* |

Case types: Technical `تقنية` · Billing `مالية` · Schedule `الجدول` · Renewal `التجديد` ·
Cancellation `إلغاء` · Complaint `شكوى` · Onboarding `بداية الاشتراك` · At risk `معرّضة للخطر` ·
Academic `أكاديمية` · General `عامة`.
The last four are **never** shown to a family under any name.

## 4. Attention and workload

| Concept | English UI | Arabic UI | Usage rule |
|---|---|---|---|
| bucket `NOW` | Now | الآن | An inbox **section heading**. Never a badge on a row. |
| bucket `TODAY` | Today | اليوم | Section heading. |
| bucket `WAITING ON FAMILY` | Waiting on family | بانتظار الأسرة | Section heading, collapsed by default. |
| bucket `QUIET` | Quiet | هادئ | Section heading, search-only. |
| `top_reason` | *(the sentence itself)* | *(الجملة نفسها)* | e.g. "Class started 5 minutes ago" / «بدأ الدرس قبل ٥ دقائق». Rendered verbatim. Never prefixed with "Reason:". |
| attention score | — | — | **Has no UI representation.** |
| response target 70% elapsed | Reply time running out | يقترب وقت الرد | Not "SLA at risk". |
| response target breached | Reply overdue | تأخر الرد | Not "SLA breached". |
| `workload_level=low` | Light | خفيف | |
| `workload_level=medium` | Steady | متوسط | |
| `workload_level=high` | Heavy | مرتفع | The highest level that exists. |
| workload score | *(number, manager only)* | | Shown only on the manager dashboard, always beside its breakdown. |

## 5. Ownership and coverage actions

| Action | English UI | Arabic UI | Usage rule |
|---|---|---|---|
| `transfer_ownership()` | **Change owner** | **تغيير المسؤول الأساسي** | Never "assign", never "reassign". Requires a reason. |
| handover on shift end | Hand over | تسليم | Automatic. Not an ownership change. |
| `sticky_handler` | I'll keep this | سأتابعها بنفسي | |
| defer to owner | Leave for the owner | اتركها للمسؤول الأساسي | |
| reply as assist | Reply as assist | رد كمساندة | Only ever shown when all preconditions are met. |
| escalate | Escalate to manager | تصعيد للمدير | Requires a reason. |
| activate backup | Activate backup | تفعيل البديل | Manager only. Never automatic in MVP. |
| offboard | Offboard | إنهاء عمل الموظف | Manager only. |

## 6. Approvals *(PRD MVP scope; the authorized approver is OQ-1)*

| Concept | English UI | Arabic UI | Usage rule |
|---|---|---|---|
| approval pending | Waiting for approval | بانتظار الاعتماد | The **sender** sees this on their own message. Other members see nothing at all. |
| approved | Sent | تم الإرسال | Once approved it is an ordinary message. The word "approved" is not shown to the sender — the message simply behaves like a message. |
| rejected | Not sent | لم تُرسل | Always accompanied by the reason. Never the bare word "rejected". |
| approval queue *(admin)* | Approvals | الاعتمادات | |

## 7. Calls *(PRD MVP scope — voice, 1:1 and group; video is Phase 2)*

Calling · مكالمة | Incoming · مكالمة واردة | Outgoing · مكالمة صادرة | Connecting · جارٍ الاتصال |
Connected · متصل | Mute · كتم | Speaker · مكبر الصوت | End · إنهاء | Missed · مكالمة فائتة |
Call history · سجل المكالمات.

**Phone numbers are never a UI concept in either language.** People are named, never dialled.

## 8. Arabic writing rules

1. **Gender.** Prefer the person's *name* over a gendered role noun wherever the sentence allows
   it: «نور تغطي هذه الأسرة» not «المسؤولة المناوبة». Where a role noun is unavoidable, use the
   neutral nominal construction (`جهة التواصل`, `المناوبة الحالية`) rather than a gendered agent
   noun. See OQ-6 — pending confirmation, this is the working rule.
2. **Numerals.** Western digits `0–9` in both locales, always (see `decisions.md` DD-09).
3. **Dates and times.** Gregorian, 12-hour with `ص/م` in Arabic, `AM/PM` in English.
   Relative time up to 24h ("5 minutes ago" / «قبل ٥ دقائق» → rendered `قبل 5 دقائق`), absolute after.
   Timezone: Africa/Cairo.
4. **No transliteration.** «كيس» for case, «تاسك» for task, «إسكاليشن» are forbidden.
5. **Sentence case in English.** Never Title Case On Buttons. Arabic has no case; keep buttons
   verb-first: «إرسال», «تغيير المسؤول الأساسي».
6. **Server-originated strings** (`top_reason`, system messages, rejection reasons, reminder
   bodies) must arrive localised or as key+params. The client never composes them from fragments.
   **Backend dependency** — raised by AI #3 (C-cross-cutting) and AI #4 (Q2); AI #6 supports
   **key + params**, because `top_reason` is the most-read string in the product and it contains
   numbers and durations that pluralise differently in Arabic.
7. **Arabic plurals** have six forms. Any string containing a count must go through ICU plural
   selection, never `n + " " + noun`.
