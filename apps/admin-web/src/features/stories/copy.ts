import { useCallback, useMemo } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { Bilingual, Plural } from '@/features/admin/copy'
import type { CtaKind, StoryKind, StoryState } from './api'

/**
 * The Stories studio's words, in both languages. Arabic first in spirit: every
 * string was written for an Arabic-speaking operator, not translated after.
 */
export const S = {
  // page
  title: { en: 'Stories', ar: 'الحالات' },
  subtitle: {
    en: 'Publish stories to exactly the people they are for, and see how each one performs.',
    ar: 'انشر الحالات للأشخاص المقصودين بالضبط، وتابع أداء كل حالة.',
  },
  newStory: { en: 'New story', ar: 'حالة جديدة' },
  tabStories: { en: 'Stories', ar: 'الحالات' },
  tabAudience: { en: 'Audience data', ar: 'بيانات الجمهور' },
  back: { en: 'All stories', ar: 'كل الحالات' },

  // summary
  liveNow: { en: 'Live now', ar: 'منشورة الآن' },
  totalReach: { en: 'People reached', ar: 'الأشخاص الذين وصلتهم' },
  totalViews: { en: 'Views', ar: 'المشاهدات' },
  totalTaps: { en: 'Button taps', ar: 'نقرات الأزرار' },

  // list
  searchStories: { en: 'Search stories', ar: 'ابحث في الحالات' },
  clearSearch: { en: 'Clear search', ar: 'مسح البحث' },
  status: { en: 'Status', ar: 'الحالة' },
  all: { en: 'All', ar: 'الكل' },
  noStories: { en: 'No stories yet', ar: 'لا توجد حالات بعد' },
  noStoriesHint: {
    en: 'Create your first story: a few words, a photo, a video or a voice note.',
    ar: 'أنشئ أول حالة: بضع كلمات أو صورة أو فيديو أو رسالة صوتية.',
  },
  noMatches: { en: 'Nothing matches.', ar: 'لا توجد نتائج مطابقة.' },
  untitled: { en: 'Untitled story', ar: 'حالة بلا اسم' },
  colStory: { en: 'Story', ar: 'الحالة' },
  colAudience: { en: 'Audience', ar: 'الجمهور' },
  colPerformance: { en: 'Performance', ar: 'الأداء' },
  viewedOf: { en: '{views} of {reach} viewed', ar: 'شاهدها {views} من {reach}' },
  notPublished: { en: 'Not published', ar: 'غير منشورة' },
  by: { en: 'by {name}', ar: 'بواسطة {name}' },
  publishedAgo: { en: 'Published {when}', ar: 'نُشرت {when}' },
  createdAgo: { en: 'Created {when}', ar: 'أُنشئت {when}' },
  publish: { en: 'Publish', ar: 'نشر' },
  publishNow: { en: 'Publish now', ar: 'انشر الآن' },
  saveDraft: { en: 'Save as draft', ar: 'حفظ كمسودة' },
  viewInsights: { en: 'View insights', ar: 'عرض الأداء' },

  // composer
  composeTitle: { en: 'New story', ar: 'حالة جديدة' },
  stepContent: { en: 'Content', ar: 'المحتوى' },
  stepButton: { en: 'Button', ar: 'الزر' },
  stepAudience: { en: 'Audience', ar: 'الجمهور' },
  stepName: { en: 'Name', ar: 'الاسم' },
  storyType: { en: 'Story type', ar: 'نوع الحالة' },
  textPlaceholder: { en: 'Write your story…', ar: 'اكتب حالتك…' },
  charsLeft: { en: '{n} characters left', ar: 'متبقٍ {n} حرفًا' },
  background: { en: 'Background', ar: 'الخلفية' },
  chooseFile: { en: 'Choose a file', ar: 'اختر ملفًا' },
  dropHint: { en: 'Drag a file here, or choose one', ar: 'اسحب ملفًا إلى هنا أو اختره' },
  photoLimits: { en: 'JPG, PNG, WebP or HEIC · up to 10 MB', ar: 'JPG أو PNG أو WebP أو HEIC · حتى 10 ميغابايت' },
  videoLimits: { en: 'MP4, MOV or WebM · up to 100 MB', ar: 'MP4 أو MOV أو WebM · حتى 100 ميغابايت' },
  voiceLimits: { en: 'M4A, MP3, AAC or WAV · up to 20 MB', ar: 'M4A أو MP3 أو AAC أو WAV · حتى 20 ميغابايت' },
  uploading: { en: 'Uploading…', ar: 'جارٍ الرفع…' },
  replace: { en: 'Replace', ar: 'استبدال' },
  remove: { en: 'Remove', ar: 'إزالة' },
  uploadFailed: { en: 'The file could not be uploaded. Try again.', ar: 'تعذّر رفع الملف. حاول مرة أخرى.' },
  record: { en: 'Record a voice note', ar: 'سجّل رسالة صوتية' },
  stopRecording: { en: 'Stop', ar: 'إيقاف' },
  recording: { en: 'Recording…', ar: 'جارٍ التسجيل…' },
  orUpload: { en: 'or upload an audio file', ar: 'أو ارفع ملفًا صوتيًا' },
  recordingUnsupported: {
    en: 'This browser cannot record a voice note every phone can play. Upload an audio file instead.',
    ar: 'لا يستطيع هذا المتصفح تسجيل رسالة صوتية تعمل على كل الهواتف. ارفع ملفًا صوتيًا بدلًا من ذلك.',
  },
  micDenied: { en: 'Microphone access was not allowed.', ar: 'لم يُسمح بالوصول إلى الميكروفون.' },
  noCaption: {
    en: 'Stories have no caption: the photo, video or voice note speaks for itself.',
    ar: 'لا تحتوي الحالات على تعليق: الصورة أو الفيديو أو الصوت يكفي.',
  },

  ctaNone: { en: 'No button', ar: 'بدون زر' },
  ctaLabel: { en: 'Button text', ar: 'نص الزر' },
  ctaLabelHint: { en: 'Leave empty to use “{default}”.', ar: 'اتركه فارغًا لاستخدام «{default}».' },
  ctaPhone: { en: 'WhatsApp number', ar: 'رقم واتساب' },
  ctaPhoneHint: { en: 'International format, e.g. +971 50 123 4567', ar: 'بالصيغة الدولية، مثل ‎+971 50 123 4567' },
  ctaUrl: { en: 'Link', ar: 'الرابط' },
  ctaUrlHint: { en: 'Must start with https://', ar: 'يجب أن يبدأ بـ https://' },
  ctaMessageHint: {
    en: 'Opens a chat with you. Only people you can be messaged by will see this story.',
    ar: 'يفتح محادثة معك. لن يرى هذه الحالة إلا من يمكنه مراسلتك.',
  },

  // audience
  who: { en: 'Who should see it?', ar: 'من يجب أن يراها؟' },
  whoEveryone: { en: 'Everyone', ar: 'الجميع' },
  whoEveryoneHint: { en: 'All parents and all teachers', ar: 'كل أولياء الأمور وكل المعلمين' },
  whoFamilies: { en: 'Parents & students', ar: 'أولياء الأمور والطلاب' },
  whoFamiliesHint: { en: 'Narrow by plan, children or country', ar: 'حدّد حسب الباقة أو عدد الأبناء أو الدولة' },
  whoTeachers: { en: 'Teachers', ar: 'المعلمون' },
  whoTeachersHint: { en: 'Every active teacher', ar: 'كل المعلمين النشطين' },
  plan: { en: 'Subscription plan', ar: 'باقة الاشتراك' },
  children: { en: 'Number of children', ar: 'عدد الأبناء' },
  country: { en: 'Country', ar: 'الدولة' },
  anyValue: { en: 'Any', ar: 'الكل' },
  addCountry: { en: 'Add a country', ar: 'أضف دولة' },
  filtersHint: {
    en: 'Leave a group on “Any” to include everyone. Groups combine: UAE + 6-month plan means both.',
    ar: 'اترك المجموعة على «الكل» لتشمل الجميع. المجموعات تجتمع معًا: الإمارات + باقة 6 أشهر تعني الاثنين معًا.',
  },
  estimating: { en: 'Counting…', ar: 'جارٍ العدّ…' },
  willReach: { en: 'Will reach', ar: 'ستصل إلى' },
  excludedNote: {
    en: '{n} left out: with a “Message me” button, only families you supervise see it.',
    ar: 'استُبعد {n}: مع زر «راسلني» تظهر الحالة فقط للعائلات التي تشرف عليها.',
  },
  missingNote: {
    en: '{n} families have no {what} recorded and will not match.',
    ar: 'لا تُعرف {what} لدى {n} من العائلات، فلن تصلها الحالة.',
  },
  fillIn: { en: 'Fill it in', ar: 'أكمل البيانات' },
  emptyAudience: {
    en: 'Nobody matches this audience yet.',
    ar: 'لا يوجد أحد يطابق هذا الجمهور حتى الآن.',
  },

  internalName: { en: 'Internal name (optional)', ar: 'اسم داخلي (اختياري)' },
  internalNameHint: {
    en: 'Only admins see this, to find the story later. Readers never do.',
    ar: 'يراه المشرفون فقط للعثور على الحالة لاحقًا، ولا يراه المتابعون أبدًا.',
  },
  preview: { en: 'Preview', ar: 'معاينة' },
  play: { en: 'Play', ar: 'تشغيل' },
  pause: { en: 'Pause', ar: 'إيقاف مؤقت' },
  previewEmpty: { en: 'Your story appears here', ar: 'ستظهر حالتك هنا' },
  confirmTitle: { en: 'Publish this story?', ar: 'نشر هذه الحالة؟' },
  confirmBody: {
    en: 'It goes to {n} now and stays up until you delete it.',
    ar: 'ستصل إلى {n} الآن وتبقى منشورة حتى تحذفها.',
  },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  needContent: { en: 'Add the story’s content first.', ar: 'أضف محتوى الحالة أولًا.' },
  needAudience: { en: 'Choose who should see it.', ar: 'اختر من يجب أن يراها.' },
  published: { en: 'Story published', ar: 'تم نشر الحالة' },
  savedDraft: { en: 'Draft saved', ar: 'تم حفظ المسودة' },

  // insights
  insights: { en: 'Insights', ar: 'الأداء' },
  reached: { en: 'Reached', ar: 'وصلت إلى' },
  viewed: { en: 'Viewed', ar: 'شاهدها' },
  tapped: { en: 'Tapped the button', ar: 'نقروا على الزر' },
  totalTapsLabel: { en: 'Total taps', ar: 'إجمالي النقرات' },
  ofReach: { en: '{pct} of reach', ar: '{pct} من الوصول' },
  ofViews: { en: '{pct} of viewers', ar: '{pct} من المشاهدين' },
  funnel: { en: 'From reach to action', ar: 'من الوصول إلى التفاعل' },
  overTime: { en: 'Views and taps by day', ar: 'المشاهدات والنقرات يوميًا' },
  byAudience: { en: 'By audience', ar: 'حسب الجمهور' },
  byCountry: { en: 'By country', ar: 'حسب الدولة' },
  parents: { en: 'Parents', ar: 'أولياء الأمور' },
  teachers: { en: 'Teachers', ar: 'المعلمون' },
  notSet: { en: 'Not set', ar: 'غير محددة' },
  people: { en: 'People', ar: 'الأشخاص' },
  viewedAt: { en: 'Viewed', ar: 'وقت المشاهدة' },
  noViewersYet: { en: 'Nobody has viewed it yet.', ar: 'لم يشاهدها أحد بعد.' },
  firstView: { en: 'First view', ar: 'أول مشاهدة' },
  lastView: { en: 'Latest view', ar: 'آخر مشاهدة' },
  details: { en: 'Details', ar: 'التفاصيل' },
  button: { en: 'Button', ar: 'الزر' },
  noButton: { en: 'No button', ar: 'بدون زر' },
  createdBy: { en: 'Created by', ar: 'أنشأها' },
  publishedOn: { en: 'Published', ar: 'تاريخ النشر' },
  neverExpires: { en: 'Stays up until deleted', ar: 'تبقى حتى تُحذف' },
  delete: { en: 'Delete story', ar: 'حذف الحالة' },
  deleteTitle: { en: 'Delete this story?', ar: 'حذف هذه الحالة؟' },
  deleteBody: {
    en: 'It disappears for everyone at once. Its numbers stay here.',
    ar: 'ستختفي عن الجميع فورًا، وتبقى أرقامها هنا.',
  },
  deleteReason: { en: 'Reason (kept in the audit log)', ar: 'السبب (يُحفظ في سجل التدقيق)' },
  dayAxis: { en: 'Day', ar: 'اليوم' },
  pct: { en: '{n}%', ar: '{n}٪' },

  // audience data
  audienceDataIntro: {
    en: 'Country and subscription plan decide who a targeted story reaches. Jawwid Core will fill these in automatically; until then, set them here.',
    ar: 'الدولة وباقة الاشتراك تحددان من تصل إليه الحالة الموجّهة. سيملؤها نظام جوّد الأساسي تلقائيًا، وحتى ذلك الحين يمكنك تعيينها هنا.',
  },
  family: { en: 'Family', ar: 'العائلة' },
  childCount: { en: 'Children', ar: 'الأبناء' },
  onlyMissing: { en: 'Only missing data', ar: 'البيانات الناقصة فقط' },
  searchFamilies: { en: 'Search families', ar: 'ابحث عن عائلة' },
  saved: { en: 'Saved', ar: 'تم الحفظ' },
  fromCore: { en: 'From Jawwid Core', ar: 'من نظام جوّد' },
  noFamilies: { en: 'No families match.', ar: 'لا توجد عائلات مطابقة.' },
  truncatedFamilies: { en: 'Showing the first 500. Search to narrow.', ar: 'تُعرض أول 500 فقط. استخدم البحث للتضييق.' },
  chooseCountry: { en: 'Choose a country', ar: 'اختر دولة' },
  choosePlan: { en: 'Choose a plan', ar: 'اختر باقة' },
} satisfies Record<string, Bilingual>

