import type { Pair } from '@/features/organization/copy'
import type { CaseEvent, CaseStatus, CaseSubjectKind, CaseTab, CaseTarget } from './api'

export { useCopy } from '@/features/organization/copy'

/** PD-35 B5: escalation cases, Arabic and English side by side. */
export const C = {
  title: { en: 'Escalations', ar: 'التصعيدات' },
  sortNeed: { en: 'Past due first, then soonest due', ar: 'المتجاوزة موعدها أولًا، ثم الأقرب موعدًا' },
  empty: { en: 'No open escalations in this list', ar: 'لا تصعيدات مفتوحة في هذه القائمة' },
  emptyAll: { en: 'No escalations in this list', ar: 'لا تصعيدات في هذه القائمة' },
  emptyHint: {
    en: 'A case appears here when a supervisor escalates one from a teacher, a student or a family.',
    ar: 'تظهر الحالة هنا حين يصعّدها مشرف من صفحة معلم أو طالب أو عائلة.',
  },
  showClosed: { en: 'Show closed', ar: 'عرض المغلقة' },
  owner: { en: 'Owner', ar: 'المسؤول' },
  noOwner: { en: 'No owner', ar: 'بلا مسؤول' },
  openedBy: { en: 'Opened by {name}', ar: 'فتحها {name}' },
  due: { en: 'Due', ar: 'الموعد' },
  dueOn: { en: 'Due {date}', ar: 'الموعد {date}' },
  noDue: { en: 'No due date', ar: 'بلا موعد' },
  about: { en: 'About', ar: 'بخصوص' },
  history: { en: 'History', ar: 'السجل' },
  start: { en: 'Start working on it', ar: 'بدء العمل عليها' },
  resolve: { en: 'Resolve', ar: 'حل' },
  cancel: { en: 'Cancel case', ar: 'إلغاء الحالة' },
  addNote: { en: 'Add a note', ar: 'إضافة ملاحظة' },
  note: { en: 'Note', ar: 'ملاحظة' },
  noteHint: { en: 'Say how it was settled.', ar: 'اذكر كيف حُلّت.' },
  save: { en: 'Save', ar: 'حفظ' },
  clearDue: { en: 'Clear', ar: 'مسح' },
  close: { en: 'Close', ar: 'إغلاق' },
  pastDue: { en: 'Past due', ar: 'تجاوزت موعدها' },
  // The due day, relative to today: "Due tomorrow", "Was due 3 days ago".
  dueWhen: { en: 'Due {when}', ar: 'موعدها {when}' },
  wasDue: { en: 'Was due {when}', ar: 'تجاوزت موعدها {when}' },

  factOpenedBy: { en: 'Opened by', ar: 'فتحها' },
  moreActions: { en: 'More actions: {name}', ar: 'إجراءات أخرى: {name}' },
  // Opening
  escalate: { en: 'Escalate', ar: 'تصعيد' },
  caseTitle: { en: 'Title', ar: 'العنوان' },
  details: { en: 'Details', ar: 'التفاصيل' },
  sendTo: { en: 'Send to', ar: 'إرسال إلى' },
  send: { en: 'Send', ar: 'إرسال' },
  // B6: the case card in a department room
  escalatedBy: { en: '{name} escalated a case to this department.', ar: 'صعّد {name} حالة إلى هذا القسم.' },
  ownerIs: { en: 'Owner: {name}.', ar: 'المسؤول: {name}.' },
  openInEscalations: { en: 'Open in Escalations', ar: 'فتح في التصعيدات' },
  sent: { en: 'Sent. It is in Escalations, under "Opened by me".', ar: 'أُرسلت. تجدها في التصعيدات، ضمن "فتحتها أنا".' },
} satisfies Record<string, Pair>

/** The queue's groups: where a case stands. */
export const GROUP_LABEL = {
  past: { en: 'Past due', ar: 'تجاوزت موعدها' },
  soon: { en: 'Due today or tomorrow', ar: 'موعدها اليوم أو غدًا' },
  later: { en: 'Later', ar: 'لاحقًا' },
  none: { en: 'No due date', ar: 'بلا موعد' },
  closed: { en: 'Closed', ar: 'مغلقة' },
} satisfies Record<string, Pair>

export const TAB_LABEL: Record<CaseTab, Pair> = {
  mine: { en: 'Mine', ar: 'المسندة إليّ' },
  opened: { en: 'Opened by me', ar: 'فتحتها أنا' },
  department: { en: 'My department', ar: 'قسمي' },
}

export const STATUS_LABEL: Record<CaseStatus, Pair> = {
  open: { en: 'Open', ar: 'مفتوحة' },
  in_progress: { en: 'In progress', ar: 'قيد العمل' },
  resolved: { en: 'Resolved', ar: 'محلولة' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة' },
}

export const TARGET_LABEL: Record<CaseTarget, Pair> = {
  teachers: { en: 'Teachers Manager', ar: 'مدير المعلمين' },
  operations: { en: 'Operations Manager', ar: 'مدير العمليات' },
}

export const SUBJECT_LABEL: Record<CaseSubjectKind, Pair> = {
  teacher: { en: 'Teacher', ar: 'المعلم' },
  lesson: { en: 'Lesson', ar: 'الحصة' },
  learner: { en: 'Student', ar: 'الطالب' },
  complaint: { en: 'Complaint', ar: 'الشكوى' },
  feedback: { en: 'Parent feedback', ar: 'ملاحظة ولي الأمر' },
}

export const EVENT_LABEL: Record<CaseEvent['kind'], Pair> = {
  opened: { en: 'Opened', ar: 'فُتحت' },
  assigned: { en: 'Assigned', ar: 'أُسندت' },
  status: { en: 'Status changed', ar: 'تغيّرت الحالة' },
  due: { en: 'Due date changed', ar: 'تغيّر الموعد' },
  note: { en: 'Note', ar: 'ملاحظة' },
}
