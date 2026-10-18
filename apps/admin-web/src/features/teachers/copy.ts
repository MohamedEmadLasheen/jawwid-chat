import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * Teacher File copy, Arabic and English side by side. Wording rule: a label
 * never promises more than the server does. Salary, schedule and workload are
 * named as "not here yet", never shown as zero.
 */
export const T = {
  title: { en: 'Teachers', ar: 'المعلمون' },
  subtitle: {
    en: 'Each teacher’s file: personal information, assigned students and supervision notes. Visible to administration only — never to parents or teachers.',
    ar: 'ملف كل معلم: البيانات الشخصية والطلاب المسندون وملاحظات الإشراف. للإدارة فقط، ولا يراه أولياء الأمور ولا المعلمون.',
  },
  search: { en: 'Search a teacher', ar: 'ابحث عن معلم' },
  count: { en: '{n} teachers', ar: '{n} معلمًا' },
  noTeachers: { en: 'No teachers to show.', ar: 'لا يوجد معلمون للعرض.' },
  name: { en: 'Teacher', ar: 'المعلم' },
  students: { en: 'Students', ar: 'الطلاب' },
  openComplaints: { en: 'Open complaints', ar: 'شكاوى مفتوحة' },
  status: { en: 'Status', ar: 'الحالة' },
  active: { en: 'Active', ar: 'نشط' },
  inactive: { en: 'Left', ar: 'غادر' },
  open: { en: 'Open file', ar: 'فتح الملف' },
  back: { en: 'All teachers', ar: 'كل المعلمين' },

  // Sections
  personal: { en: 'Personal information', ar: 'البيانات الشخصية' },
  fullName: { en: 'Full name', ar: 'الاسم الكامل' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  email: { en: 'Email address', ar: 'البريد الإلكتروني' },
  joinedOn: { en: 'Joining date', ar: 'تاريخ الانضمام' },
  notRecorded: { en: 'Not recorded', ar: 'غير مسجّل' },
  lastEdit: { en: 'Last changed by {name}, {date}', ar: 'آخر تعديل: {name}، {date}' },
  edit: { en: 'Edit', ar: 'تعديل' },
  editPersonal: { en: 'Edit personal information', ar: 'تعديل البيانات الشخصية' },
  personalHint: {
    en: 'Leave a field empty to clear it. The audit trail records which fields changed, never their values.',
    ar: 'اترك الحقل فارغًا لمسحه. يسجّل سجل التدقيق الحقول التي تغيّرت دون قيمها.',
  },

  assigned: { en: 'Assigned students', ar: 'الطلاب المسندون' },
  assignedHint: {
    en: 'From the academy’s assignment of each child to a teacher.',
    ar: 'من إسناد الأكاديمية كل طالب إلى معلمه.',
  },
  noStudents: { en: 'No students are assigned to this teacher.', ar: 'لا يوجد طلاب مسندون لهذا المعلم.' },
  child: { en: 'Student', ar: 'الطالب' },
  level: { en: 'Level', ar: 'المستوى' },
  family: { en: 'Family', ar: 'الأسرة' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  none: { en: '—', ar: '—' },

  complaints: { en: 'Complaints', ar: 'الشكاوى' },
  noComplaints: { en: 'No complaints recorded.', ar: 'لا توجد شكاوى مسجّلة.' },
  addComplaint: { en: 'Record a complaint', ar: 'تسجيل شكوى' },
  resolve: { en: 'Resolve', ar: 'معالجة' },
  resolveTitle: { en: 'Resolve the complaint', ar: 'معالجة الشكوى' },
  resolved: { en: 'Resolved', ar: 'تمت المعالجة' },
  unresolved: { en: 'Open', ar: 'مفتوحة' },
  fromConversation: { en: 'Linked to a conversation', ar: 'مرتبطة بمحادثة' },

  monthly: { en: 'Monthly performance', ar: 'الأداء الشهري' },
  noMonthly: { en: 'No monthly comments yet.', ar: 'لا توجد تعليقات شهرية بعد.' },
  addMonthly: { en: 'Write a monthly comment', ar: 'كتابة تعليق شهري' },
  month: { en: 'Month', ar: 'الشهر' },
  earlierVersions: { en: '{n} earlier version(s)', ar: 'نسخ سابقة: {n}' },
  monthlyHint: {
    en: 'Writing again for the same month replaces the comment shown; earlier versions are kept.',
    ar: 'الكتابة مرة أخرى للشهر نفسه تستبدل التعليق المعروض، وتُحفظ النسخ السابقة.',
  },

  daysOff: { en: 'Days off', ar: 'أيام الإجازة' },
  daysOffHint: {
    en: 'Extra days off recorded by supervision. The regular weekly day off arrives with the schedule.',
    ar: 'أيام الإجازة الإضافية التي يسجّلها الإشراف. الإجازة الأسبوعية الثابتة تأتي مع الجدول.',
  },
  noDaysOff: { en: 'No extra days off recorded.', ar: 'لا توجد أيام إجازة إضافية مسجّلة.' },
  addDayOff: { en: 'Record a day off', ar: 'تسجيل يوم إجازة' },
  cancel: { en: 'Cancel day off', ar: 'إلغاء الإجازة' },
  cancelTitle: { en: 'Cancel the day off on {date}', ar: 'إلغاء إجازة يوم {date}' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة' },
  day: { en: 'Day', ar: 'اليوم' },

  notHereYet: { en: 'Not here yet', ar: 'غير متاح بعد' },
  notHereYetBody: {
    en: 'Schedule and workload arrive with the lesson system (PD-9). Salary, bonuses and deductions will be shown read-only from Jawwid Core once it offers them.',
    ar: 'الجدول وعبء العمل يأتيان مع نظام الدروس (PD-9). الراتب والمكافآت والخصومات ستُعرض للقراءة فقط من نظام جوّد الأساسي عند توفيرها.',
  },

  // Forms
  details: { en: 'Details', ar: 'التفاصيل' },
  resolution: { en: 'How it was resolved', ar: 'كيف عولجت' },
  reason: { en: 'Reason for the change', ar: 'سبب التغيير' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  by: { en: '{name}, {date}', ar: '{name}، {date}' },
} satisfies Record<string, Pair>

const BY_CODE: Record<string, Pair> = {
  'COMM.TEACHER_FILE_DENIED': {
    en: 'Teacher Files are for the Teachers department and the super admin.',
    ar: 'ملفات المعلمين لقسم المعلمين والمدير العام فقط.',
  },
  'COMM.TEACHER_FILE_NOT_FOUND': { en: 'This teacher was not found.', ar: 'لم يُعثر على هذا المعلم.' },
  'COMM.TEACHER_FILE_CONFLICT': {
    en: 'Already recorded: this entry has a resolution or cancellation, or that day off exists.',
    ar: 'مسجّل مسبقًا: لهذا البند معالجة أو إلغاء، أو يوم الإجازة موجود.',
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
