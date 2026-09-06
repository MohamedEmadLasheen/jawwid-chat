import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of L10n
/// returned by `L10n.of(context)`.
///
/// Applications need to include `L10n.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: L10n.localizationsDelegates,
///   supportedLocales: L10n.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the L10n.supportedLocales
/// property.
abstract class L10n {
  L10n(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static L10n of(BuildContext context) {
    return Localizations.of<L10n>(context, L10n)!;
  }

  static const LocalizationsDelegate<L10n> delegate = _L10nDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Jawwid'**
  String get appName;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to Jawwid'**
  String get signInTitle;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your account is created by Jawwid. There is no public sign-up.'**
  String get signInSubtitle;

  /// No description provided for @usernameLabel.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get usernameLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get passwordLabel;

  /// No description provided for @signInAction.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signInAction;

  /// No description provided for @signInFailedCredentials.
  ///
  /// In en, this message translates to:
  /// **'That username or password is not correct.'**
  String get signInFailedCredentials;

  /// No description provided for @signInFailedDisabled.
  ///
  /// In en, this message translates to:
  /// **'This account is no longer active. Please contact Jawwid.'**
  String get signInFailedDisabled;

  /// No description provided for @sessionExpiredTitle.
  ///
  /// In en, this message translates to:
  /// **'You have been signed out'**
  String get sessionExpiredTitle;

  /// No description provided for @sessionExpiredBody.
  ///
  /// In en, this message translates to:
  /// **'Your session ended. Please sign in again.'**
  String get sessionExpiredBody;

  /// No description provided for @signOutAction.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOutAction;

  /// No description provided for @signOutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of Jawwid on this device?'**
  String get signOutConfirm;

  /// No description provided for @tabChats.
  ///
  /// In en, this message translates to:
  /// **'Chats'**
  String get tabChats;

  /// No description provided for @tabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabHome;

  /// No description provided for @tabGroups.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get tabGroups;

  /// No description provided for @homeYourChildren.
  ///
  /// In en, this message translates to:
  /// **'Your children'**
  String get homeYourChildren;

  /// No description provided for @homeMessageJawwid.
  ///
  /// In en, this message translates to:
  /// **'Message Jawwid'**
  String get homeMessageJawwid;

  /// No description provided for @homeNeedsReply.
  ///
  /// In en, this message translates to:
  /// **'Needs a reply'**
  String get homeNeedsReply;

  /// No description provided for @tabCalls.
  ///
  /// In en, this message translates to:
  /// **'Calls'**
  String get tabCalls;

  /// No description provided for @tabNotifications.
  ///
  /// In en, this message translates to:
  /// **'Updates'**
  String get tabNotifications;

  /// No description provided for @tabProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get tabProfile;

  /// No description provided for @sectionJawwid.
  ///
  /// In en, this message translates to:
  /// **'Jawwid'**
  String get sectionJawwid;

  /// No description provided for @sectionStaff.
  ///
  /// In en, this message translates to:
  /// **'Jawwid team'**
  String get sectionStaff;

  /// No description provided for @sectionMyGroups.
  ///
  /// In en, this message translates to:
  /// **'My groups'**
  String get sectionMyGroups;

  /// No description provided for @sectionLearner.
  ///
  /// In en, this message translates to:
  /// **'{name}'**
  String sectionLearner(String name);

  /// No description provided for @handledBy.
  ///
  /// In en, this message translates to:
  /// **'Handled by {name}'**
  String handledBy(String name);

  /// No description provided for @conversationsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No conversations yet'**
  String get conversationsEmptyTitle;

  /// No description provided for @conversationsEmptyBodyParent.
  ///
  /// In en, this message translates to:
  /// **'When Jawwid or your child\'s group sends a message, it will appear here.'**
  String get conversationsEmptyBodyParent;

  /// No description provided for @conversationsEmptyBodyTeacher.
  ///
  /// In en, this message translates to:
  /// **'Your assigned student groups will appear here.'**
  String get conversationsEmptyBodyTeacher;

  /// No description provided for @conversationsErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not load your chats'**
  String get conversationsErrorTitle;

  /// No description provided for @unreadCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 unread message} other{{count} unread messages}}'**
  String unreadCount(int count);

  /// No description provided for @pinAction.
  ///
  /// In en, this message translates to:
  /// **'Pin'**
  String get pinAction;

  /// No description provided for @unpinAction.
  ///
  /// In en, this message translates to:
  /// **'Unpin'**
  String get unpinAction;

  /// No description provided for @muteAction.
  ///
  /// In en, this message translates to:
  /// **'Mute'**
  String get muteAction;

  /// No description provided for @unmuteAction.
  ///
  /// In en, this message translates to:
  /// **'Unmute'**
  String get unmuteAction;

  /// No description provided for @archiveAction.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get archiveAction;

  /// No description provided for @unarchiveAction.
  ///
  /// In en, this message translates to:
  /// **'Unarchive'**
  String get unarchiveAction;

  /// No description provided for @archivedLabel.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get archivedLabel;

  /// No description provided for @mutedLabel.
  ///
  /// In en, this message translates to:
  /// **'Muted'**
  String get mutedLabel;

  /// No description provided for @composerHint.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get composerHint;

  /// No description provided for @composerSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get composerSend;

  /// No description provided for @composerAttach.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get composerAttach;

  /// No description provided for @composerRecord.
  ///
  /// In en, this message translates to:
  /// **'Record a voice note'**
  String get composerRecord;

  /// No description provided for @composerRecording.
  ///
  /// In en, this message translates to:
  /// **'Recording'**
  String get composerRecording;

  /// No description provided for @composerSlideToCancel.
  ///
  /// In en, this message translates to:
  /// **'Slide to cancel'**
  String get composerSlideToCancel;

  /// No description provided for @composerReadOnly.
  ///
  /// In en, this message translates to:
  /// **'You can no longer send messages here.'**
  String get composerReadOnly;

  /// No description provided for @messageStateSending.
  ///
  /// In en, this message translates to:
  /// **'Sending'**
  String get messageStateSending;

  /// No description provided for @messageStateSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get messageStateSent;

  /// No description provided for @messageStateDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get messageStateDelivered;

  /// No description provided for @messageStateRead.
  ///
  /// In en, this message translates to:
  /// **'Read'**
  String get messageStateRead;

  /// No description provided for @messageStateFailed.
  ///
  /// In en, this message translates to:
  /// **'Not sent'**
  String get messageStateFailed;

  /// No description provided for @messageStatePendingApproval.
  ///
  /// In en, this message translates to:
  /// **'Pending approval'**
  String get messageStatePendingApproval;

  /// No description provided for @messageStateRejected.
  ///
  /// In en, this message translates to:
  /// **'Not approved'**
  String get messageStateRejected;

  /// No description provided for @messageRejectedReason.
  ///
  /// In en, this message translates to:
  /// **'Not approved: {reason}'**
  String messageRejectedReason(String reason);

  /// No description provided for @messageDeleted.
  ///
  /// In en, this message translates to:
  /// **'This message was deleted'**
  String get messageDeleted;

  /// No description provided for @messageRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get messageRetry;

  /// No description provided for @messageDiscard.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get messageDiscard;

  /// No description provided for @messageQueuedOffline.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a connection'**
  String get messageQueuedOffline;

  /// No description provided for @replyAction.
  ///
  /// In en, this message translates to:
  /// **'Reply'**
  String get replyAction;

  /// No description provided for @replyingTo.
  ///
  /// In en, this message translates to:
  /// **'Replying to {name}'**
  String replyingTo(String name);

  /// No description provided for @reactAction.
  ///
  /// In en, this message translates to:
  /// **'React'**
  String get reactAction;

  /// No description provided for @copyAction.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copyAction;

  /// No description provided for @typingSingle.
  ///
  /// In en, this message translates to:
  /// **'{name} is typing…'**
  String typingSingle(String name);

  /// No description provided for @typingMany.
  ///
  /// In en, this message translates to:
  /// **'Several people are typing…'**
  String get typingMany;

  /// No description provided for @loadingOlder.
  ///
  /// In en, this message translates to:
  /// **'Loading earlier messages…'**
  String get loadingOlder;

  /// No description provided for @loadOlderFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load earlier messages.'**
  String get loadOlderFailed;

  /// No description provided for @messagesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No messages yet'**
  String get messagesEmptyTitle;

  /// No description provided for @messagesEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Say hello to start the conversation.'**
  String get messagesEmptyBody;

  /// No description provided for @groupMembersTitle.
  ///
  /// In en, this message translates to:
  /// **'Members'**
  String get groupMembersTitle;

  /// No description provided for @groupMemberRoleParent.
  ///
  /// In en, this message translates to:
  /// **'Parent'**
  String get groupMemberRoleParent;

  /// No description provided for @groupMemberRoleTeacher.
  ///
  /// In en, this message translates to:
  /// **'Teacher'**
  String get groupMemberRoleTeacher;

  /// No description provided for @groupMemberRoleAdmin.
  ///
  /// In en, this message translates to:
  /// **'Jawwid'**
  String get groupMemberRoleAdmin;

  /// No description provided for @groupApprovalNotice.
  ///
  /// In en, this message translates to:
  /// **'Messages here are reviewed by Jawwid before everyone sees them.'**
  String get groupApprovalNotice;

  /// No description provided for @callVoice.
  ///
  /// In en, this message translates to:
  /// **'Voice call'**
  String get callVoice;

  /// No description provided for @callGroup.
  ///
  /// In en, this message translates to:
  /// **'Group call'**
  String get callGroup;

  /// No description provided for @callIncoming.
  ///
  /// In en, this message translates to:
  /// **'Incoming call'**
  String get callIncoming;

  /// No description provided for @callConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting…'**
  String get callConnecting;

  /// No description provided for @callReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting…'**
  String get callReconnecting;

  /// No description provided for @callAccept.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get callAccept;

  /// No description provided for @callDecline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get callDecline;

  /// No description provided for @callEnd.
  ///
  /// In en, this message translates to:
  /// **'End'**
  String get callEnd;

  /// No description provided for @callMute.
  ///
  /// In en, this message translates to:
  /// **'Mute'**
  String get callMute;

  /// No description provided for @callUnmute.
  ///
  /// In en, this message translates to:
  /// **'Unmute'**
  String get callUnmute;

  /// No description provided for @callSpeaker.
  ///
  /// In en, this message translates to:
  /// **'Speaker'**
  String get callSpeaker;

  /// No description provided for @callHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Calls'**
  String get callHistoryTitle;

  /// No description provided for @callHistoryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No calls yet'**
  String get callHistoryEmpty;

  /// No description provided for @callOutcomeAnswered.
  ///
  /// In en, this message translates to:
  /// **'Answered'**
  String get callOutcomeAnswered;

  /// No description provided for @callOutcomeMissed.
  ///
  /// In en, this message translates to:
  /// **'Missed'**
  String get callOutcomeMissed;

  /// No description provided for @callOutcomeDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get callOutcomeDeclined;

  /// No description provided for @callDuration.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m {seconds}s'**
  String callDuration(int minutes, int seconds);

  /// No description provided for @callFailedMicrophone.
  ///
  /// In en, this message translates to:
  /// **'Jawwid needs microphone access to make calls.'**
  String get callFailedMicrophone;

  /// No description provided for @callFailedNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'This call is not available.'**
  String get callFailedNotAllowed;

  /// No description provided for @callFailedNetwork.
  ///
  /// In en, this message translates to:
  /// **'The call could not connect. Check your connection and try again.'**
  String get callFailedNetwork;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Updates'**
  String get notificationsTitle;

  /// No description provided for @notificationsEmpty.
  ///
  /// In en, this message translates to:
  /// **'You are all caught up'**
  String get notificationsEmpty;

  /// No description provided for @notificationPermissionTitle.
  ///
  /// In en, this message translates to:
  /// **'Turn on notifications'**
  String get notificationPermissionTitle;

  /// No description provided for @notificationPermissionBody.
  ///
  /// In en, this message translates to:
  /// **'Jawwid uses notifications for class reminders, messages, and calls.'**
  String get notificationPermissionBody;

  /// No description provided for @notificationPermissionAction.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get notificationPermissionAction;

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileTitle;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsLanguageArabic.
  ///
  /// In en, this message translates to:
  /// **'العربية'**
  String get settingsLanguageArabic;

  /// No description provided for @settingsLanguageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLanguageEnglish;

  /// No description provided for @settingsLanguageSystem.
  ///
  /// In en, this message translates to:
  /// **'Follow device'**
  String get settingsLanguageSystem;

  /// No description provided for @settingsNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get settingsNotifications;

  /// No description provided for @settingsDevices.
  ///
  /// In en, this message translates to:
  /// **'Active devices'**
  String get settingsDevices;

  /// No description provided for @devicesThisDevice.
  ///
  /// In en, this message translates to:
  /// **'This device'**
  String get devicesThisDevice;

  /// No description provided for @devicesLastActive.
  ///
  /// In en, this message translates to:
  /// **'Last active {when}'**
  String devicesLastActive(String when);

  /// No description provided for @devicesSignOutOther.
  ///
  /// In en, this message translates to:
  /// **'Sign out this device'**
  String get devicesSignOutOther;

  /// No description provided for @searchHint.
  ///
  /// In en, this message translates to:
  /// **'Search your chats'**
  String get searchHint;

  /// No description provided for @searchEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing matched your search'**
  String get searchEmpty;

  /// No description provided for @retryAction.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retryAction;

  /// No description provided for @cancelAction.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancelAction;

  /// No description provided for @okAction.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get okAction;

  /// No description provided for @closeAction.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get closeAction;

  /// No description provided for @errorNetworkTitle.
  ///
  /// In en, this message translates to:
  /// **'No connection'**
  String get errorNetworkTitle;

  /// No description provided for @errorNetworkBody.
  ///
  /// In en, this message translates to:
  /// **'Check your internet connection and try again.'**
  String get errorNetworkBody;

  /// No description provided for @errorTimeoutTitle.
  ///
  /// In en, this message translates to:
  /// **'This is taking too long'**
  String get errorTimeoutTitle;

  /// No description provided for @errorServerTitle.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get errorServerTitle;

  /// No description provided for @errorServerBody.
  ///
  /// In en, this message translates to:
  /// **'Please try again in a moment.'**
  String get errorServerBody;

  /// No description provided for @errorForbiddenTitle.
  ///
  /// In en, this message translates to:
  /// **'Not available'**
  String get errorForbiddenTitle;

  /// No description provided for @errorForbiddenBody.
  ///
  /// In en, this message translates to:
  /// **'You do not have access to this.'**
  String get errorForbiddenBody;

  /// No description provided for @errorNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Not found'**
  String get errorNotFoundTitle;

  /// No description provided for @errorNotFoundBody.
  ///
  /// In en, this message translates to:
  /// **'This is no longer available.'**
  String get errorNotFoundBody;

  /// No description provided for @todayLabel.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get todayLabel;

  /// No description provided for @yesterdayLabel.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get yesterdayLabel;
}

class _L10nDelegate extends LocalizationsDelegate<L10n> {
  const _L10nDelegate();

  @override
  Future<L10n> load(Locale locale) {
    return SynchronousFuture<L10n>(lookupL10n(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_L10nDelegate old) => false;
}

L10n lookupL10n(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return L10nAr();
    case 'en':
      return L10nEn();
  }

  throw FlutterError(
    'L10n.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