export const KIND_LABEL: Record<StoryKind, Bilingual> = {
  text: { en: 'Text', ar: 'نص' },
  image: { en: 'Photo', ar: 'صورة' },
  video: { en: 'Video', ar: 'فيديو' },
  voice: { en: 'Voice', ar: 'صوت' },
}

/** Since 2026-10-17 a published story is simply live until deleted. */
export const STATE_LABEL: Record<StoryState, Bilingual> = {
  published: { en: 'Live', ar: 'منشورة' },
  draft: { en: 'Draft', ar: 'مسودة' },
  expired: { en: 'Ended', ar: 'منتهية' },
  deleted: { en: 'Deleted', ar: 'محذوفة' },
}

export const CTA_LABEL: Record<CtaKind, Bilingual> = {
  whatsapp: { en: 'WhatsApp', ar: 'واتساب' },
  message_publisher: { en: 'Message me', ar: 'راسلني' },
  link: { en: 'Link', ar: 'رابط' },
}

/** What the phone shows on the button when the publisher typed nothing. */
export const CTA_DEFAULT_TEXT: Record<CtaKind, Bilingual> = {
  whatsapp: { en: 'Chat on WhatsApp', ar: 'تواصل عبر واتساب' },
  message_publisher: { en: 'Send a message', ar: 'أرسل رسالة' },
  link: { en: 'Learn more', ar: 'اعرف المزيد' },
}

