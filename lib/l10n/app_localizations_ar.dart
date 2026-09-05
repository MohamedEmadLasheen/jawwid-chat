// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class L10nAr extends L10n {
  L10nAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'جَوِّد';

  @override
  String get signInTitle => 'تسجيل الدخول إلى جَوِّد';

  @override
  String get signInSubtitle =>
      'يتم إنشاء حسابك من قِبَل جَوِّد. لا يوجد تسجيل ذاتي.';

  @override
  String get usernameLabel => 'اسم المستخدم';

  @override
  String get passwordLabel => 'كلمة المرور';

  @override
  String get signInAction => 'تسجيل الدخول';

  @override
  String get signInFailedCredentials =>
      'اسم المستخدم أو كلمة المرور غير صحيحة.';

  @override
  String get signInFailedDisabled =>
      'هذا الحساب لم يعد نشطًا. برجاء التواصل مع جَوِّد.';

  @override
  String get sessionExpiredTitle => 'تم تسجيل خروجك';

  @override
  String get sessionExpiredBody => 'انتهت جلستك. برجاء تسجيل الدخول مرة أخرى.';

  @override
  String get signOutAction => 'تسجيل الخروج';

  @override
  String get signOutConfirm => 'هل تريد تسجيل الخروج من جَوِّد على هذا الجهاز؟';

  @override
  String get tabChats => 'المحادثات';

  @override
  String get tabCalls => 'المكالمات';

  @override
  String get tabNotifications => 'المستجدات';

  @override
  String get tabProfile => 'حسابي';

  @override
  String get sectionJawwid => 'جَوِّد';

  @override
  String get sectionStaff => 'فريق جَوِّد';

  @override
  String get sectionMyGroups => 'مجموعاتي';

  @override
  String sectionLearner(String name) {
    return '$name';
  }

  @override
  String handledBy(String name) {
    return 'بمتابعة $name';
  }

  @override
  String get conversationsEmptyTitle => 'لا توجد محادثات بعد';

  @override
  String get conversationsEmptyBodyParent =>
      'عند وصول رسالة من جَوِّد أو من مجموعة ابنك، ستظهر هنا.';

  @override
  String get conversationsEmptyBodyTeacher =>
      'ستظهر هنا مجموعات الطلاب المسندة إليك.';

  @override
  String get conversationsErrorTitle => 'تعذّر تحميل المحادثات';

  @override
  String unreadCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count رسالة غير مقروءة',
      many: '$count رسالة غير مقروءة',
      few: '$count رسائل غير مقروءة',
      two: 'رسالتان غير مقروءتين',
      one: 'رسالة واحدة غير مقروءة',
      zero: 'لا رسائل غير مقروءة',
    );
    return '$_temp0';
  }

  @override
  String get pinAction => 'تثبيت';

  @override
  String get unpinAction => 'إلغاء التثبيت';

  @override
  String get muteAction => 'كتم';

  @override
  String get unmuteAction => 'إلغاء الكتم';

  @override
  String get archiveAction => 'أرشفة';

  @override
  String get unarchiveAction => 'إلغاء الأرشفة';

  @override
  String get archivedLabel => 'مؤرشفة';

  @override
  String get mutedLabel => 'مكتومة';

  @override
  String get composerHint => 'رسالة';

  @override
  String get composerSend => 'إرسال';

  @override
  String get composerAttach => 'إرفاق';

  @override
  String get composerRecord => 'تسجيل رسالة صوتية';

  @override
  String get composerRecording => 'جارٍ التسجيل';

  @override
  String get composerSlideToCancel => 'اسحب للإلغاء';

  @override
  String get composerReadOnly => 'لم يعد بإمكانك إرسال رسائل هنا.';

  @override
  String get messageStateSending => 'جارٍ الإرسال';

  @override
  String get messageStateSent => 'تم الإرسال';

  @override
  String get messageStateDelivered => 'تم التسليم';

  @override
  String get messageStateRead => 'تمت القراءة';

  @override
  String get messageStateFailed => 'لم تُرسَل';

  @override
  String get messageStatePendingApproval => 'في انتظار المراجعة';

  @override
  String get messageStateRejected => 'لم تتم الموافقة';

  @override
  String messageRejectedReason(String reason) {
    return 'لم تتم الموافقة: $reason';
  }

  @override
  String get messageDeleted => 'تم حذف هذه الرسالة';

  @override
  String get messageRetry => 'إعادة المحاولة';

  @override
  String get messageDiscard => 'تجاهل';

  @override
  String get messageQueuedOffline => 'في انتظار الاتصال';

  @override
  String get replyAction => 'رد';

  @override
  String replyingTo(String name) {
    return 'رد على $name';
  }

  @override
  String get reactAction => 'تفاعل';

  @override
  String get copyAction => 'نسخ';

  @override
  String typingSingle(String name) {
    return '$name يكتب الآن…';
  }

  @override
  String get typingMany => 'أكثر من شخص يكتب الآن…';

  @override
  String get loadingOlder => 'جارٍ تحميل الرسائل السابقة…';

  @override
  String get loadOlderFailed => 'تعذّر تحميل الرسائل السابقة.';

  @override
  String get messagesEmptyTitle => 'لا توجد رسائل بعد';

  @override
  String get messagesEmptyBody => 'ابدأ المحادثة بالسلام.';

  @override
  String get groupMembersTitle => 'الأعضاء';

  @override
  String get groupMemberRoleParent => 'ولي الأمر';

  @override
  String get groupMemberRoleTeacher => 'المعلم';

  @override
  String get groupMemberRoleAdmin => 'جَوِّد';

  @override
  String get groupApprovalNotice =>
      'تتم مراجعة الرسائل هنا من قِبَل جَوِّد قبل ظهورها للجميع.';

  @override
  String get callVoice => 'مكالمة صوتية';

  @override
  String get callGroup => 'مكالمة جماعية';

  @override
  String get callIncoming => 'مكالمة واردة';

  @override
  String get callConnecting => 'جارٍ الاتصال…';

  @override
  String get callReconnecting => 'جارٍ إعادة الاتصال…';

  @override
  String get callAccept => 'قبول';

  @override
  String get callDecline => 'رفض';

  @override
  String get callEnd => 'إنهاء';

  @override
  String get callMute => 'كتم الصوت';

  @override
  String get callUnmute => 'إلغاء الكتم';

  @override
  String get callSpeaker => 'مكبر الصوت';

  @override
  String get callHistoryTitle => 'المكالمات';

  @override
  String get callHistoryEmpty => 'لا توجد مكالمات بعد';

  @override
  String get callOutcomeAnswered => 'تم الرد';

  @override
  String get callOutcomeMissed => 'فائتة';

  @override
  String get callOutcomeDeclined => 'مرفوضة';

  @override
  String callDuration(int minutes, int seconds) {
    return '$minutes د $seconds ث';
  }

  @override
  String get callFailedMicrophone =>
      'يحتاج جَوِّد إلى إذن الميكروفون لإجراء المكالمات.';

  @override
  String get callFailedNotAllowed => 'هذه المكالمة غير متاحة.';

  @override
  String get callFailedNetwork =>
      'تعذّر إجراء المكالمة. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get notificationsTitle => 'المستجدات';

  @override
  String get notificationsEmpty => 'لا يوجد جديد';

  @override
  String get notificationPermissionTitle => 'فعّل الإشعارات';

  @override
  String get notificationPermissionBody =>
      'يستخدم جَوِّد الإشعارات لتذكيرات الحصص والرسائل والمكالمات.';

  @override
  String get notificationPermissionAction => 'فتح الإعدادات';

  @override
  String get profileTitle => 'حسابي';

  @override
  String get settingsTitle => 'الإعدادات';

  @override
  String get settingsLanguage => 'اللغة';

  @override
  String get settingsLanguageArabic => 'العربية';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSystem => 'حسب إعدادات الجهاز';

  @override
  String get settingsNotifications => 'الإشعارات';

  @override
  String get settingsDevices => 'الأجهزة النشطة';

  @override
  String get devicesThisDevice => 'هذا الجهاز';

  @override
  String devicesLastActive(String when) {
    return 'آخر نشاط $when';
  }

  @override
  String get devicesSignOutOther => 'تسجيل الخروج من هذا الجهاز';

  @override
  String get searchHint => 'ابحث في محادثاتك';

  @override
  String get searchEmpty => 'لا توجد نتائج مطابقة';

  @override
  String get retryAction => 'إعادة المحاولة';

  @override
  String get cancelAction => 'إلغاء';

  @override
  String get okAction => 'حسنًا';

  @override
  String get closeAction => 'إغلاق';

  @override
  String get errorNetworkTitle => 'لا يوجد اتصال';

  @override
  String get errorNetworkBody => 'تحقق من اتصالك بالإنترنت وحاول مرة أخرى.';

  @override
  String get errorTimeoutTitle => 'الأمر يستغرق وقتًا أطول من المعتاد';

  @override
  String get errorServerTitle => 'حدث خطأ ما';

  @override
  String get errorServerBody => 'برجاء المحاولة بعد قليل.';

  @override
  String get errorForbiddenTitle => 'غير متاح';

  @override
  String get errorForbiddenBody => 'ليس لديك صلاحية الوصول إلى هذا.';

  @override
  String get errorNotFoundTitle => 'غير موجود';

  @override
  String get errorNotFoundBody => 'لم يعد هذا متاحًا.';

  @override
  String get todayLabel => 'اليوم';

  @override
  String get yesterdayLabel => 'أمس';
}
