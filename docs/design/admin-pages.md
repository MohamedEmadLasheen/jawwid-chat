# Admin web: every page, its users, data and states

Source of truth: `apps/admin-web/src` as of 2026-11-27 (branch `ui/admin-redesign`). Read from code only; endpoints are quoted exactly as the client calls them.

- **Stack.** React + Vite, `react-router-dom` routes in `app/AppRoutes.tsx`, server state through `@tanstack/react-query`. Every page lays out what the API computed; the client counts almost nothing itself.
- **Roles** (`core/permissions/capabilities.ts`): `super_admin` (SA, sees the `/admin/*` portal), `manager` (MGR), operators `admin` and `coverage` (OP), legacy departments `finance`, `technical` and `academic` (DEPT, Tasks and Accounts only), and `specialist` (SPEC: Designer, Pronunciation reviewer, Content author).
- **Server probes** decide departments a role cannot reveal: `GET /lessons/access` returns `lessonManager` (the Teachers department), `sales`, `operations`, `calendar` and `supervisionPage`. The others are `GET /instalments/access` (`billingReader`), `/certificates/access`, `/lesson-audio/access`, `/teacher-records/access`, `/materials/admin/access`, and the `GET /me` permission keys (`moderation.view`, `staff_accounts.*`, `whiteboards.*` and so on).
- **How navigation is decided.** A route is open if `visibleAreas(role)` holds its area (`<Area>`); otherwise it renders `ForbiddenPage`. The rail lists only areas whose probe also agreed (`SERVER_CONFIRMED_AREAS`, `navAreas`). Destinations come from `app/navigation.ts` (`DESTINATIONS`, `AREA_DESTINATION`, `ADMIN_AREA_ENTRIES`). All of this is UX: the server authorises every request.
- **Landing (`homeFor`).** SA lands on `/admin/conversations`. A specialist lands on `/certificates`, or on `/lesson-audio` if they are a Pronunciation reviewer only. DEPT lands on `/tasks`, everyone else on `/chat`. The logo opens `/today`.

**Shared states on every page.**
- `QueryBoundary`: a spinner while loading; on error, the server's message with Retry.
- A 403 (`ApiError.isForbidden`) shows a lock icon and `common.forbidden`, with no retry.
- A failed route gate shows `ForbiddenPage` (a lock and "Go to start").
- Some pages render 403/404 as a lock `EmptyState` that carries the server's reason.

Rail destinations (en / ar):
- Conversations / المحادثات
- Dashboard / لوحة المتابعة
- People & Organization / الأشخاص والهيكل التنظيمي
- Sales / المبيعات
- Scheduling / الجدولة
- Operations / التشغيل
- Certificates / الشهادات
- Educational materials / المواد التعليمية
- Finance / المالية
- Communication / التواصل
- Admin & Settings / الإدارة والإعدادات

---

## Priority 1: Teacher statistics and Schedule

| Route · page (nav en / ar) | Who | For | Reads | Main writes | States worth designing |
|---|---|---|---|---|---|
| `/teachers` · Teacher statistics. Rail: People → Teachers "Teachers / المعلمون", tab "Statistics / الإحصائيات". `?month=YYYY-MM`. | Route: SA, MGR, OP. Rail: `lessonManager` (Teachers department). | Compare every teacher's month in one ledger. | `GET /stats/teachers?month`, `GET /lessons/access` | none | Loading; 403 shows a calm lock line with no retry; empty `noTeachers`; a search that finds nothing; inactive teacher "· inactive"; zero figures set quietly (`ts-zero`); `unreported.lessons > 0` in the attention colour; `summary` missing shows "—" in Excuses. |
| `/teachers?teacher=<id>&month=` · one teacher's month | same | One teacher's month as a record: figures in the masthead, a category sheet per outcome, side facts. | `GET /stats/teachers/:id?month` | none | 403 lock; `workload.availableMinutes === null` shows "No working hours recorded yet"; information-only categories show only when `lessons > 0`; a category with no lessons shows "no data"; `movements` and `movesByTeacher` are optional (older server); make-ups fact only when `summary` is absent. |
| `/admin/reports` · Reports & analytics / التقارير والتحليلات (Admin & Settings → Reports & quality) | SA | Same page as `/teachers`, without the Teachers tabs. | same | none | same |
| `/schedule` · Academy calendar / تقويم الأكاديمية (Scheduling). URL: `view=day\|week\|month`, `date`, filters. | Route: SA, MGR, OP. Rail: `calendar` (Teachers department, Operations, SA). | Every teacher's shift, lessons, leave and empty time on the academy clock, filterable. | `GET /calendar/options`, `GET /calendar?from&to&…filters` (day/week), `GET /calendar/summary?…` (month), `GET /calendar/stats?…` | none on the page. The shift is edited in the Teacher file (`POST /teachers/:id/work-pattern`). Supervisor colours are set on `/organization` (`POST /org/staff/:id/calendar-color`). | Options refused (403) blocks the page; empty `noTeachers` with hint "Clear a filter…"; an Operations supervisor opens on their own students (`viewer.scope==='supervisor'`, note `mineDefault`); other supervisors' lessons are `anonymous: true` (time and colour only, "Another supervisor's student"); `lessonFilter` note (`capacityNote`); non-matching lessons drawn as "Other booking"; overlapping lessons drawn in lanes (double booking is visible, not flagged); `outsideShift`; leave band; paused; trial; moved; `suspendedFor:'payment'` ("Suspended — payment"); not-taught outcomes struck through; phone width uses an agenda and a bottom-sheet filter. |
| `/teachers/schedules` · Teachers' schedules / جداول المعلمين (Scheduling; Teachers tab "Schedules / الجداول"). `?teacher=` | Route: Area `teachers`. Rail: `lessonManager`. | One teacher's desk: weekly working hours, days off, and their students' times, extra lessons, moves, teacher change, pause or stop. | `GET /lessons/roster`, `GET /teachers/:id/availability`, plus the desk reads listed under Schedule data. | `POST /teachers/:id/availability`, `POST /teachers/:id/days-off`, `POST /teachers/:id/days-off/:date/remove`, plus the desk writes listed under Schedule data. | No teacher picked (`pickTeacher` empty state); student with no times (`noTimesYet`); paused badge `suspension.kind==='temporary'` with `returnOn`, or stopped; `locked` (payment lock) refuses every write (`lockedRefusal`); 409 `COMM.LESSON_TEACHER_BUSY` "time taken in between, pick again"; move refusals; candidate teacher `away` (leave or suspended until), `readiness` warning. |
| `/schedule/students` · Student schedules / جداول الطلاب (Scheduling). `?student=&teacher=` (`__none` means no teacher). | Route: Area `student-schedules`. Rail: `lessonManager`. | The same desk, entered student-first and grouped by teacher. | `GET /lessons/roster` and the desk reads | Desk writes | Masthead figure "no teacher": `teacherId===null` count, urgent when > 0; empty `noStudents`; the "no teacher" group is listed first. |
| `/teachers/needs-action` · Needs action / بحاجة إلى إجراء (Operations; Teachers tab) | Route: Area `teachers`. Rail: `lessonManager`. | The Teachers department's daily queue of lessons and requests waiting on a decision. | `GET /lessons/needs-action`, `GET /correction-requests?status=all` | `POST /lessons/:id/absence`, `/teacher-no-show`, `/cancel`; `POST /lesson-rulings/:id/decide`; `POST /lessons/:id/makeup-resolution`; `POST /schedule-change-requests/:id/decide`; `POST /lessons/blocked/:id/schedule\|dismiss`; `POST /lessons/:id/correction-requests` (ask for the report); `POST /correction-requests/:id/withdraw`; `POST /suspensions/:id/extend\|end` | All clear (`allClear`); 8 queues (see Schedule data); masthead shows the first 4 non-empty queues, "Reports overdue" urgent; `stillFree:false` disables Approve ("no longer free"); blocked `reason:'teacher_changed'`. |
| `/teachers/students` · Teachers tab "Students / الطلاب" (no rail entry) | Area `teachers` | Paused and stopped students. | `GET /suspensions?kind=temporary\|permanent&status=active` | `POST /suspensions/:id/extend`, `POST /suspensions/:id/end` | Empty `nonePaused` / `noneStopped`; `returnOn`; `packageBalance`. |

