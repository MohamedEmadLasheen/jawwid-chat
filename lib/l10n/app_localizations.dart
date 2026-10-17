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

  /// No description provided for @signInFailedLocked.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Try again in a few minutes.'**
  String get signInFailedLocked;

  /// No description provided for @signInFailedRoleUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This account cannot sign in to the Jawwid app. Staff accounts use the Jawwid console.'**
  String get signInFailedRoleUnsupported;

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

  /// No description provided for @sessionUnreachableBody.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach Jawwid to open your session. You\'re still signed in — check your connection and try again.'**
  String get sessionUnreachableBody;

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

  /// No description provided for @tabCalls.
  ///
  /// In en, this message translates to:
  /// **'Calls'**
  String get tabCalls;

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

  /// No description provided for @voiceRecordingInProgress.
  ///
  /// In en, this message translates to:
  /// **'Recording a voice message'**
  String get voiceRecordingInProgress;

  /// No description provided for @voiceRecordingElapsed.
  ///
  /// In en, this message translates to:
  /// **'{duration} recorded'**
  String voiceRecordingElapsed(String duration);

  /// No description provided for @voiceStopRecording.
  ///
  /// In en, this message translates to:
  /// **'Stop recording'**
  String get voiceStopRecording;

  /// No description provided for @voiceDeleteRecording.
  ///
  /// In en, this message translates to:
  /// **'Delete recording'**
  String get voiceDeleteRecording;

  /// No description provided for @voiceReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Review your voice message'**
  String get voiceReviewTitle;

  /// No description provided for @voiceSendRecording.
  ///
  /// In en, this message translates to:
  /// **'Send voice message'**
  String get voiceSendRecording;

  /// No description provided for @voicePlay.
  ///
  /// In en, this message translates to:
  /// **'Play'**
  String get voicePlay;

  /// No description provided for @voicePause.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get voicePause;

  /// No description provided for @voiceReplay.
  ///
  /// In en, this message translates to:
  /// **'Play again'**
  String get voiceReplay;

  /// No description provided for @voiceMessageLabel.
  ///
  /// In en, this message translates to:
  /// **'Voice message'**
  String get voiceMessageLabel;

  /// No description provided for @voiceMessageDuration.
  ///
  /// In en, this message translates to:
  /// **'Voice message, {duration}'**
  String voiceMessageDuration(String duration);

  /// No description provided for @voiceLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading audio…'**
  String get voiceLoading;

  /// No description provided for @voicePlaybackFailed.
  ///
  /// In en, this message translates to:
  /// **'This voice message could not be played.'**
  String get voicePlaybackFailed;

  /// No description provided for @voiceUploading.
  ///
  /// In en, this message translates to:
  /// **'Sending voice message'**
  String get voiceUploading;

  /// No description provided for @voicePermissionDeniedTitle.
  ///
  /// In en, this message translates to:
  /// **'Microphone access is off'**
  String get voicePermissionDeniedTitle;

  /// No description provided for @voicePermissionDeniedBody.
  ///
  /// In en, this message translates to:
  /// **'Allow microphone access in your device settings to record a voice message.'**
  String get voicePermissionDeniedBody;

  /// No description provided for @voiceUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This device cannot record voice messages.'**
  String get voiceUnsupported;

  /// No description provided for @voiceTooShort.
  ///
  /// In en, this message translates to:
  /// **'Hold longer to record a voice message.'**
  String get voiceTooShort;

  /// No description provided for @voiceRecordingFailed.
  ///
  /// In en, this message translates to:
  /// **'The recording could not be completed. Please try again.'**
  String get voiceRecordingFailed;

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

  /// No description provided for @callOutgoing.
  ///
  /// In en, this message translates to:
  /// **'Calling…'**
  String get callOutgoing;

  /// No description provided for @callEnded.
  ///
  /// In en, this message translates to:
  /// **'Call ended'**
  String get callEnded;

  /// No description provided for @callSendMessageInstead.
  ///
  /// In en, this message translates to:
  /// **'Send a message instead'**
  String get callSendMessageInstead;

  /// No description provided for @callNoAnswer.
  ///
  /// In en, this message translates to:
  /// **'No answer'**
  String get callNoAnswer;

  /// No description provided for @callMissedIncoming.
  ///
  /// In en, this message translates to:
  /// **'Missed call'**
  String get callMissedIncoming;

  /// No description provided for @callAgain.
  ///
  /// In en, this message translates to:
  /// **'Call again'**
  String get callAgain;

  /// No description provided for @callRecordVoice.
  ///
  /// In en, this message translates to:
  /// **'Record voice message'**
  String get callRecordVoice;

  /// No description provided for @callMessage.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get callMessage;

  /// No description provided for @callVoiceTitle.
  ///
  /// In en, this message translates to:
  /// **'Jawwid voice call'**
  String get callVoiceTitle;

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

  /// No description provided for @settingsAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// No description provided for @settingsAppearanceAuto.
  ///
  /// In en, this message translates to:
  /// **'Auto'**
  String get settingsAppearanceAuto;

  /// No description provided for @settingsAppearanceLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsAppearanceLight;

  /// No description provided for @settingsAppearanceDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsAppearanceDark;

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

  /// No description provided for @filterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get filterAll;

  /// No description provided for @filterUnread.
  ///
  /// In en, this message translates to:
  /// **'Unread'**
  String get filterUnread;

  /// No description provided for @filterGroups.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get filterGroups;

  /// No description provided for @filterFavorites.
  ///
  /// In en, this message translates to:
  /// **'Favourites'**
  String get filterFavorites;

  /// No description provided for @filterEmptyUnread.
  ///
  /// In en, this message translates to:
  /// **'Nothing unread'**
  String get filterEmptyUnread;

  /// No description provided for @filterEmptyUnreadBody.
  ///
  /// In en, this message translates to:
  /// **'You have read everything. New messages will appear here.'**
  String get filterEmptyUnreadBody;

  /// No description provided for @filterEmptyGroups.
  ///
  /// In en, this message translates to:
  /// **'No student groups yet'**
  String get filterEmptyGroups;

  /// No description provided for @filterEmptyFavorites.
  ///
  /// In en, this message translates to:
  /// **'No favourites yet'**
  String get filterEmptyFavorites;

  /// No description provided for @filterEmptyFavoritesBody.
  ///
  /// In en, this message translates to:
  /// **'Press and hold a conversation to add it to your favourites.'**
  String get filterEmptyFavoritesBody;

  /// No description provided for @favoriteAction.
  ///
  /// In en, this message translates to:
  /// **'Add to favourites'**
  String get favoriteAction;

  /// No description provided for @unfavoriteAction.
  ///
  /// In en, this message translates to:
  /// **'Remove from favourites'**
  String get unfavoriteAction;

  /// No description provided for @favoriteLabel.
  ///
  /// In en, this message translates to:
  /// **'Favourite'**
  String get favoriteLabel;

  /// No description provided for @searchClear.
  ///
  /// In en, this message translates to:
  /// **'Clear search'**
  String get searchClear;

  /// No description provided for @searchEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Search covers conversation and group names.'**
  String get searchEmptyBody;

  /// No description provided for @archivedShow.
  ///
  /// In en, this message translates to:
  /// **'Show archived'**
  String get archivedShow;

  /// No description provided for @archivedHide.
  ///
  /// In en, this message translates to:
  /// **'Hide archived'**
  String get archivedHide;

  /// No description provided for @callHistoryEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Calls you take part in will appear here.'**
  String get callHistoryEmptyBody;

  /// No description provided for @callsUnavailableTitle.
  ///
  /// In en, this message translates to:
  /// **'Calls are not available yet'**
  String get callsUnavailableTitle;

  /// No description provided for @callsUnavailableBody.
  ///
  /// In en, this message translates to:
  /// **'Calling has not been switched on for this app yet. Nothing is missing from your account.'**
  String get callsUnavailableBody;

  /// No description provided for @conversationActionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Conversation options'**
  String get conversationActionsTitle;

  /// No description provided for @groupInfoTitle.
  ///
  /// In en, this message translates to:
  /// **'Group info'**
  String get groupInfoTitle;

  /// No description provided for @groupLearnerLabel.
  ///
  /// In en, this message translates to:
  /// **'Student'**
  String get groupLearnerLabel;

  /// No description provided for @groupMemberUnresolved.
  ///
  /// In en, this message translates to:
  /// **'Member'**
  String get groupMemberUnresolved;

  /// No description provided for @memberMessageAction.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get memberMessageAction;

  /// No description provided for @myAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'My account'**
  String get myAccountTitle;

  /// No description provided for @childrenTitle.
  ///
  /// In en, this message translates to:
  /// **'Children'**
  String get childrenTitle;

  /// No description provided for @childGroupLabel.
  ///
  /// In en, this message translates to:
  /// **'Group'**
  String get childGroupLabel;

  /// No description provided for @childTeacherLabel.
  ///
  /// In en, this message translates to:
  /// **'Teacher'**
  String get childTeacherLabel;

  /// No description provided for @childLevelLabel.
  ///
  /// In en, this message translates to:
  /// **'Level'**
  String get childLevelLabel;

  /// No description provided for @childSubscriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Subscription'**
  String get childSubscriptionLabel;

  /// No description provided for @childScheduleLabel.
  ///
  /// In en, this message translates to:
  /// **'Schedule'**
  String get childScheduleLabel;

  /// No description provided for @childrenEmpty.
  ///
  /// In en, this message translates to:
  /// **'No children are linked to your account yet.'**
  String get childrenEmpty;

  /// No description provided for @contactInfoTitle.
  ///
  /// In en, this message translates to:
  /// **'Contact information'**
  String get contactInfoTitle;

  /// No description provided for @contactInfoUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Jawwid does not hold phone numbers or email addresses in this app yet.'**
  String get contactInfoUnavailable;

  /// No description provided for @fieldNotAvailableYet.
  ///
  /// In en, this message translates to:
  /// **'Not available yet'**
  String get fieldNotAvailableYet;

  /// No description provided for @profileNoDirectContact.
  ///
  /// In en, this message translates to:
  /// **'You can reach the teacher in your child\'s group.'**
  String get profileNoDirectContact;

  /// Header of the long-press sheet on a message.
  ///
  /// In en, this message translates to:
  /// **'Message options'**
  String get messageActionsTitle;

  /// Opens the choice between deleting for me and for everyone.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get deleteAction;

  /// Hides a message for this user only.
  ///
  /// In en, this message translates to:
  /// **'Delete for me'**
  String get deleteForMeAction;

  /// Retracts a message for every member of the conversation.
  ///
  /// In en, this message translates to:
  /// **'Delete for everyone'**
  String get deleteForEveryoneAction;

  /// Explains that delete-for-me is private to this reader.
  ///
  /// In en, this message translates to:
  /// **'It stays visible to everyone else.'**
  String get deleteForMeExplainer;

  /// Explains that delete-for-everyone retracts the message.
  ///
  /// In en, this message translates to:
  /// **'Removed from the conversation for everyone.'**
  String get deleteForEveryoneExplainer;

  /// Brief confirmation after copying a message.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get copiedConfirmation;

  /// Opens an attachment.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get openAction;

  /// Saves an attachment to the device.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get saveAction;

  /// No description provided for @attachCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get attachCamera;

  /// Attachment menu entry for the photo library.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get attachPhoto;

  /// Attachment menu entry for a document.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get attachFile;

  /// Stands in for a photo where a message has no text.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get attachmentPhotoLabel;

  /// Stands in for a document where a message has no text.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get attachmentFileLabel;

  /// Stands in for a voice note where a message has no text.
  ///
  /// In en, this message translates to:
  /// **'Voice message'**
  String get attachmentVoiceLabel;

  /// Stands in for a video where a message has no text (chat list preview).
  ///
  /// In en, this message translates to:
  /// **'Video'**
  String get attachmentVideoLabel;

  /// Header of the preview shown before an attachment is sent.
  ///
  /// In en, this message translates to:
  /// **'Send this?'**
  String get attachmentSendTitle;

  /// Shown when a chosen file is over the size the academy accepts.
  ///
  /// In en, this message translates to:
  /// **'That file is too large to send.'**
  String get attachmentTooLarge;

  /// Shown when a chosen file is not an accepted type.
  ///
  /// In en, this message translates to:
  /// **'That kind of file can\'t be sent here.'**
  String get attachmentTypeNotAllowed;

  /// Shown when the photo or file picker fails.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open that. Please try again.'**
  String get attachmentPickFailed;

  /// No description provided for @cameraPermissionDenied.
  ///
  /// In en, this message translates to:
  /// **'Jawwid needs permission to use the camera. You can allow it in Settings.'**
  String get cameraPermissionDenied;

  /// No description provided for @cameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This device has no camera available.'**
  String get cameraUnavailable;

  /// Shown when photo-library permission was refused.
  ///
  /// In en, this message translates to:
  /// **'Jawwid needs permission to open your photos. You can allow it in Settings.'**
  String get attachmentPermissionDenied;

  /// Shown when the device has no picker.
  ///
  /// In en, this message translates to:
  /// **'This device can\'t pick files.'**
  String get attachmentUnsupported;

  /// Shown on a bubble whose attachment failed to upload.
  ///
  /// In en, this message translates to:
  /// **'Unable to send the file. Please try again.'**
  String get attachmentUploadFailed;

  /// Shown while an attachment is uploading.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get attachmentUploading;

  /// Stands in for a quoted message that has not been loaded yet.
  ///
  /// In en, this message translates to:
  /// **'Original message'**
  String get replyOriginalUnavailable;

  /// Opens the shared photos, files and voice notes of a conversation.
  ///
  /// In en, this message translates to:
  /// **'Media & files'**
  String get mediaAndFilesTitle;

  /// Tab of shared photos.
  ///
  /// In en, this message translates to:
  /// **'Photos'**
  String get mediaPhotosTab;

  /// Tab of shared files.
  ///
  /// In en, this message translates to:
  /// **'Files'**
  String get mediaFilesTab;

  /// Tab of shared voice messages.
  ///
  /// In en, this message translates to:
  /// **'Voice'**
  String get mediaVoiceTab;

  /// Empty state of the media and files screen.
  ///
  /// In en, this message translates to:
  /// **'Nothing shared here yet'**
  String get mediaEmpty;

  /// Explains what the media screen will hold.
  ///
  /// In en, this message translates to:
  /// **'Photos, files and voice messages from this conversation appear here.'**
  String get mediaEmptyBody;

  /// Pages further back through a conversation to find more shared items.
  ///
  /// In en, this message translates to:
  /// **'Load older'**
  String get mediaLoadOlder;

  /// State of a muted conversation. Messages still arrive.
  ///
  /// In en, this message translates to:
  /// **'Notifications muted'**
  String get notificationsMuted;

  /// Clarifies that muting only silences notifications.
  ///
  /// In en, this message translates to:
  /// **'You still receive messages.'**
  String get notificationsMutedExplainer;

  /// Screen-reader label for a reaction chip.
  ///
  /// In en, this message translates to:
  /// **'{emoji}, {count} reactions'**
  String reactionCountSemantics(String emoji, int count);

  /// Screen-reader label for a reaction chip the viewer is part of.
  ///
  /// In en, this message translates to:
  /// **'{emoji}, including yours'**
  String reactionYoursSemantics(String emoji);

  /// File size in kilobytes.
  ///
  /// In en, this message translates to:
  /// **'{size} KB'**
  String fileSizeKb(String size);

  /// File size in megabytes.
  ///
  /// In en, this message translates to:
  /// **'{size} MB'**
  String fileSizeMb(String size);

  /// Accessible label for one ring in the stories rail.
  ///
  /// In en, this message translates to:
  /// **'Unviewed story: {label}'**
  String storyRingUnviewed(String label);

  /// Accessible label for one ring in the stories rail.
  ///
  /// In en, this message translates to:
  /// **'Viewed story: {label}'**
  String storyRingViewed(String label);

  /// No description provided for @storyClose.
  ///
  /// In en, this message translates to:
  /// **'Close story'**
  String get storyClose;

  /// No description provided for @storyPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous story'**
  String get storyPrevious;

  /// No description provided for @storyNext.
  ///
  /// In en, this message translates to:
  /// **'Next story'**
  String get storyNext;

  /// No description provided for @storyImageLabel.
  ///
  /// In en, this message translates to:
  /// **'Story image'**
  String get storyImageLabel;

  /// No description provided for @storyMediaFailed.
  ///
  /// In en, this message translates to:
  /// **'This picture could not be loaded.'**
  String get storyMediaFailed;

  /// No description provided for @storyUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This story is no longer available.'**
  String get storyUnavailable;

  /// No description provided for @storyVideoLabel.
  ///
  /// In en, this message translates to:
  /// **'Story video'**
  String get storyVideoLabel;

  /// No description provided for @storyVideoFailed.
  ///
  /// In en, this message translates to:
  /// **'This video could not be played.'**
  String get storyVideoFailed;

  /// No description provided for @storyVideoRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get storyVideoRetry;

  /// Stories viewer (2026-10-17): storyTextLabel
  ///
  /// In en, this message translates to:
  /// **'Story'**
  String get storyTextLabel;

  /// Stories viewer (2026-10-17): storyVoiceLabel
  ///
  /// In en, this message translates to:
  /// **'Voice story'**
  String get storyVoiceLabel;

  /// Stories viewer (2026-10-17): storyVoiceFailed
  ///
  /// In en, this message translates to:
  /// **'This voice note could not be played.'**
  String get storyVoiceFailed;

  /// Stories viewer (2026-10-17): storyVoicePlay
  ///
  /// In en, this message translates to:
  /// **'Play voice story'**
  String get storyVoicePlay;

  /// Stories viewer (2026-10-17): storyVoicePause
  ///
  /// In en, this message translates to:
  /// **'Pause voice story'**
  String get storyVoicePause;

  /// Stories viewer (2026-10-17): storyCtaWhatsApp
  ///
  /// In en, this message translates to:
  /// **'Chat on WhatsApp'**
  String get storyCtaWhatsApp;

  /// Stories viewer (2026-10-17): storyCtaMessage
  ///
  /// In en, this message translates to:
  /// **'Send a message'**
  String get storyCtaMessage;

  /// Stories viewer (2026-10-17): storyCtaLink
  ///
  /// In en, this message translates to:
  /// **'Learn more'**
  String get storyCtaLink;

  /// Stories viewer (2026-10-17): storyCtaFailed
  ///
  /// In en, this message translates to:
  /// **'That didn\'t open. Please try again.'**
  String get storyCtaFailed;

  /// Shown in the stories rail when the signed-in account has no live stories.
  ///
  /// In en, this message translates to:
  /// **'No stories yet'**
  String get storiesEmpty;

  /// No description provided for @storiesEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Stories published to you will appear here.'**
  String get storiesEmptyBody;

  /// A system message: the Student Group was provisioned for this learner.
  ///
  /// In en, this message translates to:
  /// **'Student Group created for {learner}'**
  String systemGroupCreated(String learner);

  /// No description provided for @systemGroupCreatedNoLearner.
  ///
  /// In en, this message translates to:
  /// **'Student Group created'**
  String get systemGroupCreatedNoLearner;

  /// No description provided for @systemGroupMembersUpdated.
  ///
  /// In en, this message translates to:
  /// **'Group members updated (+{added} / −{removed})'**
  String systemGroupMembersUpdated(int added, int removed);

  /// No description provided for @systemGroupArchived.
  ///
  /// In en, this message translates to:
  /// **'Group archived'**
  String get systemGroupArchived;

  /// No description provided for @systemUpdate.
  ///
  /// In en, this message translates to:
  /// **'System update'**
  String get systemUpdate;

  /// Section header in the + menu for lesson tickets.
  ///
  /// In en, this message translates to:
  /// **'Lesson'**
  String get lessonTicketsHeader;

  /// No description provided for @ticketReport.
  ///
  /// In en, this message translates to:
  /// **'Lesson report'**
  String get ticketReport;

  /// No description provided for @ticketAbsence.
  ///
  /// In en, this message translates to:
  /// **'Student absent'**
  String get ticketAbsence;

  /// No description provided for @ticketApology.
  ///
  /// In en, this message translates to:
  /// **'Apologise for the lesson'**
  String get ticketApology;

  /// No description provided for @ticketTeacherApology.
  ///
  /// In en, this message translates to:
  /// **'I can\'t teach this lesson'**
  String get ticketTeacherApology;

  /// No description provided for @ticketLateApology.
  ///
  /// In en, this message translates to:
  /// **'Late apology (emergency)'**
  String get ticketLateApology;

  /// Subtitle naming which lesson a ticket is for.
  ///
  /// In en, this message translates to:
  /// **'Lesson of {when}'**
  String ticketLessonAt(String when);

  /// No description provided for @reportCoveredLabel.
  ///
  /// In en, this message translates to:
  /// **'What was covered'**
  String get reportCoveredLabel;

  /// No description provided for @reportHomeworkLabel.
  ///
  /// In en, this message translates to:
  /// **'Homework (optional)'**
  String get reportHomeworkLabel;

  /// No description provided for @reportRatingLabel.
  ///
  /// In en, this message translates to:
  /// **'Rating (optional)'**
  String get reportRatingLabel;

  /// No description provided for @reportNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get reportNoteLabel;

  /// No description provided for @ticketReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get ticketReasonLabel;

  /// No description provided for @ticketAbsenceHint.
  ///
  /// In en, this message translates to:
  /// **'No apology was received and the lesson time has passed.'**
  String get ticketAbsenceHint;

  /// No description provided for @ticketLateApologyHint.
  ///
  /// In en, this message translates to:
  /// **'A supervisor will review it. Until then the lesson counts as an absence.'**
  String get ticketLateApologyHint;

  /// No description provided for @ticketTeacherApologyHint.
  ///
  /// In en, this message translates to:
  /// **'A make-up lesson will be arranged with the family.'**
  String get ticketTeacherApologyHint;

  /// No description provided for @ticketSubmit.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get ticketSubmit;

  /// No description provided for @ticketSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get ticketSent;

  /// No description provided for @ticketFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send. Please try again.'**
  String get ticketFailed;

  /// No description provided for @ticketNoLongerAllowed.
  ///
  /// In en, this message translates to:
  /// **'This lesson can no longer be updated this way.'**
  String get ticketNoLongerAllowed;

  /// No description provided for @cardReportTitle.
  ///
  /// In en, this message translates to:
  /// **'Lesson report'**
  String get cardReportTitle;

  /// No description provided for @cardAbsenceTitle.
  ///
  /// In en, this message translates to:
  /// **'Absent from the lesson'**
  String get cardAbsenceTitle;

  /// No description provided for @cardApologyTitle.
  ///
  /// In en, this message translates to:
  /// **'Apology'**
  String get cardApologyTitle;

  /// No description provided for @cardTeacherApologyTitle.
  ///
  /// In en, this message translates to:
  /// **'The teacher can\'t teach this lesson'**
  String get cardTeacherApologyTitle;

  /// No description provided for @cardCancelledTitle.
  ///
  /// In en, this message translates to:
  /// **'Lesson cancelled'**
  String get cardCancelledTitle;

  /// No description provided for @cardTeacherAbsentTitle.
  ///
  /// In en, this message translates to:
  /// **'Lesson not held — the teacher was absent'**
  String get cardTeacherAbsentTitle;

  /// No description provided for @cardLateApologyTitle.
  ///
  /// In en, this message translates to:
  /// **'Late apology'**
  String get cardLateApologyTitle;

  /// No description provided for @cardRulingExcusedTitle.
  ///
  /// In en, this message translates to:
  /// **'Apology accepted'**
  String get cardRulingExcusedTitle;

  /// No description provided for @cardRulingCreditedTitle.
  ///
  /// In en, this message translates to:
  /// **'Recorded as an absence'**
  String get cardRulingCreditedTitle;

  /// No description provided for @cardUnderReview.
  ///
  /// In en, this message translates to:
  /// **'Under review by the supervision team'**
  String get cardUnderReview;

  /// No description provided for @cardMakeupOwed.
  ///
  /// In en, this message translates to:
  /// **'A make-up lesson will be arranged.'**
  String get cardMakeupOwed;

  /// No description provided for @cardCovered.
  ///
  /// In en, this message translates to:
  /// **'Covered'**
  String get cardCovered;

  /// No description provided for @cardHomework.
  ///
  /// In en, this message translates to:
  /// **'Homework'**
  String get cardHomework;

  /// No description provided for @cardRating.
  ///
  /// In en, this message translates to:
  /// **'Rating'**
  String get cardRating;

  /// No description provided for @cardNote.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get cardNote;

  /// No description provided for @cardReason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get cardReason;

  /// No description provided for @ticketBookMakeup.
  ///
  /// In en, this message translates to:
  /// **'Book a make-up lesson'**
  String get ticketBookMakeup;

  /// No description provided for @ticketRequestScheduleChange.
  ///
  /// In en, this message translates to:
  /// **'Change regular lesson times'**
  String get ticketRequestScheduleChange;

  /// Subtitle naming the child a ticket is about.
  ///
  /// In en, this message translates to:
  /// **'For {name}'**
  String ticketFor(String name);

  /// No description provided for @makeupPickDay.
  ///
  /// In en, this message translates to:
  /// **'Choose a day'**
  String get makeupPickDay;

  /// No description provided for @makeupPickTime.
  ///
  /// In en, this message translates to:
  /// **'Choose a time'**
  String get makeupPickTime;

  /// No description provided for @makeupNoSlots.
  ///
  /// In en, this message translates to:
  /// **'No free times in the next two weeks. The supervision team will arrange the make-up.'**
  String get makeupNoSlots;

  /// No description provided for @makeupBook.
  ///
  /// In en, this message translates to:
  /// **'Book'**
  String get makeupBook;

  /// Length of the make-up lesson.
  ///
  /// In en, this message translates to:
  /// **'{minutes} minutes'**
  String makeupLength(int minutes);

  /// No description provided for @scheduleChangePick.
  ///
  /// In en, this message translates to:
  /// **'Choose the new weekly times'**
  String get scheduleChangePick;

  /// No description provided for @scheduleChangeHint.
  ///
  /// In en, this message translates to:
  /// **'The supervision team will confirm the change.'**
  String get scheduleChangeHint;

  /// No description provided for @scheduleChangeNoOptions.
  ///
  /// In en, this message translates to:
  /// **'There are no other free times right now.'**
  String get scheduleChangeNoOptions;

  /// No description provided for @scheduleChangeSend.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get scheduleChangeSend;

  /// No description provided for @ticketLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the free times. Please try again.'**
  String get ticketLoadFailed;

  /// No description provided for @cardMakeupBookedTitle.
  ///
  /// In en, this message translates to:
  /// **'Make-up lesson booked'**
  String get cardMakeupBookedTitle;

  /// No description provided for @cardMakeupResolvedTitle.
  ///
  /// In en, this message translates to:
  /// **'Missed lesson resolved'**
  String get cardMakeupResolvedTitle;

  /// No description provided for @cardMakeupActionSubstitute.
  ///
  /// In en, this message translates to:
  /// **'A substitute teacher'**
  String get cardMakeupActionSubstitute;

  /// No description provided for @cardMakeupActionCredit.
  ///
  /// In en, this message translates to:
  /// **'A credit to the family'**
  String get cardMakeupActionCredit;

  /// No description provided for @cardMakeupActionExtension.
  ///
  /// In en, this message translates to:
  /// **'The package is extended'**
  String get cardMakeupActionExtension;

  /// No description provided for @cardMakeupActionWaived.
  ///
  /// In en, this message translates to:
  /// **'No make-up needed'**
  String get cardMakeupActionWaived;

  /// No description provided for @cardScheduleRequestedTitle.
  ///
  /// In en, this message translates to:
  /// **'Request to change the regular times'**
  String get cardScheduleRequestedTitle;

  /// No description provided for @cardScheduleApprovedTitle.
  ///
  /// In en, this message translates to:
  /// **'New regular times confirmed'**
  String get cardScheduleApprovedTitle;

  /// No description provided for @cardScheduleRejectedTitle.
  ///
  /// In en, this message translates to:
  /// **'The change of regular times was not approved'**
  String get cardScheduleRejectedTitle;

  /// A regular weekly time, e.g. 'Every Monday 17:00'.
  ///
  /// In en, this message translates to:
  /// **'Every {when}'**
  String cardEveryWeek(String when);

  /// No description provided for @tabSchedule.
  ///
  /// In en, this message translates to:
  /// **'Schedule'**
  String get tabSchedule;

  /// No description provided for @scheduleEmpty.
  ///
  /// In en, this message translates to:
  /// **'No lessons in the next two weeks.'**
  String get scheduleEmpty;

  /// No description provided for @scheduleLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your schedule.'**
  String get scheduleLoadFailed;

  /// No description provided for @phaseUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get phaseUpcoming;

  /// No description provided for @phaseInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get phaseInProgress;

  /// No description provided for @phaseAwaitingClose.
  ///
  /// In en, this message translates to:
  /// **'Needs report'**
  String get phaseAwaitingClose;

  /// No description provided for @phaseOverdue.
  ///
  /// In en, this message translates to:
  /// **'Report overdue'**
  String get phaseOverdue;

  /// No description provided for @outcomeHeld.
  ///
  /// In en, this message translates to:
  /// **'Held'**
  String get outcomeHeld;

  /// No description provided for @outcomeStudentApology.
  ///
  /// In en, this message translates to:
  /// **'Student apologised'**
  String get outcomeStudentApology;

  /// No description provided for @outcomeTeacherApology.
  ///
  /// In en, this message translates to:
  /// **'Teacher apologised'**
  String get outcomeTeacherApology;

  /// No description provided for @outcomeAdminCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get outcomeAdminCancelled;

  /// No description provided for @outcomeStudentNoShow.
  ///
  /// In en, this message translates to:
  /// **'Student absent'**
  String get outcomeStudentNoShow;

  /// No description provided for @outcomeTeacherNoShow.
  ///
  /// In en, this message translates to:
  /// **'Teacher absent'**
  String get outcomeTeacherNoShow;

  /// No description provided for @outcomeRescheduled.
  ///
  /// In en, this message translates to:
  /// **'Moved'**
  String get outcomeRescheduled;

  /// No description provided for @lessonKindMakeup.
  ///
  /// In en, this message translates to:
  /// **'Make-up'**
  String get lessonKindMakeup;

  /// No description provided for @cardTransferredTitle.
  ///
  /// In en, this message translates to:
  /// **'New teacher'**
  String get cardTransferredTitle;

  /// Card telling a family who teaches their child after a transfer.
  ///
  /// In en, this message translates to:
  /// **'{teacher} will teach from now on.'**
  String cardTransferredBody(String teacher);

  /// No description provided for @cardHandoverTitle.
  ///
  /// In en, this message translates to:
  /// **'A new student'**
  String get cardHandoverTitle;

  /// No description provided for @cardHandoverFrom.
  ///
  /// In en, this message translates to:
  /// **'Previous teacher'**
  String get cardHandoverFrom;

  /// No description provided for @cardHandoverNote.
  ///
  /// In en, this message translates to:
  /// **'Handover'**
  String get cardHandoverNote;

  /// No description provided for @cardPausedTitle.
  ///
  /// In en, this message translates to:
  /// **'Lessons paused'**
  String get cardPausedTitle;

  /// Return date of a paused learner.
  ///
  /// In en, this message translates to:
  /// **'Until {date}'**
  String cardPausedUntil(String date);

  /// No description provided for @cardStoppedTitle.
  ///
  /// In en, this message translates to:
  /// **'Lessons stopped'**
  String get cardStoppedTitle;

  /// No description provided for @cardReturnSoonTitle.
  ///
  /// In en, this message translates to:
  /// **'Lessons resume soon'**
  String get cardReturnSoonTitle;

  /// The day a paused learner's lessons resume.
  ///
  /// In en, this message translates to:
  /// **'Back on {date}'**
  String cardReturnOn(String date);

  /// No description provided for @cardResumedTitle.
  ///
  /// In en, this message translates to:
  /// **'Lessons resumed'**
  String get cardResumedTitle;

  /// No description provided for @cardBonusTitle.
  ///
  /// In en, this message translates to:
  /// **'A bonus for you'**
  String get cardBonusTitle;

  /// No description provided for @progressTitle.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get progressTitle;

  /// No description provided for @progressAttended.
  ///
  /// In en, this message translates to:
  /// **'Attended'**
  String get progressAttended;

  /// No description provided for @progressApologised.
  ///
  /// In en, this message translates to:
  /// **'Apologised'**
  String get progressApologised;

  /// No description provided for @progressAbsent.
  ///
  /// In en, this message translates to:
  /// **'Absent'**
  String get progressAbsent;

  /// Consecutive lessons attended.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No streak yet} =1{1 lesson in a row} other{{count} lessons in a row}}'**
  String progressStreak(int count);

  /// All-time attended lessons.
  ///
  /// In en, this message translates to:
  /// **'{count} lessons attended in total'**
  String progressAllTime(int count);

  /// Make-up lessons the family is owed.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 make-up lesson owed} other{{count} make-up lessons owed}}'**
  String progressMakeupsOwed(int count);

  /// When the next lesson is.
  ///
  /// In en, this message translates to:
  /// **'Next lesson: {when}'**
  String progressNext(String when);

  /// What the latest report says was covered.
  ///
  /// In en, this message translates to:
  /// **'Last lesson: {covered}'**
  String progressLastCovered(String covered);

  /// No description provided for @progressCertificates.
  ///
  /// In en, this message translates to:
  /// **'Certificates will appear here.'**
  String get progressCertificates;

  /// No description provided for @progressUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Progress isn\'t available right now.'**
  String get progressUnavailable;

  /// No description provided for @workloadTitle.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get workloadTitle;

  /// Lessons held this month and their hours.
  ///
  /// In en, this message translates to:
  /// **'{lessons} lessons · {hours} h'**
  String workloadHeld(int lessons, String hours);

  /// Lessons ended without a report.
  ///
  /// In en, this message translates to:
  /// **'{count} need a report'**
  String workloadNeedsReport(int count);

  /// Share of reports submitted on time.
  ///
  /// In en, this message translates to:
  /// **'{percent} reports on time'**
  String workloadOnTime(String percent);

  /// No description provided for @supervisionChatTitle.
  ///
  /// In en, this message translates to:
  /// **'Supervision'**
  String get supervisionChatTitle;

  /// No description provided for @supervisionChatSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Teachers department · private'**
  String get supervisionChatSubtitle;

  /// No description provided for @supervisionTicketsHeader.
  ///
  /// In en, this message translates to:
  /// **'Requests'**
  String get supervisionTicketsHeader;

  /// No description provided for @ticketCertificate.
  ///
  /// In en, this message translates to:
  /// **'Request a certificate'**
  String get ticketCertificate;

  /// No description provided for @ticketLeave.
  ///
  /// In en, this message translates to:
  /// **'Request leave'**
  String get ticketLeave;

  /// No description provided for @certificateFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Request a certificate'**
  String get certificateFormTitle;

  /// No description provided for @certificateFormHint.
  ///
  /// In en, this message translates to:
  /// **'Sent privately to the Teachers department. When the certificate is issued, it is posted to the student\'s group, where you and the parents receive it.'**
  String get certificateFormHint;

  /// No description provided for @certificateStudent.
  ///
  /// In en, this message translates to:
  /// **'Student'**
  String get certificateStudent;

  /// No description provided for @certificateTitleField.
  ///
  /// In en, this message translates to:
  /// **'Certificate'**
  String get certificateTitleField;

  /// No description provided for @certificateTitleHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Juz Amma'**
  String get certificateTitleHint;

  /// No description provided for @certificateAchievement.
  ///
  /// In en, this message translates to:
  /// **'Achievement'**
  String get certificateAchievement;

  /// No description provided for @certificateAchievedOn.
  ///
  /// In en, this message translates to:
  /// **'Date achieved'**
  String get certificateAchievedOn;

  /// No description provided for @certificateGrade.
  ///
  /// In en, this message translates to:
  /// **'Grade (optional)'**
  String get certificateGrade;

  /// No description provided for @certificatePrintedName.
  ///
  /// In en, this message translates to:
  /// **'Name as it should be printed'**
  String get certificatePrintedName;

  /// No description provided for @certificateNote.
  ///
  /// In en, this message translates to:
  /// **'Note to the department (optional)'**
  String get certificateNote;

  /// No description provided for @leaveFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Request leave'**
  String get leaveFormTitle;

  /// No description provided for @leaveFormHint.
  ///
  /// In en, this message translates to:
  /// **'Sent privately to the Teachers department. Approved days are deducted from your balance.'**
  String get leaveFormHint;

  /// No description provided for @leaveFirstDay.
  ///
  /// In en, this message translates to:
  /// **'First day'**
  String get leaveFirstDay;

  /// No description provided for @leaveLastDay.
  ///
  /// In en, this message translates to:
  /// **'Last day'**
  String get leaveLastDay;

  /// No description provided for @leaveReason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get leaveReason;

  /// No description provided for @leaveDaysCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}}'**
  String leaveDaysCount(int count);

  /// No description provided for @leaveBalanceNow.
  ///
  /// In en, this message translates to:
  /// **'Your balance now: {balance}'**
  String leaveBalanceNow(String balance);

  /// No description provided for @leaveSameYear.
  ///
  /// In en, this message translates to:
  /// **'Send a separate request for each year.'**
  String get leaveSameYear;

  /// No description provided for @leaveLastBeforeFirst.
  ///
  /// In en, this message translates to:
  /// **'The last day is before the first day.'**
  String get leaveLastBeforeFirst;

  /// No description provided for @formRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get formRequired;

  /// No description provided for @formSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get formSend;

  /// No description provided for @myLeaveTitle.
  ///
  /// In en, this message translates to:
  /// **'My leave'**
  String get myLeaveTitle;

  /// No description provided for @myLeaveAllowance.
  ///
  /// In en, this message translates to:
  /// **'Allowance {year}'**
  String myLeaveAllowance(String year);

  /// No description provided for @myLeaveUsed.
  ///
  /// In en, this message translates to:
  /// **'Used'**
  String get myLeaveUsed;

  /// No description provided for @myLeaveBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance'**
  String get myLeaveBalance;

  /// No description provided for @myLeaveNoAllowance.
  ///
  /// In en, this message translates to:
  /// **'Not set yet'**
  String get myLeaveNoAllowance;

  /// No description provided for @myLeaveNoRequests.
  ///
  /// In en, this message translates to:
  /// **'No leave requests this year.'**
  String get myLeaveNoRequests;

  /// No description provided for @myLeaveRequest.
  ///
  /// In en, this message translates to:
  /// **'Request leave'**
  String get myLeaveRequest;

  /// No description provided for @myLeaveWithdraw.
  ///
  /// In en, this message translates to:
  /// **'Withdraw'**
  String get myLeaveWithdraw;

  /// No description provided for @myLeaveWithdrawConfirm.
  ///
  /// In en, this message translates to:
  /// **'Withdraw this leave request?'**
  String get myLeaveWithdrawConfirm;

  /// No description provided for @leaveStateRequested.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get leaveStateRequested;

  /// No description provided for @leaveStateApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get leaveStateApproved;

  /// No description provided for @leaveStateDeclined.
  ///
  /// In en, this message translates to:
  /// **'Not approved'**
  String get leaveStateDeclined;

  /// No description provided for @leaveStateWithdrawn.
  ///
  /// In en, this message translates to:
  /// **'Withdrawn'**
  String get leaveStateWithdrawn;

  /// No description provided for @leaveStateCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get leaveStateCancelled;

  /// No description provided for @cardCertificateRequestedTitle.
  ///
  /// In en, this message translates to:
  /// **'Certificate request'**
  String get cardCertificateRequestedTitle;

  /// No description provided for @cardCertificateIssuedTitle.
  ///
  /// In en, this message translates to:
  /// **'Certificate'**
  String get cardCertificateIssuedTitle;

  /// No description provided for @cardCertificateDeclinedTitle.
  ///
  /// In en, this message translates to:
  /// **'Certificate request not approved'**
  String get cardCertificateDeclinedTitle;

  /// No description provided for @cardLeaveRequestedTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave request'**
  String get cardLeaveRequestedTitle;

  /// No description provided for @cardLeaveApprovedTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave approved'**
  String get cardLeaveApprovedTitle;

  /// No description provided for @cardLeaveDeclinedTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave not approved'**
  String get cardLeaveDeclinedTitle;

  /// No description provided for @cardLeaveWithdrawnTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave request withdrawn'**
  String get cardLeaveWithdrawnTitle;

  /// No description provided for @cardLeaveCancelledTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave cancelled'**
  String get cardLeaveCancelledTitle;

  /// No description provided for @cardAchievement.
  ///
  /// In en, this message translates to:
  /// **'Achievement'**
  String get cardAchievement;

  /// No description provided for @cardGrade.
  ///
  /// In en, this message translates to:
  /// **'Grade'**
  String get cardGrade;

  /// No description provided for @cardDays.
  ///
  /// In en, this message translates to:
  /// **'Days'**
  String get cardDays;

  /// No description provided for @cardBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance'**
  String get cardBalance;

  /// No description provided for @cardDaysReturned.
  ///
  /// In en, this message translates to:
  /// **'Days returned'**
  String get cardDaysReturned;

  /// No description provided for @cardCongratulations.
  ///
  /// In en, this message translates to:
  /// **'Congratulations! The certificate is attached.'**
  String get cardCongratulations;

  /// No description provided for @leaveNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'These dates can\'t be requested: they overlap another request or have already passed.'**
  String get leaveNotAllowed;

  /// No description provided for @progressCertificatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Certificates'**
  String get progressCertificatesTitle;

  /// No description provided for @cardDisciplineWarningTitle.
  ///
  /// In en, this message translates to:
  /// **'Warning'**
  String get cardDisciplineWarningTitle;

  /// No description provided for @cardDisciplineDeduction1Title.
  ///
  /// In en, this message translates to:
  /// **'First deduction'**
  String get cardDisciplineDeduction1Title;

  /// No description provided for @cardDisciplineDeduction2Title.
  ///
  /// In en, this message translates to:
  /// **'Second deduction'**
  String get cardDisciplineDeduction2Title;

  /// No description provided for @cardDisciplineTemporaryTitle.
  ///
  /// In en, this message translates to:
  /// **'Temporary suspension'**
  String get cardDisciplineTemporaryTitle;

  /// No description provided for @cardDisciplinePermanentTitle.
  ///
  /// In en, this message translates to:
  /// **'Permanent suspension'**
  String get cardDisciplinePermanentTitle;

  /// No description provided for @cardViolation.
  ///
  /// In en, this message translates to:
  /// **'What happened'**
  String get cardViolation;

  /// No description provided for @cardViolationLate.
  ///
  /// In en, this message translates to:
  /// **'{minutes} minutes late'**
  String cardViolationLate(String minutes);

  /// No description provided for @cardViolationNoShow.
  ///
  /// In en, this message translates to:
  /// **'Absent from the lesson'**
  String get cardViolationNoShow;

  /// No description provided for @cardViolationApology.
  ///
  /// In en, this message translates to:
  /// **'Apologised for the lesson'**
  String get cardViolationApology;

  /// No description provided for @cardViolationStep.
  ///
  /// In en, this message translates to:
  /// **'Violation {step} this month'**
  String cardViolationStep(String step);

  /// No description provided for @cardPayrollNote.
  ///
  /// In en, this message translates to:
  /// **'The amount is set in payroll.'**
  String get cardPayrollNote;

  /// No description provided for @trialGroupTitle.
  ///
  /// In en, this message translates to:
  /// **'Trial lessons'**
  String get trialGroupTitle;

  /// No description provided for @trialGroupSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sales · staff only'**
  String get trialGroupSubtitle;

  /// No description provided for @trialTicketsHeader.
  ///
  /// In en, this message translates to:
  /// **'Trials'**
  String get trialTicketsHeader;

  /// No description provided for @trialReportTitle.
  ///
  /// In en, this message translates to:
  /// **'Trial report'**
  String get trialReportTitle;

  /// No description provided for @trialAttended.
  ///
  /// In en, this message translates to:
  /// **'Attended'**
  String get trialAttended;

  /// No description provided for @trialDidNotAttend.
  ///
  /// In en, this message translates to:
  /// **'Did not attend'**
  String get trialDidNotAttend;

  /// No description provided for @trialCovered.
  ///
  /// In en, this message translates to:
  /// **'What was covered'**
  String get trialCovered;

  /// No description provided for @trialRating.
  ///
  /// In en, this message translates to:
  /// **'Rating'**
  String get trialRating;

  /// No description provided for @trialNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get trialNote;

  /// No description provided for @cardTrialBookedTitle.
  ///
  /// In en, this message translates to:
  /// **'Trial lesson booked'**
  String get cardTrialBookedTitle;

  /// No description provided for @cardTrialCancelledTitle.
  ///
  /// In en, this message translates to:
  /// **'Trial cancelled'**
  String get cardTrialCancelledTitle;

  /// No description provided for @cardTrialReportTitle.
  ///
  /// In en, this message translates to:
  /// **'Trial report'**
  String get cardTrialReportTitle;

  /// No description provided for @cardTrialNoShowTitle.
  ///
  /// In en, this message translates to:
  /// **'Did not attend the trial'**
  String get cardTrialNoShowTitle;

  /// No description provided for @cardTrialSubscribedTitle.
  ///
  /// In en, this message translates to:
  /// **'Subscribed'**
  String get cardTrialSubscribedTitle;

  /// No description provided for @cardTrialNotSubscribedTitle.
  ///
  /// In en, this message translates to:
  /// **'Did not subscribe'**
  String get cardTrialNotSubscribedTitle;

  /// No description provided for @cardTrialLevel.
  ///
  /// In en, this message translates to:
  /// **'Level'**
  String get cardTrialLevel;

  /// No description provided for @cardTrialAwaitingCore.
  ///
  /// In en, this message translates to:
  /// **'Counts once Core confirms the subscription.'**
  String get cardTrialAwaitingCore;
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
