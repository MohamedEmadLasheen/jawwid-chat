import { useCallback } from 'react'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { BackupStatus, DepartmentKind, Position } from './api'

/**
 * Organization-structure copy, Arabic and English side by side (the {en, ar}
 * pattern of features/admin and features/profile). Wording rule: a label never
 * promises more than the server does -- "assign" changes who supervises a
 * child; it does not move a family, and it says so.
 */
export interface Pair {
  en: string
  ar: string
}

export function useCopy() {
  const { locale } = useI18n()
  return useCallback(
    (pair: Pair, params?: Record<string, string | number>) => {
      const template = locale === 'ar' ? pair.ar : pair.en
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
    },
    [locale],
  )
}

export const T = {
  title: { en: 'Organization', ar: 'الهيكل التنظيمي' },
  subtitle: {
    en: 'Who supervises each child, and who covers whom. Every change is checked by the server and recorded with its reason.',
    ar: 'من يشرف على كل طفل، ومن ينوب عن من. يتحقق الخادم من كل تغيير ويسجّله مع سببه.',
  },
  tabChildren: { en: 'Children & supervisors', ar: 'الأطفال والمشرفون' },
  tabStructure: { en: 'Departments & backups', ar: 'الأقسام والبدلاء' },

  // Children
  search: { en: 'Search a child or a family', ar: 'ابحث عن طفل أو أسرة' },
  filter: { en: 'Show', ar: 'عرض' },
  filterAll: { en: 'All children', ar: 'كل الأطفال' },
  filterUnassigned: { en: 'Without a supervisor', ar: 'بلا مشرف' },
  child: { en: 'Child', ar: 'الطفل' },
  family: { en: 'Family', ar: 'الأسرة' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  unassigned: { en: 'Unassigned', ar: 'غير مُسند' },
  noTeacher: { en: 'No teacher', ar: 'بلا معلم' },
  assign: { en: 'Assign', ar: 'إسناد' },
  change: { en: 'Change', ar: 'تغيير' },
  noChildren: { en: 'No children to show.', ar: 'لا يوجد أطفال للعرض.' },
  noOperations: {
    en: 'Children are assigned by the Operations department. Your department has none to manage.',
    ar: 'يُسند الأطفال من قسم العمليات. لا يوجد في قسمك أطفال لإدارتهم.',
  },
  count: { en: '{n} children', ar: '{n} طفلًا' },

  assignTitle: { en: 'Supervisor for {name}', ar: 'المشرف على {name}' },
  assignTo: { en: 'New supervisor', ar: 'المشرف الجديد' },
  choose: { en: 'Choose…', ar: 'اختر…' },
  assignHint: {
    en: "The child's groups move with them. The parent's 1:1 with the previous supervisor passes to the new one once the previous supervisor has none of the family's children left.",
    ar: 'تنتقل مجموعات الطفل معه. وتنتقل محادثة ولي الأمر الخاصة مع المشرف السابق إلى المشرف الجديد عندما لا يبقى للمشرف السابق أي طفل من الأسرة.',
  },

  // PD-24: changing the supervisor of a group / a new student
  changeSupervisor: { en: 'Change supervisor', ar: 'تغيير المشرف' },
  changeSupervisorTitle: { en: 'Change supervisor — {name}', ar: 'تغيير المشرف — {name}' },
  currentSupervisor: { en: 'Current supervisor', ar: 'المشرف الحالي' },
  movesChildren: { en: 'Moves: {names}', ar: 'ينقل: {names}' },
  transferHint: {
    en: 'Nothing is recreated and nothing is lost. The group stays the same chat, with all its members, messages and files; the current supervisor leaves it and the new one joins it. The children\'s and the parent\'s profiles, lessons, payments and the parent\'s 1:1 with their supervisor move to the new supervisor, and the previous one stops seeing them.',
    ar: 'لا يُعاد إنشاء أي شيء ولا يضيع أي شيء. تبقى المجموعة المحادثة نفسها بكل أعضائها ورسائلها وملفاتها؛ يخرج منها المشرف الحالي وينضم إليها الجديد. وتنتقل ملفات الأطفال وولي الأمر والحصص والمدفوعات ومحادثة ولي الأمر الخاصة مع مشرفه إلى المشرف الجديد، ولا يعود المشرف السابق يراها.',
  },
  transferred: {
    en: '{names} moved to {supervisor}. The chat history is unchanged.',
    ar: 'انتقل {names} إلى {supervisor}. سجلّ المحادثة كما هو.',
  },
  transferUnchanged: { en: 'Already with this supervisor — nothing changed.', ar: 'مع هذا المشرف بالفعل — لم يتغير شيء.' },

  // Structure
  manager: { en: 'Manager', ar: 'المدير' },
  noManager: { en: 'No manager yet', ar: 'لا يوجد مدير بعد' },
  members: { en: 'Team', ar: 'الفريق' },
  personName: { en: 'Name', ar: 'الاسم' },
  position: { en: 'Position', ar: 'الدور' },
  noMembers: { en: 'No team members yet.', ar: 'لا يوجد أعضاء في الفريق بعد.' },
  childrenCount: { en: 'Children', ar: 'الأطفال' },
  backups: { en: 'Backup supervisors', ar: 'المشرفون البدلاء' },
  backupsHint: {
    en: 'A backup sees and answers a supervisor’s conversations ONLY while the link is active. A link starts dormant.',
    ar: 'يرى البديل محادثات المشرف ويرد عليها فقط أثناء تفعيل الربط. يبدأ الربط غير مفعّل.',
  },
  noBackups: { en: 'No backup links yet.', ar: 'لا توجد روابط بدلاء بعد.' },
  covers: { en: '{backup} covers {primary}', ar: '{backup} ينوب عن {primary}' },
  until: { en: 'until {date}', ar: 'حتى {date}' },
  addBackup: { en: 'Add backup link', ar: 'إضافة رابط بديل' },
  activate: { en: 'Activate', ar: 'تفعيل' },
  deactivate: { en: 'Deactivate', ar: 'إيقاف' },
  end: { en: 'End link', ar: 'إنهاء الربط' },
  primaryLabel: { en: 'Supervisor', ar: 'المشرف' },
  backupLabel: { en: 'Backup', ar: 'البديل' },
  activateTitle: { en: 'Activate {backup} for {primary}', ar: 'تفعيل {backup} بديلًا عن {primary}' },
  untilLabel: { en: 'Active until (optional)', ar: 'مفعّل حتى (اختياري)' },
  untilHint: { en: 'Leave empty for the maximum of 90 days. Access ends by itself at that time.', ar: 'اتركه فارغًا لأقصى مدة (90 يومًا). ينتهي الوصول تلقائيًا في ذلك الوقت.' },
  deactivateTitle: { en: 'Deactivate this backup link', ar: 'إيقاف رابط البديل' },
  endTitle: { en: 'End this backup link', ar: 'إنهاء رابط البديل' },
  endHint: { en: 'An ended link is kept as history and cannot be activated again.', ar: 'يُحفظ الرابط المنتهي سجلًا ولا يمكن تفعيله مجددًا.' },

  // PD-33: hand over to backup
  handOver: { en: 'Hand over to backup', ar: 'التسليم إلى البديل' },
  imAway: { en: "I'm away", ar: 'سأغيب' },
  handOverTitle: { en: 'Hand over {name} to a backup', ar: 'تسليم متابعة {name} إلى بديل' },
  handOverHint: {
    en: "Until the date you choose, the backup answers {name}'s families, groups and parent chats, sees their queues and gets their notifications. Everything returns to {name} automatically at that time.",
    ar: 'حتى التاريخ الذي تختاره، يرد البديل على أسر {name} ومجموعاتهم ومحادثات أولياء الأمور، ويرى قوائم العمل ويستلم الإشعارات. ويعود كل شيء إلى {name} تلقائيًا في ذلك الوقت.',
  },
  backupField: { en: 'Backup', ar: 'البديل' },
  linkedBackup: { en: 'linked backup', ar: 'البديل المرتبط' },
  fromField: { en: 'From', ar: 'من' },
  fromNow: { en: 'Now', ar: 'الآن' },
  fromLater: { en: 'Later…', ar: 'لاحقًا…' },
  untilField: { en: 'Until (at most {n} days)', ar: 'حتى (بحد أقصى {n} يومًا)' },
  quick3: { en: '3 days', ar: '3 أيام' },
  quick7: { en: '1 week', ar: 'أسبوع' },
  quick14: { en: '2 weeks', ar: 'أسبوعان' },
  noteField: { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  review: { en: 'Review', ar: 'مراجعة' },
  back: { en: 'Back', ar: 'رجوع' },
  confirmTitle: { en: 'Confirm the hand-over', ar: 'تأكيد التسليم' },
  summary: {
    en: '{families} families, {groups} groups and {items} open items move to {backup} until {date}.',
    ar: 'تنتقل إلى {backup} حتى {date}: الأسر {families} · المجموعات {groups} · المهام المفتوحة {items}.',
  },
  summaryDetail: {
    en: 'Parent chats: {directs} · Awaiting approval: {approvals} · Open instalments: {instalments} · New students: {newStudents}',
    ar: 'محادثات أولياء الأمور: {directs} · بانتظار الموافقة: {approvals} · أقساط مفتوحة: {instalments} · طلاب جدد: {newStudents}',
  },
  summaryKeep: {
    en: '{name} keeps every chat and can still reply; notifications go to {backup}. A line is posted in each group so families know who answers.',
    ar: 'تبقى لـ{name} كل المحادثات ويمكنه الرد؛ وتذهب الإشعارات إلى {backup}. وتُنشر رسالة في كل مجموعة ليعرف الأهل من يرد عليهم.',
  },
  confirm: { en: 'Hand over', ar: 'تسليم' },
  handedOver: { en: 'Handed over. {backup} is covering until {date}.', ar: 'تم التسليم. {backup} يغطي حتى {date}.' },
  awayUntil: { en: 'Away until {date}', ar: 'غائب حتى {date}' },
  coveredBy: { en: '{backup} covering', ar: 'يغطي {backup}' },
  coveringFor: { en: 'Covering {name} until {date}', ar: 'تغطية عن {name} حتى {date}' },
  scheduled: { en: 'Hand-over to {backup} from {date}', ar: 'تسليم إلى {backup} ابتداءً من {date}' },
  extend: { en: 'Extend', ar: 'تمديد' },
  endNow: { en: 'End cover now', ar: 'إنهاء التغطية الآن' },
  awayBanner: { en: "You're away until {date}. {backup} is covering your families.", ar: 'أنت في غياب حتى {date}. {backup} يغطي أسرك.' },
  coveringBanner: { en: "You're covering {name}'s families until {date}.", ar: 'أنت تغطي أسر {name} حتى {date}.' },
  blockedInactive: { en: 'not an active staff member', ar: 'ليس عضوًا نشطًا' },
  blockedAway: { en: 'away themselves', ar: 'غائب أيضًا' },
  blockedAtLimit: { en: 'already covers {n} supervisors', ar: 'يغطي {n} مشرفين بالفعل' },
  noBackup: { en: 'No backup supervisor in this department can cover now.', ar: 'لا يوجد مشرف بديل متاح في هذا القسم الآن.' },
  alreadyAway: { en: '{name} is already handed over to {backup} until {date}.', ar: 'تم تسليم {name} بالفعل إلى {backup} حتى {date}.' },
  untilInvalid: { en: 'Choose an end within {n} days.', ar: 'اختر نهاية خلال {n} يومًا.' },

  // Common
  reason: { en: 'Reason (required)', ar: 'السبب (مطلوب)' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
}

export const DEPARTMENT_LABEL: Record<DepartmentKind, Pair> = {
  operations: { en: 'Operations', ar: 'العمليات' },
  teachers: { en: 'Teachers', ar: 'المعلمون' },
  sales: { en: 'Sales', ar: 'المبيعات' },
}

export const POSITION_LABEL: Record<Position, Pair> = {
  supervisor: { en: 'Supervisor', ar: 'مشرف' },
  backup_supervisor: { en: 'Backup supervisor', ar: 'مشرف بديل' },
}

export const STATUS_LABEL: Record<BackupStatus, Pair> = {
  dormant: { en: 'Dormant', ar: 'غير مفعّل' },
  active: { en: 'Active', ar: 'مفعّل' },
  expired: { en: 'Expired', ar: 'منتهي المدة' },
  deactivated: { en: 'Deactivated', ar: 'موقوف' },
  ended: { en: 'Ended', ar: 'منتهٍ' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.ORG_STRUCTURE_DENIED': { en: 'You are not allowed to make this change.', ar: 'غير مسموح لك بهذا التغيير.' },
  'COMM.ORG_STRUCTURE_INVALID': {
    en: 'The organization structure does not allow this (wrong department, ended link, or mixed supervisors).',
    ar: 'لا يسمح الهيكل التنظيمي بذلك (قسم غير صحيح، أو رابط منتهٍ، أو مشرفون مختلفون).',
  },
  'COMM.LEARNER_UNSUPERVISED': { en: 'This child has no supervisor yet.', ar: 'لا يوجد مشرف لهذا الطفل بعد.' },
  'COMM.CANNOT_PROVISION_STUDENT_GROUP': {
    en: 'Only the children’s supervisor, their active backup or manager may create this group.',
    ar: 'لا ينشئ هذه المجموعة إلا مشرف الأطفال أو بديله المفعّل أو مديره.',
  },
  'COMM.INVALID_PARTICIPANTS': {
    en: 'Someone chosen cannot join: parents must be from this family, teachers must teach one of the children.',
    ar: 'لا يمكن ضم أحد المختارين: يجب أن يكون ولي الأمر من هذه الأسرة، وأن يُدرّس المعلم أحد الأطفال.',
  },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const mapped = BY_CODE[error.code]
    return mapped ? pick(mapped) : error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}