### Teacher statistics: every field the endpoints return (`features/teachers/api.ts`)

`GET /stats/teachers?month` returns `{ month, zone, teachers: TeacherRow[] }`.

| Field (TeacherRow) | Meaning / shown as |
|---|---|
| `teacher { id, name, isActive }` | Row name; "inactive" tag |
| `held`, `scheduled`, `notHeld`, `unreported`, `upcoming` | Each a `Bucket { lessons, minutes }`. Column "Held / المنعقدة" (lessons · hours) with "Counted / المحتسبة" and "Not held / لم تُعقد" under it. `upcoming` is returned but not shown in the list. |
| `attendanceRate` (0..1 or null) | "Attendance / الحضور" = held ÷ (held + student absent). This is the student's attendance, not the teacher's. |
| `reportsOnTimeRate` (0..1 or null) | "Reports on time / التقارير في موعدها" (within 24 h), with "Needs report / بانتظار التقرير" = `unreported.lessons` under it |
| `trials: TrialStats` | `total, conducted, subscribed, notSubscribed, noShow, awaiting, upcoming, cancelled, conversionRate`. The list shows `subscribed / total`. |
| `summary?: MonthSummary` | "Excuses / الأعذار": student `beforeStart + afterStart` · teacher excuses; make-ups `completed / total` |
| `movesByTeacher?` | "Moved by teacher / نقلها المعلم": information only, never a violation |

`GET /stats/teachers/:id?month` returns a `TeacherDetail`.

| Field | Content |
|---|---|
| `teacher { id, name }`, `month`, `zone` | header |
| `categories[]: { key, lessons, minutes, counted, byDuration[{ durationMinutes, lessons, minutes }] }` | `key` is one of: `held` (Completed / المنعقدة), `upcoming` (Scheduled), `unreported` (Awaiting report), `student_apology`, `teacher_apology`, `student_no_show` (Student absent), `teacher_no_show` (Teacher absent / غياب المعلم), `admin_cancelled`, `rescheduled` (Moved, info only), `suspended` (Paused, info only). `counted:false` shows "for information; not counted". |
| `summary?: MonthSummary` | `totalScheduled, conducted, studentAttended, studentNoShow, studentExcuses{ total, beforeStart, afterStart }, teacherExcuses, teacherNoShow, cancelled, pending{ total, upcoming, awaitingReport }, completed{ regular, makeup, total }, makeups{ completed, scheduled, total }` |
| `totals { counted: Bucket, scheduledMinutes }` | masthead "Total counted" |
| `makeups { lessons, held }` | shown only when `summary` is absent |
| `trials: TrialStats` | full trial breakdown and `conversionRate` |
| `rates { attendance, completion, teacherReliability }` | masthead. Completion = held ÷ every closed counted lesson. Reliability = lessons not lost through the teacher. |
| `reports { reports, onTime, onTimeRate, medianDelayMinutes }` | "Lesson reports": on time within 24 h, and the **median delay** (the late-report measure) |
| `replies { familyMessages, answeredWithin, rate, medianReplyMinutes }` | "Replies to families": answered within 24 h, median reply time |
| `workload { availableMinutes\|null, scheduledMinutes, freeMinutes\|null, bookedWithinMinutes?, pausedWithinMinutes?, outsideMinutes? }` | available = bookedWithin + pausedWithin + free. `outside` = booked beyond the hours. Only available, free and scheduled are shown today. |
| `movements? { transfersIn, transfersOut, paused, stopped }` | student movements in the month |
| `previous { month, held: Bucket }` | "last month: N h" line |
| `movesByTeacher?` | info only |

**Elsewhere for the same teacher:**
- **Teacher file → Records → Lesson reports.** `GET /teacher-files/:id/lesson-reports?month&status&cursor` returns `counts { reports, onTime, late, pending, missing }`. Each row has `status: 'on_time'|'late'|'pending'|'missing'`, `report.submittedAt`, `report.delayMinutes`, `report.graceHours`, and `anotherFamily` (counted, never named). **This is the only per-lesson "late report" data.**
- **Teacher file → Overview** reuses `GET /stats/teachers/:id`.

### Schedule data: every field (`features/schedule/api.ts`, `features/teachers/opsApi.ts`)

**Calendar query** (in the URL; the same names go to the API):
- `from`, `to`, `teacherIds`, `categories`, `supervisorIds` (`none` = no supervisor), `learnerIds`
- `statuses`: `active|trial|paused|moved`
- `kinds`: `regular|makeup|trial`
- `weekdays`: ISO, week starts Saturday
- `utilization`: `lt50|50to80|gte80`
- `timeFrom`, `timeTo`, `emptyMinutesGte`
- `onlyMatching`: on by default

