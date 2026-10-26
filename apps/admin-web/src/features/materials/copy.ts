import { ApiError } from '@/core/api/errors'
import type { AgeGroup, ItemStatus, Kind, Strand, Subject } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'
import type { Pair } from '@/features/organization/copy'

/**
 * PD-29 Materials copy, Arabic and English side by side. Wording rule: the
 * library PLAYS the academy's existing materials -- nothing here creates
 * content -- and a label never promises more than the server does.
 */
export const M = {
  title: { en: 'Materials', ar: 'المواد التعليمية' },
  subtitle: {
    en: 'The academy’s existing Quran, Arabic and Islamic-studies materials, played in the app. Families see published items by subject and age; teachers attach them to lesson reports.',
    ar: 'مواد الأكاديمية الموجودة في القرآن واللغة العربية والتربية الإسلامية، تُعرض داخل التطبيق. ترى الأسر المواد المنشورة حسب المادة والعمر، ويرفقها المعلمون بتقارير الحصص.',
  },
  tabs: { en: 'Sections', ar: 'الأقسام' },
  tabLibrary: { en: 'Library', ar: 'المكتبة' },
  tabImport: { en: 'Import', ar: 'الاستيراد' },
  tabRecitations: { en: 'Recitations', ar: 'التلاوات' },

  // Library
  add: { en: 'Add item', ar: 'إضافة مادة' },
  search: { en: 'Search by title or ref', ar: 'ابحث بالعنوان أو المرجع' },
  subject: { en: 'Subject', ar: 'المادة' },
  strand: { en: 'Strand', ar: 'المجال' },
  kind: { en: 'Type', ar: 'النوع' },
  status: { en: 'Status', ar: 'الحالة' },
  ageGroups: { en: 'Age groups', ar: 'الفئات العمرية' },
  ageGroup: { en: 'Age group', ar: 'الفئة العمرية' },
  allAges: { en: 'All ages', ar: 'كل الأعمار' },
  allAgesHint: { en: 'Choose none to suit every age.', ar: 'اترك الكل دون تحديد ليناسب جميع الأعمار.' },
  all: { en: 'All', ar: 'الكل' },
  surah: { en: 'Surah', ar: 'السورة' },
  noSurah: { en: 'No surah', ar: 'بدون سورة' },
  titleAr: { en: 'Title (Arabic)', ar: 'العنوان (بالعربية)' },
  titleEn: { en: 'Title (English)', ar: 'العنوان (بالإنجليزية)' },
  description: { en: 'Description', ar: 'الوصف' },
  ref: { en: 'Ref (stable key for imports)', ar: 'المرجع (مفتاح ثابت للاستيراد)' },
  sortOrder: { en: 'Order', ar: 'الترتيب' },
  sortOrderHint: {
    en: 'Its place in the list: 1 comes first. Set from the import row; Quran always lists Al-Fatihah first, then by surah from An-Nas down.',
    ar: 'مكانها في القائمة: ١ أولًا. يُؤخذ من صف الاستيراد؛ والقرآن يُعرض دائمًا بالفاتحة أولًا ثم بالسور من الناس نزولًا.',
  },
  sortOrderShort: { en: 'Order {n}', ar: 'الترتيب {n}' },
  source: { en: 'Source', ar: 'المصدر' },
  sourceSite: { en: 'A lesson of the lessons site', ar: 'درس من موقع الدروس' },
  sitePath: { en: 'Lesson path', ar: 'مسار الدرس' },
  sitePathHint: {
    en: 'The path on the lessons site, e.g. /lessons/quran/surah-78. The site’s address is set by the deployment, so the lessons can move without editing items.',
    ar: 'المسار على موقع الدروس، مثل ‎/lessons/quran/surah-78. عنوان الموقع يحدده الإعداد، فيمكن نقل الدروس دون تعديل المواد.',
  },
  sourceLink: { en: 'A link (https)', ar: 'رابط (https)' },
  sourceFile: { en: 'Upload a file', ar: 'رفع ملف' },
  sourceKeep: { en: 'Keep the current source', ar: 'إبقاء المصدر الحالي' },
  url: { en: 'Link', ar: 'الرابط' },
  file: { en: 'File', ar: 'الملف' },
  fileHint: {
    en: 'Audio, video, PDF or image -- or an HTML5 activity as a .zip with index.html at the top (H5P exported as HTML works; a raw .h5p does not).',
    ar: 'صوت أو فيديو أو PDF أو صورة -- أو نشاط HTML5 في ملف .zip يحتوي index.html في أعلاه (يعمل H5P المُصدَّر بصيغة HTML، ولا يعمل ملف .h5p الخام).',
  },
  empty: { en: 'No items match.', ar: 'لا توجد مواد مطابقة.' },
  emptyLibrary: { en: 'The library is empty. Add an item or import a manifest.', ar: 'المكتبة فارغة. أضف مادة أو استورد قائمة.' },
  edit: { en: 'Edit', ar: 'تعديل' },
  preview: { en: 'Preview', ar: 'معاينة' },
  publish: { en: 'Publish', ar: 'نشر' },
  retire: { en: 'Retire', ar: 'إيقاف' },
  restoreDraft: { en: 'Back to draft', ar: 'إرجاع إلى مسودة' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  newItem: { en: 'New item', ar: 'مادة جديدة' },
  editItem: { en: 'Edit item', ar: 'تعديل المادة' },
  skipped: { en: 'Not served (types a web page does not need): {files}', ar: 'لن تُعرض (أنواع لا تحتاجها صفحة الويب): {files}' },
  open: { en: 'Open in a new tab', ar: 'فتح في تبويب جديد' },
  previewNote: {
    en: 'Played in a sandbox: it cannot reach this page, your session or the API.',
    ar: 'يُعرض في بيئة معزولة: لا يصل إلى هذه الصفحة ولا إلى جلستك ولا إلى الخادم.',
  },
  opensInBrowser: {
    en: 'This link is not on the allowed list for embedding, so families open it in their browser.',
    ar: 'هذا الرابط ليس ضمن القائمة المسموح بعرضها داخل التطبيق، لذلك تفتحه الأسر في المتصفح.',
  },
  noPreview: { en: 'This file type has no preview here.', ar: 'لا توجد معاينة لهذا النوع هنا.' },

  // Import
  importIntro: {
    en: 'Bring existing materials in at once: a CSV or JSON manifest (one row per item) and the files it names. Check first -- nothing is written until you import. Rows with the same ref update the same item, so importing again never duplicates.',
    ar: 'أدخل المواد الموجودة دفعة واحدة: قائمة CSV أو JSON (صف لكل مادة) والملفات التي تذكرها. افحص أولًا -- لا يُكتب شيء حتى تضغط استيراد. الصفوف التي تحمل المرجع نفسه تحدّث المادة نفسها، فلا يتكرر شيء عند إعادة الاستيراد.',
  },
  template: { en: 'Download the CSV template', ar: 'تنزيل قالب CSV' },
  manifest: { en: 'Manifest (.csv or .json)', ar: 'القائمة (‎.csv أو ‎.json)' },
  files: { en: 'Files named in the manifest', ar: 'الملفات المذكورة في القائمة' },
  filesChosen: { en: 'Files chosen: {n}', ar: 'عدد الملفات المختارة: {n}' },
  check: { en: 'Check', ar: 'فحص' },
  checking: { en: 'Checking…', ar: 'جارٍ الفحص…' },
  runImport: { en: 'Upload files and import', ar: 'رفع الملفات والاستيراد' },
  importing: { en: 'Uploading {done} of {total}…', ar: 'جارٍ رفع {done} من {total}…' },
  committing: { en: 'Importing…', ar: 'جارٍ الاستيراد…' },
  summary: { en: '{create} new · {update} updated · {errors} with errors', ar: '{create} جديدة · {update} محدّثة · {errors} بها أخطاء' },
  fixFirst: { en: 'Fix the rows with errors in the manifest, then check again.', ar: 'صحّح الصفوف التي بها أخطاء في القائمة ثم افحص مرة أخرى.' },
  imported: { en: 'Imported: {create} new, {update} updated. New items are drafts unless the row says published.', ar: 'تم الاستيراد: {create} جديدة، {update} محدّثة. المواد الجديدة مسودات ما لم يذكر الصف أنها منشورة.' },
  notImported: { en: 'Nothing was imported:', ar: 'لم يُستورد شيء:' },
  unmatched: { en: 'Files no row names (not uploaded): {files}', ar: 'ملفات لا يذكرها أي صف (لن تُرفع): {files}' },
  row: { en: 'Row', ar: 'الصف' },
  action: { en: 'Result', ar: 'النتيجة' },
  actionCreate: { en: 'New', ar: 'جديدة' },
  actionUpdate: { en: 'Update', ar: 'تحديث' },
  actionError: { en: 'Error', ar: 'خطأ' },
  details: { en: 'Details', ar: 'التفاصيل' },
  badManifest: { en: 'The manifest could not be read.', ar: 'تعذّرت قراءة القائمة.' },

  // Recitations
  recitationIntro: {
    en: 'Recitations come from a source the academy is authorized to use. A source’s link pattern covers every surah ({surah} = 1–114, {surah3} = 001–114); a surah can be given its own link or file instead.',
    ar: 'تأتي التلاوات من مصدر مأذون للأكاديمية باستخدامه. نمط رابط المصدر يغطي كل السور ({surah} = 1–114، {surah3} = 001–114)، ويمكن إعطاء سورة رابطًا أو ملفًا خاصًا بها بدلًا منه.',
  },
  sourceName: { en: 'Source name', ar: 'اسم المصدر' },
  urlTemplate: { en: 'Link pattern (https)', ar: 'نمط الرابط (https)' },
  makeDefault: { en: 'The source families hear', ar: 'المصدر الذي تسمعه الأسر' },
  isDefault: { en: 'In use', ar: 'مستخدم' },
  inactive: { en: 'Retired', ar: 'موقوف' },
  addSource: { en: 'Add source', ar: 'إضافة مصدر' },
  noSources: { en: 'No recitation source yet. Families see surahs without audio until one is added.', ar: 'لا يوجد مصدر تلاوة بعد. ترى الأسر السور بدون صوت حتى يُضاف مصدر.' },
  overrides: { en: 'Surahs with their own recitation', ar: 'سور لها تلاوة خاصة' },
  setOverride: { en: 'Set', ar: 'تعيين' },
  clear: { en: 'Use the pattern', ar: 'استخدام النمط' },
  retireSource: { en: 'Retire', ar: 'إيقاف' },
  restoreSource: { en: 'Restore', ar: 'استعادة' },
  useSource: { en: 'Use this source', ar: 'استخدام هذا المصدر' },
} satisfies Record<string, Pair>

export const SUBJECT_LABEL: Record<Subject, Pair> = {
  quran: { en: 'Quran', ar: 'القرآن الكريم' },
  arabic: { en: 'Arabic language', ar: 'اللغة العربية' },
  islamic_studies: { en: 'Islamic studies', ar: 'التربية الإسلامية' },
}

export const STRAND_LABEL: Record<Strand, Pair> = {
  memorization: { en: 'Memorization', ar: 'الحفظ' },
  recitation: { en: 'Recitation', ar: 'التلاوة' },
  word_meanings: { en: 'Word meanings', ar: 'معاني الكلمات' },
  tafsir: { en: 'Tafsir', ar: 'التفسير' },
}

export const KIND_LABEL: Record<Kind, Pair> = {
  activity_package: { en: 'Activity (HTML5)', ar: 'نشاط (HTML5)' },
  activity_link: { en: 'Activity link', ar: 'رابط نشاط' },
  audio: { en: 'Audio', ar: 'صوت' },
  video: { en: 'Video', ar: 'فيديو' },
  pdf: { en: 'PDF', ar: 'PDF' },
  image: { en: 'Image', ar: 'صورة' },
}

export const STATUS_LABEL: Record<ItemStatus, Pair> = {
  draft: { en: 'Draft', ar: 'مسودة' },
  published: { en: 'Published', ar: 'منشورة' },
  retired: { en: 'Retired', ar: 'موقوفة' },
}

export const AGE_LABEL: Record<AgeGroup, Pair> = {
  '4-6': { en: '4–6 years', ar: '٤–٦ سنوات' },
  '7-9': { en: '7–9 years', ar: '٧–٩ سنوات' },
  '10-12': { en: '10–12 years', ar: '١٠–١٢ سنة' },
  '13-17': { en: '13–17 years', ar: '١٣–١٧ سنة' },
  '18+': { en: '18+', ar: '١٨ فأكثر' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.MATERIAL_DENIED': {
    en: 'The library is managed by the super admin and the Teachers manager.',
    ar: 'يدير المكتبة المدير العام ومدير قسم المعلمين.',
  },
  'COMM.MATERIAL_NOT_FOUND': { en: 'Not found, or no longer available.', ar: 'غير موجودة أو لم تعد متاحة.' },
  'COMM.MATERIAL_NOT_UPLOADED': { en: 'The file did not finish uploading. Try again.', ar: 'لم يكتمل رفع الملف. حاول مرة أخرى.' },
  'COMM.MATERIAL_INVALID': { en: 'Please check the form', ar: 'يُرجى مراجعة النموذج' },
  'COMM.MATERIAL_FILE_REFUSED': { en: 'The file was refused', ar: 'رُفض الملف' },
  'COMM.LESSON_DENIED': { en: 'You may not do this for this child.', ar: 'لا يمكنك تنفيذ هذا لهذا الطفل.' },
  'COMM.LESSON_NOT_FOUND': { en: 'Not found, or not a child you look after.', ar: 'غير موجود، أو ليس طفلًا تتابعه.' },
}

/** Codes whose server message says exactly what to fix: shown after the label. */
const WITH_DETAIL = new Set(['COMM.MATERIAL_INVALID', 'COMM.MATERIAL_FILE_REFUSED'])

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = error.code ? BY_CODE[error.code] : undefined
    if (known && WITH_DETAIL.has(error.code)) return `${pick(known)}: ${error.messageEn}`
    if (known) return pick(known)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** An item's title in the viewer's language, falling back to the other. */
export function itemTitle(item: { titleAr: string | null; titleEn: string | null }, locale: 'ar' | 'en'): string {
  return (locale === 'ar' ? item.titleAr ?? item.titleEn : item.titleEn ?? item.titleAr) ?? ''
}
