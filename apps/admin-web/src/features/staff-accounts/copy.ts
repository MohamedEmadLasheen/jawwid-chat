import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-40 PR-5 copy, Arabic first, then English. Wording rules: nothing here
 * suggests the administrator sees or chooses anyone's password (they hand over
 * a one-time code, or it is e-mailed), and a role is "a template" only while
 * the server says it is one.
 */
export const SA = {
  tabsLabel: { ar: 'صفحات الحسابات', en: 'Account pages' },
  tabAccounts: { ar: 'الحسابات', en: 'Accounts' },
  tabStaff: { ar: 'حسابات الموظفين', en: 'Staff accounts' },
  tabRoles: { ar: 'الأدوار', en: 'Roles' },

  title: { ar: 'حسابات الموظفين', en: 'Staff accounts' },
  subtitle: {
    ar: 'حسابات القسم وأدوارها. يتحقق الخادم من كل إجراء، ويتطلب كل إجراء سببًا ويُسجَّل.',
    en: 'Department accounts and their roles. The server checks every action; each needs a reason and is recorded.',
  },
  newAccount: { ar: 'حساب جديد', en: 'New account' },
  empty: { ar: 'لا توجد حسابات موظفين لعرضها.', en: 'No staff accounts to show.' },
  name: { ar: 'الاسم', en: 'Name' },
  department: { ar: 'القسم', en: 'Department' },
  tier: { ar: 'المستوى', en: 'Tier' },
  roles: { ar: 'الأدوار', en: 'Roles' },
  status: { ar: 'الحالة', en: 'Status' },
  lastLogin: { ar: 'آخر تسجيل دخول', en: 'Last sign-in' },
  never: { ar: 'لم يسجّل الدخول', en: 'Never' },
  setupPending: { ar: 'بانتظار الإعداد', en: 'Setup pending' },
  noDepartment: { ar: 'بلا قسم', en: 'No department' },
  noRoles: { ar: 'بلا أدوار', en: 'No roles' },
  show: { ar: 'عرض', en: 'Show' },
  all: { ar: 'الكل', en: 'All' },
  anyRole: { ar: 'كل الأدوار', en: 'Any role' },
  anyDepartment: { ar: 'كل الأقسام', en: 'Any department' },
  filterRole: { ar: 'تصفية حسب الدور', en: 'Filter by role' },
  filterDepartment: { ar: 'تصفية حسب القسم', en: 'Filter by department' },

  newTitle: { ar: 'حساب موظف جديد', en: 'New staff account' },
  stepIdentity: { ar: 'الخطوة 1 من 3: الهوية', en: 'Step 1 of 3: identity' },
  stepPlacement: { ar: 'الخطوة 2 من 3: المكان', en: 'Step 2 of 3: placement' },
  stepRoles: { ar: 'الخطوة 3 من 3: الأدوار', en: 'Step 3 of 3: roles' },
  fullName: { ar: 'الاسم الكامل', en: 'Full name' },
  signInEmail: { ar: 'بريد الدخول', en: 'Sign-in e-mail' },
  signInHint: {
    ar: 'يسجّل الموظف الدخول بهذا البريد، ويصله رمز الدخول الأول عليه.',
    en: 'They sign in with this e-mail, and the first sign-in code is sent to it.',
  },
  required: { ar: 'مطلوب.', en: 'Required.' },
  fixedPlacement: {
    ar: 'تنشئ حسابات متخصصين في القسم الذي تديره فقط.',
    en: 'You create specialist accounts in the department you run only.',
  },
  noManagedDepartment: {
    ar: 'لا تدير قسمًا، لذلك لا يمكنك إنشاء حساب.',
    en: 'You do not run a department, so you cannot create an account.',
  },
  departmentOnlySpecialist: {
    ar: 'يُحدَّد قسم المشرف أو المدير في الهيكل التنظيمي.',
    en: "A supervisor's or manager's department is set in the organization structure.",
  },
  rolesHint: {
    ar: 'تظهر فقط الأدوار التي يمكنك منحها لهذا المستوى.',
    en: 'Only the roles you may grant at this tier are offered.',
  },
  noGrantableRoles: { ar: 'لا توجد أدوار يمكنك منحها.', en: 'There are no roles you can grant.' },
  previewTitle: { ar: 'سيفتح هذا الحساب', en: 'This account will open' },
  previewNothing: {
    ar: 'لا يفتح هذا الحساب شيئًا بعد: يمكن منحه أدوارًا لاحقًا.',
    en: 'This account opens nothing yet: roles can be granted later.',
  },
  reason: { ar: 'السبب', en: 'Reason' },
  next: { ar: 'التالي', en: 'Next' },
  back: { ar: 'السابق', en: 'Back' },
  create: { ar: 'إنشاء الحساب', en: 'Create account' },
  creating: { ar: 'جارٍ الإنشاء…', en: 'Creating…' },

  firstLoginTitle: { ar: 'رمز الدخول الأول', en: 'First sign-in code' },
  firstLoginHint: {
    ar: 'سلّم هذا الرمز للموظف. يعمل مرة واحدة لمدة 72 ساعة، ولن يُعرض مرة أخرى.',
    en: 'Give this code to the new colleague. It works once, for 72 hours, and is not shown again.',
  },
  signInLabel: { ar: 'اسم الدخول', en: 'Sign-in' },
  codeLabel: { ar: 'الرمز', en: 'Code' },
  validUntil: { ar: 'صالح حتى {when}', en: 'Valid until {when}' },
  emailedTo: { ar: 'وأُرسل أيضًا إلى {email}.', en: 'It was also e-mailed to {email}.' },
  emailedToSignIn: { ar: 'وأُرسل أيضًا إلى بريد الدخول.', en: 'It was also e-mailed to the sign-in address.' },
  notEmailed: { ar: 'لم يُرسل بالبريد: سلّمه بنفسك.', en: 'It was not e-mailed: hand it over yourself.' },
  codeEmailed: {
    ar: 'أُرسل رمز جديد بالبريد إلى بريد الدخول الخاص بالحساب.',
    en: "A new code was sent by e-mail to the account's sign-in address.",
  },
  codeNotEmailed: {
    ar: 'تعذّر إرسال الرمز بالبريد. اطلب من مدير النظام إصدار رمز.',
    en: 'The code could not be e-mailed. Ask the super admin to issue one.',
  },
  done: { ar: 'تم', en: 'Done' },

  detailRoles: { ar: 'الأدوار', en: 'Roles' },
  detailActions: { ar: 'الحساب', en: 'Account' },
  addRole: { ar: 'إضافة دور', en: 'Add a role' },
  chooseRole: { ar: 'اختر دورًا', en: 'Choose a role' },
  grant: { ar: 'منح', en: 'Grant' },
  grantTitle: { ar: 'منح {role} إلى {name}', en: 'Grant {role} to {name}' },
  grantExplain: {
    ar: 'سيفتح {name} ما يفتحه هذا الدور من طلبه التالي.',
    en: '{name} gets what this role opens from their next request.',
  },
  remove: { ar: 'إزالة', en: 'Remove' },
  removeRole: { ar: 'إزالة {role}', en: 'Remove {role}' },
  revokeTitle: { ar: 'إزالة {role} من {name}', en: 'Remove {role} from {name}' },
  revokeExplain: {
    ar: 'يفقد {name} ما كان هذا الدور وحده يفتحه.',
    en: '{name} loses what only this role opened.',
  },
  sendNewCode: { ar: 'إرسال رمز دخول أول جديد', en: 'Send a new first sign-in code' },
  setupTitle: { ar: 'رمز دخول أول جديد لـ {name}', en: 'New first sign-in code for {name}' },
  setupExplain: {
    ar: 'يتوقف الرمز السابق عن العمل. يصل الرمز الجديد إلى بريد الدخول.',
    en: 'The earlier code stops working. The new one goes to the sign-in e-mail.',
  },
  sendCode: { ar: 'إرسال الرمز', en: 'Send code' },
  noSignIn: { ar: 'لا يوجد حساب دخول لهذا الموظف.', en: 'This staff member has no sign-in.' },

  rolesTitle: { ar: 'الأدوار', en: 'Roles' },
  rolesSubtitle: {
    ar: 'مجموعات صلاحيات مسمّاة. يعرّفها مدير النظام وحده، ويمنحها المدير لمتخصصي قسمه.',
    en: 'Named bundles of permissions. Only the super admin defines them; a manager grants them to their specialists.',
  },
  newRole: { ar: 'دور جديد', en: 'New role' },
  noRolesYet: { ar: 'لا توجد أدوار بعد.', en: 'No roles yet.' },
  role: { ar: 'الدور', en: 'Role' },
  roleKey: { ar: 'المعرّف', en: 'Key' },
  maxTier: { ar: 'أعلى مستوى', en: 'Highest tier' },
  permissions: { ar: 'الصلاحيات', en: 'Permissions' },
  members: { ar: 'الأعضاء', en: 'Members' },
  actions: { ar: 'الإجراءات', en: 'Actions' },
  template: { ar: 'قالب', en: 'Template' },
  templateHint: {
    ar: 'أُنشئ من قالب، ويُعدَّل مثل أي دور.',
    en: 'Seeded from a template; it is edited like any role.',
  },
  archived: { ar: 'مؤرشف', en: 'Archived' },
  youCanGrant: { ar: 'يمكنك منحه', en: 'You can grant this' },
  edit: { ar: 'تعديل', en: 'Edit' },
  archive: { ar: 'أرشفة', en: 'Archive' },
  archiveTitle: { ar: 'أرشفة {role}', en: 'Archive {role}' },
  archiveExplain: {
    ar: 'لن يُمنح هذا الدور لأحد بعد الآن. تبقى المنح الحالية سارية حتى تُزال.',
    en: 'Nobody can be granted this role again. Existing grants keep working until they are removed.',
  },
  editTitle: { ar: 'تعديل {role}', en: 'Edit {role}' },
  roleKeyHint: {
    ar: 'أحرف إنجليزية صغيرة وأرقام وشرطة سفلية، ولا يتغيّر لاحقًا.',
    en: 'Lower-case letters, digits and underscores; it cannot change later.',
  },
  nameAr: { ar: 'الاسم (بالعربية)', en: 'Name (Arabic)' },
  nameEn: { ar: 'الاسم (بالإنجليزية)', en: 'Name (English)' },
  descriptionOptional: { ar: 'الوصف (اختياري)', en: 'Description (optional)' },
  checklist: { ar: 'ما يفتحه الدور', en: 'What the role opens' },
  checklistHint: {
    ar: 'مجمّعة حسب الصفحة. صلاحيات مدير النظام لا تدخل في أي دور ولا تظهر هنا.',
    en: "Grouped by page. The super admin's own powers never go in a role and are not listed.",
  },
  superAdminGrants: { ar: 'يمنحه مدير النظام فقط', en: 'Super admin grants only' },
  atLeastOne: { ar: 'اختر صلاحية واحدة على الأقل.', en: 'Choose at least one permission.' },
  save: { ar: 'حفظ الدور', en: 'Save role' },
  saving: { ar: 'جارٍ الحفظ…', en: 'Saving…' },
  conflictLead: {
    ar: 'منح بعض المديرين هذا الدور، ولا يمكنهم منح ما أضفته. أزل هذه المنح أولًا، ثم احفظ مرة أخرى:',
    en: 'Managers granted this role and may not grant what you added. Revoke these grants first, then save again:',
  },
  grantedBy: { ar: '{name}، منحه {by}', en: '{name}, granted by {by}' },
} satisfies Record<string, Pair>