| Endpoint | Fields |
|---|---|
| `GET /calendar/options` | `zone`; `viewer { staffId, scope: 'academy'\|'teachers'\|'supervisor', canEditShifts, canEditColors }`; `palette[]`; `teachers[{ id, name, isActive, category, timezone }]`; `supervisors[{ id, name, role: 'manager'\|'supervisor'\|'backup_supervisor', colorKey }]`; `learners[{ id, name, teacherId }]` |
| `GET /calendar` (day/week) | `zone, from, to, lessonFilter`; `teachers: CalendarTeacher[]`; `days[{ teacherId, day, shift[], work[], leave[], empty[], free[] }]` (each an `[from,to)` interval list); `lessons[]` |
| CalendarTeacher | `id, name, isActive, category: 'full_shift'\|'part_shift'\|'hourly'\|'unset', zone, lessons, matching, utilization`, plus `totals { shiftMinutes, workMinutes, leaveMinutes, bookedMinutes, pausedMinutes, inShiftBookedMinutes, inShiftPausedMinutes, inShiftLeaveMinutes, emptyMinutes, freeMinutes, outsideMinutes }` |
| CalendarLesson | `id, teacherId, startsAt, endsAt, kind, status: 'active'\|'trial'\|'paused'\|'moved', colorKey, matches, outsideShift`. Either named: `learner{ id, name }\|null, prospect{ name }\|null, outcome, suspendedFor: 'payment'\|null, movedFrom`. Or `anonymous: true`. |
| `GET /calendar/summary` (month) | `zone, from, to, lessonFilter, teachers[]`, `cells[]` (each is Totals plus `teacherId, day, lessons, matching, utilization`) |
| `GET /calendar/stats` | `teaching { lessons, bookedMinutes, heldMinutes }`; `students { distinct, trial, paused }`; `capacity { shiftMinutes, inShiftBookedMinutes, inShiftPausedMinutes, inShiftLeaveMinutes, emptyMinutes, outsideMinutes, workMinutes, freeMinutes, utilization }`; `teachers[]`. Masthead: Booked hours (held so far), Shift used % (key), Empty in shift, Leave (paused). Sheet bar: students, outside the shift, free (hourly). A "By teacher" table: shift, booked, used %, remaining, outside · leave. |
| `GET /teachers/:id/work-pattern` | `teacherId, today, patterns[{ id, category, timezone, validFrom, validTo, reason, createdAt, windows[{ weekday, start, end }] }]`, `defaults { full_shift, part_shift: { start, end, weekdays[] } }`. POST body: `{ category, timezone, validFrom, windows?, reason?, applyToAvailability? }`. Shown in the Teacher file (ShiftSection); editing needs `viewer.canEditShifts`. |
| `GET /teachers/:id/availability` | `teacherId, timezone, windows[{ weekday, start, end }], daysOff[{ date, reason }]` |
| `GET /lessons/roster` | `teachers[{ id, name, isActive, timezone }]`, `learners[{ id, name, family{ id, displayName }, teacherId, slots[{ weekday, start, durationMinutes }], suspension{ id, kind, returnOn }\|null }]` |
| `GET /lessons?learnerId\|teacherId&from&to` (LessonDto) | `id, learner, teacher, kind: 'regular'\|'makeup', makeupFor, startsAt, endsAt, durationMinutes, phase: 'upcoming'\|'in_progress'\|'awaiting_close'\|'overdue'\|'closed', outcome, outcomeNote, movedFrom?, movedTo?, movedBy?: 'family'\|'teacher'\|'staff'` |
| `GET /lessons/needs-action` | `overdue[]` (Reports overdue: ended over a day ago, no outcome); `awaitingClose[]`; `rulings[{ id, kind, reason, openedAt, decision, lesson }]` (late apologies); `makeupsOverdue[]` (teacher-cancelled, no make-up within a week); `returningSoon[{ suspensionId, learner, returnOn }]`; `scheduleRequests[{ id, learner, slots, note, createdAt, teacher?, requestedBy?{ kind, name }, effectiveFrom?, current?[], requested?[{ …, free }], stillFree? }]`; `blockedOccurrences?[{ id, learner, teacher, startsAt, endsAt, blockedBy{ lessonId, kind, startsAt, endsAt }, reason?: 'weekly'\|'teacher_changed', lessonKind? }]`. The page also reads `GET /correction-requests` (`kind: 'missing'\|'correction'`, `status: 'open'\|'corrected'\|'filed'\|'withdrawn'`). |
| Desk reads | `GET /learners/:id/schedule-options?teacherId` (`timezone, durationMinutes, locked, current[], options[{ weekday, start, nextStartsAt, except[] }]`); `GET /learners/:id/free-slots?durationMinutes`; `GET /lessons/:id/move-slots` (`slots[], locked, refusal: 'started'\|'not_movable'\|'family_already_moved'\|'family_monthly_limit'\|'too_late', familyMovesLeft`); `GET /lessons/blocked/:id/slots`; `GET /teachers/candidates` (`away{ kind: 'leave'\|'suspended', until }`, `readiness`); `GET /learners/:id/transfer-preview?toTeacherId`; `GET /conversations/:id/teacher-preview` (each slot has `free, keptAs, zoneShift`; plus `allFree, futureLessons, unmovable[]`) |
| Desk writes | `POST /learners/:id/schedule` `{ slots, effectiveFrom }`; `POST /lessons` (idempotency key); `POST /lessons/:id/move` `{ startsAt }`; `POST /learners/:id/transfer`; `POST /conversations/:id/teacher`; `POST /learners/:id/suspensions` `{ kind, reason, note, startsOn, returnOn }` |

`Locked = 'balance'|'overdue'|'other'|null` arrives on schedule options, free slots, move slots and the transfer preview. When it is set, every scheduling write is refused.

---

## Priority 2: Conversations, Today, Payments and instalments, Requests

