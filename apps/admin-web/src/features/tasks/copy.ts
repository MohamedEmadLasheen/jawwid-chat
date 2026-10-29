import type { Pair } from '@/features/organization/copy'
import type { Level, SourceType, TaskEvent, TaskView } from './api'

export { useCopy } from '@/features/organization/copy'

/** PD-47: the Tasks page, Arabic and English side by side. */
export const C = {
  title: { en: 'Tasks', ar: 'المهام' },
  subtitle: {
    en: 'Everything someone must do, until it is done. A task leaves a list only when it is completed, removed or handed on.',
    ar: 'كل ما يجب على أحد إنجازه، حتى يُنجَز. لا تغادر المهمة القائمة إلا إذا أُنجزت أو أُزيلت أو أُسندت لغيره.',
  },
  empty: { en: 'Nothing here.', ar: 'لا شيء هنا.' },
  loadMore: { en: 'Show more', ar: 'عرض المزيد' },
  newTask: { en: 'New task', ar: 'مهمة جديدة' },
  // Filters
  level: { en: 'Level', ar: 'المستوى' },
  anyLevel: { en: 'Any level', ar: 'كل المستويات' },
  kind: { en: 'Kind', ar: 'النوع' },
  anyKind: { en: 'Any kind', ar: 'كل الأنواع' },
  operational: { en: 'Operational', ar: 'تشغيلية' },
  overdueOnly: { en: 'Overdue only', ar: 'المتأخرة فقط' },
  goneOnly: { en: 'Assignee left', ar: 'غادر المسند إليه' },
  unmanagedOnly: { en: 'No manager can move it', ar: 'لا يستطيع أي مدير نقلها' },
  clearFilter: { en: 'Clear "{filter}"', ar: 'إلغاء «{filter}»' },
  whose: { en: 'Whose', ar: 'لمن' },
  // A row
  assignedTo: { en: 'Assigned to {name}', ar: 'مسندة إلى {name}' },
  due: { en: 'Due {when}', ar: 'الموعد {when}' },
  noDue: { en: 'No due date', ar: 'بلا موعد' },
  age: { en: 'Opened {ago}', ar: 'فُتحت {ago}' },
  closedOn: { en: 'Closed {when}', ar: 'أُغلقت {when}' },
  // The panel
  close: { en: 'Close', ar: 'إغلاق' },
  overdue: { en: 'Overdue', ar: 'متأخرة' },
  notFound: {
    en: 'This task is not here, or it is not yours to see.',
    ar: 'هذه المهمة غير موجودة، أو ليست مما يحق لك رؤيته.',
  },
  openSource: { en: 'Open', ar: 'فتح' },
  createdBy: { en: 'Given by {name}', ar: 'أسندها {name}' },
  instructions: { en: 'Instructions', ar: 'التعليمات' },
  closeReason: { en: 'Reason', ar: 'السبب' },
  history: { en: 'History', ar: 'السجل' },
  system: { en: 'System', ar: 'النظام' },
  unmanaged: {
    en: 'No manager is responsible for this task now. Only the super admin can move it.',
    ar: 'لا يوجد مدير مسؤول عن هذه المهمة الآن. وحده المشرف العام يستطيع نقلها.',
  },
  withdrawn: {
    en: 'The work behind this task no longer exists. Acknowledge it, or a manager removes it.',
    ar: 'العمل الذي تمثله هذه المهمة لم يعد موجودًا. أقِرّ بذلك، أو يزيلها المدير.',
  },
  assigneeLeft: { en: 'The assignee has left. A manager should hand it on.', ar: 'غادر المسند إليه. على المدير إسنادها لغيره.' },
  // Actions
  complete: { en: 'Mark done', ar: 'تمّ الإنجاز' },
  acknowledge: { en: 'Acknowledge', ar: 'إقرار' },
  outOfScope: { en: 'Not my responsibility', ar: 'ليست من مسؤوليتي' },
  outOfScopeHint: { en: 'Say why. Your manager decides what happens next.', ar: 'اذكر السبب. يقرر مديرك ما يحدث بعد ذلك.' },
  comment: { en: 'Add a comment', ar: 'إضافة تعليق' },
  returnTask: { en: 'Return with instructions', ar: 'إعادة مع تعليمات' },
  remove: { en: 'Remove', ar: 'إزالة' },
  removeHint: { en: 'Say why it is no longer needed.', ar: 'اذكر لماذا لم تعد مطلوبة.' },
  reassign: { en: 'Hand on', ar: 'إسناد لغيره' },
  to: { en: 'To', ar: 'إلى' },
  department: { en: '{department} (its manager, {name})', ar: '{department} (مديره، {name})' },
  optionalInstructions: { en: 'Instructions (optional)', ar: 'تعليمات (اختياري)' },
  shortened: {
    en: 'This list is shortened: not everyone is shown. Send it to a department, and its manager hands it on.',
    ar: 'هذه القائمة مختصرة: لا يظهر الجميع. أرسلها إلى قسم، ويتولى مديره إسنادها.',
  },
  note: { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  text: { en: 'Text', ar: 'النص' },
  dueAt: { en: 'Due', ar: 'الموعد' },
  clearDue: { en: 'Clear', ar: 'مسح' },
  manualLevel: { en: 'Level set by a person', ar: 'المستوى الذي حدده شخص' },
  save: { en: 'Save', ar: 'حفظ' },
  send: { en: 'Send', ar: 'إرسال' },
  // New task
  taskTitle: { en: 'Title', ar: 'العنوان' },
  details: { en: 'Details', ar: 'التفاصيل' },
  assignee: { en: 'Assignee', ar: 'المسند إليه' },
  choose: { en: 'Choose…', ar: 'اختر…' },
  markFinancial: { en: 'Financial', ar: 'مالية' },
  created: { en: 'Created. It is in their tasks now.', ar: 'أُنشئت. أصبحت ضمن مهامه الآن.' },
} satisfies Record<string, Pair>

export const TAB_LABEL: Record<TaskView | 'closed', Pair> = {
  mine: { en: 'Mine', ar: 'مهامي' },
  team: { en: 'Team', ar: 'الفريق' },
  decisions: { en: 'Decisions', ar: 'القرارات' },
  all: { en: 'All', ar: 'الكل' },
  closed: { en: 'Closed', ar: 'المغلقة' },
}

export const LEVEL_LABEL: Record<Level, Pair> = {
  high: { en: 'High', ar: 'عالية' },
  medium: { en: 'Medium', ar: 'متوسطة' },
  low: { en: 'Low', ar: 'منخفضة' },
}

/** Why the level was raised. A level a person set (`manual`) needs no reason. */
export const REASON_LABEL = {
  overdue: { en: 'Overdue', ar: 'متأخرة' },
  due_soon: { en: 'Due soon', ar: 'قريبة الموعد' },
  source: { en: 'Raised by its source', ar: 'رفعها مصدرها' },
} satisfies Record<string, Pair>

/** A source's own words for raising the level. */
export const SOURCE_REASON: Partial<Record<SourceType, Pair>> = {
  package_low: { en: 'Balance used up', ar: 'نفد رصيد الحصص' },
}

export const FINANCE: Pair = { en: 'Finance', ar: 'مالية' }

export const STATE_LABEL = {
  open: { en: 'Open', ar: 'مفتوحة' },
  returned: { en: 'Returned with instructions', ar: 'أُعيدت بتعليمات' },
  awaiting_decision: { en: 'Waiting for a decision', ar: 'بانتظار قرار' },
  withdrawn: { en: 'No longer needed', ar: 'لم تعد مطلوبة' },
  completed: { en: 'Done', ar: 'منجزة' },
  acknowledged: { en: 'Acknowledged', ar: 'أُقرّت' },
  removed: { en: 'Removed', ar: 'أُزيلت' },
} satisfies Record<string, Pair>

export const SOURCE_LABEL: Record<SourceType | 'manual', Pair> = {
  manual: { en: 'Given by a person', ar: 'أسندها شخص' },
  lesson_report: { en: 'Lesson report', ar: 'تقرير حصة' },
  report_correction: { en: 'Report correction', ar: 'تصحيح تقرير' },
  lesson_ruling: { en: 'Lesson ruling', ar: 'قرار بشأن حصة' },
  leave_decision: { en: 'Leave request', ar: 'طلب إجازة' },
  violation_decision: { en: 'Violation', ar: 'مخالفة' },
  case: { en: 'Escalation', ar: 'تصعيد' },
  instalment: { en: 'Instalment', ar: 'قسط' },
  package_low: { en: 'Lessons running out', ar: 'رصيد الحصص' },
  renewal_request: { en: 'Renewal', ar: 'تجديد' },
  receipt_review: { en: 'Transfer receipt', ar: 'إيصال تحويل' },
  checkout_failed: { en: 'Card payment', ar: 'دفع بالبطاقة' },
  family_unsupervised: { en: 'Family without a supervisor', ar: 'عائلة بلا مشرف' },
  teacher_setup: { en: 'Teacher set-up', ar: 'إعداد معلم' },
  new_student_assign: { en: 'New student form', ar: 'استمارة طالب جديد' },
  new_student_group: { en: 'Family group', ar: 'مجموعة العائلة' },
}

/** A system task's title, from its source now (`titleParams`). */
export const SOURCE_TITLE: Record<SourceType, Pair> = {
  lesson_report: { en: 'Write the lesson report: {learner}, {when}', ar: 'اكتب تقرير الحصة: {learner}، {when}' },
  report_correction: { en: 'Correct the lesson report: {learner}, {when}', ar: 'صحّح تقرير الحصة: {learner}، {when}' },
  lesson_ruling: { en: 'Rule on a lesson: {learner}, {when}', ar: 'قرّر بشأن حصة: {learner}، {when}' },
  leave_decision: { en: 'Decide on leave: {teacher}, {first} to {last}', ar: 'قرّر بشأن إجازة: {teacher}، من {first} إلى {last}' },
  violation_decision: { en: 'Decide on a violation: {teacher}', ar: 'قرّر بشأن مخالفة: {teacher}' },
  case: { en: 'Escalation: {title}', ar: 'تصعيد: {title}' },
  instalment: { en: 'Instalment due: {family}, {label}, {amount}', ar: 'قسط مستحق: {family}، {label}، {amount}' },
  package_low: { en: 'Lessons running out: {learner}, {balance} left', ar: 'رصيد الحصص ينفد: {learner}، المتبقي {balance}' },
  renewal_request: { en: 'Renewal requested: {learner}', ar: 'طلب تجديد: {learner}' },
  receipt_review: { en: 'Review a transfer receipt: {family}, {amount}', ar: 'راجع إيصال تحويل: {family}، {amount}' },
  checkout_failed: { en: 'Card payment failed: {family}, {label}, {amount}', ar: 'فشل الدفع بالبطاقة: {family}، {label}، {amount}' },
  family_unsupervised: {
    en: 'Choose an Operations supervisor: {family}, {count} waiting',
    ar: 'اختر مشرف عمليات: {family}، بانتظار {count}',
  },
  teacher_setup: { en: 'Finish setting up {teacher}: {count} left', ar: 'أكمل إعداد {teacher}: المتبقي {count}' },
  new_student_assign: { en: 'Assign the new family: {prospect}, trial {when}', ar: 'أسند العائلة الجديدة: {prospect}، تجربة {when}' },
  new_student_group: { en: 'Open the family group: {family}', ar: 'افتح مجموعة العائلة: {family}' },
}

export const EVENT_LABEL: Record<TaskEvent['kind'], Pair> = {
  created: { en: 'Created', ar: 'أُنشئت' },
  reassigned: { en: 'Handed on', ar: 'أُسندت لغيره' },
  out_of_scope: { en: 'Said not their responsibility', ar: 'قيل إنها ليست من مسؤوليته' },
  returned: { en: 'Returned with instructions', ar: 'أُعيدت بتعليمات' },
  completed: { en: 'Done', ar: 'أُنجزت' },
  removed: { en: 'Removed', ar: 'أُزيلت' },
  commented: { en: 'Comment', ar: 'تعليق' },
  due_changed: { en: 'Due date changed', ar: 'تغيّر الموعد' },
  priority_changed: { en: 'Level changed', ar: 'تغيّر المستوى' },
  source_withdrawn: { en: 'No longer needed', ar: 'لم تعد مطلوبة' },
  source_restored: { en: 'Needed again', ar: 'عادت مطلوبة' },
  source_raised: { en: 'Raised by its source', ar: 'رفعها مصدرها' },
}

export const DEPARTMENT_LABEL: Record<'operations' | 'teachers' | 'sales', Pair> = {
  operations: { en: 'Operations', ar: 'العمليات' },
  teachers: { en: 'Teachers', ar: 'المعلمون' },
  sales: { en: 'Sales', ar: 'المبيعات' },
}