export const TIER: Record<string, Pair> = {
  specialist: { ar: 'متخصص', en: 'Specialist' },
  admin: { ar: 'مشرف', en: 'Supervisor' },
  coverage: { ar: 'مشرف تغطية', en: 'Coverage supervisor' },
  supervisor: { ar: 'مشرف', en: 'Supervisor' },
  manager: { ar: 'مدير', en: 'Manager' },
  finance: { ar: 'المالية', en: 'Finance' },
  technical: { ar: 'الدعم الفني', en: 'Technical' },
  academic: { ar: 'الشؤون الأكاديمية', en: 'Academic' },
}

export const STATUS: Record<string, Pair> = {
  provisioned: { ar: 'غير مُعَدّ', en: 'Not set up' },
  active: { ar: 'نشط', en: 'Active' },
  suspended: { ar: 'موقوف', en: 'Inactive' },
  deactivated: { ar: 'معطّل نهائيًا', en: 'Deactivated' },
}

/** The risks the role editor and the preview flag in red (plan §8). */
export const RISK: Partial<Record<string, Pair>> = {
  pii: { ar: 'بيانات شخصية', en: 'Personal data' },
  finance: { ar: 'أموال', en: 'Money' },
  family_contact: { ar: 'تواصل مع الأسر', en: 'Family contact' },
}