export const PLAN_LABEL: Record<number, Bilingual> = {
  1: { en: '1 month', ar: 'شهر' },
  3: { en: '3 months', ar: '3 أشهر' },
  6: { en: '6 months', ar: '6 أشهر' },
  12: { en: '1 year', ar: 'سنة' },
}

export const CHILDREN_LABEL: Record<number, Bilingual> = {
  1: { en: '1 child', ar: 'ابن واحد' },
  2: { en: '2 children', ar: 'ابنان' },
  3: { en: '3 children', ar: '3 أبناء' },
  4: { en: '4 or more', ar: '4 أو أكثر' },
}

export const BACKGROUND_LABEL: Record<string, Bilingual> = {
  teal: { en: 'Teal', ar: 'أزرق مخضر' },
  gold: { en: 'Gold', ar: 'ذهبي' },
  plum: { en: 'Plum', ar: 'برقوقي' },
  ink: { en: 'Ink', ar: 'حبري' },
  rose: { en: 'Rose', ar: 'وردي' },
  sky: { en: 'Sky', ar: 'سماوي' },
  forest: { en: 'Forest', ar: 'أخضر' },
  sunset: { en: 'Sunset', ar: 'غروب' },
}

/**
 * Countries offered first in the country picker: the academy's markets. Any
 * other ISO code can still be added; names come from the browser (Intl), so
 * there is no country table to maintain.
 */