| Route · page (nav en / ar) | Who | For | Reads | Main writes | States worth designing |
|---|---|---|---|---|---|
| `/chat`, `/chat/:conversationId` · Conversations / المحادثات (SA: "Chat / الدردشة"). **Default landing** for MGR and OP. `?view=waiting` | Area `chat`: SA, MGR, OP | Three panes: queue, thread, family context. The SA replies here. | `GET /conversations` (60 s + realtime), `/conversations/:id`, `/messages?before&limit`, `/messages/pins`, `/messages/search`, `/me/search`, `/me/starred`, `/me/labels`, `/quick-replies`, `/presence`, `/me/cover` (admin, coverage), `/org/group-candidates`. Family panel: `/parent-profiles/:id`, `/families/:id/billing`, `/learners/:id/profile`. | `POST /conversations/:id/messages` (`visibility: 'customer'\|'internal'`, mentions), attachments authorize + PUT, `…/messages/read`, `PATCH`/`DELETE` a message, star, pin, reactions, forward, `…/preferences` (pin, favorite, archive, `mutedUntil`), labels, theme, `POST /conversations/:id/join\|leave\|members`, `POST /conversations/direct\|family-group`, `POST /mentions/:id/dismiss`; family panel `POST /families/:id/payments\|payment-requests` | Queue groups: `needsReply` (longest wait first) → `unreadCount>0` → rest. Summons badge (`mention.kind==='summons'`, pending, `expiresAt`). Waiting tab (`state==='waiting_on_jawwid'`). Covering marks and banners (`cover.away.status` scheduled/active, `covering[]`). **Payment-locked group:** `paymentLock{ readOnly, canPay, children[].reasons 'balance'\|'overdue', overdue{ label, dueDate } }` shows `PaymentLockBanner`. Seat bar. Message `moderation` pending/rejected, internal note, deleted, edited, `sentBySupport`, send failed with retry, `COMM.EDIT_WINDOW_EXPIRED` (15 min). Offline banner. Family facts `overdueMinor>0` red. Empty, no matches, no messages. No on-duty, SLA or owner-lock fields exist. |
| `/admin/conversations` · All conversations / كل المحادثات (Conversations). **SA landing.** | SA | Read-only inspection of every conversation. | `GET /admin/conversations`, `GET /admin/conversations/:id/messages` | none | `waiting_on_jawwid` attention row with waited time; `archivedAt`; message deleted, moderation, internal; `truncated` footnote; "only recent loaded". |
| `/today` · Today / اليوم (the logo) | everyone; each block only if its page is in the account's navigation | "What needs me now": figures, a Do-next list, today's lessons, notifications. | `GET /conversations`, `GET /instalments?responsible=all`, `GET /me/tasks?state=open&overdue=true`, `GET /payment-receipts?status=pending`, `GET /calendar?from&to` (today), `GET /calendar/summary` (week), `GET /me/notifications?tab=all` | none | All clear; `noLessons`; `noActivity`; failed or refused lists silently dropped (no error UI); overdue instalments (`status==='overdue'`, `days`); `needsReply` urgent; lesson tags: `anonymous`, `suspendedFor==='payment'`, `status==='paused'` (problem), moved, trial, make-up; "Now" marker. |
| `/requests` · Requests / الطلبات (from Today and search) | everyone; each list only if its page is offered | One read-only queue of every waiting request, longest wait first; each row opens its own page. | `GET /trials` (`outcome==='awaiting'`), `GET /trials/new-students`, `GET /certificates/access` then `GET /certificates?category&status`, `GET /subscriptions/renewal-requests` (`!renewed`), `GET /payment-receipts?status=pending`. **Sales pipeline is not included.** | none | No request page available (lock); loading; empty / empty for type; late = `waitedOvernight(since)` → urgent group "Waiting since before today"; list not arrived "–"; refused list dropped; certificates "+" when paged; new-student `locked` (sign-up locked). |
| `/instalments` · Instalments / الأقساط (Finance). SA: `/admin/instalments` "Instalment payments". | Route: SA, MGR, OP. Rail: `billingReader`. | Every family's instalments: overdue → due today → upcoming → paid. | `GET /instalments?responsible=all\|me\|none&paid&beforeGoLive`, `GET /families/:id/billing-supervisor`, masthead `GET /payment-receipts?status=pending`, `GET /payments?from&to&limit=1` | `POST /families/:id/billing-supervisor` `{ supervisorId\|null, reason }` | **Overdue** `status==='overdue'` + `days` late; `beforeGoLive` flag (never locks); no supervisor (`responsibleSupervisor===null`, `counts.unassigned`); `COMM.BILLING_DENIED`; empty "Nothing due" / filtered empty; folding after 8 rows. |
| `/payments` · Payments / المدفوعات (Finance). SA: `/admin/payments`. `?tab=` receipts, transactions, attempts, events, renewals, settings. | Rail: `billingReader`. Events tab: `canVerifyPayments`. | Verify bank-transfer receipts, the transaction ledger, card attempts, Stripe events, renewal requests, billing settings. | `GET /payment-receipts?status`, `GET /payments?…filters&cursor`, `GET /payments/:id`, `GET /payment-attempts?status`, `GET /stripe/events`, `GET /billing/settings`, `GET /subscriptions/renewal-requests`, `GET /invoices/:id/link` | `POST /payment-receipts/:id/approve` `{ amountMinor?, paidOn? }`, `…/reject` `{ reason }`, `POST /payments/:id/reconcile`, `POST /stripe/reconcile`, `POST /billing/settings` (bank account, issuer, reminders, or `{ cardPaused }`) | **Card payments paused** `cardPaused` (warn badge on every tab); `webhookConfigured:false` (danger); receipts `pending\|approved\|rejected`; `!canDecide` lock note; transaction `standing\|partially_refunded\|refunded\|voided`; `overpaid{ why, settled }`; test mode `livemode:false`; attempts `open\|complete\|expired\|failed`; Stripe event outcomes (dispute, mismatch, refund_failed…); reminder rules `offsetDays`; `COMM.BILLING_STATE`. |
| `/trials` · Trial lessons / الحصص التجريبية (Sales; under Operations for a Teachers-department account). `?filter=all\|decision\|upcoming\|recorded&open=` | Rail: `lessonManager \|\| sales \|\| operations` | Book trials and record each trial's one outcome. | `GET /trials`, `GET /trials/teachers`, `GET /trials/slots`, `GET /geo/countries[/:code/subdivisions]`, `GET /trials/:id/subscription-prefill` | `POST /trials`, `…/:id/reschedule\|cancel\|outcome\|correction\|attendance`, `POST /trials/teachers/:id/group` | `outcome: upcoming\|awaiting\|no_show\|subscribed\|not_subscribed\|cancelled`; **late outcome** (awaiting since before today, urgent); `outcomeDetail.reason`; `correctedAt`; no slots; `COMM.LESSON_TEACHER_BUSY`; `locked`; "Sales only" options. |
| `/trials/new-students` · New students / الطلاب الجدد (Sales) | Rail: `sales \|\| operations` | Hand-over board after a trial: not assigned → waiting for parent → signed up. | `GET /trials/new-students` (15 s), `GET /org/structure`, `GET /trials/new-students/:id/payment-requests`, `GET /family-intake/entered` | `POST /trials/:id/subscription`, `POST /trials/new-students/:id/assign\|supervisor\|group\|signup-code/invalidate\|signup-attempts/reset\|payment-requests` | `unassigned\|waiting\|locked\|signed_up`; sign-up locked (`attempts.locked`); `code_waiting`; wrong tries `n / cap`; late assignment (urgent); `COMM.PARENT_EXISTS`; `schedules[].set===false`; payment request `open\|paid\|cancelled\|expired`. |
| `/sales/pipeline` · Sales pipeline / مسار المبيعات (Sales, first) | Rail: `sales` | Lead board: `new_lead → contacted → trial_booked → trial_completed → converted → lost`. | `GET /sales-pipeline/access`, `…/leads?stage&q&followUp=due&limit&offset`, `…/leads/:id`, `…/owners`, `GET /family-intake/options` | `POST /sales-pipeline/leads`, `…/leads/:id`, `…/contacted`, `…/owner`, `…/convert`, `POST /family-intake` | `followUpDue` (red); `lastContactedAt==null`; `owner==null`; `lostReason`; `manualStage===false`; convert result `linked\|awaiting_enrolment\|intake_required`; `access.allowed===false` shows Forbidden. No "stale lead" state. |
| `/certificates` · Certificates / الشهادات | Rail: `/certificates/access.canOpen` (includes the Designer specialist). Landing for SPEC. | Student and teacher certificate requests through design to sending; Types tab. | `GET /certificates/access`, `GET /certificates?category&status&q&cursor`, `/certificates/:id`, `/types`, `/recipients`, `/:id/delivery`, `/:id/files/:fileId` | `POST /certificates`, `POST /certificates/:id/{edit\|accept\|resubmit\|start\|release\|approve\|return\|redesign\|withdraw-approval\|cancel\|decline\|send\|story\|consent}`, file upload, types | `state: proposed\|requested\|in_design\|changes_requested\|uploaded\|approved\|sent\|cancelled\|declined`; groups suggested, pending, in progress, completed, sent, closed; duplicate suspected; consent withdrawn; denied lock. |
| `/payments?tab=renewals` · renewals (inside Payments) | as Payments | Children whose parent asked to renew. | `GET /subscriptions/renewal-requests` | none | Waiting (`!renewed`) / Renewed; 403 lock `renewalsDenied`; empty. |

---

## Priority 3: everything else

