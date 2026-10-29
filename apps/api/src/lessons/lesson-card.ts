import { CardKind, LessonOutcome, RulingDecision } from '../communication/contracts/vocab';
import { performanceLabel, taskLabel, topicLabel } from './report-vocab';
import { surahOf } from '../materials/quran-surahs';

export type CardLanguage = 'ar' | 'en';

/**
 * The plain-text body of a card message, in the family's language. A client
 * that knows cards draws `card.payload`; one that does not still shows this,
 * so a build that predates PD-11 reads a sensible message instead of nothing.
 *
 * Pure, and deliberately plain: no names of anyone but the learner, and no time
 * zone guessed for the reader (the card's own timestamps are what clients format).
 */
export function renderCardBody(kind: string, p: Record<string, unknown>, lang: CardLanguage): string {
  const ar = lang === 'ar';
  const learner = String(p.learnerName ?? '');
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${String(value)}`;
  const join = (...parts: Array<string | null>) => parts.filter((x): x is string => x !== null).join('\n');
  // PD-50: an excuse's category is the family's to read; the free text is not (PD-15).
  const category = line(ar ? 'السبب' : 'Reason', excuseCategoryLabel(String(p.reasonCategory ?? ''), ar));

  switch (kind) {
    case CardKind.LESSON_REPORT:
      // PD-15: the teacher's private note is never on the card.
      return reportBody(p, ar, ar ? `📘 تقرير حصة ${learner}` : `📘 Lesson report — ${learner}`);
    case CardKind.LESSON_CORRECTED:
      return join(
        ar ? `✏️ تم تصحيح سجل حصة ${learner}` : `✏️ ${learner}'s lesson record was corrected`,
        line(ar ? 'السجل الآن' : 'Now recorded as', outcomeLabel(String(p.outcome ?? ''), String(p.apologyTiming ?? ''), ar)),
        p.outcome === LessonOutcome.HELD ? reportBody(p, ar, null) || null : null,
      );
    case CardKind.LESSON_ABSENCE:
      return join(
        ar ? `⏰ لم يحضر ${learner} الحصة` : `⏰ ${learner} did not attend the lesson`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
        ar ? 'إذا كان هناك ظرف طارئ يمكنكم تقديم اعتذار متأخر.' : 'If there was an emergency, you can send a late apology.',
      );
    case CardKind.LESSON_APOLOGY:
      // A supervisor's excuse carries no reason (PD-15): only the family's own does.
      return p.timing === 'after_start'
        ? join(
            ar ? `🙏 سُجّل اعتذار ${learner} عن حصة اليوم بعد بدايتها` : `🙏 ${learner}'s absence from today's lesson is excused`,
            category,
            ar ? 'يمكن ترتيب حصة تعويضية بالاتفاق مع المعلم.' : 'A make-up lesson can be arranged with the teacher.',
          )
        : join(
            ar ? `🙏 لدى ${learner} عذر ولن يتمكن من حضور الحصة` : `🙏 ${learner} has an excuse and will not attend the lesson`,
            category,
            line(ar ? 'السبب' : 'Reason', p.reason),
            ar ? 'يمكن ترتيب حصة تعويضية بالاتفاق مع المعلم.' : 'A make-up lesson can be arranged with the teacher.',
          );
    case CardKind.LESSON_TEACHER_APOLOGY:
      // The teacher's reason is internal (PD-15): the family is told only that a make-up follows.
      return join(
        ar ? `🙏 اعتذر المعلم عن حصة ${learner}` : `🙏 The teacher cannot teach ${learner}'s lesson`,
        ar ? 'سيتم ترتيب حصة تعويضية.' : 'A make-up lesson will be arranged.',
      );
    case CardKind.LESSON_CANCELLED:
      return p.outcome === LessonOutcome.TEACHER_NO_SHOW
        ? join(
            ar ? `⚠️ لم تُعقد حصة ${learner} لغياب المعلم` : `⚠️ ${learner}'s lesson did not take place: the teacher was absent`,
            ar ? 'سيتم ترتيب حصة تعويضية.' : 'A make-up lesson will be arranged.',
          )
        : join(
            ar ? `❌ أُلغيت حصة ${learner}` : `❌ ${learner}'s lesson was cancelled`,
            line(ar ? 'السبب' : 'Reason', p.reason),
          );
    case CardKind.LESSON_LATE_APOLOGY:
      return join(
        ar ? `🕊️ اعتذار متأخر عن حصة ${learner}` : `🕊️ Late apology for ${learner}'s lesson`,
        category,
        line(ar ? 'السبب' : 'Reason', p.reason),
        ar ? 'ستراجعه الإدارة.' : 'The supervision team will review it.',
      );
    case CardKind.LESSON_RULING:
      return join(
        p.decision === RulingDecision.EXCUSED
          ? ar ? `✅ قُبل الاعتذار عن حصة ${learner}` : `✅ The apology for ${learner}'s lesson was accepted`
          : ar ? `ℹ️ سُجّلت حصة ${learner} غيابًا` : `ℹ️ ${learner}'s lesson is recorded as an absence`,
        p.decision === RulingDecision.EXCUSED ? category : null,
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.LESSON_MOVED:
      // The times are the card's own timestamps, which clients draw in the reader's zone.
      return ar ? `📅 تغيّر موعد حصة ${learner}` : `📅 ${learner}'s lesson was moved`;
    case CardKind.LESSON_UNSCHEDULED:
      return ar
        ? `📅 لا يستطيع المعلم الجديد حضور إحدى حصص ${learner} في موعدها؛ ستحدد الإدارة موعدًا جديدًا لها`
        : `📅 The new teacher cannot take one of ${learner}'s lessons at its time; the team will set a new time`;
    case CardKind.LESSON_MAKEUP_BOOKED:
      return ar ? `📅 تم تحديد موعد حصة تعويضية لـ ${learner}` : `📅 A make-up lesson is scheduled for ${learner}`;
    case CardKind.LESSON_MAKEUP_RESOLVED:
      return join(
        ar ? `ℹ️ تمت معالجة الحصة التي لم يقدمها المعلم لـ ${learner}` : `ℹ️ The lesson ${learner} missed through the teacher has been resolved`,
        line(ar ? 'الإجراء' : 'Action', makeupActionLabel(String(p.action ?? ''), ar)),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.SCHEDULE_CHANGE_REQUESTED:
      return join(
        ar ? `🗓️ طلب تغيير مواعيد حصص ${learner}` : `🗓️ Request to change ${learner}'s regular lesson times`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
        ar ? 'ستراجعه الإدارة.' : 'The supervision team will review it.',
      );
    case CardKind.SCHEDULE_CHANGE_DECIDED:
      return join(
        p.decision === 'approved'
          ? ar ? `✅ تم اعتماد المواعيد الجديدة لحصص ${learner}` : `✅ ${learner}'s new regular lesson times are confirmed`
          : ar ? `ℹ️ لم يُعتمد طلب تغيير مواعيد ${learner}` : `ℹ️ The request to change ${learner}'s times was not approved`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.LEARNER_TRANSFERRED:
      return ar
        ? `👋 سيدرّس ${String(p.teacherName ?? '')} ${learner} ابتداءً من الآن.`
        : `👋 ${String(p.teacherName ?? '')} will teach ${learner} from now on.`;
    case CardKind.LEARNER_HANDOVER:
      return join(
        ar ? `📝 انضم إليك ${learner}` : `📝 ${learner} is now your student`,
        line(ar ? 'المعلم السابق' : 'Previous teacher', p.fromTeacherName),
        line(ar ? 'ملاحظات التسليم' : 'Handover', p.handoverNote),
      );
    case CardKind.LEARNER_SUSPENDED:
      return p.kind === 'temporary'
        ? ar ? `⏸️ توقفت حصص ${learner} مؤقتًا حتى ${String(p.returnOn)}` : `⏸️ ${learner}'s lessons are paused until ${String(p.returnOn)}`
        : ar ? `⏹️ توقفت حصص ${learner}` : `⏹️ ${learner}'s lessons have stopped`;
    case CardKind.LEARNER_RETURN_SOON:
      return ar
        ? `🔔 تعود حصص ${learner} يوم ${String(p.returnOn)}`
        : `🔔 ${learner}'s lessons resume on ${String(p.returnOn)}`;
    case CardKind.LEARNER_RESUMED:
      return ar ? `▶️ عادت حصص ${learner}` : `▶️ ${learner}'s lessons have resumed`;
    case CardKind.TEACHER_BONUS:
      return join(ar ? '🏅 مكافأة' : '🏅 A bonus for you', line(ar ? 'السبب' : 'Reason', p.reason));
    case CardKind.SUBSCRIPTION_GRACE:
      return ar
        ? `⏳ انتهت حصص اشتراك ${learner}. ${graceLeftLabel(Number(p.graceLeft), true)} حتى التجديد.`
        : `⏳ ${learner}'s subscription lessons are used up. ${graceLeftLabel(Number(p.graceLeft), false)} until renewal.`;
    case CardKind.SUBSCRIPTION_LOCKED:
      return join(
        ar ? `⏸️ توقفت حصص ${learner}` : `⏸️ ${learner}'s lessons are paused`,
        lockReasonLines(p, ar),
        ar ? 'جدّدوا الاشتراك أو ادفعوا القسط من «الاشتراكات».' : 'Renew or pay the instalment in Subscriptions.',
      );
    case CardKind.LESSONS_PAUSED:
      return ar ? `⏸️ توقفت حصص ${learner} مؤقتًا.` : `⏸️ ${learner}'s lessons are paused.`;
    case CardKind.SUBSCRIPTION_UNLOCKED:
      return ar ? `▶️ عادت حصص ${learner}.` : `▶️ ${learner}'s lessons are back on.`;
    case CardKind.RENEWAL_REQUESTED:
      return ar ? `🔁 طلب ولي الأمر تجديد اشتراك ${learner}.` : `🔁 The parent asked to renew ${learner}'s subscription.`;
    default:
      return ar ? 'تحديث على الحصة' : 'Lesson update';
  }
}

/** PD-50: an excuse's reason category as the family reads it; null for none or an unknown code. */
export function excuseCategoryLabel(code: string, ar: boolean): string | null {
  switch (code) {
    case 'travel': return ar ? 'سفر' : 'Travel';
    case 'illness': return ar ? 'مرض' : 'Illness';
    case 'exams': return ar ? 'امتحانات' : 'Exams';
    case 'emergency': return ar ? 'ظرف طارئ' : 'An emergency';
    case 'other': return ar ? 'أخرى' : 'Other';
    default: return null;
  }
}

/** PD-30: "2 grace lessons left" / "1 grace lesson left". */
function graceLeftLabel(n: number, ar: boolean): string {
  if (ar) return n === 1 ? 'تبقّت حصة سماح واحدة' : n === 2 ? 'تبقّت حصتا سماح' : `تبقّت ${n} حصص سماح`;
  return n === 1 ? '1 grace lesson left' : `${n} grace lessons left`;
}

/** PD-30: why a child's lessons are paused, one line per reason. */
function lockReasonLines(p: Record<string, unknown>, ar: boolean): string | null {
  const reasons = Array.isArray(p.reasons) ? p.reasons.map(String) : [];
  const lines: string[] = [];
  if (reasons.includes('balance')) lines.push(ar ? 'انتهت حصص الاشتراك' : 'The subscription\'s lessons are used up');
  if (reasons.includes('overdue')) {
    const label = String(p.instalmentLabel ?? '');
    const since = String(p.overdueSince ?? '');
    lines.push(ar ? `القسط ${label} متأخر منذ ${since}` : `Instalment ${label} overdue since ${since}`);
  }
  return lines.length ? lines.join('\n') : null;
}

/** The report's own lines, shared by the report card and a correction to held. */
function reportBody(p: Record<string, unknown>, ar: boolean, title: string | null): string {
  const list = (v: unknown, label: (code: string, ar: boolean) => string) =>
    Array.isArray(v) && v.length > 0 ? v.map((c) => label(String(c), ar)).join('، ') : null;
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${String(value)}`;
  const performance = typeof p.rating === 'number' ? performanceLabel(p.rating, ar) : null;
  return [
    title,
    // PD-30: "2 of 24" when the report kept its subscription's lessons.
    line(
      ar ? 'رقم الحصة' : 'Lesson no.',
      typeof p.lessonNumber === 'number' && typeof p.lessonTotal === 'number'
        ? ar ? `${p.lessonNumber} من ${p.lessonTotal}` : `${p.lessonNumber} of ${p.lessonTotal}`
        : p.lessonNumber,
    ),
    line(ar ? 'ما تمت دراسته' : 'Covered', list(p.coveredTopics, topicLabel)),
    line(ar ? 'التفاصيل' : 'Details', p.covered),
    line(ar ? 'مستوى الأداء' : 'Performance', performance),
    line(ar ? 'المطلوب للحصة القادمة' : 'For next lesson', list(p.nextTasks, taskLabel)),
    line(ar ? 'الواجب' : 'Homework', p.homework),
    line(ar ? 'تدريب هذا الأسبوع' : 'Practice this week', practiceLabel(p.practice, ar)),
  ].filter((x): x is string => x !== null).join('\n');
}

/** PD-29: a report's practice in one line -- "Al-Mulk 1–10، <item title>". */
function practiceLabel(v: unknown, ar: boolean): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const parts = v.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (p.kind === 'item') return String(p.title ?? '');
    const surah = surahOf(Number(p.surah));
    if (!surah) return '';
    const name = ar ? `سورة ${surah.nameAr}` : surah.nameEn;
    const whole = p.ayahFrom === 1 && p.ayahTo === surah.ayahCount;
    return whole ? name : `${name} ${String(p.ayahFrom)}–${String(p.ayahTo)}`;
  }).filter((x) => x !== '');
  return parts.length ? parts.join(ar ? '، ' : ', ') : null;
}

/** A lesson outcome as a family reads it. */
export function outcomeLabel(outcome: string, timing: string, ar: boolean): string {
  switch (outcome) {
    case LessonOutcome.HELD: return ar ? 'حضر الطالب' : 'The student attended';
    case LessonOutcome.STUDENT_NO_SHOW: return ar ? 'لم يحضر الطالب' : 'The student did not attend';
    case LessonOutcome.STUDENT_APOLOGY:
      return timing === 'after_start'
        ? ar ? 'عذر للطالب بعد بداية الحصة' : 'Student excused after the start'
        : ar ? 'عذر للطالب قبل بداية الحصة' : 'Student excused before the start';
    case LessonOutcome.TEACHER_APOLOGY: return ar ? 'اعتذار المعلم' : 'The teacher apologised';
    case LessonOutcome.TEACHER_NO_SHOW: return ar ? 'غياب المعلم' : 'The teacher was absent';
    case LessonOutcome.ADMIN_CANCELLED: return ar ? 'أُلغيت الحصة' : 'Cancelled';
    case LessonOutcome.VOIDED: return ar ? 'حُذفت الحصة من السجل' : 'Removed from the record';
    default: return outcome;
  }
}

function makeupActionLabel(action: string, ar: boolean): string {
  switch (action) {
    case 'substitute_teacher': return ar ? 'معلم بديل' : 'A substitute teacher';
    case 'family_credit': return ar ? 'رصيد للأسرة' : 'A credit to the family';
    case 'package_extension': return ar ? 'تمديد الباقة' : 'The package is extended';
    case 'waived': return ar ? 'لا حاجة لحصة تعويضية' : 'No make-up needed';
    default: return action;
  }
}
