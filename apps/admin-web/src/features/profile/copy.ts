import { useCallback } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { CompletenessField, StaffWorkload } from './api'

/**
 * Staff-profile copy, Arabic and English side by side -- the same {en, ar}
 * pattern the Admin Portal sections use (features/admin), so a translator sees
 * both languages in one place and a missing one is a type error.
 *
 * Wording rule: a label never promises more than the data. "Teachers of my
 * families' students" is what the number counts; "Supervised teachers" would
 * describe a relationship that does not exist in the system.
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
  myProfile: { en: 'My profile', ar: 'ملفي الشخصي' },
  profileOf: { en: 'Staff profile', ar: 'الملف الوظيفي' },
  back: { en: 'Back to my profile', ar: 'العودة إلى ملفي' },
  notFound: { en: 'This profile does not exist or is not one you can view.', ar: 'هذا الملف غير موجود أو ليس من صلاحيتك عرضه.' },

  // Personal
  personal: { en: 'Personal profile', ar: 'الملف الشخصي' },
  personalHint: { en: 'Your own description of your work. It never changes what you can access.', ar: 'وصفك لعملك بكلماتك. لا يغيّر أبدًا ما يمكنك الوصول إليه.' },
  jobTitle: { en: 'Job title', ar: 'المسمى الوظيفي' },
  jobTitleHint: { en: 'How you describe your job. A title is not a role or a permission.', ar: 'كيف تصف وظيفتك. المسمى ليس دورًا ولا صلاحية.' },
  about: { en: 'About me', ar: 'نبذة عني' },
  aboutHint: {
    en: 'Your background, what you work on, your expertise, your experience at the academy, and relevant qualifications. Plain text.',
    ar: 'خلفيتك المهنية، وما تعمل عليه، وخبراتك، وتجربتك في الأكاديمية، والمؤهلات ذات الصلة. نص عادي.',
  },
  displayName: { en: 'Full name', ar: 'الاسم الكامل' },
  displayNameHint: { en: 'Changes how this person is shown. Their sign-in stays the same.', ar: 'يغيّر طريقة عرض هذا الشخص فقط. تبقى بيانات الدخول كما هي.' },
  notSet: { en: 'Not added yet', ar: 'لم تُضف بعد' },
  aboutEmpty: { en: 'No introduction yet.', ar: 'لا توجد نبذة بعد.' },
  edit: { en: 'Edit', ar: 'تعديل' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  saved: { en: 'Saved.', ar: 'تم الحفظ.' },
  charCount: { en: '{n} of {max} characters', ar: '{n} من {max} حرفًا' },
  tooLong: { en: 'Too long — at most {max} characters.', ar: 'النص طويل جدًا — {max} حرفًا كحد أقصى.' },
  required: { en: 'This field is required.', ar: 'هذا الحقل مطلوب.' },
  conflict: {
    en: 'Someone else saved this profile after you opened it. Nothing was overwritten and your text is still here.',
    ar: 'قام شخص آخر بحفظ هذا الملف بعد أن فتحته. لم يُستبدل شيء وما زال نصّك هنا.',
  },
  reload: { en: 'Load the latest version', ar: 'تحميل أحدث نسخة' },
  latestLoaded: {
    en: 'The latest saved version is shown below. Your edits are still in the form; saving now replaces the saved version with them.',
    ar: 'أحدث نسخة محفوظة معروضة أدناه. تعديلاتك ما زالت في النموذج؛ الحفظ الآن يستبدل النسخة المحفوظة بها.',
  },
  editReason: { en: 'Reason for this change (optional, recorded in the audit log)', ar: 'سبب هذا التعديل (اختياري، يُسجَّل في سجل التدقيق)' },
  editingFor: { en: 'You are editing {name}’s profile. This change is recorded with your name.', ar: 'أنت تعدّل ملف {name}. يُسجَّل هذا التعديل باسمك.' },
  lastUpdated: { en: 'Last updated {when} by {who}', ar: 'آخر تحديث {when} بواسطة {who}' },

  // Photo
  photo: { en: 'Profile photo', ar: 'الصورة الشخصية' },
  photoChoose: { en: 'Choose a photo', ar: 'اختر صورة' },
  photoReplace: { en: 'Replace photo', ar: 'استبدال الصورة' },
  photoRemove: { en: 'Remove photo', ar: 'إزالة الصورة' },
  photoHint: { en: 'JPEG, PNG or WebP, at least 64×64 px. It is cropped to a square.', ar: 'JPEG أو PNG أو WebP، بحجم 64×64 بكسل على الأقل. تُقص الصورة لتصبح مربعة.' },
  photoPreview: { en: 'Preview of the new photo', ar: 'معاينة الصورة الجديدة' },
  photoUse: { en: 'Use this photo', ar: 'استخدام هذه الصورة' },
  photoUploading: { en: 'Uploading…', ar: 'جارٍ الرفع…' },
  photoSaved: { en: 'Photo updated.', ar: 'تم تحديث الصورة.' },
  photoRemoved: { en: 'Photo removed.', ar: 'تمت إزالة الصورة.' },
  photoBadType: { en: 'Choose a JPEG, PNG or WebP image.', ar: 'اختر صورة بصيغة JPEG أو PNG أو WebP.' },
  photoTooBig: { en: 'That file is larger than 10 MB.', ar: 'حجم الملف أكبر من 10 ميجابايت.' },
  photoTooSmall: { en: 'That image is smaller than 64×64 pixels.', ar: 'أبعاد الصورة أقل من 64×64 بكسل.' },
  photoUnreadable: { en: 'That file could not be read as an image.', ar: 'تعذّرت قراءة الملف كصورة.' },
  photoUploadFailed: { en: 'The upload did not complete. Your current photo is unchanged — try again.', ar: 'لم يكتمل الرفع. صورتك الحالية لم تتغير — حاول مرة أخرى.' },
  avatarOf: { en: 'Photo of {name}', ar: 'صورة {name}' },

  // Account facts
  accountFacts: { en: 'Account', ar: 'الحساب' },
  role: { en: 'Role', ar: 'الدور' },
  status: { en: 'Account status', ar: 'حالة الحساب' },
  joined: { en: 'Joined', ar: 'تاريخ الانضمام' },
  lastActivity: { en: 'Last activity', ar: 'آخر نشاط' },
  signIn: { en: 'Signs in as', ar: 'يسجّل الدخول باسم' },
  noLogin: { en: 'No sign-in yet', ar: 'لا يوجد حساب دخول بعد' },
  never: { en: 'Not recorded', ar: 'غير مسجّل' },
  reportsTo: { en: 'Reports to', ar: 'المدير المباشر' },
  noManager: { en: 'No reporting manager assigned', ar: 'لم يُحدَّد مدير مباشر' },
  officialFieldsNote: {
    en: 'Role, permissions, account status and reporting line are official fields. They are not editable from a profile; ask the super admin.',
    ar: 'الدور والصلاحيات وحالة الحساب والمدير المباشر حقول رسمية لا تُعدَّل من الملف الشخصي؛ تواصل مع المدير العام.',
  },
  contactNote: {
    en: 'Jawwid Chat stores no phone number or email for staff beyond the sign-in identifier.',
    ar: 'لا يخزّن جوّد شات رقم هاتف أو بريدًا إلكترونيًا للموظفين سوى معرّف تسجيل الدخول.',
  },
  inactive: { en: 'Inactive', ar: 'غير نشط' },
  active: { en: 'Active', ar: 'نشط' },

  // Responsibilities
  responsibilities: { en: 'Responsibilities & supervision', ar: 'المسؤوليات والإشراف' },
  responsibilitiesHint: {
    en: 'Official labels describe what someone works on. They do not grant access to any module.',
    ar: 'التصنيفات الرسمية تصف مجال عمل الشخص، ولا تمنح صلاحية الوصول إلى أي قسم.',
  },
  fromRecords: { en: 'From system records', ar: 'من سجلات النظام' },
  officialLabels: { en: 'Assigned responsibilities', ar: 'المسؤوليات المكلَّف بها' },
  noResponsibilities: { en: 'No responsibilities assigned yet.', ar: 'لم تُسند مسؤوليات بعد.' },
  assign: { en: 'Assign responsibility', ar: 'إسناد مسؤولية' },
  category: { en: 'Area', ar: 'المجال' },
  scopeNote: { en: 'Scope (optional)', ar: 'النطاق (اختياري)' },
  scopeNoteHint: { en: 'Which part of the area, e.g. “Families in the evening shift”.', ar: 'أي جزء من المجال، مثل «أسر الفترة المسائية».' },
  scopeRequired: { en: '“Other” needs a short description of the scope.', ar: 'خيار «أخرى» يحتاج إلى وصف موجز للنطاق.' },
  assignedOn: { en: 'Assigned {when}', ar: 'أُسندت {when}' },
  assignedBy: { en: 'by {who}', ar: 'بواسطة {who}' },
  end: { en: 'End', ar: 'إنهاء' },
  endTitle: { en: 'End this responsibility', ar: 'إنهاء هذه المسؤولية' },
  endReason: { en: 'Reason (required, recorded in the audit log)', ar: 'السبب (مطلوب، يُسجَّل في سجل التدقيق)' },
  ended: { en: 'Ended {when}', ar: 'انتهت {when}' },
  history: { en: 'Ended assignments', ar: 'مسؤوليات منتهية' },
  derived_family_supervision: { en: 'Supervises {n} assigned families', ar: 'يشرف على {n} من الأسر المسندة' },
  derived_team_management: { en: 'Manages {n} direct reports', ar: 'يدير {n} من المرؤوسين المباشرين' },
  derived_coverage_role: { en: 'Coverage role: acts for other supervisors during explicit cover', ar: 'دور التغطية: ينوب عن المشرفين الآخرين أثناء التغطية المحددة' },

  // Reporting line
  changeManager: { en: 'Change reporting manager', ar: 'تغيير المدير المباشر' },
  manager: { en: 'Reporting manager', ar: 'المدير المباشر' },
  noneOption: { en: '— No reporting manager —', ar: '— بدون مدير مباشر —' },
  reasonRequired: { en: 'Reason (required, recorded in the audit log)', ar: 'السبب (مطلوب، يُسجَّل في سجل التدقيق)' },
  managerHint: { en: 'Staff report to a manager or the super admin; managers report to the super admin.', ar: 'يتبع الموظفون مديرًا أو المدير العام؛ ويتبع المديرون المدير العام.' },

  // Workload
  workload: { en: 'My responsibilities at a glance', ar: 'مسؤولياتي في لمحة' },
  workloadOf: { en: 'Responsibilities at a glance', ar: 'المسؤوليات في لمحة' },
  workloadHint: {
    en: 'Counted live from the families currently assigned to this person (churned families excluded). No names are shown.',
    ar: 'تُحسب مباشرةً من الأسر المسندة حاليًا لهذا الشخص (باستثناء الأسر المنتهي اشتراكها). لا يُعرض اسم أيّ أسرة.',
  },
  asOf: { en: 'As of {when}', ar: 'حتى {when}' },
  notTracked: { en: 'Not tracked in Jawwid Chat', ar: 'غير متتبَّع في جوّد شات' },
  notTrackedBody: {
    en: 'Tasks, cases, complaints, follow-ups, attendance and performance scores have no records in this system, so no number is shown for them.',
    ar: 'لا توجد سجلات في هذا النظام للمهام أو الحالات أو الشكاوى أو المتابعات أو الحضور أو مؤشرات الأداء، لذلك لا يُعرض لها أي رقم.',
  },

  // Team
  myTeam: { en: 'My team', ar: 'فريقي' },
  myTeamHint: { en: 'Staff whose reporting line names you. You can open their profiles and, where marked, edit their professional details and responsibilities.', ar: 'الموظفون الذين يتبعونك مباشرة. يمكنك فتح ملفاتهم، وتعديل بياناتهم المهنية ومسؤولياتهم حيث يُشار إلى ذلك.' },
  directReports: { en: 'Direct reports', ar: 'المرؤوسون المباشرون' },
  noTeam: { en: 'Nobody reports to you yet. Reporting lines are set by the super admin.', ar: 'لا يتبعك أحد بعد. يحدّد المدير العام خطوط التبعية.' },
  search: { en: 'Search by name or title', ar: 'ابحث بالاسم أو المسمى' },
  filterAll: { en: 'All', ar: 'الكل' },
  filterActive: { en: 'Active', ar: 'النشطون' },
  filterInactive: { en: 'Inactive', ar: 'غير النشطين' },
  filterIncomplete: { en: 'Incomplete profile', ar: 'ملف غير مكتمل' },
  filterRole: { en: 'Role', ar: 'الدور' },
  filterManager: { en: 'Manager', ar: 'المدير' },
  filterCategory: { en: 'Responsibility', ar: 'المسؤولية' },
  anyOption: { en: 'Any', ar: 'الكل' },
  unassignedOption: { en: 'No manager', ar: 'بدون مدير' },
  noMatches: { en: 'No one matches these filters.', ar: 'لا أحد يطابق هذه المرشحات.' },
  colPerson: { en: 'Person', ar: 'الشخص' },
  colRole: { en: 'Role', ar: 'الدور' },
  colResponsibilities: { en: 'Responsibilities', ar: 'المسؤوليات' },
  colFamilies: { en: 'Families', ar: 'الأسر' },
  colStudents: { en: 'Students', ar: 'الطلاب' },
  colTeachers: { en: 'Teachers', ar: 'المعلمون' },
  colOpen: { en: 'Open', ar: 'مفتوحة' },
  colAwaiting: { en: 'Awaiting reply', ar: 'بانتظار الرد' },
  colApprovals: { en: 'Approvals', ar: 'موافقات' },
  colActivity: { en: 'Last activity', ar: 'آخر نشاط' },
  colProfile: { en: 'Profile', ar: 'الملف' },
  colManager: { en: 'Reports to', ar: 'يتبع' },
  canEditBadge: { en: 'You can edit', ar: 'يمكنك التعديل' },
  viewOnlyBadge: { en: 'View only', ar: 'عرض فقط' },
  teamTotals: { en: 'Team totals', ar: 'إجماليات الفريق' },
  teamTotalsHint: {
    en: 'Families, students, contacts, conversations and approvals belong to exactly one supervisor, so these are exact sums. Teachers are counted once even when they teach several members’ students.',
    ar: 'الأسر والطلاب وجهات الاتصال والمحادثات والموافقات تتبع مشرفًا واحدًا فقط، لذا فهذه مجاميع دقيقة. يُحتسب المعلم مرة واحدة حتى لو درّس طلاب أكثر من عضو.',
  },
  completeOf: { en: '{done}/{total}', ar: '{done}/{total}' },

  // Organization
  organization: { en: 'Organization overview', ar: 'نظرة عامة على المؤسسة' },
  organizationHint: {
    en: 'Every number here is its own count from the database. Summed team figures are shown separately from unique totals and never mixed.',
    ar: 'كل رقم هنا عدٌّ مستقل من قاعدة البيانات. تُعرض مجاميع الفرق منفصلة عن الإجماليات الفريدة ولا تُخلط بها.',
  },
  openOrganization: { en: 'Open the organization overview', ar: 'فتح النظرة العامة على المؤسسة' },
  tabOverview: { en: 'Organization', ar: 'المؤسسة' },
  tabDirectory: { en: 'Team directory', ar: 'دليل الفريق' },
  tabCoverage: { en: 'Responsibilities & coverage', ar: 'المسؤوليات والتغطية' },
  tabWorkload: { en: 'Academy workload', ar: 'أعباء الأكاديمية' },
  tabHealth: { en: 'Profile & assignment health', ar: 'سلامة الملفات والتكليفات' },
  tabActivity: { en: 'Administrative activity', ar: 'النشاط الإداري' },
  managers: { en: 'Managers', ar: 'المديرون' },
  adminsSupervisors: { en: 'Admins & supervisors', ar: 'المشرفون والإداريون' },
  activeAccounts: { en: 'Active staff accounts', ar: 'حسابات الموظفين النشطة' },
  inactiveAccounts: { en: 'Inactive staff accounts', ar: 'حسابات الموظفين غير النشطة' },
  withoutLogin: { en: 'Active staff without a sign-in', ar: 'موظفون نشطون بلا حساب دخول' },
  byRole: { en: 'Staff by role', ar: 'الموظفون حسب الدور' },
  teams: { en: 'Teams', ar: 'الفرق' },
  members: { en: '{n} members', ar: '{n} من الأعضاء' },
  noTeams: { en: 'No managers yet.', ar: 'لا يوجد مديرون بعد.' },
  holders: { en: 'Held by', ar: 'المكلَّفون' },
  nobodyHolds: { en: 'Nobody holds this', ar: 'لا أحد مكلَّف بها' },
  uniqueTotals: { en: 'Unique academy totals', ar: 'الإجماليات الفريدة للأكاديمية' },
  sumOfTeams: { en: 'Summed across teams', ar: 'مجموع الفرق' },
  outsideTeams: { en: 'Families supervised by staff outside any team', ar: 'أسر يشرف عليها موظفون خارج أي فريق' },
  activeTeachers: { en: 'Active teachers', ar: 'المعلمون النشطون' },
  teachersWithStudents: { en: 'Teachers teaching current students', ar: 'معلمون يدرّسون طلابًا حاليين' },
  inactiveOwners: { en: 'Families still owned by inactive staff', ar: 'أسر ما زالت مسندة لموظفين غير نشطين' },
  noReportingLine: { en: 'Active staff without a reporting manager', ar: 'موظفون نشطون بلا مدير مباشر' },
  incomplete: { en: 'Incomplete profiles', ar: 'ملفات غير مكتملة' },
  staleLines: { en: 'Reporting lines that no longer fit the hierarchy', ar: 'خطوط تبعية لم تعد تتوافق مع الهيكل' },
  allClear: { en: 'Nothing to fix.', ar: 'لا شيء يحتاج إلى إصلاح.' },
  truncated: { en: 'Showing the first 500 staff accounts.', ar: 'يُعرض أول 500 حساب موظف.' },
  quickActions: { en: 'Quick actions', ar: 'إجراءات سريعة' },
  qaUsers: { en: 'All accounts (read-only)', ar: 'جميع الحسابات (قراءة فقط)' },
  qaDirectory: { en: 'Edit staff profiles and responsibilities', ar: 'تعديل ملفات الموظفين ومسؤولياتهم' },
  qaHealth: { en: 'Fix unassigned and incomplete profiles', ar: 'معالجة الملفات غير المسندة وغير المكتملة' },
  qaPermissions: {
    en: 'Roles and permissions: no management screen exists yet. The super admin role is granted only by the bootstrap procedure.',
    ar: 'الأدوار والصلاحيات: لا توجد شاشة إدارة بعد. يُمنح دور المدير العام فقط عبر إجراء التهيئة.',
  },

  // Activity
  activity: { en: 'Profile activity', ar: 'نشاط الملف' },
  activityHint: { en: 'Official audit records. They cannot be edited.', ar: 'سجلات تدقيق رسمية لا يمكن تعديلها.' },
  noActivity: { en: 'No recorded profile changes.', ar: 'لا توجد تغييرات مسجَّلة على الملف.' },
  by: { en: 'by {who}', ar: 'بواسطة {who}' },
  system: { en: 'unknown actor', ar: 'جهة غير معروفة' },
  reason: { en: 'Reason', ar: 'السبب' },
  fields: { en: 'Changed', ar: 'التغييرات' },

  // Completeness
  completeness: { en: 'Profile completeness', ar: 'اكتمال الملف' },
  completeCount: { en: '{done} of {total} complete', ar: 'مكتمل {done} من {total}' },
} satisfies Record<string, Pair>

export const ROLE_LABEL: Record<string, Pair> = {
  super_admin: { en: 'Super admin', ar: 'المدير العام' },
  manager: { en: 'Manager', ar: 'مدير' },
  admin: { en: 'Supervisor', ar: 'مشرف' },
  coverage: { en: 'Coverage supervisor', ar: 'مشرف تغطية' },
  finance: { en: 'Finance', ar: 'المالية' },
  technical: { en: 'Technical', ar: 'الدعم الفني' },
  academic: { en: 'Academic', ar: 'الشؤون الأكاديمية' },
}

export const ACCOUNT_STATUS_LABEL: Record<string, Pair> = {
  active: { en: 'Active', ar: 'نشط' },
  provisioned: { en: 'Provisioned', ar: 'مُجهَّز' },
  suspended: { en: 'Suspended', ar: 'موقوف' },
  deactivated: { en: 'Deactivated', ar: 'معطَّل' },
}

export const CATEGORY_LABEL: Record<string, Pair> = {
  family_follow_up: { en: 'Family / parent follow-up', ar: 'متابعة الأسر وأولياء الأمور' },
  student_follow_up: { en: 'Student follow-up', ar: 'متابعة الطلاب' },
  teacher_supervision: { en: 'Teacher supervision', ar: 'الإشراف على المعلمين' },
  teaching_quality: { en: 'Teaching quality & evaluation', ar: 'جودة التعليم والتقييم' },
  academic_progress: { en: 'Academic progress', ar: 'التقدم الأكاديمي' },
  attendance_monitoring: { en: 'Attendance & lesson monitoring', ar: 'متابعة الحضور والحصص' },
  operations_scheduling: { en: 'Operations & scheduling', ar: 'العمليات والجدولة' },
  message_moderation: { en: 'Group message moderation', ar: 'مراجعة رسائل المجموعات' },
  content_materials: { en: 'Content & educational materials', ar: 'المحتوى والمواد التعليمية' },
  customer_support: { en: 'Customer support', ar: 'دعم العملاء' },
  complaints_escalations: { en: 'Complaints & escalations', ar: 'الشكاوى والتصعيد' },
  sales_admissions: { en: 'Sales & admissions', ar: 'المبيعات والقبول' },
  team_management: { en: 'Team management', ar: 'إدارة الفريق' },
  other: { en: 'Other', ar: 'أخرى' },
}

/** Each workload metric with exactly what it counts. */
export const METRICS: ReadonlyArray<{ key: keyof StaffWorkload; label: Pair; definition: Pair }> = [
  {
    key: 'assignedFamilies',
    label: { en: 'Assigned families', ar: 'الأسر المسندة' },
    definition: { en: 'Families whose current supervisor is this person.', ar: 'الأسر التي يكون مشرفها الحالي هذا الشخص.' },
  },
  {
    key: 'studentsInAssignedFamilies',
    label: { en: 'Students', ar: 'الطلاب' },
    definition: { en: 'Students in those families.', ar: 'الطلاب في تلك الأسر.' },
  },
  {
    key: 'parentContacts',
    label: { en: 'Parent contacts', ar: 'جهات اتصال الأسر' },
    definition: { en: 'Active family contacts in those families.', ar: 'جهات الاتصال النشطة في تلك الأسر.' },
  },
  {
    key: 'teachersOfAssignedStudents',
    label: { en: 'Teachers of these students', ar: 'معلمو هؤلاء الطلاب' },
    definition: { en: 'Active teachers teaching those students. Not a supervision relationship.', ar: 'المعلمون النشطون الذين يدرّسون هؤلاء الطلاب. ليست علاقة إشراف.' },
  },
  {
    key: 'openConversations',
    label: { en: 'Open conversations', ar: 'المحادثات المفتوحة' },
    definition: { en: 'Conversations of those families that are not resolved or archived.', ar: 'محادثات تلك الأسر غير المغلقة وغير المؤرشفة.' },
  },
  {
    key: 'awaitingReply',
    label: { en: 'Awaiting our reply', ar: 'بانتظار ردّنا' },
    definition: { en: 'Open conversations whose latest family message is newer than the latest staff reply.', ar: 'محادثات مفتوحة آخر رسالة فيها من الأسرة أحدث من آخر رد من الفريق.' },
  },
  {
    key: 'pendingApprovals',
    label: { en: 'Messages awaiting approval', ar: 'رسائل بانتظار الموافقة' },
    definition: { en: 'Held group messages in those conversations not yet approved or rejected.', ar: 'رسائل مجموعات محتجزة في تلك المحادثات لم يُبتّ فيها بعد.' },
  },
  {
    key: 'directReports',
    label: { en: 'Direct reports', ar: 'المرؤوسون المباشرون' },
    definition: { en: 'Active staff whose reporting line names this person.', ar: 'الموظفون النشطون الذين يتبعون هذا الشخص مباشرة.' },
  },
]

