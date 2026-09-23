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
  String get voiceRecordingInProgress => 'جارٍ تسجيل رسالة صوتية';

  @override
  String voiceRecordingElapsed(String duration) {
    return 'تم تسجيل $duration';
  }

  @override
  String get voiceStopRecording => 'إيقاف التسجيل';

  @override
  String get voiceDeleteRecording => 'حذف التسجيل';

  @override
  String get voiceReviewTitle => 'راجعي رسالتك الصوتية';

  @override
  String get voiceSendRecording => 'إرسال الرسالة الصوتية';

  @override
  String get voicePlay => 'تشغيل';

  @override
  String get voicePause => 'إيقاف مؤقت';

  @override
  String get voiceReplay => 'تشغيل من جديد';

  @override
  String get voiceMessageLabel => 'رسالة صوتية';

  @override
  String voiceMessageDuration(String duration) {
    return 'رسالة صوتية، $duration';
  }

  @override
  String get voiceLoading => 'جارٍ تحميل الصوت…';

  @override
  String get voicePlaybackFailed => 'تعذّر تشغيل هذه الرسالة الصوتية.';

  @override
  String get voiceUploading => 'جارٍ إرسال الرسالة الصوتية';

  @override
  String get voicePermissionDeniedTitle => 'الوصول إلى الميكروفون معطّل';

  @override
  String get voicePermissionDeniedBody =>
      'اسمحي بالوصول إلى الميكروفون من إعدادات جهازك لتسجيل رسالة صوتية.';

  @override
  String get voiceUnsupported => 'لا يمكن لهذا الجهاز تسجيل رسائل صوتية.';

  @override
  String get voiceTooShort => 'استمرّي بالضغط مدة أطول لتسجيل رسالة صوتية.';

  @override
  String get voiceRecordingFailed =>
      'تعذّر إكمال التسجيل. يُرجى المحاولة مرة أخرى.';

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
  String get notificationsTitle => 'الإشعارات';

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

  @override
  String get filterAll => 'الكل';

  @override
  String get filterUnread => 'غير المقروءة';

  @override
  String get filterGroups => 'المجموعات';

  @override
  String get filterFavorites => 'المفضلة';

  @override
  String get filterEmptyUnread => 'لا توجد رسائل غير مقروءة';

  @override
  String get filterEmptyUnreadBody => 'قرأت كل شيء. ستظهر الرسائل الجديدة هنا.';

  @override
  String get filterEmptyGroups => 'لا توجد مجموعات طلاب بعد';

  @override
  String get filterEmptyFavorites => 'لا توجد محادثات مفضلة';

  @override
  String get filterEmptyFavoritesBody =>
      'اضغط مطوّلًا على محادثة لإضافتها إلى المفضلة.';

  @override
  String get favoriteAction => 'إضافة إلى المفضلة';

  @override
  String get unfavoriteAction => 'إزالة من المفضلة';

  @override
  String get favoriteLabel => 'مفضلة';

  @override
  String get searchClear => 'مسح البحث';

  @override
  String get searchEmptyBody => 'يشمل البحث عناوين المحادثات والمجموعات.';

  @override
  String get archivedShow => 'عرض المؤرشفة';

  @override
  String get archivedHide => 'إخفاء المؤرشفة';

  @override
  String get callHistoryEmptyBody => 'ستظهر هنا المكالمات التي تشارك فيها.';

  @override
  String get callsUnavailableTitle => 'المكالمات غير متاحة بعد';

  @override
  String get callsUnavailableBody =>
      'لم يتم تفعيل المكالمات في هذا التطبيق بعد. لا ينقص حسابك شيء.';

  @override
  String get conversationActionsTitle => 'خيارات المحادثة';

  @override
  String get groupInfoTitle => 'معلومات المجموعة';

  @override
  String get groupLearnerLabel => 'الطالب';

  @override
  String get groupMemberUnresolved => 'عضو';

  @override
  String get myAccountTitle => 'حسابي';

  @override
  String get childrenTitle => 'الأبناء';

  @override
  String get childGroupLabel => 'المجموعة';

  @override
  String get childTeacherLabel => 'المعلم';

  @override
  String get childLevelLabel => 'المستوى';

  @override
  String get childSubscriptionLabel => 'الاشتراك';

  @override
  String get childScheduleLabel => 'المواعيد';

  @override
  String get childrenEmpty => 'لا يوجد أبناء مرتبطون بحسابك بعد.';

  @override
  String get contactInfoTitle => 'معلومات التواصل';

  @override
  String get contactInfoUnavailable =>
      'لا يحتفظ التطبيق بأرقام هواتف أو عناوين بريد إلكتروني بعد.';

  @override
  String get fieldNotAvailableYet => 'غير متاح بعد';

  @override
  String get profileNoDirectContact =>
      'يمكنك التواصل مع المعلم داخل مجموعة ابنك.';

  @override
  String notificationsWithUnread(int count) {
    return 'الإشعارات، $count غير مقروء';
  }

  @override
  String get notificationsMarkAllRead => 'تعليم الكل كمقروء';

  @override
  String get notificationsEmptyTitle => 'لا يوجد شيء بعد';

  @override
  String get notificationsEmptyBody =>
      'ستظهر هنا الرسائل وتغييرات الحصص وأخبار الأكاديمية.';

  @override
  String get notificationsAllCaughtUp => 'لا يوجد جديد.';

  @override
  String get notificationUnreadLabel => 'غير مقروء';

  @override
  String get notificationUrgentLabel => 'عاجل';

  @override
  String get notificationImportantLabel => 'مهم';

  @override
  String get notificationFilterAll => 'الكل';

  @override
  String get notificationFilterUnread => 'غير المقروء';

  @override
  String get notificationFilterMessages => 'الرسائل';

  @override
  String get notificationFilterClasses => 'الحصص';

  @override
  String get notificationFilterCalls => 'المكالمات';

  @override
  String get notificationFilterAcademy => 'الأكاديمية';

  @override
  String get notificationFilterPayments => 'المدفوعات';

  @override
  String get notificationPreferencesTitle => 'إعدادات الإشعارات';

  @override
  String get notificationPreferencesExplainer =>
      'إيقاف أي منها يمنع تنبيه هاتفك فقط. يبقى الإشعار هنا، فلا يضيع شيء.';

  @override
  String get notificationCategoryMessages => 'الرسائل';

  @override
  String get notificationCategoryMessagesBody =>
      'رسائل معلّم طفلك والمشرف والأكاديمية.';

  @override
  String get notificationCategoryCalls => 'المكالمات';

  @override
  String get notificationCategoryCallsBody =>
      'المكالمات الفائتة. المكالمات الواردة ترنّ دائماً.';

  @override
  String get notificationCategoryClasses => 'الحصص';

  @override
  String get notificationCategoryClassesBody =>
      'تذكيرات الحصص. تغييرات المواعيد والإلغاء تصلك دائماً.';

  @override
  String get notificationCategoryAcademy => 'الأكاديمية';

  @override
  String get notificationCategoryAcademyBody =>
      'أخبار جوّيد. الإعلانات العاجلة تصلك دائماً.';

  @override
  String get notificationCategoryPayments => 'المدفوعات';

  @override
  String get notificationCategoryPaymentsBody => 'تذكيرات التجديد والدفع.';

  @override
  String get notificationCategoryApprovals => 'الموافقات';

  @override
  String get notificationCategoryAccount => 'الحساب';

  @override
  String get notificationCategoryAlwaysOn => 'مفعّل دائماً.';

  @override
  String get announcementTitle => 'إعلان';

  @override
  String get announcementUnavailableBody => 'هذا الإعلان لم يعد متاحاً.';

  @override
  String get announcementUrgentBanner => 'إعلان عاجل من أكاديمية جوّيد';

  @override
  String get announcementImportantBanner => 'إعلان مهم';
}