export const SUGGESTED_COUNTRIES = [
  'AE', 'SA', 'KW', 'QA', 'BH', 'OM', 'EG', 'JO', 'LB', 'IQ', 'MA', 'DZ', 'TN', 'LY', 'SD', 'YE', 'PS', 'SY',
  'TR', 'GB', 'US', 'CA', 'DE', 'FR', 'NL', 'SE', 'AU', 'MY', 'ID', 'PK', 'IN',
] as const

/** Every ISO 3166-1 alpha-2 code the browser can name, for "add a country". */
export function allCountryCodes(): string[] {
  const A = 65
  const out: string[] = []
  for (let i = 0; i < 26; i += 1) {
    for (let j = 0; j < 26; j += 1) out.push(String.fromCharCode(A + i, A + j))
  }
  return out
}

export function useCountryName() {
  const { locale } = useI18n()
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale === 'ar' ? 'ar' : 'en'], { type: 'region', fallback: 'none' })
    } catch {
      return null
    }
  }, [locale])
  return useCallback(
    (code: string) => {
      try {
        return names?.of(code) ?? code
      } catch {
        return code
      }
    },
    [names],
  )
}

/** A flag from its ISO code (regional indicator symbols). Decorative. */
export function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Counts in both languages, with Arabic's six plural forms. */
export const COUNT = {
  people: PLURAL_PEOPLE(),
  parents: {
    en: { one: '{n} parent', other: '{n} parents' },
    ar: { one: 'ولي أمر واحد', two: 'وليّا أمر', few: '{n} أولياء أمور', many: '{n} وليّ أمر', other: '{n} وليّ أمر' },
  },
  teachers: {
    en: { one: '{n} teacher', other: '{n} teachers' },
    ar: { zero: 'لا معلمين', one: 'معلم واحد', two: 'معلمان', few: '{n} معلمين', many: '{n} معلمًا', other: '{n} معلم' },
  },
  taps: {
    en: { one: '{n} tap', other: '{n} taps' },
    ar: { zero: 'لا نقرات', one: 'نقرة واحدة', two: 'نقرتان', few: '{n} نقرات', many: '{n} نقرة', other: '{n} نقرة' },
  },
  families: {
    en: { one: '{n} family', other: '{n} families' },
    ar: { one: 'عائلة واحدة', two: 'عائلتان', few: '{n} عائلات', many: '{n} عائلة', other: '{n} عائلة' },
  },
} satisfies Record<string, Plural>

function PLURAL_PEOPLE(): Plural {
  return {
    en: { one: '{n} person', other: '{n} people' },
    ar: { zero: 'لا أحد', one: 'شخص واحد', two: 'شخصان', few: '{n} أشخاص', many: '{n} شخصًا', other: '{n} شخص' },
  }
}
