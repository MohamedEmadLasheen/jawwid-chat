import type { Pair } from '@/features/organization/copy'

export { useCopy } from '@/features/organization/copy'

/**
 * PD-39 staff viewer copy. Wording rule (§10 1d, 5a): it never offers what the
 * server will not do -- no edit, no delete -- and it says plainly that every
 * look is recorded and when a kept board is deleted for good.
 */
export const B = {
  title: { en: "Teachers' boards", ar: 'سبورات المعلمين' },
  tab: { en: 'Boards', ar: 'السبورات' },
  subtitle: {
    en: 'Read only. Every list and every board you open is recorded in its access history.',
    ar: 'للاطلاع فقط. كل قائمة وكل سبورة تفتحها تُسجَّل في سجل الوصول الخاص بها.',
  },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  chooseTeacher: { en: 'Choose a teacher', ar: 'اختر معلمًا' },
  chooseTeacherHint: { en: "Choose a teacher to see their boards.", ar: 'اختر معلمًا لعرض سبوراته.' },
  departed: { en: '{name} (left)', ar: '{name} (غادر)' },
  noBoards: { en: 'No boards', ar: 'لا توجد سبورات' },
  noBoardsHint: { en: 'This teacher has no boards in use or kept.', ar: 'ليس لدى هذا المعلم سبورات مستخدمة أو محفوظة.' },
  notYours: { en: "You can't see this teacher's boards", ar: 'لا يمكنك الاطلاع على سبورات هذا المعلم' },
  notYoursHint: {
    en: "A teacher's boards are open to their supervisor, their active backup, the Teachers Manager and the super admin.",
    ar: 'سبورات المعلم متاحة لمشرفه ولمن ينوب عنه حاليًا ولمدير المعلمين وللمدير العام.',
  },
  boardNotFound: { en: 'This board is not available to you', ar: 'هذه السبورة غير متاحة لك' },
  pages: { en: '{n} pages', ar: 'عدد الصفحات: {n}' },
  updated: { en: 'Updated {date}', ar: 'آخر تحديث {date}' },
  kept: { en: 'Kept until {date}', ar: 'محفوظة حتى {date}' },
  keptHint: {
    en: 'The teacher has left. This board is deleted for good on {date} unless it is copied to another teacher.',
    ar: 'غادر المعلم. تُحذف هذه السبورة نهائيًا في {date} ما لم تُنسخ إلى معلم آخر.',
  },
  readOnly: { en: 'Read only', ar: 'للاطلاع فقط' },
  allBoards: { en: 'All boards', ar: 'كل السبورات' },
  pageOf: { en: 'Page {n} of {m}', ar: 'الصفحة {n} من {m}' },
  previousPage: { en: 'Previous page', ar: 'الصفحة السابقة' },
  nextPage: { en: 'Next page', ar: 'الصفحة التالية' },
  canvasLabel: { en: 'Page {n} of the board «{title}»', ar: 'الصفحة {n} من السبورة «{title}»' },
  noPages: { en: 'This board has no pages.', ar: 'لا توجد صفحات في هذه السبورة.' },
  verseLoading: { en: 'Loading the verse…', ar: 'جارٍ تحميل الآية…' },
  verseUnavailable: { en: 'Verse text unavailable', ar: 'نص الآية غير متاح' },
  verseChanged: {
    en: 'The verse text has changed since it was placed. The teacher should insert it again.',
    ar: 'تغيّر نص الآية منذ إدراجها. على المعلم إدراجها من جديد.',
  },
  imageLoading: { en: 'Loading the image…', ar: 'جارٍ تحميل الصورة…' },
  imageUnavailable: { en: 'Image unavailable. Open the board again to reload it.', ar: 'الصورة غير متاحة. افتح السبورة من جديد لإعادة تحميلها.' },
  unknownKind: { en: 'Not shown here: {kind}', ar: 'لا يُعرض هنا: {kind}' },
  quranSource: { en: 'Quran text: {source}', ar: 'نص القرآن: {source}' },
  pageText: { en: 'Text on this page', ar: 'النصوص في هذه الصفحة' },
  verseRef: { en: 'Quran: surah {surah}, ayat {from} to {to}', ar: 'القرآن: سورة {surah}، الآيات {from} إلى {to}' },

  history: { en: 'Access history', ar: 'سجل الوصول' },
  showHistory: { en: 'Show access history', ar: 'عرض سجل الوصول' },
  historyNote: { en: 'Opening the history is recorded too.', ar: 'فتح السجل يُسجَّل أيضًا.' },
  historyEmpty: { en: 'Nothing recorded yet', ar: 'لا يوجد شيء مسجّل بعد' },
  colWhen: { en: 'When', ar: 'الوقت' },
  colWho: { en: 'Who', ar: 'من' },
  colAs: { en: 'As', ar: 'بصفته' },
  colAction: { en: 'What', ar: 'الإجراء' },
  supportBy: { en: 'Support session by {name}', ar: 'جلسة دعم بواسطة {name}' },
  someone: { en: 'Unknown', ar: 'غير معروف' },
  system: { en: 'System', ar: 'النظام' },

  copy: { en: 'Copy to a teacher', ar: 'نسخ إلى معلم' },
  copyTitle: { en: 'Copy «{title}» to another teacher', ar: 'نسخ «{title}» إلى معلم آخر' },
  copyBody: {
    en: 'The teacher gets a new board of their own. This board stays as it is and is still deleted for good on {date}.',
    ar: 'يحصل المعلم على سبورة جديدة خاصة به. تبقى هذه السبورة كما هي وتُحذف نهائيًا في {date}.',
  },
  copyTo: { en: 'Copy to', ar: 'النسخ إلى' },
  copyConfirm: { en: 'Copy', ar: 'نسخ' },
  copied: { en: 'Copied. {teacher} now has «{title}» among their boards.', ar: 'تم النسخ. أصبحت «{title}» ضمن سبورات {teacher}.' },
} satisfies Record<string, Pair>

export const ACTION: Record<string, Pair> = {
  open: { en: 'Opened the board', ar: 'فتح السبورة' },
  list: { en: 'Saw it in a list', ar: 'ظهرت له في قائمة' },
  read_log: { en: 'Read this history', ar: 'اطّلع على هذا السجل' },
  export: { en: 'Exported', ar: 'صدّر السبورة' },
  trash: { en: 'Moved to Deleted boards', ar: 'نقلها إلى السبورات المحذوفة' },
  restore: { en: 'Restored', ar: 'استعادها' },
  copy: { en: 'Copied to another teacher', ar: 'نسخها إلى معلم آخر' },
  purge: { en: 'Deleted for good', ar: 'حُذفت نهائيًا' },
  retain: { en: 'Kept: the teacher left', ar: 'حُفظت: غادر المعلم' },
  unretain: { en: 'No longer kept: the teacher returned', ar: 'لم تعد محفوظة: عاد المعلم' },
}

export const BASIS: Record<string, Pair> = {
  owner: { en: 'The teacher', ar: 'المعلم' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  backup: { en: 'Backup', ar: 'المشرف البديل' },
  teachers_manager: { en: 'Teachers Manager', ar: 'مدير المعلمين' },
  super_admin: { en: 'Super admin', ar: 'المدير العام' },
  support_session: { en: 'Support session', ar: 'جلسة دعم' },
  system: { en: 'System', ar: 'النظام' },
}