| Route · page (nav en / ar) | Who | For | Reads | Main writes | States worth designing |
|---|---|---|---|---|---|
| Signed out · Sign in (`LoginPage`) | anyone | Sign in | `POST /auth/login`, then `GET /me` | `POST /auth/refresh` (automatic on 401), `POST /auth/logout` | Signing in; server error; offline; `admin.not_staff`; "Keep me signed in" only if persistence is supported. No locked-account screen of its own. |
| Signed out · Password reset (same page) | a person with an admin-issued code | Set a password with a 6-digit code | none | `POST /auth/password-reset` `{ username, code, password }` | `AUTH.RESET_CODE_INVALID` (invalid, expired or used), `AUTH.PASSWORD_TOO_WEAK` (min 4), `COMMON.RATE_LIMITED`; done "signed out everywhere". |
| Terms gate (`LegalGuard`, before every page) | every signed-in staff member | Accept the current Terms | `legal` on `GET /me`, `GET /me/legal` | `POST /me/legal/accept` | `legal.state: accepted\|required\|unavailable`; any 403 `COMM.TERMS_NOT_ACCEPTED`; `LEGAL_VERSION_STALE`; `SUPPORT_SESSION_FORBIDDEN`; fail-closed "unavailable" with Retry / Sign out. |
| `/dashboard` · Dashboard / لوحة المتابعة. SA is sent to `/admin/dashboard`. | Area: SA, MGR. Each section needs its key. | Counts of what waits, each linking to where it is resolved. | `GET /dashboard/:section` for `chats, cases, lessons, enrolment, billing, teachers, structure, tasks` (60 s) | none | Tiles `count, oldestAt, capped`; key ending `overdue` = late tone; section 403 hidden; a failed section stays visible with an error (never shown as zero); `noSections`. |
| `/admin/dashboard` · Dashboard | SA | Org overview | `GET /admin/overview`, `GET /admin/conversations`, plus the dashboard sections | none | Waiting count "N+" when `truncated`; stories by state. |
| `/admin/users` · Users / المستخدمون | SA | Read-only staff, teacher and contact list | `GET /admin/users` | none | `hasLogin:false`, `accountStatus` provisioned / suspended / deactivated, `lastLoginAt` never, `truncated`. |
| `/admin/teams` → OrganizationPage · Organization / الهيكل التنظيمي | SA | as `/organization` | as below | as below | as below |
| `/admin/teachers` · Teachers / المعلمون | SA | Teacher files roster (TeacherFilesPage) | `GET /teacher-files` | `POST /teachers` | as `/teachers/files` |
| `/admin/parents`, `/admin/stories`, `/admin/calls`, `/admin/tasks` | SA | The operator pages (Parents, Stories, Calls, Tasks with the All and Decisions tabs) | as the operator page | as the operator page | as the operator page |
| `/admin/{notifications,whatsapp,quality,academy,forms,integrations,approvals,audit,settings}` · in development | SA | Placeholder: purpose, note, legacy screens behind a warning | none | none | "In development" only, never fake numbers. Unknown key → `notFound`. |
| `/tasks` · Tasks / المهام (Dashboard destination) | every staff role. Landing for DEPT. | Task queue by due date, with a detail panel | `GET /me/tasks?…`, `GET /tasks?view=team\|decisions\|all`, `/tasks/:id`, `/tasks/assignees`, `/dashboard/tasks`, `/cases?…&status=open` | `POST /tasks`, `/tasks/:id/{complete\|acknowledge\|out-of-scope\|comments\|return\|remove\|reassign\|due\|priority}` | Due groups `overdue\|today\|week\|later\|none`; `priorityReason`; `needsReassignment` (assignee left); `unmanaged`; `awaiting_decision`; returned with instructions; financial tag; not found. |
| `/cases` · Escalations / التصعيدات (a tab of Tasks) | Area: SA, MGR, OP. Tab: `cases.manage`. | Escalation cases | `GET /cases?tab&status`, `/cases/:id`, `/cases/:id/owners` | `POST /cases`, `/cases/:id/{assign\|status\|due\|notes}` | Past due (`dueOn < today`); `owner:null`; `canAct:false` read-only; `in_progress`, `resolved`, `cancelled`. |
| `/moderation` · Reports / البلاغات (Conversations) | Area: SA, MGR, plus `moderation.view` | User reports with a 24 h due clock | `GET /moderation/reports?status&priority&overdue`, `/:id`, attachment URL | `POST /moderation/reports/:id/take\|resolve` | Due clock `ok\|warn (≤6 h)\|overdue\|closed`; `child_safety` urgent; `REPORT_ALREADY_TAKEN`; not available (404). |
| `/calls`, `/calls/join/:scheduledCallId` · Calls / المكالمات (Communication). SA: `/admin/calls`. | Area: SA, MGR, OP | The account's calls, scheduled calls and call links | `GET /scheduled-calls`, `/scheduled-calls/:id`, `/calls/history`, `/conversations` | `POST /calls`, `/scheduled-calls`, `/scheduled-calls/:id/cancel\|join` | `upcoming\|open\|cancelled\|over`; join window; history `missed`; link not available. |
| `/stories`, `/stories/new`, `/stories/:storyId` · Stories / الحالات (Communication). SA: `/admin/stories*`. | Area: SA, MGR, OP; the server decides publish | Publish stories to an audience; insights | `GET /stories?drafts=true`, `/stories/:id`, `/analytics`, `/viewers`, `/stories/audience/facts\|families` | `POST /stories`, `/:id/publish`, `DELETE /stories/:id`, media upload, `POST /stories/audience/estimate`, `POST /stories/audience/families/:id` | `draft\|published\|expired\|deleted`; not published; estimate error. |
| `/organization` · Organization / الهيكل التنظيمي (People). SA uses `/admin/teams`. | Area: MGR only | Children's supervisors, teachers' supervisors, backups, covers, supervisor calendar colours | `GET /org/structure`, `/org/learners`, `/org/teacher-assignments`, `/org/covers?active=true`, `/org/covers/preview` | `POST /org/learners/:id/supervisor`, `/org/teachers/:id/supervisor`, `/org/backups[/:id/activate\|deactivate\|end]`, `/org/covers[/:id/extend\|end]`, `/org/staff/:id/calendar-color` | Unassigned children; backup `dormant\|active\|expired\|deactivated\|ended`; cover `scheduled\|active\|ended`; backup blocked `inactive\|away\|at_limit\|not_linked`. |
| `/teachers/files`, `/teachers/files/:teacherId` (`/admin/teachers/:teacherId`) · Teachers tab "Teacher files / ملفات المعلمين" | Area `teachers`; rail `lessonManager` | Roster and one teacher's record. Tabs `overview\|students\|schedule\|pay\|leave\|evaluations\|records`. | `GET /teacher-files`, `/teacher-files/:id`, `/stats/teachers/:id`, `/lessons?teacherId`, `/teachers/:id/availability\|work-pattern`, `/calendar/options`, `/teacher-files/:id/finance\|leave\|lesson-reports\|deletion-request`, `/teachers/:id/evaluations\|supervision\|history\|offboard-preview` | personal, entries, sign-in, offboard, reactivate, payroll, evaluations, leave allowance, work pattern, availability (full list in `teacher-files/api.ts`) | `away.kind: leave\|suspended\|day_off`; `unsupervised`; `setupMissing`; sign-in `none\|provisioned\|active\|suspended\|deactivated`; offboard blocked (`TEACHER_HAS_STUDENTS`, `TEACHER_HAS_OPEN_LESSONS`); deletion request pending with a deadline; payroll "not priced"; complaint `open\|upheld\|actioned\|resolved`; report `on_time\|late\|pending\|missing`. |
| `/teacher-attendance` · Attendance & complaints / الحضور والتأخير والأعذار والشكاوى (People → Teachers). SA: `/admin/teacher-attendance`. `?section=leave\|lateness\|excuses\|complaints` | Rail: `teacherAttendance` (`/teacher-records/access`); `basis==='sales'` gets a reduced set | Teacher leave, lateness, absences and excuses, complaints | `GET /teacher-records/access`, `/teacher-leave-overview`, `/teacher-leave-requests?state`, `/discipline/violations?state&kind&month`, `/teacher-files/complaints`, `/parent-feedback?category=suggestion`, `/teacher-records/teachers/:id/summary` | `POST /teacher-leave-requests/:id/approve` `{ days, note, cancelCollidingLessons }`, `…/decline\|cancel`, `POST /discipline/violations/:id/decide`, `POST /lessons/:id/lateness`, `POST /teachers/:id/absences`, complaint uphold, void, feedback take/reply | Leave `requested\|approved\|declined\|withdrawn\|cancelled`, `balance` null, `unpaidDays`, **`collidingLessons[]`**; violation `teacher_apology\|teacher_no_show\|late\|absence\|complaint` with `lateMinutes`, `step` 1–5, `suggestedDecision`; `DISCIPLINE_LESSONS_COLLIDE`; Denied line. |
| `/teacher-grants` · Grants & testimonials / المنح والشهادات الطيبة. SA: `/admin/teacher-grants`. | Rail: `teacherGrants` | Teacher bonuses and testimonials | `GET /teacher-files/rewards`, `/teacher-files/finance/deduction-defaults`, `/teacher-records/testimonials` | `POST /teacher-files/:id/rewards`, deduction defaults, `POST /teachers/:id/testimonials`, praise share, void | `canViewAmounts`; testimonial `voided`, `sharedAt`, `origin`. |
| `/teacher-profiles` · Teacher profiles / ملفات المعلمين (SA: "Teacher credentials review / مراجعة مؤهلات المعلمين") | Rail: `lessonManager` | Approve or reject teacher credential documents | `GET /teacher-profiles/review`, certificate download | `POST /teacher-profiles/certificates/:id/decide` | `pending\|approved\|rejected` with `reviewNote`; inline decide error. No "expired" state. |
| `/teachers/boards`, `/teachers/boards/:boardId` · Teachers tab "Boards / السبورات". SA: `/admin/teachers/boards*`. | `whiteboards.view\|retention` | Read-only teacher whiteboards | `GET /teacher-boards/teachers`, `/teacher-boards?teacherId`, `/teacher-boards/:id`, `/:id/access-log`, `/quran/ayahs` | `POST /teacher-boards/:id/copy` | `active\|trashed\|retained` (`retainedUntil`); departed teacher; asset unavailable; `notYours`. |
| `/lesson-audio` · Lesson audio / تسجيلات الدروس (Operations) | Rail: `lessonAudio`. Landing for a Pronunciation-reviewer SPEC. | Two-reviewer approval of voice clips | `GET /lesson-audio/access`, `/lesson-audio/review/:lesson[/units/:unit]` | `POST /lesson-audio/clips/:id/approve\|reject\|withdraw`, `/strings/:lesson/:id/decision` | Clip `pending\|approved\|rejected\|withdrawn`; "n of `approvalsRequired`"; needs a decision; hash mismatch; no access shows the empty state (no denied screen). |
| `/materials` · Educational materials / المواد التعليمية | Rail: `materialsWorkspace` | Library, import, recitations | `GET /materials/admin/access`, `/materials/admin/items`, `/materials/admin/recitations`, `/materials/quran/surahs` | items create/update, uploads, `POST /materials/admin/import` (dry run first), recitation sources | `draft\|in_review\|published\|retired`; import errors block commit. |
| `/parents` · Parents / أولياء الأمور (People → Families). SA: `/admin/parents`. | Rail: `billingReader` | Family directory and Add family | `GET /parent-profiles?q&access=locked\|grace&location=missing`, `GET /family-intake/options` | `POST /family-intake` | **Payment-locked family** `?access=locked\|grace`; `truncated` "200+"; `noTeam`. |
| `/parents/:contactId` · Parent profile | Area `parents` | Family record: Overview, Money, Children, History | `GET /parent-profiles/:id`, `/families/:id/billing`, `/learners/:id/subscription` (each child), `/family-intake/families/:id[/history]` | contact, photo, `POST /families/:id/billing` (409 if stale), instalments create / pay / void, payment requests, payments record / void / refund, add child, ownership | Locked or grace (from children's `standing.state`); overdue instalment `status==='overdue'` + `days`; partial; request `open\|paid\|cancelled\|expired`; refunds; invoices. |
| `/students` · Students / الطلاب (People → Families) | Rail: `lessonManager` | Paged learner directory | `GET /learners?q&teacher&supervisor&status&page&limit=25` | none | `status: active\|paused\|stopped`; no teacher; no supervisor. |
| `/students/:learnerId` · Student profile | no Area gate; the server decides | Student record: Overview, Subscription, Schedule, Family | `GET /learners/:id/profile`, `/learners/:id/subscription`, `/family-intake/learners/:id/carried-over`, `/lessons/access` | subscriptions, exceptions, void, carried-over, change teacher | `standing.state: open\|grace\|locked`, `graceLeft`, `lockReasons`, `overdue`; `enforced:false`; no teacher; no schedule. |
| `/accounts` · Accounts / الحسابات (People → Staff & accounts) | every staff role; actions from `allowed.*` | Parent, teacher and staff accounts: reset, suspend, sessions, support session, family access | `GET /admin/accounts`, `/admin/accounts/:id/sessions`, `/admin/impersonations`, `/admin/family-access-grants` | `POST /admin/accounts/:id/{password-reset\|suspend\|reactivate}`, session revoke, `POST /admin/impersonations`, family-access grant / revoke | `provisioned\|active\|suspended\|deactivated`; `lockedUntil`; one-time code shown once. |
| `/accounts/staff` · Staff accounts tab | `staff_accounts.view` | Staff accounts, roles, denies, setup code | `GET /admin/staff-accounts[/:id[/access\|denies]]`, `/admin/access-roles` | create, roles grant / revoke, setup code, denies | `setupPending`; denied keys; risk badges. |
| `/accounts/roles` · Roles tab | `staff_accounts.view` or `access_roles.manage` | Access roles catalogue | `GET /admin/access-roles`, `/admin/permissions` | `POST /admin/access-roles[/:id[/archive]]` | template, archived. |
| `/support/:impersonationId` · Support session | Area `accounts`; the server decides | Act as a parent or teacher, on the record | `POST /admin/impersonations/:id/token`, `GET /conversations` and messages, `GET /me/profile` (with the support token) | send message, `PATCH /me/profile`, `POST /admin/impersonations/:id/end` | Countdown from `expiresAt` (≤5 min warning); ended (`IMPERSONATION_ENDED` / not found / 401); "Sent by support". |
| `/profile`, `/profile/:staffId` · My profile / ملفي الشخصي | everyone; `access.*` from the server | Staff file: identity, workload, responsibilities, activity | `GET /staff-profiles/:ref[/activity]`, `/staff/:id/action-log`, `/staff-profiles/team\|organization` | `PATCH /staff-profiles/:ref`, avatar, responsibilities, reporting line | `STAFF_PROFILE_CONFLICT`; inactive with families still assigned; `completeness.missing`. |
| `/team` · Team / الفريق (People, MGR and SA) | MGR, SA (`viewer.team` / `organizationOverview`) | Team roster | `GET /staff-profiles/me`, `/staff-profiles/team\|organization` | none | `noTeam`, `teamClosed`, truncated. |
| `/profile/devices` · My devices & sessions / أجهزتي وجلساتي | everyone | Own sessions | `GET /me/sessions` | `POST /me/sessions/:id/revoke`, `/me/sessions/revoke-others` | current, remembered, `SESSION_NOT_FOUND`. |
| `/notifications` · Notifications / الإشعارات | everyone | Own inbox and push settings | `GET /me/notifications/counts`, `/me/notifications?tab&before`, `/me/notification-settings` | `POST /me/notifications/read`, `/:id/acted`, `PUT /me/notification-settings` | `requiresAction && !acted`; locked categories; quiet hours. `severity`, `dueAt` and `taskStatus` are returned but not rendered. |
| `/teachers/supervision` (`/admin/teachers/supervision`) | Area `teachers` | Redirect page (PD-52) to `/teacher-attendance` or `/teacher-grants` by `section` | none | none | nothing to design |

---

## Redirects and retired routes

| From | To |
|---|---|
| `/` and any unknown path (`*`) | `homeFor(staff)` (see the landing rule above) |
| `/teachers/certificates`, `/admin/teachers/certificates` | `/certificates?category=student` |
| `/teachers/cases` | `/cases` |
| `/teachers/leave` | `/teacher-attendance?section=leave` |
| `/teachers/discipline` | `/teacher-attendance?section=excuses` |
| `/admin/teachers/leave` | `/admin/teacher-attendance?section=leave` |
| `/admin/teachers/discipline` | `/admin/teacher-attendance?section=excuses` |
| `/teachers/supervision?section=…` | rewards → `/teacher-grants?section=grants`; praise → testimonials; suggestions → `/teacher-attendance?section=complaints&view=suggestions`; absences → excuses; anything else → leave |
| `/dashboard` (as SA) | `/admin/dashboard` |
| `/calls` (as SA) | `/admin/calls` |
| `/approvals` | intentionally unregistered (reserved seam); the `/admin/approvals` placeholder is "in development" |

The **in-development** admin sections (no backend) are notifications, whatsapp, quality, academy, forms, integrations, approvals, audit and settings. Legacy prototype screens appear only behind a warning disclosure.

---

## States inventory (rare states across the app, and where their data comes from)

| State | Field(s) | Endpoint | Shown on |
|---|---|---|---|
| Overdue instalment | `status: 'overdue'`, `days` | `GET /instalments`, `GET /families/:id/billing` | Instalments, Parent profile (Money), Today, chat family panel (`overdueMinor > 0`), Dashboard `instalments.overdue` |
| Payment-locked group or child | `paymentLock{ readOnly, canPay, children[].reasons: 'balance'\|'overdue', overdue{ label, dueDate } }` | `GET /conversations/:id` | Chat thread banner |
| Locked / grace subscription | `standing.state: 'open'\|'grace'\|'locked'`, `graceLeft`, `lockReasons`, `overdue`, `held`, `enforced` | `GET /learners/:id/subscription` | Student profile, Parent profile, Parents `?access=locked\|grace`, Dashboard `parents.locked\|grace` |
| Scheduling write refused by the lock | `locked: 'balance'\|'overdue'\|'other'\|null` | schedule options, free / move slots, transfer preview | Schedule desk dialogs (`lockedRefusal`) |
| Lesson held for payment | `suspendedFor: 'payment'` | `GET /calendar` | Calendar ("Suspended — payment"), Today |
| Paused card payments | `cardPaused` (with `cardConfigured`, `cardAvailable`, `webhookConfigured`) | `GET /billing/settings` | Payments (every tab), Settings |
| Overpayment | `overpaid{ amountMinor, why, settled }` | `GET /payments` | Payments transactions |
| Stripe dispute or mismatch | event `outcome` (`dispute_*`, `mismatch`, `refund_failed_after_record`…) | `GET /stripe/events` | Payments events |
| Receipt waiting | `status: 'pending'` | `GET /payment-receipts` | Payments, Requests, Today |
| Renewal requested | `renewed: false` | `GET /subscriptions/renewal-requests` | Payments renewals, Requests |
| Schedule conflict / double booking | (1) overlapping `CalendarLesson`s drawn in lanes; (2) `blockedOccurrences[]` (`blockedBy`, `reason: 'weekly'\|'teacher_changed'`); (3) `stillFree: false` on a time request; (4) 409 `COMM.LESSON_TEACHER_BUSY`; (5) `requested[].free`, `slots[].free`, `zoneShift` in previews | `/calendar`, `/lessons/needs-action`, write responses | Calendar, Needs action, desk dialogs. **There is no explicit conflict flag on the calendar.** |
| Lesson outside the shift | `outsideShift`; totals `outsideMinutes` | `/calendar`, `/calendar/stats` | Calendar, stats bar |
| Empty shift time (unused capacity) | `days[].empty[]`, `emptyMinutes`, `utilization` | `/calendar*` | Calendar (red empty time), masthead |
| Teacher on leave or away | `days[].leave[]`, `inShiftLeaveMinutes`; `away{ kind: 'leave'\|'suspended'\|'day_off', until }` | `/calendar`, `/teachers/candidates`, `/teacher-files` | Calendar, teacher pickers, Teacher files |
| Teacher absent with lessons to cover | `teacher_no_show` outcome, `makeupsOverdue[]` (no make-up within a week), leave `collidingLessons[{ id, startsAt, learnerName }]` + `cancelCollidingLessons`, `DISCIPLINE_LESSONS_COLLIDE` | `/lessons/needs-action`, `/teacher-leave-requests`, `/discipline/*` | Needs action, Attendance & complaints. **No "uncovered lessons" list exists.** |
| Late lesson report | `phase: 'overdue'` (ended more than a day ago, no outcome) in `needsAction.overdue`; per lesson `status: 'late'\|'missing'\|'pending'`, `delayMinutes`, `graceHours`; per teacher `reportsOnTimeRate`, `unreported`, `reports.medianDelayMinutes`, `summary.pending.awaitingReport`; correction requests `kind: 'missing'` | `/lessons/needs-action`, `/teacher-files/:id/lesson-reports`, `/stats/teachers*`, `/correction-requests` | Needs action, Teacher file Records, Teacher statistics, Dashboard `lessons.today_unreported` / `needs_outcome` |
| Teacher late to a lesson | violation `kind: 'late'`, `lateMinutes`, `step` 1–5, `suggestedDecision` | `/discipline/violations` | Attendance & complaints → lateness |
| Late apology to rule on | `rulings[]` (`decision` null) | `/lessons/needs-action` | Needs action, Dashboard `lessons.rulings_open` |
| Paused / stopped student | `suspension{ kind: 'temporary'\|'permanent', returnOn }`, `status: 'paused'\|'stopped'` | `/lessons/roster`, `/suspensions`, `/learners` | Schedule desk, Students tab, Students directory, Needs action "Returning soon" |
| Move refused | `refusal: started\|not_movable\|family_already_moved\|family_monthly_limit\|too_late`, `familyMovesLeft` | `/lessons/:id/move-slots` | Move dialog |
| Student with no teacher / no times | `teacherId === null`, `slots: []` | `/lessons/roster`, `/learners` | Student schedules (urgent figure), Students, Student profile |
| Teacher not ready | `readiness` (`setupIncomplete\|notSignedIn\|noSupervisor\|loginSuspended`), `setupMissing`, `unsupervised` | `/teachers/candidates`, `/teacher-files` | Teacher pickers, Teacher files |
| Trial outcome late | `outcome: 'awaiting'` past the day it ended | `/trials` | Trials, Requests |
| Sign-up locked (new student) | `parentSignup.attempts.locked` | `/trials/new-students` | New students, Requests |
| Lead follow-up due | `followUpDue`, `lastContactedAt` | `/sales-pipeline/leads` | Sales pipeline |
| Waiting conversation | `needsReply`, `state: 'waiting_on_jawwid'` | `/conversations`, `/admin/conversations` | Chat, All conversations, Today |
| Covering a colleague | `cover.away`, `cover.covering[]`, `conv.cover` | `/me/cover`, `/conversations/:id` | Chat banners |
| Task overdue / assignee left | `overdue`, `needsReassignment`, `unmanaged` | `/me/tasks`, `/tasks` | Tasks, Today |
| Case past due | `dueOn < today` | `/cases` | Escalations |
| Report SLA | `dueAt`, `overdueAt`, warn at ≤6 h | `/moderation/reports` | Moderation |
| Support session expiring | `expiresAt` (≤5 min) | `/admin/impersonations/:id/token` | Support session |
| Terms not accepted | `legal.state`, 403 `COMM.TERMS_NOT_ACCEPTED` | `/me`, `/me/legal` | Terms gate |

---

## Status after the third pass (2026-11-27)

Every page below is on the design system (`core/theme/system.css`), built on real endpoints, and was reviewed by fresh-context critics at 1440x900 in Arabic and English (also 1280, 1920 and 390). Rounds = critic rounds run; screenshots are the final round's.

| Page | Rounds | Final screenshot |
|---|---|---|
| Teacher statistics | 4 | `admin-screens/teacher-stats-round4.png` |
| Schedule (day, week, month, phone) | 4 | `admin-screens/schedule-round4.png` |
| Conversations / All conversations | 3 | `admin-screens/conversations-round3.png` |
| Today | 3 | `admin-screens/today-round3.png` |
| Shell, sign-in, search | 3 | `admin-screens/shell-menu-round3.png`, `sign-in-round3.png`, `search-round3.png` |
| Payments (receipts, transactions, attempts, events, renewals, settings) | 6 | `admin-screens/finance-receipts-round6.png` |
| Instalments | 6 | `admin-screens/finance-instalments-round6.png` |
| Requests hub | 5 | `admin-screens/requests-round5.png` |
| Trial lessons, New students | 5 | `admin-screens/trials-round5.png`, `new-students-round5.png` |
| Certificates | 5 | `admin-screens/certificates-round5.png` |
| Sales pipeline | 5 | `admin-screens/sales-pipeline-round5.png` |
| Tasks, Escalations | 4 | `admin-screens/tasks-round4.png`, `escalations-round4.png` |
| Dashboard | 3 | `admin-screens/dashboard-round3.png` |
| Notifications and settings | 3 | `admin-screens/notifications-round3.png` |
| Parent file, Staff profile, My profile | 4 | `admin-screens/parent-file-round4.png`, `staff-profile-round4.png` |
| Student file | 3 | `admin-screens/student-file-round3.png` |
| Teacher file | 3 | `admin-screens/teacher-file-round3.png` |
| Accounts, staff accounts, roles, organization, devices, support session | 4 | `admin-screens/accounts-round4.png`, `organization-round4.png` |
| Parents, Students, Team, Users (admin) | 3 | `admin-screens/parents-round3.png`, `students-round3.png`, `team-round3.png`, `admin-users-round3.png` |
| Teacher roster, Needs action, Teachers' schedules | 3 | `admin-screens/teacher-roster-round3.png`, `needs-action-round3.png`, `teacher-schedules-round3.png` |
| Attendance & complaints, Grants & testimonials, Credentials review | 3 | `admin-screens/teacher-attendance-round3.png`, `teacher-grants-round3.png`, `teacher-profiles-round3.png` |
| Moderation, Materials, Lesson audio | 3 | `admin-screens/moderation-round3.png`, `materials-round3.png`, `lesson-audio-round3.png` |
| Calls, call window, Stories | 3 | `admin-screens/calls-round3.png`, `call-window-round3.png`, `stories-round3.png` |
| Admin dashboard, unbuilt sections, All conversations | 3 | `admin-screens/admin-dashboard-round3.png`, `admin-placeholder-round3.png`, `admin-conversations-round3.png` |
| Student schedules desk | 3 | `admin-screens/student-schedules-round3.png`, `student-schedules-phone-round3.png` |
| Paused and stopped students (`/teachers/students`) | 3 | `admin-screens/teacher-students-round3.png` |
| Teacher boards, board viewer | 3 | `admin-screens/teacher-boards-round3.png`, `teacher-board-viewer-round3.png` |
| Collapsible rail (shell, every page) | see below | `admin-screens/rail-*.png` |

Every page has now had at least three critic rounds.

**Collapsible rail (2026-11-27).** The desktop sidebar is folded to icons by default and opens to icon and label from its foot (see `admin-decisions.md`).
- **Final run:** every page (73 routes) in both states, in Arabic and English. Folded (the default) at 1440x900, 1024x768 and 390x844; opened at 1440x900 and 1024x768. 730 shots.
- **Automatic check:** it looks for content that spills past the page or is cut off by a box that hides overflow.
- **What it caught, now fixed:**
  - The pages that broke at 1024 with the rail open, when a page gets about 764px: Instalments, Teacher statistics, the payments ledger, the chat reply queue, and Attendance.
  - The All conversations order picker on phones.
- **What it still flags:** a supervisor's 404 on a student profile they may not open (a permission, in both states), and the payments row action that the stacked ledger hides on purpose (the row opens the payment).
- **Critic rounds on the rail:** 3. Pairs per page type are `admin-screens/rail-<page>-folded.png` and `rail-<page>-open.png`, plus `rail-tooltip`, `rail-menu`, `rail-account`, `rail-keyboard-focus` and `rail-short-1366x768-open`. The gallery's `rail.html` pairs every page.
