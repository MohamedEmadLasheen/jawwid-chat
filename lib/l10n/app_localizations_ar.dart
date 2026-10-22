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
  String get signInFailedLocked =>
      'محاولات كثيرة. برجاء المحاولة مرة أخرى بعد عدة دقائق.';

  @override
  String get signInFailedRoleUnsupported =>
      'لا يمكن تسجيل الدخول إلى تطبيق جَوِّد بهذا الحساب. حسابات الموظفين تستخدم لوحة تحكم جَوِّد.';

  @override
  String get sessionExpiredTitle => 'تم تسجيل خروجك';

  @override
  String get sessionExpiredBody => 'انتهت جلستك. برجاء تسجيل الدخول مرة أخرى.';

  @override
  String get sessionUnreachableBody =>
      'تعذّر الوصول إلى جَوِّد لفتح جلستك. ما زلت مسجّلًا للدخول — تحقق من اتصالك وحاول مرة أخرى.';

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
  String typingMany(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count شخص يكتبون الآن…',
      many: '$count شخصًا يكتبون الآن…',
      few: '$count أشخاص يكتبون الآن…',
      two: 'شخصان يكتبان الآن…',
      one: 'شخص واحد يكتب الآن…',
      zero: 'لا أحد يكتب الآن…',
    );
    return '$_temp0';
  }

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
  String get callOutgoing => 'جارٍ الاتصال…';

  @override
  String get callEnded => 'انتهت المكالمة';

  @override
  String get callSendMessageInstead => 'إرسال رسالة بدلاً من ذلك';

  @override
  String get callNoAnswer => 'لم يتم الرد';

  @override
  String get callMissedIncoming => 'مكالمة فائتة';

  @override
  String get callAgain => 'معاودة الاتصال';

  @override
  String get callRecordVoice => 'تسجيل رسالة صوتية';

  @override
  String get callMessage => 'رسالة';

  @override
  String get callVoiceTitle => 'مكالمة جوّد الصوتية';

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
  String get settingsAppearance => 'المظهر';

  @override
  String get settingsAppearanceAuto => 'تلقائي';

  @override
  String get settingsAppearanceLight => 'الوضع الفاتح';

  @override
  String get settingsAppearanceDark => 'الوضع الداكن';

  @override
  String get settingsLanguageArabic => 'العربية';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSystem => 'حسب إعدادات الجهاز';

  @override
  String get settingsNotifications => 'الإشعارات';

  @override
  String get settingsDevices => 'الأجهزة والجلسات';

  @override
  String get devicesThisDevice => 'هذا الجهاز';

  @override
  String devicesLastActive(String when) {
    return 'آخر نشاط $when';
  }

  @override
  String get devicesSignOutOther => 'تسجيل الخروج من هذا الجهاز';

  @override
  String devicesSignedIn(String date) {
    return 'تسجيل الدخول $date';
  }

  @override
  String get devicesJustNow => 'الآن';

  @override
  String devicesMinutesAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'منذ $count دقيقة',
      many: 'منذ $count دقيقة',
      few: 'منذ $count دقائق',
      two: 'منذ دقيقتين',
      one: 'منذ دقيقة',
      zero: 'الآن',
    );
    return '$_temp0';
  }

  @override
  String devicesHoursAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'منذ $count ساعة',
      many: 'منذ $count ساعة',
      few: 'منذ $count ساعات',
      two: 'منذ ساعتين',
      one: 'منذ ساعة',
      zero: 'الآن',
    );
    return '$_temp0';
  }

  @override
  String devicesDaysAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'منذ $count يوم',
      many: 'منذ $count يومًا',
      few: 'منذ $count أيام',
      two: 'منذ يومين',
      one: 'منذ يوم',
      zero: 'اليوم',
    );
    return '$_temp0';
  }

  @override
  String get devicesNeverUsed => 'لم يُستخدم منذ تسجيل الدخول';

  @override
  String get devicesPlatformIphone => 'آيفون';

  @override
  String get devicesPlatformAndroid => 'هاتف أندرويد';

  @override
  String get devicesPlatformWeb => 'متصفح ويب';

  @override
  String get devicesPlatformUnknown => 'جهاز غير معروف';

  @override
  String devicesSignOutConfirmTitle(String device) {
    return 'تسجيل الخروج من $device؟';
  }

  @override
  String get devicesSignOutConfirmBody =>
      'سيحتاج ذلك الجهاز إلى كلمة المرور لتسجيل الدخول مرة أخرى.';

  @override
  String get devicesSignOutAllOthers => 'تسجيل الخروج من جميع الأجهزة الأخرى';

  @override
  String get devicesSignOutAllOthersConfirm =>
      'تسجيل الخروج من كل الأجهزة الأخرى؟ سيبقى هذا الجهاز وحده مسجّلًا الدخول.';

  @override
  String get devicesSignedOutOne => 'تم تسجيل الخروج من ذلك الجهاز';

  @override
  String devicesSignedOutOthers(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تم تسجيل الخروج من $count جهاز',
      many: 'تم تسجيل الخروج من $count جهازًا',
      few: 'تم تسجيل الخروج من $count أجهزة',
      two: 'تم تسجيل الخروج من جهازين',
      one: 'تم تسجيل الخروج من جهاز واحد',
      zero: 'لا توجد أجهزة أخرى مسجّلة الدخول',
    );
    return '$_temp0';
  }

  @override
  String get devicesSignOutFailed =>
      'تعذّر تسجيل خروج ذلك الجهاز. حاول مرة أخرى.';

  @override
  String get devicesEmpty => 'لا توجد جلسات نشطة';

  @override
  String get appLockTitle => 'قفل التطبيق';

  @override
  String get appLockToggle => 'القفل ببصمة الوجه أو الإصبع أو رمز المرور';

  @override
  String get appLockToggleSubtitle => 'اطلب فتح القفل عند العودة إلى التطبيق';

  @override
  String get appLockUnavailable =>
      'لاستخدام قفل التطبيق، فعّل بصمة الوجه أو بصمة الإصبع أو رمز مرور على هذا الجهاز.';

  @override
  String get appLockTimeoutLabel => 'القفل تلقائيًا';

  @override
  String get appLockTimeoutImmediately => 'فورًا';

  @override
  String get appLockTimeoutOneMinute => 'بعد دقيقة واحدة';

  @override
  String get appLockTimeoutFifteenMinutes => 'بعد 15 دقيقة';

  @override
  String get appLockTimeoutOneHour => 'بعد ساعة واحدة';

  @override
  String get appLockReason => 'افتح قفل التطبيق';

  @override
  String get appLockLockedTitle => 'التطبيق مقفل';

  @override
  String get appLockLockedBody => 'افتح القفل لرؤية محادثاتك.';

  @override
  String get appLockUnlockAction => 'فتح القفل';

  @override
  String get appLockFailed => 'تعذّر فتح القفل. حاول مرة أخرى.';

  @override
  String get appLockOfferTitle => 'قفل التطبيق؟';

  @override
  String get appLockOfferBody =>
      'استخدم بصمة الوجه أو بصمة الإصبع أو رمز المرور لفتح التطبيق، لتبقى محادثاتك خاصة إذا أمسك أحد غيرك بهاتفك. يمكنك تغيير ذلك في أي وقت من الإعدادات.';

  @override
  String get appLockOfferAccept => 'تفعيل';

  @override
  String get appLockOfferDecline => 'ليس الآن';

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
  String get memberMessageAction => 'مراسلة';

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
  String get messageActionsTitle => 'خيارات الرسالة';

  @override
  String get deleteAction => 'حذف';

  @override
  String get deleteForMeAction => 'حذف لدي';

  @override
  String get deleteForEveryoneAction => 'حذف لدى الجميع';

  @override
  String get deleteForMeExplainer => 'ستظل ظاهرة لبقية المشاركين.';

  @override
  String get deleteForEveryoneExplainer => 'ستُحذف من المحادثة لدى الجميع.';

  @override
  String get copiedConfirmation => 'تم النسخ';

  @override
  String get openAction => 'فتح';

  @override
  String get saveAction => 'حفظ';

  @override
  String get attachCamera => 'الكاميرا';

  @override
  String get attachPhoto => 'صورة';

  @override
  String get attachFile => 'ملف';

  @override
  String get attachmentPhotoLabel => 'صورة';

  @override
  String get attachmentFileLabel => 'ملف';

  @override
  String get attachmentVoiceLabel => 'رسالة صوتية';

  @override
  String get attachmentVideoLabel => 'فيديو';

  @override
  String get attachmentSendTitle => 'إرسال هذه؟';

  @override
  String get attachmentTooLarge => 'هذا الملف أكبر من أن يُرسل.';

  @override
  String get attachmentTypeNotAllowed =>
      'لا يمكن إرسال هذا النوع من الملفات هنا.';

  @override
  String get attachmentPickFailed => 'تعذّر فتح ذلك. برجاء المحاولة مرة أخرى.';

  @override
  String get cameraPermissionDenied =>
      'يحتاج جَوِّد إلى إذن لاستخدام الكاميرا. يمكنك السماح بذلك من الإعدادات.';

  @override
  String get cameraUnavailable => 'لا توجد كاميرا متاحة على هذا الجهاز.';

  @override
  String get attachmentPermissionDenied =>
      'يحتاج جَوِّد إلى إذن للوصول إلى صورك. يمكنك السماح بذلك من الإعدادات.';

  @override
  String get attachmentUnsupported => 'لا يمكن اختيار الملفات على هذا الجهاز.';

  @override
  String get attachmentUploadFailed =>
      'تعذّر إرسال الملف. برجاء المحاولة مرة أخرى.';

  @override
  String get attachmentUploading => 'جارٍ الإرسال…';

  @override
  String get replyOriginalUnavailable => 'الرسالة الأصلية';

  @override
  String get mediaAndFilesTitle => 'الوسائط والملفات';

  @override
  String get mediaPhotosTab => 'الصور';

  @override
  String get mediaFilesTab => 'الملفات';

  @override
  String get mediaVoiceTab => 'الصوتيات';

  @override
  String get mediaEmpty => 'لم تتم مشاركة أي شيء بعد';

  @override
  String get mediaEmptyBody =>
      'تظهر هنا الصور والملفات والرسائل الصوتية الخاصة بهذه المحادثة.';

  @override
  String get mediaLoadOlder => 'تحميل الأقدم';

  @override
  String get notificationsMuted => 'الإشعارات مكتومة';

  @override
  String get notificationsMutedExplainer => 'ستظل تصلك الرسائل.';

  @override
  String reactionCountSemantics(String emoji, int count) {
    return '$emoji، $count تفاعلات';
  }

  @override
  String reactionYoursSemantics(String emoji) {
    return '$emoji، من بينها تفاعلك';
  }

  @override
  String fileSizeKb(String size) {
    return '$size ك.ب';
  }

  @override
  String fileSizeMb(String size) {
    return '$size م.ب';
  }

  @override
  String storyRingUnviewed(String label) {
    return 'حالة غير مقروءة: $label';
  }

  @override
  String storyRingViewed(String label) {
    return 'حالة مقروءة: $label';
  }

  @override
  String get storyClose => 'إغلاق الحالة';

  @override
  String get storyPrevious => 'الحالة السابقة';

  @override
  String get storyNext => 'الحالة التالية';

  @override
  String get storyImageLabel => 'صورة الحالة';

  @override
  String get storyMediaFailed => 'لم نتمكّن من تحميل هذه الصورة.';

  @override
  String get storyUnavailable => 'هذه الحالة لم تعد متاحة.';

  @override
  String get storyVideoLabel => 'فيديو الحالة';

  @override
  String get storyVideoFailed => 'لم نتمكّن من تشغيل هذا الفيديو.';

  @override
  String get storyVideoRetry => 'إعادة المحاولة';

  @override
  String get storyTextLabel => 'حالة';

  @override
  String get storyVoiceLabel => 'حالة صوتية';

  @override
  String get storyVoiceFailed => 'لم نتمكّن من تشغيل هذه الرسالة الصوتية.';

  @override
  String get storyVoicePlay => 'تشغيل الحالة الصوتية';

  @override
  String get storyVoicePause => 'إيقاف الحالة الصوتية مؤقتًا';

  @override
  String get storyCtaWhatsApp => 'تواصل عبر واتساب';

  @override
  String get storyCtaMessage => 'أرسل رسالة';

  @override
  String get storyCtaLink => 'اعرف المزيد';

  @override
  String get storyCtaFailed => 'لم يُفتح. حاول مرة أخرى.';

  @override
  String get storiesEmpty => 'لا توجد حالات بعد';

  @override
  String get storiesEmptyBody => 'ستظهر هنا الحالات المنشورة إليك.';

  @override
  String systemGroupCreated(String learner) {
    return 'أُنشئت مجموعة الطالب لـ $learner';
  }

  @override
  String get systemGroupCreatedNoLearner => 'أُنشئت مجموعة الطالب';

  @override
  String systemGroupMembersUpdated(int added, int removed) {
    return 'تحدّث أعضاء المجموعة (+$added / −$removed)';
  }

  @override
  String get systemGroupArchived => 'أُرشفت المجموعة';

  @override
  String systemGroupSupervisorChanged(String name) {
    return 'أصبح $name مشرف هذه المجموعة';
  }

  @override
  String get systemGroupSupervisorChangedNoName => 'تغيّر مشرف هذه المجموعة';

  @override
  String systemDirectSupervisorChanged(String name) {
    return 'أصبح $name مشرفك؛ سجلّ المحادثة كما هو';
  }

  @override
  String get systemDirectSupervisorChangedNoName =>
      'تغيّر مشرفك؛ سجلّ المحادثة كما هو';

  @override
  String get systemGroupLearnerDetached =>
      'انتقل طفل من هذه المجموعة إلى مشرف آخر';

  @override
  String get systemUpdate => 'تحديث من النظام';

  @override
  String get lessonTicketsHeader => 'الحصة';

  @override
  String get ticketReport => 'تقرير الحصة';

  @override
  String get ticketAbsence => 'غياب الطالب';

  @override
  String get ticketApology => 'اعتذار عن الحصة';

  @override
  String get ticketTeacherApology => 'اعتذار المعلم عن الحصة';

  @override
  String get ticketLateApology => 'اعتذار متأخر (ظرف طارئ)';

  @override
  String ticketLessonAt(String when) {
    return 'حصة $when';
  }

  @override
  String get reportCoveredLabel => 'ما تمت دراسته';

  @override
  String get reportHomeworkLabel => 'الواجب (اختياري)';

  @override
  String get reportRatingLabel => 'التقييم (اختياري)';

  @override
  String get reportNoteLabel => 'ملاحظة (اختياري)';

  @override
  String get ticketReasonLabel => 'السبب';

  @override
  String get ticketAbsenceHint => 'لم يصل اعتذار وانتهى وقت الحصة.';

  @override
  String get ticketLateApologyHint =>
      'ستراجعه الإدارة، وحتى ذلك الحين تُحتسب الحصة غيابًا.';

  @override
  String get ticketTeacherApologyHint => 'سيتم ترتيب حصة تعويضية مع الأسرة.';

  @override
  String get ticketSubmit => 'إرسال';

  @override
  String get ticketSent => 'تم الإرسال';

  @override
  String get ticketFailed => 'تعذّر الإرسال. حاول مرة أخرى.';

  @override
  String get ticketNoLongerAllowed =>
      'لم يعد بالإمكان تحديث هذه الحصة بهذه الطريقة.';

  @override
  String get cardReportTitle => 'تقرير الحصة';

  @override
  String get cardAbsenceTitle => 'غياب عن الحصة';

  @override
  String get cardApologyTitle => 'اعتذار';

  @override
  String get cardTeacherApologyTitle => 'اعتذار المعلم عن الحصة';

  @override
  String get cardCancelledTitle => 'أُلغيت الحصة';

  @override
  String get cardTeacherAbsentTitle => 'لم تُعقد الحصة لغياب المعلم';

  @override
  String get cardLateApologyTitle => 'اعتذار متأخر';

  @override
  String get cardRulingExcusedTitle => 'قُبل الاعتذار';

  @override
  String get cardRulingCreditedTitle => 'سُجّلت الحصة غيابًا';

  @override
  String get cardUnderReview => 'قيد المراجعة من الإدارة';

  @override
  String get cardMakeupOwed => 'سيتم ترتيب حصة تعويضية.';

  @override
  String get cardCovered => 'ما تمت دراسته';

  @override
  String get cardHomework => 'الواجب';

  @override
  String get cardRating => 'التقييم';

  @override
  String get cardNote => 'ملاحظة';

  @override
  String get cardReason => 'السبب';

  @override
  String get ticketBookMakeup => 'جدولة حصة تعويضية';

  @override
  String get ticketRequestScheduleChange => 'تغيير مواعيد الحصص الثابتة';

  @override
  String ticketFor(String name) {
    return 'لـ $name';
  }

  @override
  String get makeupPickDay => 'اختر يومًا';

  @override
  String get makeupPickTime => 'اختر وقتًا';

  @override
  String get makeupNoSlots =>
      'لا توجد أوقات متاحة خلال الأسبوعين القادمين، وستتولى الإدارة ترتيب الحصة التعويضية.';

  @override
  String get makeupBook => 'احجز';

  @override
  String makeupLength(int minutes) {
    return '$minutes دقيقة';
  }

  @override
  String get scheduleChangePick => 'اختر المواعيد الأسبوعية الجديدة';

  @override
  String get scheduleChangeHint => 'ستؤكد الإدارة التغيير.';

  @override
  String get scheduleChangeNoOptions => 'لا توجد مواعيد أخرى متاحة حاليًا.';

  @override
  String get scheduleChangeSend => 'إرسال الطلب';

  @override
  String get ticketLoadFailed => 'تعذّر تحميل الأوقات المتاحة. حاول مرة أخرى.';

  @override
  String get cardMakeupBookedTitle => 'حُجزت حصة تعويضية';

  @override
  String get cardMakeupResolvedTitle => 'تمت معالجة الحصة الفائتة';

  @override
  String get cardMakeupActionSubstitute => 'معلم بديل';

  @override
  String get cardMakeupActionCredit => 'رصيد للأسرة';

  @override
  String get cardMakeupActionExtension => 'تمديد الباقة';

  @override
  String get cardMakeupActionWaived => 'لا حاجة لحصة تعويضية';

  @override
  String get cardScheduleRequestedTitle => 'طلب تغيير المواعيد الثابتة';

  @override
  String get cardScheduleApprovedTitle => 'اعتُمدت المواعيد الجديدة';

  @override
  String get cardScheduleRejectedTitle => 'لم يُعتمد تغيير المواعيد';

  @override
  String cardEveryWeek(String when) {
    return 'كل $when';
  }

  @override
  String get tabSchedule => 'الجدول';

  @override
  String get scheduleEmpty => 'لا توجد حصص خلال الأسبوعين القادمين.';

  @override
  String get scheduleLoadFailed => 'تعذّر تحميل جدولك.';

  @override
  String get phaseUpcoming => 'قادمة';

  @override
  String get phaseInProgress => 'جارية';

  @override
  String get phaseAwaitingClose => 'بانتظار التقرير';

  @override
  String get phaseOverdue => 'تأخر التقرير';

  @override
  String get outcomeHeld => 'عُقدت';

  @override
  String get outcomeStudentApology => 'اعتذر الطالب';

  @override
  String get outcomeTeacherApology => 'اعتذر المعلم';

  @override
  String get outcomeAdminCancelled => 'أُلغيت';

  @override
  String get outcomeStudentNoShow => 'غاب الطالب';

  @override
  String get outcomeTeacherNoShow => 'غاب المعلم';

  @override
  String get outcomeRescheduled => 'نُقلت';

  @override
  String get lessonKindMakeup => 'تعويضية';

  @override
  String get cardTransferredTitle => 'معلم جديد';

  @override
  String cardTransferredBody(String teacher) {
    return 'سيتولى $teacher التدريس ابتداءً من الآن.';
  }

  @override
  String get cardHandoverTitle => 'طالب جديد';

  @override
  String get cardHandoverFrom => 'المعلم السابق';

  @override
  String get cardHandoverNote => 'ملاحظات التسليم';

  @override
  String get cardPausedTitle => 'توقف الحصص مؤقتًا';

  @override
  String cardPausedUntil(String date) {
    return 'حتى $date';
  }

  @override
  String get cardStoppedTitle => 'توقفت الحصص';

  @override
  String get cardReturnSoonTitle => 'تعود الحصص قريبًا';

  @override
  String cardReturnOn(String date) {
    return 'العودة يوم $date';
  }

  @override
  String get cardResumedTitle => 'عادت الحصص';

  @override
  String get cardBonusTitle => 'مكافأة لك';

  @override
  String get progressTitle => 'هذا الشهر';

  @override
  String get progressAttended => 'حضر';

  @override
  String get progressApologised => 'اعتذر';

  @override
  String get progressAbsent => 'غاب';

  @override
  String progressStreak(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count حصة متتالية',
      many: '$count حصة متتالية',
      few: '$count حصص متتالية',
      two: 'حصتان متتاليتان',
      one: 'حصة واحدة متتالية',
      zero: 'لا توجد سلسلة بعد',
    );
    return '$_temp0';
  }

  @override
  String progressAllTime(int count) {
    return '$count حصة حضرها إجمالًا';
  }

  @override
  String progressMakeupsOwed(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count حصة تعويضية مستحقة',
      few: '$count حصص تعويضية مستحقة',
      two: 'حصتان تعويضيتان مستحقتان',
      one: 'حصة تعويضية مستحقة',
    );
    return '$_temp0';
  }

  @override
  String progressNext(String when) {
    return 'الحصة القادمة: $when';
  }

  @override
  String progressLastCovered(String covered) {
    return 'آخر حصة: $covered';
  }

  @override
  String get progressCertificates => 'ستظهر الشهادات هنا.';

  @override
  String get progressUnavailable => 'التقدم غير متاح حاليًا.';

  @override
  String get workloadTitle => 'هذا الشهر';

  @override
  String workloadHeld(int lessons, String hours) {
    return '$lessons حصة · $hours ساعة';
  }

  @override
  String workloadNeedsReport(int count) {
    return '$count بانتظار التقرير';
  }

  @override
  String workloadOnTime(String percent) {
    return '$percent من التقارير في موعدها';
  }

  @override
  String get supervisionChatTitle => 'الإشراف';

  @override
  String get supervisionChatSubtitle => 'قسم المعلمين · خاصة';

  @override
  String get supervisionTicketsHeader => 'الطلبات';

  @override
  String get ticketCertificate => 'طلب شهادة';

  @override
  String get ticketLeave => 'طلب إجازة';

  @override
  String get certificateFormTitle => 'طلب شهادة';

  @override
  String get certificateFormHint =>
      'يُرسل بشكل خاص إلى قسم المعلمين. عند إصدار الشهادة تُنشر في مجموعة الطالب، حيث تستلمها أنت وأولياء الأمر.';

  @override
  String get certificateStudent => 'الطالب';

  @override
  String get certificateTitleField => 'الشهادة';

  @override
  String get certificateTitleHint => 'مثال: جزء عمّ';

  @override
  String get certificateAchievement => 'الإنجاز';

  @override
  String get certificateAchievedOn => 'تاريخ الإنجاز';

  @override
  String get certificateGrade => 'التقدير (اختياري)';

  @override
  String get certificatePrintedName => 'الاسم كما يُكتب على الشهادة';

  @override
  String get certificateNote => 'ملاحظة للقسم (اختيارية)';

  @override
  String get leaveFormTitle => 'طلب إجازة';

  @override
  String get leaveFormHint =>
      'يُرسل بشكل خاص إلى قسم المعلمين. تُخصم الأيام المعتمدة من رصيدك.';

  @override
  String get leaveFirstDay => 'أول يوم';

  @override
  String get leaveLastDay => 'آخر يوم';

  @override
  String get leaveReason => 'السبب';

  @override
  String leaveDaysCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count يوم',
      many: '$count يومًا',
      few: '$count أيام',
      two: 'يومان',
      one: 'يوم واحد',
    );
    return '$_temp0';
  }

  @override
  String leaveBalanceNow(String balance) {
    return 'رصيدك الحالي: $balance';
  }

  @override
  String get leaveSameYear => 'أرسل طلبًا منفصلًا لكل عام.';

  @override
  String get leaveLastBeforeFirst => 'آخر يوم قبل أول يوم.';

  @override
  String get formRequired => 'مطلوب';

  @override
  String get formSend => 'إرسال';

  @override
  String get myLeaveTitle => 'إجازاتي';

  @override
  String myLeaveAllowance(String year) {
    return 'رصيد $year';
  }

  @override
  String get myLeaveUsed => 'المستخدم';

  @override
  String get myLeaveBalance => 'المتبقي';

  @override
  String get myLeaveNoAllowance => 'لم يُحدَّد بعد';

  @override
  String get myLeaveNoRequests => 'لا توجد طلبات إجازة هذا العام.';

  @override
  String get myLeaveRequest => 'طلب إجازة';

  @override
  String get myLeaveWithdraw => 'سحب';

  @override
  String get myLeaveWithdrawConfirm => 'سحب طلب الإجازة هذا؟';

  @override
  String get leaveStateRequested => 'بانتظار القرار';

  @override
  String get leaveStateApproved => 'معتمدة';

  @override
  String get leaveStateDeclined => 'غير معتمدة';

  @override
  String get leaveStateWithdrawn => 'مسحوبة';

  @override
  String get leaveStateCancelled => 'ملغاة';

  @override
  String get cardCertificateRequestedTitle => 'طلب شهادة';

  @override
  String get cardCertificateIssuedTitle => 'شهادة';

  @override
  String get cardCertificateDeclinedTitle => 'لم يُعتمد طلب الشهادة';

  @override
  String get cardLeaveRequestedTitle => 'طلب إجازة';

  @override
  String get cardLeaveApprovedTitle => 'تمت الموافقة على الإجازة';

  @override
  String get cardLeaveDeclinedTitle => 'لم تتم الموافقة على الإجازة';

  @override
  String get cardLeaveWithdrawnTitle => 'سُحب طلب الإجازة';

  @override
  String get cardLeaveCancelledTitle => 'أُلغيت الإجازة';

  @override
  String get cardAchievement => 'الإنجاز';

  @override
  String get cardGrade => 'التقدير';

  @override
  String get cardDays => 'الأيام';

  @override
  String get cardBalance => 'الرصيد';

  @override
  String get cardDaysReturned => 'أيام أُعيدت';

  @override
  String get cardCongratulations => 'مبارك! الشهادة مرفقة.';

  @override
  String get leaveNotAllowed =>
      'لا يمكن طلب هذه الأيام: تتداخل مع طلب آخر أو مضت.';

  @override
  String get progressCertificatesTitle => 'الشهادات';

  @override
  String get cardDisciplineWarningTitle => 'تنبيه';

  @override
  String get cardDisciplineDeduction1Title => 'الخصم الأول';

  @override
  String get cardDisciplineDeduction2Title => 'الخصم الثاني';

  @override
  String get cardDisciplineTemporaryTitle => 'إيقاف مؤقت';

  @override
  String get cardDisciplinePermanentTitle => 'إيقاف نهائي';

  @override
  String get cardViolation => 'ما حدث';

  @override
  String cardViolationLate(String minutes) {
    return 'تأخر $minutes دقيقة';
  }

  @override
  String get cardViolationNoShow => 'غياب عن الحصة';

  @override
  String get cardViolationApology => 'اعتذار عن الحصة';

  @override
  String get cardViolationAbsence => 'غياب';

  @override
  String get cardViolationComplaint => 'شكوى ثبتت';

  @override
  String chatTeacherOnLeave(String name, String date) {
    return '$name في إجازة حتى $date. تظل الرسائل تصله.';
  }

  @override
  String chatTeacherAway(String name, String date) {
    return '$name غير متاح حتى $date. تظل الرسائل تصله.';
  }

  @override
  String cardViolationStep(String step) {
    return 'المخالفة رقم $step هذا الشهر';
  }

  @override
  String get cardPayrollNote => 'يُحدَّد المبلغ في الرواتب.';

  @override
  String get trialGroupTitle => 'الحصص التجريبية';

  @override
  String get trialGroupSubtitle => 'المبيعات · للموظفين فقط';

  @override
  String get trialTicketsHeader => 'الحصص التجريبية';

  @override
  String get trialReportTitle => 'تقرير الحصة التجريبية';

  @override
  String get trialAttended => 'حضر';

  @override
  String get trialDidNotAttend => 'لم يحضر';

  @override
  String get trialCovered => 'ما تم في الحصة';

  @override
  String get trialRating => 'التقييم';

  @override
  String get trialNote => 'ملاحظة (اختيارية)';

  @override
  String get cardTrialBookedTitle => 'حُجزت حصة تجريبية';

  @override
  String get cardTrialCancelledTitle => 'أُلغيت الحصة التجريبية';

  @override
  String get cardTrialReportTitle => 'تقرير الحصة التجريبية';

  @override
  String get cardTrialNoShowTitle => 'لم يحضر الطالب الحصة التجريبية.';

  @override
  String get cardTrialSubscribedTitle => 'اشترك الطالب.';

  @override
  String get cardTrialNotSubscribedTitle => 'لم يشترك الطالب.';

  @override
  String get cardTrialLevel => 'المستوى';

  @override
  String get cardTrialCorrectionTitle => 'تم تصحيح النتيجة';

  @override
  String get cardTrialNewOutcome => 'الآن';

  @override
  String get callsSearchHint => 'ابحث بالاسم';

  @override
  String get callActionStart => 'بدء مكالمة';

  @override
  String get callActionNewLink => 'رابط مكالمة جديد';

  @override
  String get callActionSelectMember => 'اختيار عضو';

  @override
  String get callActionSchedule => 'جدولة مكالمة';

  @override
  String get callsSectionUpcoming => 'القادمة';

  @override
  String get callsSectionFavorites => 'المفضلة';

  @override
  String get callsSectionRecent => 'الأخيرة';

  @override
  String get callsUpcomingEmpty => 'لا توجد مكالمات مجدولة';

  @override
  String get callsUpcomingError => 'تعذّر تحميل المكالمات القادمة.';

  @override
  String get callsFavoritesEmpty => 'أضف محادثة إلى المفضلة لتتصل بها من هنا.';

  @override
  String get callsSearchNoMatch => 'لا توجد نتائج مطابقة لبحثك';

  @override
  String get callsUnnamed => 'محادثة بلا اسم';

  @override
  String get callBack => 'معاودة الاتصال';

  @override
  String get callDirectionOutgoing => 'صادرة';

  @override
  String get callDirectionIncoming => 'واردة';

  @override
  String callWhen(String day, String time) {
    return '$day، $time';
  }

  @override
  String get callPickerPeople => 'الأشخاص';

  @override
  String get callPickerGroups => 'المجموعات';

  @override
  String get callPickerEmpty => 'لا توجد محادثات للاختيار منها.';

  @override
  String get callPickerNoMatch => 'لا توجد محادثات تطابق بحثك';

  @override
  String get callRefusedParentGroup =>
      'يبدأ مكالمةَ المجموعة الموظفون أو المعلم فقط';

  @override
  String get callRefusedGeneric => 'المكالمات غير متاحة في هذه المحادثة';

  @override
  String get scheduledCallDefaultTitle => 'مكالمة مجدولة';

  @override
  String get scheduledCallLinkLabel => 'رابط مكالمة';

  @override
  String get scheduledCallStateOpen => 'متاحة الآن';

  @override
  String get scheduledCallStateUpcoming => 'مجدولة';

  @override
  String get scheduledCallJoin => 'انضمام';

  @override
  String get scheduledCallCancel => 'إلغاء المكالمة';

  @override
  String get scheduledCallCancelConfirmTitle => 'إلغاء هذه المكالمة؟';

  @override
  String get scheduledCallCancelConfirmBody =>
      'سيرى كل من في المحادثة أنها أُلغيت.';

  @override
  String get scheduledCallKeep => 'إبقاء';

  @override
  String get scheduledCallCancelled => 'أُلغيت المكالمة';

  @override
  String scheduledCallBy(String name) {
    return 'بواسطة $name';
  }

  @override
  String get scheduledCallJoinHint => 'يمكنك الانضمام قبل الموعد بعشر دقائق.';

  @override
  String get scheduledJoinNotJoinable =>
      'لا يمكن الانضمام إلى هذه المكالمة الآن';

  @override
  String get scheduledJoinWaitingForHost =>
      'تبدأ المكالمة عندما ينضم الموظفون أو المعلم';

  @override
  String get scheduledJoinBusy => 'أنهِ مكالمتك الحالية أولًا';

  @override
  String get callScheduleDate => 'التاريخ';

  @override
  String get callScheduleTime => 'الوقت';

  @override
  String get callScheduleTitleLabel => 'العنوان (اختياري)';

  @override
  String get callScheduleInPast => 'اختر وقتًا في المستقبل';

  @override
  String callSchedulePosted(String chat) {
    return 'تمت الجدولة — نُشرت في $chat';
  }

  @override
  String callLinkPosted(String chat) {
    return 'نُشر رابط المكالمة في $chat';
  }

  @override
  String get callLinkJoinNow => 'انضم الآن';

  @override
  String get callLinkOpenChat => 'فتح المحادثة';

  @override
  String get profilePhotoTitle => 'الصورة الشخصية';

  @override
  String get profilePhotoHint => 'يرى هذه الصورة كل من تتحدث معه.';

  @override
  String get profilePhotoAdd => 'إضافة صورة';

  @override
  String get profilePhotoChange => 'تغيير الصورة';

  @override
  String get profilePhotoRemove => 'إزالة الصورة';

  @override
  String get profilePhotoSaving => 'جارٍ الحفظ…';

  @override
  String get profilePhotoFailed => 'تعذّر حفظ الصورة. حاول مرة أخرى.';

  @override
  String get profilePhotoInvalid =>
      'استخدم صورة JPEG أو PNG أو WebP، بحجم ٦٤ × ٦٤ بكسل على الأقل وأقل من ٢ ميغابايت.';

  @override
  String get childrenPhotosTitle => 'صور الأطفال';

  @override
  String get childrenPhotosHint => 'تظهر في مجموعات طفلك لمعلمه ومشرفه.';

  @override
  String get starAction => 'تمييز بنجمة';

  @override
  String get unstarAction => 'إلغاء التمييز';

  @override
  String get pinAction => 'تثبيت الرسالة';

  @override
  String get unpinAction => 'إلغاء تثبيت الرسالة';

  @override
  String get starredMark => 'مميّزة بنجمة';

  @override
  String get pinnedMark => 'مثبّتة';

  @override
  String get pinnedBannerOne => 'رسالة مثبّتة';

  @override
  String pinnedBannerOf(int index, int total) {
    return 'رسالة مثبّتة $index من $total';
  }

  @override
  String get starredMessagesTitle => 'الرسائل المميّزة بنجمة';

  @override
  String get starredMessagesEmpty =>
      'لم تميّز أي رسالة بعد. اضغط مطولًا على رسالة واختر «تمييز بنجمة».';

  @override
  String get forwardAction => 'إعادة توجيه';

  @override
  String get forwardTitle => 'إعادة التوجيه إلى…';

  @override
  String get forwardEmpty => 'لا توجد محادثات لإعادة التوجيه إليها.';

  @override
  String forwardSendTo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'إرسال إلى $count',
      zero: 'إرسال',
    );
    return '$_temp0';
  }

  @override
  String get forwardMax => 'يمكن اختيار ١٠ محادثات كحد أقصى.';

  @override
  String forwardDone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أُعيد توجيهها إلى $count محادثات',
      one: 'أُعيد توجيهها إلى محادثة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get forwardedLabel => 'مُعاد توجيهها';

  @override
  String get sentBySupportLabel => 'أرسلها الدعم';

  @override
  String get editedMark => 'معدّلة';

  @override
  String get selectAction => 'تحديد الرسائل';

  @override
  String selectedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count رسائل محددة',
      one: 'رسالة محددة',
    );
    return '$_temp0';
  }

  @override
  String get cancelSelection => 'إلغاء التحديد';

  @override
  String get searchInChat => 'البحث في المحادثة';

  @override
  String get searchMessagesHint => 'ابحث في الرسائل';

  @override
  String get searchClose => 'إغلاق البحث';

  @override
  String get searchOlder => 'النتيجة الأقدم';

  @override
  String get searchNewer => 'النتيجة الأحدث';

  @override
  String get searchNoMatches => 'لا توجد رسائل مطابقة';

  @override
  String get searchTooShort => 'اكتب حرفين على الأقل';

  @override
  String searchPosition(int index, String total) {
    return '$index من $total';
  }

  @override
  String get searchMessagesSection => 'الرسائل';

  @override
  String get searchMessagesNone => 'لا توجد رسائل مطابقة في محادثاتك';

  @override
  String get chatThemeAction => 'سمة المحادثة';

  @override
  String get chatWallpaperBadType => 'هذه ليست صورة JPEG أو PNG أو WebP صالحة.';

  @override
  String get chatWallpaperTooLarge =>
      'الصورة كبيرة جدًا (4 ميغابايت على الأكثر).';

  @override
  String get chatWallpaperBadSize =>
      'يجب أن يكون طول الصورة وعرضها بين 200 و4096 بكسل.';

  @override
  String get chatWallpaperAnimated => 'لا يمكن استخدام صورة متحركة خلفيةً.';

  @override
  String get chatThemeHint =>
      'لك وحدك: تغيّر خلفية هذه المحادثة على كل أجهزتك، ولا يراها غيرك.';

  @override
  String get chatThemeDefault => 'الافتراضية';

  @override
  String get chatThemeLagoon => 'بحيرة';

  @override
  String get chatThemeSand => 'رمل';

  @override
  String get chatThemeRose => 'ورد';

  @override
  String get chatThemeSky => 'سماء';

  @override
  String get chatThemeLilac => 'ليلك';

  @override
  String get chatThemeOlive => 'زيتون';

  @override
  String get chatThemeSlate => 'رمادي';

  @override
  String get chatThemeDusk => 'غروب';

  @override
  String get chatWallpaperTitle => 'صورة خلفية';

  @override
  String get chatWallpaperChoose => 'اختيار صورة';

  @override
  String get chatWallpaperReplace => 'تغيير الصورة';

  @override
  String get chatWallpaperRemove => 'إزالة الصورة';

  @override
  String get teacherProfileTitle => 'الملف المهني للمعلم';

  @override
  String get teacherProfileSettingsEntry => 'الملف المهني';

  @override
  String get teacherProfileSettingsSubtitle => 'ما تقرؤه الأسر عنك';

  @override
  String get teacherProfileAboutSection => 'نبذة';

  @override
  String get teacherProfileBioLabel => 'نبذة تعريفية';

  @override
  String get teacherProfileBioHint => 'تعريف موجز للأسر.';

  @override
  String get teacherProfileProfessionalSection => 'المعلومات المهنية';

  @override
  String get teacherProfileSpecializationLabel => 'التخصص';

  @override
  String get teacherProfileQualificationsLabel => 'المؤهلات';

  @override
  String get teacherProfileExperienceLabel => 'الخبرة';

  @override
  String get teacherProfileLanguagesLabel => 'اللغات';

  @override
  String get teacherProfileLanguagesHint => 'افصل بين اللغات بفاصلة.';

  @override
  String get teacherProfileCertificatesSection => 'الشهادات';

  @override
  String get teacherProfileCertificatesEmpty => 'لا توجد شهادات بعد.';

  @override
  String get teacherProfileAddCertificate => 'إضافة شهادة';

  @override
  String get teacherProfileCertificateTitleLabel => 'اسم الشهادة';

  @override
  String get teacherProfileCertificateIssuerLabel => 'الجهة المانحة';

  @override
  String get teacherProfileCertificateYearLabel => 'سنة الإصدار';

  @override
  String get teacherProfileCertificateFile => 'اختيار ملف';

  @override
  String teacherProfileCertificateFileChosen(String name) {
    return '$name جاهز للرفع';
  }

  @override
  String get teacherProfileCertificateUploading => 'جارٍ الرفع…';

  @override
  String get teacherProfileCertificateOpen => 'فتح';

  @override
  String get teacherProfileCertificateRemove => 'حذف';

  @override
  String get teacherProfileCertificateRemoveTitle => 'حذف هذه الشهادة؟';

  @override
  String get teacherProfileCertificateRemoveBody =>
      'ستُزال من ملفك، ويُحذف الملف المرفوع.';

  @override
  String get teacherProfileCertificatePending => 'بانتظار المراجعة';

  @override
  String get teacherProfileCertificateApproved => 'معتمدة';

  @override
  String get teacherProfileCertificateRejected => 'غير مقبولة';

  @override
  String get teacherProfileSave => 'حفظ';

  @override
  String get teacherProfileSaving => 'جارٍ الحفظ…';

  @override
  String get teacherProfileSaved => 'تم الحفظ';

  @override
  String get teacherProfileEmptyTitle => 'أنشئ ملفك المهني';

  @override
  String get teacherProfileEmptyBody =>
      'عرِّف الأسر بخبرتك. يتم حفظ تعديلاتك وتظهر فوراً.';

  @override
  String get teacherProfileUnavailable => 'ملفك المهني غير متاح الآن.';

  @override
  String get teacherProfileCertificateTitleRequired => 'أدخل اسم الشهادة.';

  @override
  String get teacherProfileCertificateFileRequired => 'اختر ملفًا أولًا.';

  @override
  String get teacherProfileCertificateBadType => 'اختر ملف PDF أو JPEG أو PNG.';

  @override
  String get teacherProfileCertificateTooLarge =>
      'حجم الملف أكبر من ١٠ ميجابايت.';

  @override
  String get teacherProfileCertificateEdit => 'تعديل';

  @override
  String get teacherProfileCertificateEditTitle => 'تعديل الشهادة';

  @override
  String get teacherProfileCertificateEditNote =>
      'تعديل البيانات يُعيد إرسال الشهادة للمراجعة. الملف نفسه لا يتغير.';

  @override
  String get teacherProfileNameLabel => 'اسمك';

  @override
  String get teacherProfileNameSave => 'حفظ الاسم';

  @override
  String get teacherProfileNameSaved => 'تم حفظ الاسم';

  @override
  String get teacherProfileNameRequired => 'أدخل اسمك.';

  @override
  String get teacherProfilePhotoChoose => 'صورة الملف';

  @override
  String get teacherProfilePhotoReplace => 'تغيير الصورة';

  @override
  String get teacherProfilePhotoRemove => 'إزالة الصورة';

  @override
  String get teacherProfilePhotoRemoveTitle => 'إزالة صورتك؟';

  @override
  String get teacherProfilePhotoRemoveBody =>
      'سيظهر ملفك بالأحرف الأولى من اسمك بدلاً من الصورة.';

  @override
  String get teacherProfilePhotoUploading => 'جارٍ رفع الصورة…';

  @override
  String get teacherProfileCertificateSave => 'حفظ الشهادة';

  @override
  String get myProfileTitle => 'ملفي الشخصي';

  @override
  String get myProfileSettingsSubtitle => 'صورتك واسمك ونبذتك';

  @override
  String get profileAboutLabel => 'نبذة';

  @override
  String get profileAboutHint => 'نبذة قصيرة عنك';

  @override
  String get profileAboutEmpty => 'لا توجد نبذة بعد';

  @override
  String get profileNameLabel => 'الاسم';

  @override
  String get profileNameEmptyError => 'يُرجى إدخال الاسم';

  @override
  String get profileNameTooLongError => 'الاسم طويل جدًا';

  @override
  String get profileAboutTooLongError => 'النص طويل جدًا';

  @override
  String get profileEdit => 'تعديل';

  @override
  String get profileSave => 'حفظ';

  @override
  String get profileCancel => 'إلغاء';

  @override
  String get profileSaved => 'تم الحفظ';

  @override
  String get profileSaveFailed => 'تعذّر الحفظ. يُرجى المحاولة مرة أخرى.';

  @override
  String get profilePhotoRemoveFailed =>
      'تعذّر إزالة الصورة. يُرجى المحاولة مرة أخرى.';

  @override
  String get profilePhotoEditLabel => 'تغيير صورتك';

  @override
  String profileChildPhotoEditLabel(String name) {
    return 'تغيير صورة $name';
  }

  @override
  String profileChildEditTitle(String name) {
    return 'ملف $name';
  }

  @override
  String get profileLoadFailed => 'تعذّر تحميل ملفك الشخصي.';

  @override
  String get ticketReportChoose => 'ماذا حدث في هذه الحصة؟';

  @override
  String get ticketReportAttended => 'حضر الطالب';

  @override
  String get ticketReportNotAttended => 'لم يحضر الطالب';

  @override
  String get ticketAbsenceConfirm =>
      'سيُبلَّغ أعضاء المجموعة بأن الطالب لم يحضر هذه الحصة.';

  @override
  String get reportLessonNumberLabel => 'رقم الحصة';

  @override
  String get reportTopicsLabel => 'ماذا تعلّم الطالب؟';

  @override
  String get reportDetailsLabel => 'تفاصيل (اختياري، باختصار)';

  @override
  String get reportPerformanceLabel => 'مستوى الأداء في هذه الحصة';

  @override
  String get reportNextLabel => 'المطلوب للحصة القادمة';

  @override
  String get reportHomeworkDetailsLabel => 'تفاصيل الواجب (اختياري)';

  @override
  String get reportPrivateNoteLabel => 'ملاحظة خاصة (للمشرفين فقط)';

  @override
  String get reportNeedsCovered => 'اختر موضوعًا أو اكتب سطرًا قصيرًا.';

  @override
  String get reportEdit => 'تعديل التقرير';

  @override
  String get reportUpdated => 'تم تحديث التقرير';

  @override
  String get topicNewMemorization => 'حفظ جديد';

  @override
  String get topicRevision => 'مراجعة';

  @override
  String get topicRecitation => 'تلاوة';

  @override
  String get topicTajweed => 'أحكام التجويد';

  @override
  String get topicReading => 'قراءة';

  @override
  String get topicWriting => 'كتابة';

  @override
  String get topicGrammar => 'قواعد';

  @override
  String get topicVocabulary => 'مفردات';

  @override
  String get topicIslamicStudies => 'تربية إسلامية';

  @override
  String get topicAssessment => 'اختبار وتقييم';

  @override
  String get taskMemorizeNew => 'حفظ المقطع الجديد';

  @override
  String get taskRevisePrevious => 'مراجعة ما سبق';

  @override
  String get taskPractiseRecitation => 'التدرّب على التلاوة';

  @override
  String get taskPractiseReading => 'التدرّب على القراءة';

  @override
  String get taskWrittenHomework => 'واجب كتابي';

  @override
  String get taskPrepareNext => 'التحضير للدرس القادم';

  @override
  String get taskNothing => 'لا يوجد واجب';

  @override
  String get level5 => 'ممتاز';

  @override
  String get level4 => 'جيد جدًا';

  @override
  String get level3 => 'جيد';

  @override
  String get level2 => 'مقبول';

  @override
  String get level1 => 'يحتاج إلى متابعة';

  @override
  String get cardLessonNumber => 'رقم الحصة';

  @override
  String get cardNextLesson => 'المطلوب للحصة القادمة';

  @override
  String get cardPerformance => 'مستوى الأداء';

  @override
  String get cardCorrectedTitle => 'تم تصحيح سجل الحصة';

  @override
  String get cardCorrectedNow => 'السجل الآن';

  @override
  String get cardExcusedAfterTitle => 'عذر بعد بداية الحصة';

  @override
  String get cardReportCorrected => 'صحّحه المشرف';

  @override
  String get cardOutcomeHeld => 'حضر الطالب';

  @override
  String get cardOutcomeStudentNoShow => 'لم يحضر الطالب';

  @override
  String get cardOutcomeExcusedBefore => 'عذر للطالب قبل بداية الحصة';

  @override
  String get cardOutcomeExcusedAfter => 'عذر للطالب بعد بداية الحصة';

  @override
  String get cardOutcomeTeacherApology => 'اعتذار المعلم';

  @override
  String get cardOutcomeTeacherNoShow => 'غياب المعلم';

  @override
  String get cardOutcomeCancelled => 'ملغاة';

  @override
  String get makeupOtherTime => 'موعد آخر متفق عليه';

  @override
  String get makeupAgreedHint =>
      'سجّل الحصة التعويضية بعد الاتفاق مع الأسرة على الموعد.';

  @override
  String makeupChosen(String when) {
    return 'الموعد المختار: $when';
  }

  @override
  String get groupChildrenTitle => 'الأطفال في هذه المجموعة';

  @override
  String groupChildAge(int age) {
    String _temp0 = intl.Intl.pluralLogic(
      age,
      locale: localeName,
      other: '$age سنة',
      many: '$age سنة',
      few: '$age سنوات',
      two: 'سنتان',
      one: 'سنة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get groupChildAgeLabel => 'العمر';

  @override
  String get groupChildCourse => 'الدورة';

  @override
  String get groupChildSchedule => 'أيام ومواعيد الحصص';

  @override
  String get groupChildPackage => 'الباقة';

  @override
  String groupChildPackageLessons(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count حصة',
      many: '$count حصة',
      few: '$count حصص',
      two: 'حصتان',
      one: 'حصة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get groupChildTeacher => 'المعلم';

  @override
  String get groupChildNotSet => 'غير محدد';

  @override
  String get groupChildNoSchedule => 'لا توجد مواعيد ثابتة بعد';

  @override
  String groupChildMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes دقيقة',
      many: '$minutes دقيقة',
      few: '$minutes دقائق',
      two: 'دقيقتان',
      one: 'دقيقة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get signupOpen => 'ولي أمر جديد؟ أنشئ حسابك';

  @override
  String get signupTitle => 'إنشاء حساب ولي الأمر';

  @override
  String get signupEmailIntro =>
      'أدخل البريد الإلكتروني الذي سجّلته لدى الأكاديمية عند الاشتراك.';

  @override
  String get signupEmailLabel => 'البريد الإلكتروني';

  @override
  String get signupEmailInvalid => 'أدخل بريدًا إلكترونيًا صحيحًا.';

  @override
  String get signupSendCode => 'احصل على الرمز';

  @override
  String get signupCodeSent =>
      'سيرسل إليك مشرفك رمزًا من 6 أرقام عبر واتساب. أدخله أدناه مع كلمة المرور التي تريدها.';

  @override
  String get signupCodeLabel => 'الرمز المكوّن من 6 أرقام';

  @override
  String get signupPasswordLabel => 'كلمة مرور جديدة (8 أحرف على الأقل)';

  @override
  String get signupPasswordConfirmLabel => 'أعد كتابة كلمة المرور';

  @override
  String get signupPasswordTooShort => 'استخدم 8 أحرف على الأقل.';

  @override
  String get signupPasswordsDiffer => 'كلمتا المرور غير متطابقتين.';

  @override
  String get signupFinish => 'إنشاء الحساب';

  @override
  String get signupCodeInvalid =>
      'هذا الرمز غير صالح أو انتهت صلاحيته. اطلب رمزًا جديدًا.';

  @override
  String get signupNewCode => 'أرسل رمزًا جديدًا';

  @override
  String get signupTooMany => 'محاولات كثيرة. حاول مرة أخرى بعد دقائق.';

  @override
  String get signupFailed => 'حدث خطأ. حاول مرة أخرى.';

  @override
  String get resetOpen => 'نسيت كلمة المرور؟ لديّ رمز إعادة تعيين';

  @override
  String get resetTitle => 'تعيين كلمة مرور جديدة';

  @override
  String get resetIntro =>
      'اطلب من الأكاديمية رمزًا لمرة واحدة، ثم أدخل بيانات الدخول والرمز وكلمة مرور جديدة تختارها بنفسك. لن يعرفها أحد غيرك.';

  @override
  String get resetUsernameLabel => 'بيانات الدخول (البريد الإلكتروني)';

  @override
  String get resetUsernameRequired => 'أدخل بيانات الدخول.';

  @override
  String get resetCodeLabel => 'الرمز المكوّن من 6 أرقام';

  @override
  String get resetCodeInvalid =>
      'هذا الرمز غير صالح أو منتهي أو مستخدم من قبل. اطلب رمزًا جديدًا من الأكاديمية.';

  @override
  String get resetFinish => 'تعيين كلمة المرور';

  @override
  String get studentProfileTitle => 'ملف الطالب';

  @override
  String get studentProfileView => 'عرض الملف';

  @override
  String get studentProfileTeacher => 'المعلّم المسؤول';

  @override
  String get studentProfileSchedule => 'مواعيد الحصص';

  @override
  String studentProfileTimeZone(String zone) {
    return 'المواعيد بتوقيت $zone';
  }

  @override
  String get studentProfileNotYoursTitle => 'لا يمكنك فتح ملف هذا الطالب';

  @override
  String get studentProfileNotYoursBody => 'يراه معلّم الطالب فقط.';

  @override
  String get myPaymentsTitle => 'المدفوعات';

  @override
  String get myPaymentsSettingsSubtitle => 'أقساطك وما تم دفعه';

  @override
  String get billingPlanLabel => 'الخطة';

  @override
  String billingPlanMonths(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: 'خطة $months شهر',
      many: 'خطة $months شهرًا',
      few: 'خطة $months أشهر',
      two: 'خطة شهرين',
      one: 'خطة شهر واحد',
    );
    return '$_temp0';
  }

  @override
  String get billingNoPlan => 'لا توجد خطة';

  @override
  String get billingMethodLabel => 'طريقة الدفع';

  @override
  String get billingMethodInvoice => 'فاتورة';

  @override
  String get billingMethodBankTransfer => 'تحويل بنكي';

  @override
  String get billingNotSet => 'غير محدد';

  @override
  String get billingPaidTotal => 'المدفوع';

  @override
  String get billingOutstandingTotal => 'المتبقي';

  @override
  String get billingOverdueTotal => 'منه متأخر';

  @override
  String get billingInstalmentsTitle => 'الأقساط';

  @override
  String get billingStatusOverdue => 'متأخر';

  @override
  String get billingStatusDue => 'مستحق اليوم';

  @override
  String get billingStatusUpcoming => 'قادم';

  @override
  String get billingStatusPaid => 'مدفوع';

  @override
  String get billingFamily => 'العائلة';

  @override
  String billingDueOn(String date) {
    return 'يستحق في $date';
  }

  @override
  String billingPaidOn(String date, String method) {
    return 'دُفع في $date · $method';
  }

  @override
  String billingPaidOnNoMethod(String date) {
    return 'دُفع في $date';
  }

  @override
  String billingDaysLate(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'متأخر $days يوم',
      many: 'متأخر $days يومًا',
      few: 'متأخر $days أيام',
      two: 'متأخر يومين',
      one: 'متأخر يومًا واحدًا',
    );
    return '$_temp0';
  }

  @override
  String billingDaysUntil(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'بعد $days يوم',
      many: 'بعد $days يومًا',
      few: 'بعد $days أيام',
      two: 'بعد يومين',
      one: 'بعد يوم واحد',
    );
    return '$_temp0';
  }

  @override
  String get billingEmptyTitle => 'لا توجد مدفوعات بعد';

  @override
  String get billingEmptyBody => 'ستظهر أقساطك هنا.';

  @override
  String get billingDeniedTitle => 'تظهر المدفوعات لأولياء أمور الأسرة';

  @override
  String get billingDeniedBody => 'إن كان لديك سؤال، تواصل مع الأكاديمية.';

  @override
  String get tabPayments => 'المدفوعات';

  @override
  String get roleSales => 'المبيعات';

  @override
  String get roleSuperAdmin => 'المدير العام';

  @override
  String get conversationsEmptyBodySales =>
      'ستظهر هنا مجموعات الحصص التجريبية ومحادثاتك.';

  @override
  String get internalNoteLabel => 'ملاحظة داخلية';

  @override
  String get trialGroupNotMember => 'لست عضوًا في هذه المجموعة بعد.';

  @override
  String get trialGroupJoin => 'انضم إلى هذه المجموعة';

  @override
  String get salesSearchHint => 'ابحث عن ولي أمر أو عائلة';

  @override
  String get salesSearchEmpty => 'لم يُعثر على أولياء أمور';

  @override
  String get salesSearchTruncated =>
      'تُعرض أولى النتائج فقط. اكتب المزيد لتضييق البحث.';

  @override
  String salesChildrenCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ابن',
      many: '$count ابنًا',
      few: '$count أبناء',
      two: 'ابنان',
      one: 'ابن واحد',
      zero: 'لا أبناء',
    );
    return '$_temp0';
  }

  @override
  String get salesPaymentsDenied => 'المدفوعات غير متاحة لحسابك.';

  @override
  String get billingCurrencyLabel => 'العملة';

  @override
  String get billingStatusVoided => 'ملغى';

  @override
  String salesPaidRecordedBy(String date, String method, String name) {
    return 'دُفع في $date · $method · سجّله $name';
  }

  @override
  String salesVoidedBy(String name, String reason) {
    return 'ألغاه $name: $reason';
  }

  @override
  String salesVoidedReason(String reason) {
    return 'أُلغي: $reason';
  }

  @override
  String get salesRecordPayment => 'تسجيل دفعة';

  @override
  String get salesVoid => 'إلغاء';

  @override
  String get salesPaidOnLabel => 'تاريخ الدفع';

  @override
  String get salesReferenceLabel => 'المرجع (اختياري)';

  @override
  String get salesRecordSave => 'تسجيل';

  @override
  String get salesVoidTitle => 'إلغاء هذا القسط؟';

  @override
  String get salesVoidFinal => 'الإلغاء نهائي: لا يمكن دفع هذا القسط بعد ذلك.';

  @override
  String get salesVoidReasonLabel => 'السبب';

  @override
  String get salesVoidConfirm => 'إلغاء القسط';

  @override
  String get salesBillingStateConflict =>
      'سبق دفع هذا القسط أو إلغاؤه. تم تحديث القائمة.';

  @override
  String get salesBillingInvalid => 'تحقّق من التاريخ والمرجع ثم حاول مجددًا.';

  @override
  String get salesWriteFailed => 'تعذّر الحفظ. حاول مرة أخرى.';

  @override
  String get settingsDateTime => 'التاريخ والوقت';

  @override
  String settingsDateTimeSubtitle(String zone) {
    return 'المنطقة الزمنية: $zone';
  }

  @override
  String get timeZoneSetAutomatically => 'الضبط تلقائيًا';

  @override
  String get timeZoneAutomaticHint =>
      'يستخدم المنطقة الزمنية لهاتفك، وتتغيّر من تلقاء نفسها عند السفر.';

  @override
  String get timeZoneLabel => 'المنطقة الزمنية';

  @override
  String get timeZoneUnknown => 'غير معروفة بعد';

  @override
  String get timeZoneAppliesTo =>
      'تظهر مواعيد الحصص والتذكيرات والإشعارات بهذه المنطقة الزمنية.';

  @override
  String get timeZoneSearchHint => 'ابحث عن مدينة';

  @override
  String get timeZoneNoMatch => 'لا توجد منطقة زمنية مطابقة.';

  @override
  String get timeZoneSaveFailed =>
      'تعذّر تغيير المنطقة الزمنية. حاول مرة أخرى.';
}
