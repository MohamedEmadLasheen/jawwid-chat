export { useCopy, type Pair } from '@/features/organization/copy'

/** PD-52 copy, Arabic and English side by side. */
export const R = {
  group: { en: 'Teacher records', ar: 'سجلات المعلمين' },
  attendanceTitle: { en: 'Attendance & complaints', ar: 'الحضور والتأخير والأعذار والشكاوى' },
  attendanceSubtitle: {
    en: 'Leave, lateness, excuses and absences, and complaints about teachers. A parent’s complaint from the app appears here by itself.',
    ar: 'الإجازات والتأخير والأعذار والغياب والشكاوى المتعلقة بالمعلمين. تظهر شكوى ولي الأمر من التطبيق هنا تلقائيًا.',
  },
  grantsTitle: { en: 'Grants & testimonials', ar: 'المنح والشهادات الطيبة' },
  sections: { en: 'Sections', ar: 'الأقسام' },
  leave: { en: 'Leave', ar: 'الإجازات' },
  lateness: { en: 'Lateness', ar: 'التأخير' },
  excuses: { en: 'Excuses & absences', ar: 'الأعذار والغياب' },
  complaints: { en: 'Complaints', ar: 'الشكاوى' },
  showing: { en: 'Show', ar: 'عرض' },
  complaintsList: { en: 'All complaints', ar: 'كل الشكاوى' },
  suggestions: { en: 'Suggestions', ar: 'الاقتراحات' },
  denied: { en: 'This page is not part of your work.', ar: 'هذه الصفحة ليست ضمن عملك.' },
}