/** The catalogue's pages (the key's prefix). An unknown page shows its key. */
export const PAGE: Record<string, Pair> = {
  access_roles: { ar: 'الأدوار', en: 'Roles' },
  accounts: { ar: 'الحسابات', en: 'Accounts' },
  admin: { ar: 'بوابة الإدارة', en: 'Admin Portal' },
  billing: { ar: 'الأقساط والمدفوعات', en: 'Instalments and payments' },
  calls: { ar: 'المكالمات', en: 'Calls' },
  cases: { ar: 'التصعيدات', en: 'Escalations' },
  certificates: { ar: 'الشهادات', en: 'Certificates' },
  chat: { ar: 'المحادثات', en: 'Chats' },
  feedback: { ar: 'الملاحظات', en: 'Feedback' },
  leave: { ar: 'الإجازات', en: 'Leave' },
  lessons: { ar: 'الحصص', en: 'Lessons' },
  materials: { ar: 'المواد التعليمية', en: 'Materials' },
  new_students: { ar: 'الطلاب الجدد', en: 'New students' },
  org: { ar: 'الهيكل التنظيمي', en: 'Organization' },
  parents: { ar: 'أولياء الأمور', en: 'Parents' },
  reports: { ar: 'التقارير', en: 'Reports' },
  schedule: { ar: 'الجدول', en: 'Schedule' },
  staff_accounts: { ar: 'حسابات الموظفين', en: 'Staff accounts' },
  staff_profiles: { ar: 'ملفات الموظفين', en: 'Staff profiles' },
  stories: { ar: 'الحالات', en: 'Stories' },
  students: { ar: 'الطلاب', en: 'Students' },
  subscriptions: { ar: 'الاشتراكات', en: 'Subscriptions' },
  supervision: { ar: 'الإشراف', en: 'Supervision' },
  teacher_files: { ar: 'ملفات المعلمين', en: 'Teacher files' },
  teacher_profiles: { ar: 'مراجعة مؤهلات المعلمين', en: 'Teacher credentials review' },
  teacher_supervision: { ar: 'الإشراف على المعلمين', en: 'Teacher supervision' },
  teachers: { ar: 'المعلمون', en: 'Teachers' },
  trials: { ar: 'الحصص التجريبية', en: 'Trials' },
}