export const MISSING_LABEL: Record<CompletenessField, Pair> = {
  photo: { en: 'Photo', ar: 'الصورة' },
  job_title: { en: 'Job title', ar: 'المسمى الوظيفي' },
  about: { en: 'About me', ar: 'النبذة' },
  reporting_line: { en: 'Reporting manager', ar: 'المدير المباشر' },
  responsibility: { en: 'Responsibility', ar: 'المسؤولية' },
}

export const ACTION_LABEL: Record<string, Pair> = {
  'staff_profile.updated': { en: 'Profile details changed', ar: 'تعديل بيانات الملف' },
  'staff_profile.photo_set': { en: 'Photo set', ar: 'تعيين الصورة' },
  'staff_profile.photo_removed': { en: 'Photo removed', ar: 'إزالة الصورة' },
  'staff_responsibility.assigned': { en: 'Responsibility assigned', ar: 'إسناد مسؤولية' },
  'staff_responsibility.ended': { en: 'Responsibility ended', ar: 'إنهاء مسؤولية' },
  'staff_reporting_line.set': { en: 'Reporting manager set', ar: 'تحديد المدير المباشر' },
  'staff_reporting_line.cleared': { en: 'Reporting manager removed', ar: 'إزالة المدير المباشر' },
}

export const FIELD_LABEL: Record<string, Pair> = {
  jobTitle: { en: 'job title', ar: 'المسمى الوظيفي' },
  about: { en: 'about me', ar: 'النبذة' },
  displayName: { en: 'name', ar: 'الاسم' },
  hasPhoto: { en: 'photo', ar: 'الصورة' },
  category: { en: 'area', ar: 'المجال' },
  scopeNote: { en: 'scope', ar: 'النطاق' },
  managerStaffId: { en: 'reporting manager', ar: 'المدير المباشر' },
}

/** A label for a value the server sent; an unknown value shows as itself, never as blank. */
export function labelFor(table: Record<string, Pair>, value: string): Pair {
  return table[value] ?? { en: value, ar: value }
}