export const pageLabel = (page: string): Pair => PAGE[page] ?? { ar: page, en: page }

const BY_CODE: Record<string, Pair> = {
  'COMM.STAFF_ACCOUNT_DENIED': {
    ar: 'لا يمكنك تنفيذ هذا على هذا الحساب أو بهذا الدور.',
    en: 'You may not do this to this account, or with this role.',
  },
  'COMM.STAFF_ACCOUNT_NOT_FOUND': { ar: 'هذا الحساب غير موجود ضمن نطاقك.', en: 'This account is not within your reach.' },
  'COMM.STAFF_ACCOUNT_CONFLICT': { ar: 'هذا البريد يسجّل الدخول إلى Chat بالفعل.', en: 'This e-mail already signs in to Chat.' },
  'COMM.ACCESS_ROLE_INVALID': {
    ar: 'لا يمكن تعريف هذا الدور: تحقّق من المعرّف والاسمين والصلاحيات.',
    en: 'This role cannot be defined: check the key, the names and the permissions.',
  },
  'COMM.ACCOUNT_ADMIN_STATE': {
    ar: 'لا يمكن تنفيذ هذا الآن: إما أن الحساب سجّل الدخول بالفعل، أو أن البريد غير متاح فلا يصدر الرمز إلا مدير النظام.',
    en: 'This cannot be done now: the account has signed in already, or e-mail is off and only the super admin can issue a code.',
  },
  'COMMON.RATE_LIMITED': {
    ar: 'رموز كثيرة لهذا الحساب خلال الساعة الأخيرة. حاول لاحقًا.',
    en: 'Too many codes for this account in the last hour. Try again later.',
  },
}

/**
 * The reader's language for a known refusal; otherwise the server's own words.
 * STAFF_ACCOUNT_INVALID keeps the server's text: it names the field.
 */
export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = BY_CODE[error.code]
    return known ? pick(known) : error.localized(locale)
  }
  return pick({ ar: 'حدث خطأ. حاول مرة أخرى.', en: 'Something went wrong. Try again.' })
}

/** ReasonDialog shows an ApiError in the reader's language; this one carries PD-40's own wording. */
export function localized(error: unknown): ApiError | undefined {
  if (error == null) return undefined
  return new ApiError({
    status: error instanceof ApiError ? error.status : 0,
    code: error instanceof ApiError ? error.code : 'CLIENT',
    messageEn: describeError(error, 'en'),
    messageAr: describeError(error, 'ar'),
  })
}

/**
 * ACCESS_ROLE_CONFLICT names the grants that block an edit, as
 * "<staff id> (granted by <staff id>)", comma-separated. Parsed so the editor
 * can show names; null when the message has another shape.
 */
export function blockingGrants(error: unknown): Array<{ staffId: string; grantedBy: string }> | null {
  if (!(error instanceof ApiError) || error.code !== 'COMM.ACCESS_ROLE_CONFLICT') return null
  const list = /grant to:\s*(.+?);/.exec(error.messageEn)?.[1]
  if (!list) return null
  const out: Array<{ staffId: string; grantedBy: string }> = []
  for (const m of list.matchAll(/([^\s,()]+)\s*\(granted by ([^\s)]+)\)/g)) out.push({ staffId: m[1]!, grantedBy: m[2]! })
  return out.length > 0 ? out : null
}
