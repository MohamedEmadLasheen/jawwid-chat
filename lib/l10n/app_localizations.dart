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
  /// **'{count, plural, one{{count} person is typing…} other{{count} people are typing…}}'**
  String typingMany(int count);

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
  /// **'Devices & sessions'**
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

  /// No description provided for @devicesSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Signed in {date}'**
  String devicesSignedIn(String date);

  /// No description provided for @devicesJustNow.
  ///
  /// In en, this message translates to:
  /// **'just now'**
  String get devicesJustNow;

  /// No description provided for @devicesMinutesAgo.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 minute ago} other{{count} minutes ago}}'**
  String devicesMinutesAgo(int count);

  /// No description provided for @devicesHoursAgo.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 hour ago} other{{count} hours ago}}'**
  String devicesHoursAgo(int count);

  /// No description provided for @devicesDaysAgo.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day ago} other{{count} days ago}}'**
  String devicesDaysAgo(int count);

  /// No description provided for @devicesNeverUsed.
  ///
  /// In en, this message translates to:
  /// **'Not used since sign-in'**
  String get devicesNeverUsed;

  /// No description provided for @devicesPlatformIphone.
  ///
  /// In en, this message translates to:
  /// **'iPhone'**
  String get devicesPlatformIphone;

  /// No description provided for @devicesPlatformAndroid.
  ///
  /// In en, this message translates to:
  /// **'Android phone'**
  String get devicesPlatformAndroid;

  /// No description provided for @devicesPlatformWeb.
  ///
  /// In en, this message translates to:
  /// **'Web browser'**
  String get devicesPlatformWeb;

  /// No description provided for @devicesPlatformUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown device'**
  String get devicesPlatformUnknown;

  /// No description provided for @devicesSignOutConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign out {device}?'**
  String devicesSignOutConfirmTitle(String device);

  /// No description provided for @devicesSignOutConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'That device will need your password to sign in again.'**
  String get devicesSignOutConfirmBody;

  /// No description provided for @devicesSignOutAllOthers.
  ///
  /// In en, this message translates to:
  /// **'Sign out all other devices'**
  String get devicesSignOutAllOthers;

  /// No description provided for @devicesSignOutAllOthersConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of every other device? Only this device stays signed in.'**
  String get devicesSignOutAllOthersConfirm;

  /// No description provided for @devicesSignedOutOne.
  ///
  /// In en, this message translates to:
  /// **'Signed out of that device'**
  String get devicesSignedOutOne;

  /// No description provided for @devicesSignedOutOthers.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No other devices were signed in} =1{Signed out of 1 device} other{Signed out of {count} devices}}'**
  String devicesSignedOutOthers(int count);

  /// No description provided for @devicesSignOutFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not sign that device out. Try again.'**
  String get devicesSignOutFailed;

  /// No description provided for @devicesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No active sessions'**
  String get devicesEmpty;

  /// No description provided for @appLockTitle.
  ///
  /// In en, this message translates to:
  /// **'App lock'**
  String get appLockTitle;

  /// Names the unlock methods the way the platform does: Android says fingerprint and screen lock, and face only as 'if supported' (a weak face unlock is not available to apps); iOS says Face ID and passcode. platform is android or other.
  ///
  /// In en, this message translates to:
  /// **'{platform, select, android{Lock with fingerprint, face (if supported) or screen lock} other{Lock with Face ID, fingerprint or passcode}}'**
  String appLockToggle(String platform);

  /// No description provided for @appLockToggleSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Ask to unlock when you return to the app'**
  String get appLockToggleSubtitle;

  /// Names the unlock methods the way the platform does: Android says fingerprint and screen lock, and face only as 'if supported' (a weak face unlock is not available to apps); iOS says Face ID and passcode. platform is android or other.
  ///
  /// In en, this message translates to:
  /// **'{platform, select, android{Set up a fingerprint or a screen lock on this device to use app lock.} other{Set up Face ID, a fingerprint or a passcode on this device to use app lock.}}'**
  String appLockUnavailable(String platform);

  /// Beside the App lock hint on Android: opens the phone's own screen for adding a fingerprint or a screen lock.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get appLockOpenSettings;

  /// No description provided for @appLockTimeoutLabel.
  ///
  /// In en, this message translates to:
  /// **'Lock automatically'**
  String get appLockTimeoutLabel;

  /// No description provided for @appLockTimeoutImmediately.
  ///
  /// In en, this message translates to:
  /// **'Immediately'**
  String get appLockTimeoutImmediately;

  /// No description provided for @appLockTimeoutOneMinute.
  ///
  /// In en, this message translates to:
  /// **'After 1 minute'**
  String get appLockTimeoutOneMinute;

  /// No description provided for @appLockTimeoutFifteenMinutes.
  ///
  /// In en, this message translates to:
  /// **'After 15 minutes'**
  String get appLockTimeoutFifteenMinutes;

  /// No description provided for @appLockTimeoutOneHour.
  ///
  /// In en, this message translates to:
  /// **'After 1 hour'**
  String get appLockTimeoutOneHour;

  /// No description provided for @appLockReason.
  ///
  /// In en, this message translates to:
  /// **'Unlock Jawwid'**
  String get appLockReason;

  /// No description provided for @appLockLockedTitle.
  ///
  /// In en, this message translates to:
  /// **'Jawwid is locked'**
  String get appLockLockedTitle;

  /// No description provided for @appLockLockedBody.
  ///
  /// In en, this message translates to:
  /// **'Unlock to see your chats.'**
  String get appLockLockedBody;

  /// No description provided for @appLockUnlockAction.
  ///
  /// In en, this message translates to:
  /// **'Unlock'**
  String get appLockUnlockAction;

  /// No description provided for @appLockFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not unlock. Try again.'**
  String get appLockFailed;

  /// No description provided for @appLockOfferTitle.
  ///
  /// In en, this message translates to:
  /// **'Lock the app?'**
  String get appLockOfferTitle;

  /// Names the unlock methods the way the platform does: Android says fingerprint and screen lock, and face only as 'if supported' (a weak face unlock is not available to apps); iOS says Face ID and passcode. platform is android or other.
  ///
  /// In en, this message translates to:
  /// **'{platform, select, android{Use your fingerprint, face (if supported) or screen lock to open Jawwid, so your chats stay private if someone else picks up your phone. You can change this anytime in Settings.} other{Use Face ID, your fingerprint or your passcode to open Jawwid, so your chats stay private if someone else picks up your phone. You can change this anytime in Settings.}}'**
  String appLockOfferBody(String platform);

  /// No description provided for @appLockOfferAccept.
  ///
  /// In en, this message translates to:
  /// **'Turn on'**
  String get appLockOfferAccept;

  /// No description provided for @appLockOfferDecline.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get appLockOfferDecline;

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

  /// PD-24 system message: the group was handed to another supervisor; history kept.
  ///
  /// In en, this message translates to:
  /// **'{name} is now this group\'s supervisor'**
  String systemGroupSupervisorChanged(String name);

  /// No description provided for @systemGroupSupervisorChangedNoName.
  ///
  /// In en, this message translates to:
  /// **'This group\'s supervisor changed'**
  String get systemGroupSupervisorChangedNoName;

  /// PD-24 system message in the parent's 1:1 with their supervisor after a transfer.
  ///
  /// In en, this message translates to:
  /// **'{name} is now your supervisor; the chat history is kept'**
  String systemDirectSupervisorChanged(String name);

  /// No description provided for @systemDirectSupervisorChangedNoName.
  ///
  /// In en, this message translates to:
  /// **'Your supervisor changed; the chat history is kept'**
  String get systemDirectSupervisorChangedNoName;

  /// No description provided for @systemGroupLearnerDetached.
  ///
  /// In en, this message translates to:
  /// **'A child of this group moved to another supervisor'**
  String get systemGroupLearnerDetached;

  /// PD-42: a child added to the family joined its group.
  ///
  /// In en, this message translates to:
  /// **'{learner} joined this group'**
  String systemGroupLearnerAdded(String learner);

  /// No description provided for @systemGroupLearnerAddedNoName.
  ///
  /// In en, this message translates to:
  /// **'A child joined this group'**
  String get systemGroupLearnerAddedNoName;

  /// No description provided for @systemCoverStarted.
  ///
  /// In en, this message translates to:
  /// **'{cover} is covering for {supervisor} until {date}'**
  String systemCoverStarted(String cover, String supervisor, String date);

  /// No description provided for @systemCoverExtended.
  ///
  /// In en, this message translates to:
  /// **'{cover}\'s cover for {supervisor} is extended until {date}'**
  String systemCoverExtended(String cover, String supervisor, String date);

  /// No description provided for @systemCoverEnded.
  ///
  /// In en, this message translates to:
  /// **'{supervisor} is back; the cover has ended'**
  String systemCoverEnded(String supervisor);

  /// No description provided for @systemCoverStartedNoName.
  ///
  /// In en, this message translates to:
  /// **'A backup supervisor is covering'**
  String get systemCoverStartedNoName;

  /// No description provided for @systemCoverEndedNoName.
  ///
  /// In en, this message translates to:
  /// **'The cover has ended'**
  String get systemCoverEndedNoName;

  /// No description provided for @conversationCoverLine.
  ///
  /// In en, this message translates to:
  /// **'{cover} is covering until {date}'**
  String conversationCoverLine(String cover, String date);

  /// PD-35 system line: a staff member took a visible seat in the group. who = systemSeatWho or a name.
  ///
  /// In en, this message translates to:
  /// **'{who} joined to support'**
  String systemSeatJoined(String who);

  /// PD-35 system line: a staff member follows a family 1:1 (no seat in the pair).
  ///
  /// In en, this message translates to:
  /// **'{who} is following this chat'**
  String systemSeatSteppedIn(String who);

  /// PD-35 system line: a staff member left their seat.
  ///
  /// In en, this message translates to:
  /// **'{name} left'**
  String systemSeatLeft(String name);

  /// PD-35 system line: a seat ended after days with no message.
  ///
  /// In en, this message translates to:
  /// **'{name} left (no activity)'**
  String systemSeatLeftIdle(String name);

  /// PD-35: a name with its role word, inside a seat line.
  ///
  /// In en, this message translates to:
  /// **'{name} ({role})'**
  String systemSeatWho(String name, String role);

  /// No description provided for @systemSeatSomeone.
  ///
  /// In en, this message translates to:
  /// **'A team member'**
  String get systemSeatSomeone;

  /// No description provided for @systemSeatJoinedNoName.
  ///
  /// In en, this message translates to:
  /// **'A team member joined'**
  String get systemSeatJoinedNoName;

  /// No description provided for @systemSeatSteppedInNoName.
  ///
  /// In en, this message translates to:
  /// **'A team member is following this chat'**
  String get systemSeatSteppedInNoName;

  /// No description provided for @systemSeatLeftNoName.
  ///
  /// In en, this message translates to:
  /// **'A team member left'**
  String get systemSeatLeftNoName;

  /// No description provided for @seatRoleTeacherSupervisor.
  ///
  /// In en, this message translates to:
  /// **'teacher supervisor'**
  String get seatRoleTeacherSupervisor;

  /// No description provided for @seatRoleSupervisor.
  ///
  /// In en, this message translates to:
  /// **'supervisor'**
  String get seatRoleSupervisor;

  /// No description provided for @seatRoleManager.
  ///
  /// In en, this message translates to:
  /// **'manager'**
  String get seatRoleManager;

  /// No description provided for @seatRoleAdministration.
  ///
  /// In en, this message translates to:
  /// **'administration'**
  String get seatRoleAdministration;

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

  /// No description provided for @ticketWriteReport.
  ///
  /// In en, this message translates to:
  /// **'Write lesson report'**
  String get ticketWriteReport;

  /// In the chat's + menu, under the one upcoming lesson it offers per child: the child's later lessons and owed make-ups, one tap further.
  ///
  /// In en, this message translates to:
  /// **'Other lessons ({count})'**
  String lessonsOtherLessons(int count);

  /// No description provided for @lessonsOtherLessonsTitle.
  ///
  /// In en, this message translates to:
  /// **'Other lessons'**
  String get lessonsOtherLessonsTitle;

  /// In the chat's + menu, under the one lesson report it offers: a link to the Schedule, filtered to the lessons still owed a report.
  ///
  /// In en, this message translates to:
  /// **'Other unreported lessons ({count})'**
  String lessonsOtherUnreported(int count);

  /// No description provided for @scheduleFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get scheduleFilterAll;

  /// No description provided for @scheduleFilterNeedsReport.
  ///
  /// In en, this message translates to:
  /// **'Needs a report ({count})'**
  String scheduleFilterNeedsReport(int count);

  /// No description provided for @scheduleNeedsReportHeader.
  ///
  /// In en, this message translates to:
  /// **'Still owed a report'**
  String get scheduleNeedsReportHeader;

  /// No description provided for @scheduleLessonNoActions.
  ///
  /// In en, this message translates to:
  /// **'Nothing to do for this lesson now.'**
  String get scheduleLessonNoActions;

  /// No description provided for @scheduleLessonLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this lesson. Try again.'**
  String get scheduleLessonLoadFailed;

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

  /// Lesson card row label: the booked make-up lesson's day, date and time follow (on the make-up card and on the excuse card it replaces).
  ///
  /// In en, this message translates to:
  /// **'Make-up lesson'**
  String get cardMakeupLesson;

  /// Make-up card row label: the day, date and time of the missed lesson the make-up replaces follow.
  ///
  /// In en, this message translates to:
  /// **'Instead of the lesson on'**
  String get cardMakeupInsteadOf;

  /// PD-15: lesson card row label for the internal excuse/apology reason, shown to staff and the teacher only, never to a family.
  ///
  /// In en, this message translates to:
  /// **'Reason (staff and the teacher only)'**
  String get cardStaffReason;

  /// No description provided for @ticketBookMakeup.
  ///
  /// In en, this message translates to:
  /// **'Book the make-up lesson'**
  String get ticketBookMakeup;

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

  /// No description provided for @scheduleViewList.
  ///
  /// In en, this message translates to:
  /// **'List'**
  String get scheduleViewList;

  /// No description provided for @scheduleViewDay.
  ///
  /// In en, this message translates to:
  /// **'Day'**
  String get scheduleViewDay;

  /// No description provided for @scheduleViewWeek.
  ///
  /// In en, this message translates to:
  /// **'Week'**
  String get scheduleViewWeek;

  /// No description provided for @scheduleViewMonth.
  ///
  /// In en, this message translates to:
  /// **'Month'**
  String get scheduleViewMonth;

  /// No description provided for @calendarPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get calendarPrevious;

  /// No description provided for @calendarNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get calendarNext;

  /// No description provided for @calendarToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get calendarToday;

  /// No description provided for @calendarLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your schedule. Try again.'**
  String get calendarLoadFailed;

  /// No description provided for @calendarBooked.
  ///
  /// In en, this message translates to:
  /// **'{hours} h of lessons'**
  String calendarBooked(String hours);

  /// No description provided for @calendarHeld.
  ///
  /// In en, this message translates to:
  /// **'{hours} h held'**
  String calendarHeld(String hours);

  /// No description provided for @calendarStudents.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No students} =1{1 student} other{{count} students}}'**
  String calendarStudents(int count);

  /// No description provided for @calendarTrialStudents.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{+1 trial student} other{+{count} trial students}}'**
  String calendarTrialStudents(int count);

  /// No description provided for @calendarShiftUsed.
  ///
  /// In en, this message translates to:
  /// **'{percent} of your shift booked'**
  String calendarShiftUsed(String percent);

  /// No description provided for @calendarEmptyInShift.
  ///
  /// In en, this message translates to:
  /// **'{hours} h empty in your shift'**
  String calendarEmptyInShift(String hours);

  /// No description provided for @calendarOutsideHours.
  ///
  /// In en, this message translates to:
  /// **'{hours} h outside your shift'**
  String calendarOutsideHours(String hours);

  /// No description provided for @calendarLegendEmpty.
  ///
  /// In en, this message translates to:
  /// **'Available time without a student'**
  String get calendarLegendEmpty;

  /// No description provided for @calendarLegendOutside.
  ///
  /// In en, this message translates to:
  /// **'Outside the shift'**
  String get calendarLegendOutside;

  /// No description provided for @calendarLegendLeave.
  ///
  /// In en, this message translates to:
  /// **'Leave'**
  String get calendarLegendLeave;

  /// No description provided for @calendarLegendWork.
  ///
  /// In en, this message translates to:
  /// **'Working hours'**
  String get calendarLegendWork;

  /// No description provided for @calendarStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get calendarStatusActive;

  /// No description provided for @calendarStatusTrial.
  ///
  /// In en, this message translates to:
  /// **'Trial'**
  String get calendarStatusTrial;

  /// No description provided for @calendarStatusPaused.
  ///
  /// In en, this message translates to:
  /// **'Temporarily paused'**
  String get calendarStatusPaused;

  /// No description provided for @calendarOutsideShift.
  ///
  /// In en, this message translates to:
  /// **'Outside the shift'**
  String get calendarOutsideShift;

  /// No description provided for @calendarNoLessons.
  ///
  /// In en, this message translates to:
  /// **'No lessons'**
  String get calendarNoLessons;

  /// No description provided for @calendarDayLessons.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No lessons} =1{1 lesson} other{{count} lessons}}'**
  String calendarDayLessons(int count);

  /// No description provided for @calendarTimesIn.
  ///
  /// In en, this message translates to:
  /// **'Times in {zone}'**
  String calendarTimesIn(String zone);

  /// No description provided for @calendarHoursShort.
  ///
  /// In en, this message translates to:
  /// **'{hours} h'**
  String calendarHoursShort(String hours);

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

  /// No description provided for @cardViolationAbsence.
  ///
  /// In en, this message translates to:
  /// **'Absent'**
  String get cardViolationAbsence;

  /// No description provided for @cardViolationComplaint.
  ///
  /// In en, this message translates to:
  /// **'A complaint was upheld'**
  String get cardViolationComplaint;

  /// No description provided for @chatTeacherOnLeave.
  ///
  /// In en, this message translates to:
  /// **'{name} is on leave until {date}. Messages still reach them.'**
  String chatTeacherOnLeave(String name, String date);

  /// No description provided for @chatTeacherAway.
  ///
  /// In en, this message translates to:
  /// **'{name} is away until {date}. Messages still reach them.'**
  String chatTeacherAway(String name, String date);

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
  /// **'The student did not attend the trial lesson.'**
  String get cardTrialNoShowTitle;

  /// No description provided for @cardTrialSubscribedTitle.
  ///
  /// In en, this message translates to:
  /// **'The student has subscribed.'**
  String get cardTrialSubscribedTitle;

  /// No description provided for @cardTrialNotSubscribedTitle.
  ///
  /// In en, this message translates to:
  /// **'The student did not subscribe.'**
  String get cardTrialNotSubscribedTitle;

  /// No description provided for @cardTrialLevel.
  ///
  /// In en, this message translates to:
  /// **'Level'**
  String get cardTrialLevel;

  /// No description provided for @cardTrialCorrectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Outcome corrected'**
  String get cardTrialCorrectionTitle;

  /// No description provided for @cardTrialNewOutcome.
  ///
  /// In en, this message translates to:
  /// **'Now'**
  String get cardTrialNewOutcome;

  /// No description provided for @callsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by name'**
  String get callsSearchHint;

  /// No description provided for @callActionStart.
  ///
  /// In en, this message translates to:
  /// **'Start call'**
  String get callActionStart;

  /// No description provided for @callActionNewLink.
  ///
  /// In en, this message translates to:
  /// **'New call link'**
  String get callActionNewLink;

  /// No description provided for @callActionSelectMember.
  ///
  /// In en, this message translates to:
  /// **'Select a member'**
  String get callActionSelectMember;

  /// No description provided for @callActionSchedule.
  ///
  /// In en, this message translates to:
  /// **'Schedule call'**
  String get callActionSchedule;

  /// No description provided for @callsSectionUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get callsSectionUpcoming;

  /// No description provided for @callsSectionFavorites.
  ///
  /// In en, this message translates to:
  /// **'Favourites'**
  String get callsSectionFavorites;

  /// No description provided for @callsSectionRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent'**
  String get callsSectionRecent;

  /// No description provided for @callsUpcomingEmpty.
  ///
  /// In en, this message translates to:
  /// **'No scheduled calls'**
  String get callsUpcomingEmpty;

  /// No description provided for @callsUpcomingError.
  ///
  /// In en, this message translates to:
  /// **'Upcoming calls could not be loaded.'**
  String get callsUpcomingError;

  /// No description provided for @callsFavoritesEmpty.
  ///
  /// In en, this message translates to:
  /// **'Add a chat to your favourites to call it from here.'**
  String get callsFavoritesEmpty;

  /// No description provided for @callsSearchNoMatch.
  ///
  /// In en, this message translates to:
  /// **'Nothing matched your search'**
  String get callsSearchNoMatch;

  /// No description provided for @callsUnnamed.
  ///
  /// In en, this message translates to:
  /// **'Unnamed chat'**
  String get callsUnnamed;

  /// No description provided for @callBack.
  ///
  /// In en, this message translates to:
  /// **'Call back'**
  String get callBack;

  /// No description provided for @callDirectionOutgoing.
  ///
  /// In en, this message translates to:
  /// **'Outgoing'**
  String get callDirectionOutgoing;

  /// No description provided for @callDirectionIncoming.
  ///
  /// In en, this message translates to:
  /// **'Incoming'**
  String get callDirectionIncoming;

  /// No description provided for @callWhen.
  ///
  /// In en, this message translates to:
  /// **'{day}, {time}'**
  String callWhen(String day, String time);

  /// No description provided for @callPickerPeople.
  ///
  /// In en, this message translates to:
  /// **'People'**
  String get callPickerPeople;

  /// No description provided for @callPickerGroups.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get callPickerGroups;

  /// No description provided for @callPickerEmpty.
  ///
  /// In en, this message translates to:
  /// **'There are no chats to choose from.'**
  String get callPickerEmpty;

  /// No description provided for @callPickerNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No chats match your search'**
  String get callPickerNoMatch;

  /// No description provided for @callRefusedParentGroup.
  ///
  /// In en, this message translates to:
  /// **'Only staff or the teacher can start a group call'**
  String get callRefusedParentGroup;

  /// No description provided for @callRefusedGeneric.
  ///
  /// In en, this message translates to:
  /// **'Calls are not available in this chat'**
  String get callRefusedGeneric;

  /// No description provided for @scheduledCallDefaultTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled call'**
  String get scheduledCallDefaultTitle;

  /// No description provided for @scheduledCallLinkLabel.
  ///
  /// In en, this message translates to:
  /// **'Call link'**
  String get scheduledCallLinkLabel;

  /// No description provided for @scheduledCallStateOpen.
  ///
  /// In en, this message translates to:
  /// **'Open now'**
  String get scheduledCallStateOpen;

  /// No description provided for @scheduledCallStateUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get scheduledCallStateUpcoming;

  /// No description provided for @scheduledCallJoin.
  ///
  /// In en, this message translates to:
  /// **'Join'**
  String get scheduledCallJoin;

  /// No description provided for @scheduledCallCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel call'**
  String get scheduledCallCancel;

  /// No description provided for @scheduledCallCancelConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this call?'**
  String get scheduledCallCancelConfirmTitle;

  /// No description provided for @scheduledCallCancelConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Everyone in the chat will see that it was cancelled.'**
  String get scheduledCallCancelConfirmBody;

  /// No description provided for @scheduledCallKeep.
  ///
  /// In en, this message translates to:
  /// **'Keep'**
  String get scheduledCallKeep;

  /// No description provided for @scheduledCallCancelled.
  ///
  /// In en, this message translates to:
  /// **'Call cancelled'**
  String get scheduledCallCancelled;

  /// No description provided for @scheduledCallBy.
  ///
  /// In en, this message translates to:
  /// **'By {name}'**
  String scheduledCallBy(String name);

  /// No description provided for @scheduledCallJoinHint.
  ///
  /// In en, this message translates to:
  /// **'You can join from 10 minutes before the start.'**
  String get scheduledCallJoinHint;

  /// No description provided for @scheduledJoinNotJoinable.
  ///
  /// In en, this message translates to:
  /// **'This call is not open to join right now'**
  String get scheduledJoinNotJoinable;

  /// No description provided for @scheduledJoinWaitingForHost.
  ///
  /// In en, this message translates to:
  /// **'The call starts when staff or the teacher join'**
  String get scheduledJoinWaitingForHost;

  /// No description provided for @scheduledJoinBusy.
  ///
  /// In en, this message translates to:
  /// **'Finish your current call first'**
  String get scheduledJoinBusy;

  /// No description provided for @callScheduleDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get callScheduleDate;

  /// No description provided for @callScheduleTime.
  ///
  /// In en, this message translates to:
  /// **'Time'**
  String get callScheduleTime;

  /// No description provided for @callScheduleTitleLabel.
  ///
  /// In en, this message translates to:
  /// **'Title (optional)'**
  String get callScheduleTitleLabel;

  /// No description provided for @callScheduleInPast.
  ///
  /// In en, this message translates to:
  /// **'Choose a time in the future'**
  String get callScheduleInPast;

  /// No description provided for @callSchedulePosted.
  ///
  /// In en, this message translates to:
  /// **'Scheduled — posted in {chat}'**
  String callSchedulePosted(String chat);

  /// No description provided for @callLinkPosted.
  ///
  /// In en, this message translates to:
  /// **'Call link posted in {chat}'**
  String callLinkPosted(String chat);

  /// No description provided for @callLinkJoinNow.
  ///
  /// In en, this message translates to:
  /// **'Join now'**
  String get callLinkJoinNow;

  /// No description provided for @callLinkOpenChat.
  ///
  /// In en, this message translates to:
  /// **'Open chat'**
  String get callLinkOpenChat;

  /// No description provided for @profilePhotoTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile photo'**
  String get profilePhotoTitle;

  /// No description provided for @profilePhotoHint.
  ///
  /// In en, this message translates to:
  /// **'Everyone you chat with sees this photo.'**
  String get profilePhotoHint;

  /// No description provided for @profilePhotoAdd.
  ///
  /// In en, this message translates to:
  /// **'Add photo'**
  String get profilePhotoAdd;

  /// No description provided for @profilePhotoChange.
  ///
  /// In en, this message translates to:
  /// **'Change photo'**
  String get profilePhotoChange;

  /// No description provided for @profilePhotoRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get profilePhotoRemove;

  /// No description provided for @profilePhotoSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get profilePhotoSaving;

  /// No description provided for @profilePhotoFailed.
  ///
  /// In en, this message translates to:
  /// **'The photo could not be saved. Try again.'**
  String get profilePhotoFailed;

  /// No description provided for @profilePhotoInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use a JPEG, PNG or WebP photo, at least 64 × 64 pixels and under 2 MB.'**
  String get profilePhotoInvalid;

  /// No description provided for @childrenPhotosTitle.
  ///
  /// In en, this message translates to:
  /// **'Children\'s photos'**
  String get childrenPhotosTitle;

  /// No description provided for @childrenPhotosHint.
  ///
  /// In en, this message translates to:
  /// **'Shown in your child\'s groups, to their teacher and supervisor.'**
  String get childrenPhotosHint;

  /// No description provided for @starAction.
  ///
  /// In en, this message translates to:
  /// **'Star'**
  String get starAction;

  /// No description provided for @unstarAction.
  ///
  /// In en, this message translates to:
  /// **'Unstar'**
  String get unstarAction;

  /// No description provided for @pinAction.
  ///
  /// In en, this message translates to:
  /// **'Pin message'**
  String get pinAction;

  /// No description provided for @unpinAction.
  ///
  /// In en, this message translates to:
  /// **'Unpin message'**
  String get unpinAction;

  /// No description provided for @starredMark.
  ///
  /// In en, this message translates to:
  /// **'Starred'**
  String get starredMark;

  /// No description provided for @pinnedMark.
  ///
  /// In en, this message translates to:
  /// **'Pinned'**
  String get pinnedMark;

  /// No description provided for @pinnedBannerOne.
  ///
  /// In en, this message translates to:
  /// **'Pinned message'**
  String get pinnedBannerOne;

  /// No description provided for @pinnedBannerOf.
  ///
  /// In en, this message translates to:
  /// **'Pinned message {index} of {total}'**
  String pinnedBannerOf(int index, int total);

  /// No description provided for @starredMessagesTitle.
  ///
  /// In en, this message translates to:
  /// **'Starred messages'**
  String get starredMessagesTitle;

  /// No description provided for @starredMessagesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No starred messages yet. Long-press a message and choose Star.'**
  String get starredMessagesEmpty;

  /// No description provided for @forwardAction.
  ///
  /// In en, this message translates to:
  /// **'Forward'**
  String get forwardAction;

  /// No description provided for @forwardTitle.
  ///
  /// In en, this message translates to:
  /// **'Forward to…'**
  String get forwardTitle;

  /// No description provided for @forwardEmpty.
  ///
  /// In en, this message translates to:
  /// **'No chats to forward to.'**
  String get forwardEmpty;

  /// No description provided for @forwardSendTo.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Send} other{Send to {count}}}'**
  String forwardSendTo(int count);

  /// No description provided for @forwardMax.
  ///
  /// In en, this message translates to:
  /// **'You can choose at most 10 chats.'**
  String get forwardMax;

  /// No description provided for @forwardDone.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Forwarded to 1 chat} other{Forwarded to {count} chats}}'**
  String forwardDone(int count);

  /// No description provided for @forwardedLabel.
  ///
  /// In en, this message translates to:
  /// **'Forwarded'**
  String get forwardedLabel;

  /// No description provided for @sentBySupportLabel.
  ///
  /// In en, this message translates to:
  /// **'Sent by support'**
  String get sentBySupportLabel;

  /// Shown next to a message's time when its author edited it after sending.
  ///
  /// In en, this message translates to:
  /// **'Edited'**
  String get editedMark;

  /// No description provided for @selectAction.
  ///
  /// In en, this message translates to:
  /// **'Select messages'**
  String get selectAction;

  /// No description provided for @selectedCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 selected} other{{count} selected}}'**
  String selectedCount(int count);

  /// No description provided for @cancelSelection.
  ///
  /// In en, this message translates to:
  /// **'Cancel selection'**
  String get cancelSelection;

  /// No description provided for @searchInChat.
  ///
  /// In en, this message translates to:
  /// **'Search in chat'**
  String get searchInChat;

  /// No description provided for @searchMessagesHint.
  ///
  /// In en, this message translates to:
  /// **'Search messages'**
  String get searchMessagesHint;

  /// No description provided for @searchClose.
  ///
  /// In en, this message translates to:
  /// **'Close search'**
  String get searchClose;

  /// No description provided for @searchOlder.
  ///
  /// In en, this message translates to:
  /// **'Older match'**
  String get searchOlder;

  /// No description provided for @searchNewer.
  ///
  /// In en, this message translates to:
  /// **'Newer match'**
  String get searchNewer;

  /// No description provided for @searchNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No matching messages'**
  String get searchNoMatches;

  /// No description provided for @searchTooShort.
  ///
  /// In en, this message translates to:
  /// **'Type at least 2 characters'**
  String get searchTooShort;

  /// No description provided for @searchPosition.
  ///
  /// In en, this message translates to:
  /// **'{index} of {total}'**
  String searchPosition(int index, String total);

  /// No description provided for @searchMessagesSection.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get searchMessagesSection;

  /// No description provided for @searchMessagesNone.
  ///
  /// In en, this message translates to:
  /// **'No matching messages in your chats'**
  String get searchMessagesNone;

  /// No description provided for @chatThemeAction.
  ///
  /// In en, this message translates to:
  /// **'Chat theme'**
  String get chatThemeAction;

  /// No description provided for @chatWallpaperBadType.
  ///
  /// In en, this message translates to:
  /// **'That is not a valid JPEG, PNG or WebP image.'**
  String get chatWallpaperBadType;

  /// No description provided for @chatWallpaperTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That image is too large (4 MB at most).'**
  String get chatWallpaperTooLarge;

  /// No description provided for @chatWallpaperBadSize.
  ///
  /// In en, this message translates to:
  /// **'The image must be between 200 and 4096 pixels on each side.'**
  String get chatWallpaperBadSize;

  /// No description provided for @chatWallpaperAnimated.
  ///
  /// In en, this message translates to:
  /// **'An animated image cannot be used as a wallpaper.'**
  String get chatWallpaperAnimated;

  /// No description provided for @chatThemeHint.
  ///
  /// In en, this message translates to:
  /// **'Only you see this. It changes this chat\'s background on all your devices.'**
  String get chatThemeHint;

  /// No description provided for @chatThemeDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get chatThemeDefault;

  /// No description provided for @chatThemeLagoon.
  ///
  /// In en, this message translates to:
  /// **'Lagoon'**
  String get chatThemeLagoon;

  /// No description provided for @chatThemeSand.
  ///
  /// In en, this message translates to:
  /// **'Sand'**
  String get chatThemeSand;

  /// No description provided for @chatThemeRose.
  ///
  /// In en, this message translates to:
  /// **'Rose'**
  String get chatThemeRose;

  /// No description provided for @chatThemeSky.
  ///
  /// In en, this message translates to:
  /// **'Sky'**
  String get chatThemeSky;

  /// No description provided for @chatThemeLilac.
  ///
  /// In en, this message translates to:
  /// **'Lilac'**
  String get chatThemeLilac;

  /// No description provided for @chatThemeOlive.
  ///
  /// In en, this message translates to:
  /// **'Olive'**
  String get chatThemeOlive;

  /// No description provided for @chatThemeSlate.
  ///
  /// In en, this message translates to:
  /// **'Slate'**
  String get chatThemeSlate;

  /// No description provided for @chatThemeDusk.
  ///
  /// In en, this message translates to:
  /// **'Dusk'**
  String get chatThemeDusk;

  /// No description provided for @chatWallpaperTitle.
  ///
  /// In en, this message translates to:
  /// **'Photo wallpaper'**
  String get chatWallpaperTitle;

  /// No description provided for @chatWallpaperChoose.
  ///
  /// In en, this message translates to:
  /// **'Choose a photo'**
  String get chatWallpaperChoose;

  /// No description provided for @chatWallpaperReplace.
  ///
  /// In en, this message translates to:
  /// **'Change photo'**
  String get chatWallpaperReplace;

  /// No description provided for @chatWallpaperRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get chatWallpaperRemove;

  /// No description provided for @teacherProfileTitle.
  ///
  /// In en, this message translates to:
  /// **'Teacher professional profile'**
  String get teacherProfileTitle;

  /// No description provided for @teacherProfileSettingsEntry.
  ///
  /// In en, this message translates to:
  /// **'Professional profile'**
  String get teacherProfileSettingsEntry;

  /// No description provided for @teacherProfileSettingsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'What families read about you'**
  String get teacherProfileSettingsSubtitle;

  /// No description provided for @teacherProfileAboutSection.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get teacherProfileAboutSection;

  /// No description provided for @teacherProfileBioLabel.
  ///
  /// In en, this message translates to:
  /// **'Bio'**
  String get teacherProfileBioLabel;

  /// No description provided for @teacherProfileBioHint.
  ///
  /// In en, this message translates to:
  /// **'A short introduction for families.'**
  String get teacherProfileBioHint;

  /// No description provided for @teacherProfileProfessionalSection.
  ///
  /// In en, this message translates to:
  /// **'Professional information'**
  String get teacherProfileProfessionalSection;

  /// No description provided for @teacherProfileSpecializationLabel.
  ///
  /// In en, this message translates to:
  /// **'Specialization'**
  String get teacherProfileSpecializationLabel;

  /// No description provided for @teacherProfileQualificationsLabel.
  ///
  /// In en, this message translates to:
  /// **'Qualifications'**
  String get teacherProfileQualificationsLabel;

  /// No description provided for @teacherProfileExperienceLabel.
  ///
  /// In en, this message translates to:
  /// **'Experience'**
  String get teacherProfileExperienceLabel;

  /// No description provided for @teacherProfileLanguagesLabel.
  ///
  /// In en, this message translates to:
  /// **'Languages'**
  String get teacherProfileLanguagesLabel;

  /// No description provided for @teacherProfileLanguagesHint.
  ///
  /// In en, this message translates to:
  /// **'Separate each language with a comma.'**
  String get teacherProfileLanguagesHint;

  /// No description provided for @teacherProfileCertificatesSection.
  ///
  /// In en, this message translates to:
  /// **'Certificates'**
  String get teacherProfileCertificatesSection;

  /// No description provided for @teacherProfileCertificatesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No certificates yet.'**
  String get teacherProfileCertificatesEmpty;

  /// No description provided for @teacherProfileAddCertificate.
  ///
  /// In en, this message translates to:
  /// **'Add certificate'**
  String get teacherProfileAddCertificate;

  /// No description provided for @teacherProfileCertificateTitleLabel.
  ///
  /// In en, this message translates to:
  /// **'Certificate title'**
  String get teacherProfileCertificateTitleLabel;

  /// No description provided for @teacherProfileCertificateIssuerLabel.
  ///
  /// In en, this message translates to:
  /// **'Issuing organization'**
  String get teacherProfileCertificateIssuerLabel;

  /// No description provided for @teacherProfileCertificateYearLabel.
  ///
  /// In en, this message translates to:
  /// **'Year issued'**
  String get teacherProfileCertificateYearLabel;

  /// No description provided for @teacherProfileCertificateFile.
  ///
  /// In en, this message translates to:
  /// **'Choose file'**
  String get teacherProfileCertificateFile;

  /// No description provided for @teacherProfileCertificateFileChosen.
  ///
  /// In en, this message translates to:
  /// **'{name} ready to upload'**
  String teacherProfileCertificateFileChosen(String name);

  /// No description provided for @teacherProfileCertificateUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading…'**
  String get teacherProfileCertificateUploading;

  /// No description provided for @teacherProfileCertificateOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get teacherProfileCertificateOpen;

  /// No description provided for @teacherProfileCertificateRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get teacherProfileCertificateRemove;

  /// No description provided for @teacherProfileCertificateRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this certificate?'**
  String get teacherProfileCertificateRemoveTitle;

  /// No description provided for @teacherProfileCertificateRemoveBody.
  ///
  /// In en, this message translates to:
  /// **'It will be removed from your profile. The file is deleted.'**
  String get teacherProfileCertificateRemoveBody;

  /// No description provided for @teacherProfileCertificatePending.
  ///
  /// In en, this message translates to:
  /// **'Awaiting review'**
  String get teacherProfileCertificatePending;

  /// No description provided for @teacherProfileCertificateApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get teacherProfileCertificateApproved;

  /// No description provided for @teacherProfileCertificateRejected.
  ///
  /// In en, this message translates to:
  /// **'Not accepted'**
  String get teacherProfileCertificateRejected;

  /// No description provided for @teacherProfileSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get teacherProfileSave;

  /// No description provided for @teacherProfileSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get teacherProfileSaving;

  /// No description provided for @teacherProfileSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get teacherProfileSaved;

  /// No description provided for @teacherProfileEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Build your professional profile'**
  String get teacherProfileEmptyTitle;

  /// No description provided for @teacherProfileEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Tell families about your background. Your changes are saved and visible right away.'**
  String get teacherProfileEmptyBody;

  /// No description provided for @teacherProfileUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Your professional profile is not available right now.'**
  String get teacherProfileUnavailable;

  /// No description provided for @teacherProfileCertificateTitleRequired.
  ///
  /// In en, this message translates to:
  /// **'Give the certificate a title.'**
  String get teacherProfileCertificateTitleRequired;

  /// No description provided for @teacherProfileCertificateFileRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose a file first.'**
  String get teacherProfileCertificateFileRequired;

  /// No description provided for @teacherProfileCertificateBadType.
  ///
  /// In en, this message translates to:
  /// **'Choose a PDF, JPEG or PNG.'**
  String get teacherProfileCertificateBadType;

  /// No description provided for @teacherProfileCertificateTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That file is larger than 10 MB.'**
  String get teacherProfileCertificateTooLarge;

  /// No description provided for @teacherProfileCertificateEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get teacherProfileCertificateEdit;

  /// No description provided for @teacherProfileCertificateEditTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit certificate'**
  String get teacherProfileCertificateEditTitle;

  /// No description provided for @teacherProfileCertificateEditNote.
  ///
  /// In en, this message translates to:
  /// **'Editing the details sends this certificate for review again. The file is not changed.'**
  String get teacherProfileCertificateEditNote;

  /// No description provided for @teacherProfileNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get teacherProfileNameLabel;

  /// No description provided for @teacherProfileNameSave.
  ///
  /// In en, this message translates to:
  /// **'Save name'**
  String get teacherProfileNameSave;

  /// No description provided for @teacherProfileNameSaved.
  ///
  /// In en, this message translates to:
  /// **'Name saved'**
  String get teacherProfileNameSaved;

  /// No description provided for @teacherProfileNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your name.'**
  String get teacherProfileNameRequired;

  /// No description provided for @teacherProfilePhotoChoose.
  ///
  /// In en, this message translates to:
  /// **'Profile photo'**
  String get teacherProfilePhotoChoose;

  /// No description provided for @teacherProfilePhotoReplace.
  ///
  /// In en, this message translates to:
  /// **'Replace photo'**
  String get teacherProfilePhotoReplace;

  /// No description provided for @teacherProfilePhotoRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get teacherProfilePhotoRemove;

  /// No description provided for @teacherProfilePhotoRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove your photo?'**
  String get teacherProfilePhotoRemoveTitle;

  /// No description provided for @teacherProfilePhotoRemoveBody.
  ///
  /// In en, this message translates to:
  /// **'Your profile will show your initials instead.'**
  String get teacherProfilePhotoRemoveBody;

  /// No description provided for @teacherProfilePhotoUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading photo…'**
  String get teacherProfilePhotoUploading;

  /// No description provided for @teacherProfileCertificateSave.
  ///
  /// In en, this message translates to:
  /// **'Save certificate'**
  String get teacherProfileCertificateSave;

  /// No description provided for @myProfileTitle.
  ///
  /// In en, this message translates to:
  /// **'My profile'**
  String get myProfileTitle;

  /// No description provided for @myProfileSettingsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your photo, name and about'**
  String get myProfileSettingsSubtitle;

  /// No description provided for @profileAboutLabel.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get profileAboutLabel;

  /// No description provided for @profileAboutHint.
  ///
  /// In en, this message translates to:
  /// **'A little about you'**
  String get profileAboutHint;

  /// No description provided for @profileAboutEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing added yet'**
  String get profileAboutEmpty;

  /// No description provided for @profileNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get profileNameLabel;

  /// No description provided for @profileNameEmptyError.
  ///
  /// In en, this message translates to:
  /// **'Please enter a name'**
  String get profileNameEmptyError;

  /// No description provided for @profileNameTooLongError.
  ///
  /// In en, this message translates to:
  /// **'That name is too long'**
  String get profileNameTooLongError;

  /// No description provided for @profileAboutTooLongError.
  ///
  /// In en, this message translates to:
  /// **'That is too long'**
  String get profileAboutTooLongError;

  /// No description provided for @profileEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get profileEdit;

  /// No description provided for @profileSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get profileSave;

  /// No description provided for @profileCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get profileCancel;

  /// No description provided for @profileSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get profileSaved;

  /// No description provided for @profileSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'That could not be saved. Please try again.'**
  String get profileSaveFailed;

  /// No description provided for @profilePhotoRemoveFailed.
  ///
  /// In en, this message translates to:
  /// **'That photo could not be removed. Please try again.'**
  String get profilePhotoRemoveFailed;

  /// No description provided for @profilePhotoEditLabel.
  ///
  /// In en, this message translates to:
  /// **'Change your photo'**
  String get profilePhotoEditLabel;

  /// No description provided for @profileChildPhotoEditLabel.
  ///
  /// In en, this message translates to:
  /// **'Change {name}\'s photo'**
  String profileChildPhotoEditLabel(String name);

  /// No description provided for @profileChildEditTitle.
  ///
  /// In en, this message translates to:
  /// **'{name}\'s profile'**
  String profileChildEditTitle(String name);

  /// No description provided for @profileLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Your profile could not be loaded.'**
  String get profileLoadFailed;

  /// No description provided for @ticketReportChoose.
  ///
  /// In en, this message translates to:
  /// **'What happened in this lesson?'**
  String get ticketReportChoose;

  /// No description provided for @ticketReportAttended.
  ///
  /// In en, this message translates to:
  /// **'Student attended'**
  String get ticketReportAttended;

  /// No description provided for @ticketReportNotAttended.
  ///
  /// In en, this message translates to:
  /// **'Student did not attend'**
  String get ticketReportNotAttended;

  /// No description provided for @ticketAbsenceConfirm.
  ///
  /// In en, this message translates to:
  /// **'The group will be told that the student did not attend this lesson.'**
  String get ticketAbsenceConfirm;

  /// No description provided for @reportLessonNumberLabel.
  ///
  /// In en, this message translates to:
  /// **'Lesson number'**
  String get reportLessonNumberLabel;

  /// No description provided for @reportTopicsLabel.
  ///
  /// In en, this message translates to:
  /// **'What did the student learn?'**
  String get reportTopicsLabel;

  /// No description provided for @reportDetailsLabel.
  ///
  /// In en, this message translates to:
  /// **'Details (optional, short)'**
  String get reportDetailsLabel;

  /// No description provided for @reportPerformanceLabel.
  ///
  /// In en, this message translates to:
  /// **'Performance in this lesson'**
  String get reportPerformanceLabel;

  /// No description provided for @reportNextLabel.
  ///
  /// In en, this message translates to:
  /// **'For the next lesson'**
  String get reportNextLabel;

  /// No description provided for @reportHomeworkDetailsLabel.
  ///
  /// In en, this message translates to:
  /// **'Homework details (optional)'**
  String get reportHomeworkDetailsLabel;

  /// No description provided for @reportPrivateNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Private note (supervisors only)'**
  String get reportPrivateNoteLabel;

  /// No description provided for @reportNeedsCovered.
  ///
  /// In en, this message translates to:
  /// **'Choose a topic or write a short line.'**
  String get reportNeedsCovered;

  /// No description provided for @reportEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit report'**
  String get reportEdit;

  /// No description provided for @reportUpdated.
  ///
  /// In en, this message translates to:
  /// **'Report updated'**
  String get reportUpdated;

  /// No description provided for @topicNewMemorization.
  ///
  /// In en, this message translates to:
  /// **'New memorization'**
  String get topicNewMemorization;

  /// No description provided for @topicRevision.
  ///
  /// In en, this message translates to:
  /// **'Revision'**
  String get topicRevision;

  /// No description provided for @topicRecitation.
  ///
  /// In en, this message translates to:
  /// **'Recitation'**
  String get topicRecitation;

  /// No description provided for @topicTajweed.
  ///
  /// In en, this message translates to:
  /// **'Tajweed rules'**
  String get topicTajweed;

  /// No description provided for @topicReading.
  ///
  /// In en, this message translates to:
  /// **'Reading'**
  String get topicReading;

  /// No description provided for @topicWriting.
  ///
  /// In en, this message translates to:
  /// **'Writing'**
  String get topicWriting;

  /// No description provided for @topicGrammar.
  ///
  /// In en, this message translates to:
  /// **'Grammar'**
  String get topicGrammar;

  /// No description provided for @topicVocabulary.
  ///
  /// In en, this message translates to:
  /// **'Vocabulary'**
  String get topicVocabulary;

  /// No description provided for @topicIslamicStudies.
  ///
  /// In en, this message translates to:
  /// **'Islamic studies'**
  String get topicIslamicStudies;

  /// No description provided for @topicAssessment.
  ///
  /// In en, this message translates to:
  /// **'Test / assessment'**
  String get topicAssessment;

  /// No description provided for @taskMemorizeNew.
  ///
  /// In en, this message translates to:
  /// **'Memorize the new part'**
  String get taskMemorizeNew;

  /// No description provided for @taskRevisePrevious.
  ///
  /// In en, this message translates to:
  /// **'Revise previous lessons'**
  String get taskRevisePrevious;

  /// No description provided for @taskPractiseRecitation.
  ///
  /// In en, this message translates to:
  /// **'Practise recitation'**
  String get taskPractiseRecitation;

  /// No description provided for @taskPractiseReading.
  ///
  /// In en, this message translates to:
  /// **'Practise reading'**
  String get taskPractiseReading;

  /// No description provided for @taskWrittenHomework.
  ///
  /// In en, this message translates to:
  /// **'Written homework'**
  String get taskWrittenHomework;

  /// No description provided for @taskPrepareNext.
  ///
  /// In en, this message translates to:
  /// **'Prepare the next lesson'**
  String get taskPrepareNext;

  /// No description provided for @taskNothing.
  ///
  /// In en, this message translates to:
  /// **'Nothing this time'**
  String get taskNothing;

  /// No description provided for @level5.
  ///
  /// In en, this message translates to:
  /// **'Excellent'**
  String get level5;

  /// No description provided for @level4.
  ///
  /// In en, this message translates to:
  /// **'Very good'**
  String get level4;

  /// No description provided for @level3.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get level3;

  /// No description provided for @level2.
  ///
  /// In en, this message translates to:
  /// **'Fair'**
  String get level2;

  /// No description provided for @level1.
  ///
  /// In en, this message translates to:
  /// **'Needs more work'**
  String get level1;

  /// No description provided for @cardLessonNumber.
  ///
  /// In en, this message translates to:
  /// **'Lesson no.'**
  String get cardLessonNumber;

  /// No description provided for @cardNextLesson.
  ///
  /// In en, this message translates to:
  /// **'For the next lesson'**
  String get cardNextLesson;

  /// No description provided for @cardPerformance.
  ///
  /// In en, this message translates to:
  /// **'Performance'**
  String get cardPerformance;

  /// No description provided for @cardCorrectedTitle.
  ///
  /// In en, this message translates to:
  /// **'Lesson record corrected'**
  String get cardCorrectedTitle;

  /// No description provided for @cardCorrectedNow.
  ///
  /// In en, this message translates to:
  /// **'Now recorded as'**
  String get cardCorrectedNow;

  /// No description provided for @cardExcusedAfterTitle.
  ///
  /// In en, this message translates to:
  /// **'Excused after the lesson started'**
  String get cardExcusedAfterTitle;

  /// No description provided for @cardReportCorrected.
  ///
  /// In en, this message translates to:
  /// **'Corrected by the supervisor'**
  String get cardReportCorrected;

  /// No description provided for @cardOutcomeHeld.
  ///
  /// In en, this message translates to:
  /// **'The student attended'**
  String get cardOutcomeHeld;

  /// No description provided for @cardOutcomeStudentNoShow.
  ///
  /// In en, this message translates to:
  /// **'The student did not attend'**
  String get cardOutcomeStudentNoShow;

  /// No description provided for @cardOutcomeExcusedBefore.
  ///
  /// In en, this message translates to:
  /// **'Student excused before the start'**
  String get cardOutcomeExcusedBefore;

  /// No description provided for @cardOutcomeExcusedAfter.
  ///
  /// In en, this message translates to:
  /// **'Student excused after the start'**
  String get cardOutcomeExcusedAfter;

  /// No description provided for @cardOutcomeTeacherApology.
  ///
  /// In en, this message translates to:
  /// **'The teacher apologised'**
  String get cardOutcomeTeacherApology;

  /// No description provided for @cardOutcomeTeacherNoShow.
  ///
  /// In en, this message translates to:
  /// **'The teacher was absent'**
  String get cardOutcomeTeacherNoShow;

  /// No description provided for @cardOutcomeCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get cardOutcomeCancelled;

  /// No description provided for @makeupOtherTime.
  ///
  /// In en, this message translates to:
  /// **'Another agreed date and time'**
  String get makeupOtherTime;

  /// No description provided for @makeupAgreedHint.
  ///
  /// In en, this message translates to:
  /// **'Record the make-up once you and the family have agreed on a time.'**
  String get makeupAgreedHint;

  /// The make-up time picked outside the free-slot list.
  ///
  /// In en, this message translates to:
  /// **'Chosen: {when}'**
  String makeupChosen(String when);

  /// No description provided for @groupChildrenTitle.
  ///
  /// In en, this message translates to:
  /// **'Children in this group'**
  String get groupChildrenTitle;

  /// A child's age in whole years.
  ///
  /// In en, this message translates to:
  /// **'{age, plural, =1{1 year} other{{age} years}}'**
  String groupChildAge(int age);

  /// No description provided for @groupChildAgeLabel.
  ///
  /// In en, this message translates to:
  /// **'Age'**
  String get groupChildAgeLabel;

  /// No description provided for @groupChildCourse.
  ///
  /// In en, this message translates to:
  /// **'Course'**
  String get groupChildCourse;

  /// No description provided for @groupChildSchedule.
  ///
  /// In en, this message translates to:
  /// **'Lesson days and times'**
  String get groupChildSchedule;

  /// No description provided for @groupChildPackage.
  ///
  /// In en, this message translates to:
  /// **'Package'**
  String get groupChildPackage;

  /// The package size in lessons.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 lesson} other{{count} lessons}}'**
  String groupChildPackageLessons(int count);

  /// No description provided for @groupChildTeacher.
  ///
  /// In en, this message translates to:
  /// **'Teacher'**
  String get groupChildTeacher;

  /// No description provided for @groupChildNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get groupChildNotSet;

  /// No description provided for @groupChildNoSchedule.
  ///
  /// In en, this message translates to:
  /// **'No regular times yet'**
  String get groupChildNoSchedule;

  /// A lesson's length in minutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{1 min} other{{minutes} min}}'**
  String groupChildMinutes(int minutes);

  /// No description provided for @signupOpen.
  ///
  /// In en, this message translates to:
  /// **'New parent? Create your account'**
  String get signupOpen;

  /// No description provided for @signupTitle.
  ///
  /// In en, this message translates to:
  /// **'Create your parent account'**
  String get signupTitle;

  /// No description provided for @signupEmailIntro.
  ///
  /// In en, this message translates to:
  /// **'Enter the e-mail address you gave the academy when you subscribed.'**
  String get signupEmailIntro;

  /// No description provided for @signupEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'E-mail'**
  String get signupEmailLabel;

  /// No description provided for @signupEmailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid e-mail address.'**
  String get signupEmailInvalid;

  /// No description provided for @signupSendCode.
  ///
  /// In en, this message translates to:
  /// **'Get my code'**
  String get signupSendCode;

  /// No description provided for @signupCodeSent.
  ///
  /// In en, this message translates to:
  /// **'Your supervisor will send you a 6-digit code on WhatsApp. Enter it below with the password you want.'**
  String get signupCodeSent;

  /// No description provided for @signupCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get signupCodeLabel;

  /// No description provided for @signupPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'New password (at least 4 characters)'**
  String get signupPasswordLabel;

  /// No description provided for @signupPasswordConfirmLabel.
  ///
  /// In en, this message translates to:
  /// **'Repeat the password'**
  String get signupPasswordConfirmLabel;

  /// No description provided for @signupPasswordTooShort.
  ///
  /// In en, this message translates to:
  /// **'Use at least 4 characters.'**
  String get signupPasswordTooShort;

  /// No description provided for @signupPasswordsDiffer.
  ///
  /// In en, this message translates to:
  /// **'The passwords do not match.'**
  String get signupPasswordsDiffer;

  /// No description provided for @signupFinish.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get signupFinish;

  /// No description provided for @signupCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'That code is not valid or has expired. Ask for a new one.'**
  String get signupCodeInvalid;

  /// No description provided for @signupNewCode.
  ///
  /// In en, this message translates to:
  /// **'Send a new code'**
  String get signupNewCode;

  /// No description provided for @signupTooMany.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Try again in a few minutes.'**
  String get signupTooMany;

  /// No description provided for @signupFailed.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Try again.'**
  String get signupFailed;

  /// No description provided for @resetOpen.
  ///
  /// In en, this message translates to:
  /// **'Forgot your password? I have a reset code'**
  String get resetOpen;

  /// No description provided for @resetTitle.
  ///
  /// In en, this message translates to:
  /// **'Set a new password'**
  String get resetTitle;

  /// No description provided for @resetIntro.
  ///
  /// In en, this message translates to:
  /// **'Ask the academy for a one-time code. Then enter your login, the code and a new password of your own. Nobody else will know it.'**
  String get resetIntro;

  /// No description provided for @resetUsernameLabel.
  ///
  /// In en, this message translates to:
  /// **'Your login (e-mail)'**
  String get resetUsernameLabel;

  /// No description provided for @resetUsernameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your login.'**
  String get resetUsernameRequired;

  /// No description provided for @resetCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get resetCodeLabel;

  /// No description provided for @resetCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'That code is not valid, has expired or was already used. Ask the academy for a new one.'**
  String get resetCodeInvalid;

  /// No description provided for @resetFinish.
  ///
  /// In en, this message translates to:
  /// **'Set password'**
  String get resetFinish;

  /// No description provided for @recoveryOpen.
  ///
  /// In en, this message translates to:
  /// **'Trouble signing in?'**
  String get recoveryOpen;

  /// No description provided for @recoveryTitle.
  ///
  /// In en, this message translates to:
  /// **'Get back into your account'**
  String get recoveryTitle;

  /// No description provided for @recoveryIntro.
  ///
  /// In en, this message translates to:
  /// **'Choose what you need help with. It only takes a minute.'**
  String get recoveryIntro;

  /// No description provided for @recoveryUnavailable.
  ///
  /// In en, this message translates to:
  /// **'To get back into your account, ask your supervisor for a one-time reset code, then enter it here.'**
  String get recoveryUnavailable;

  /// No description provided for @recoveryForgotPassword.
  ///
  /// In en, this message translates to:
  /// **'I forgot my password'**
  String get recoveryForgotPassword;

  /// No description provided for @recoveryForgotPasswordHint.
  ///
  /// In en, this message translates to:
  /// **'We\'ll e-mail a code to the address you sign in with.'**
  String get recoveryForgotPasswordHint;

  /// No description provided for @recoveryForgotEmail.
  ///
  /// In en, this message translates to:
  /// **'I forgot my e-mail'**
  String get recoveryForgotEmail;

  /// No description provided for @recoveryForgotEmailHint.
  ///
  /// In en, this message translates to:
  /// **'We\'ll send a code on WhatsApp to the phone number the academy has for you.'**
  String get recoveryForgotEmailHint;

  /// No description provided for @recoveryHaveCode.
  ///
  /// In en, this message translates to:
  /// **'I have a code from the academy'**
  String get recoveryHaveCode;

  /// No description provided for @recoveryHaveCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Your supervisor gave you a one-time reset code.'**
  String get recoveryHaveCodeHint;

  /// No description provided for @recoveryStillStuck.
  ///
  /// In en, this message translates to:
  /// **'Still stuck? Your supervisor can send you a one-time reset code.'**
  String get recoveryStillStuck;

  /// No description provided for @recoveryStep.
  ///
  /// In en, this message translates to:
  /// **'Step {number} of {total}'**
  String recoveryStep(int number, int total);

  /// No description provided for @recoverySendCode.
  ///
  /// In en, this message translates to:
  /// **'Send code'**
  String get recoverySendCode;

  /// No description provided for @recoveryResend.
  ///
  /// In en, this message translates to:
  /// **'Send a new code'**
  String get recoveryResend;

  /// No description provided for @recoveryResendIn.
  ///
  /// In en, this message translates to:
  /// **'Send a new code in {seconds} s'**
  String recoveryResendIn(int seconds);

  /// No description provided for @recoveryResent.
  ///
  /// In en, this message translates to:
  /// **'A new code is on its way. Only the newest code works.'**
  String get recoveryResent;

  /// No description provided for @recoveryContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get recoveryContinue;

  /// No description provided for @recoveryChangeEmail.
  ///
  /// In en, this message translates to:
  /// **'Use a different e-mail'**
  String get recoveryChangeEmail;

  /// No description provided for @recoveryChangePhone.
  ///
  /// In en, this message translates to:
  /// **'Use a different number'**
  String get recoveryChangePhone;

  /// No description provided for @recoveryCodeFormat.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6 digits of the code.'**
  String get recoveryCodeFormat;

  /// No description provided for @recoveryCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'That code is wrong or has expired. Check it, or send a new one.'**
  String get recoveryCodeInvalid;

  /// No description provided for @forgotPasswordTitle.
  ///
  /// In en, this message translates to:
  /// **'Reset your password'**
  String get forgotPasswordTitle;

  /// No description provided for @forgotPasswordIntro.
  ///
  /// In en, this message translates to:
  /// **'Enter the e-mail you sign in with. We\'ll send you a 6-digit code.'**
  String get forgotPasswordIntro;

  /// No description provided for @forgotPasswordCodeSent.
  ///
  /// In en, this message translates to:
  /// **'If {email} is a parent account, a 6-digit code is on its way. It works for {minutes, plural, =1{1 minute} other{{minutes} minutes}}; check your spam folder if you can\'t see it. Then choose a new password.'**
  String forgotPasswordCodeSent(String email, int minutes);

  /// No description provided for @forgotEmailTitle.
  ///
  /// In en, this message translates to:
  /// **'Find your sign-in e-mail'**
  String get forgotEmailTitle;

  /// No description provided for @forgotEmailIntro.
  ///
  /// In en, this message translates to:
  /// **'Enter your phone number, the one the academy has for you. We\'ll send a 6-digit code to it on WhatsApp.'**
  String get forgotEmailIntro;

  /// No description provided for @forgotEmailPhoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Phone number'**
  String get forgotEmailPhoneLabel;

  /// No description provided for @forgotEmailPhoneHint.
  ///
  /// In en, this message translates to:
  /// **'If your number is not Egyptian, start with + and the country code.'**
  String get forgotEmailPhoneHint;

  /// No description provided for @forgotEmailPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter your phone number.'**
  String get forgotEmailPhoneInvalid;

  /// No description provided for @forgotEmailCodeSent.
  ///
  /// In en, this message translates to:
  /// **'If this number is on file, a 6-digit code is on its way on WhatsApp. It works for {minutes, plural, =1{1 minute} other{{minutes} minutes}}.'**
  String forgotEmailCodeSent(int minutes);

  /// No description provided for @forgotEmailFound.
  ///
  /// In en, this message translates to:
  /// **'Your sign-in e-mail is:'**
  String get forgotEmailFound;

  /// No description provided for @forgotEmailFoundMany.
  ///
  /// In en, this message translates to:
  /// **'This phone number belongs to more than one account. Choose the one you want:'**
  String get forgotEmailFoundMany;

  /// No description provided for @forgotEmailSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in with this e-mail'**
  String get forgotEmailSignIn;

  /// No description provided for @forgotEmailSetPassword.
  ///
  /// In en, this message translates to:
  /// **'I forgot my password too'**
  String get forgotEmailSetPassword;

  /// No description provided for @studentProfileTitle.
  ///
  /// In en, this message translates to:
  /// **'Student profile'**
  String get studentProfileTitle;

  /// No description provided for @studentProfileView.
  ///
  /// In en, this message translates to:
  /// **'View profile'**
  String get studentProfileView;

  /// No description provided for @studentProfileTeacher.
  ///
  /// In en, this message translates to:
  /// **'Assigned teacher'**
  String get studentProfileTeacher;

  /// No description provided for @studentProfileSchedule.
  ///
  /// In en, this message translates to:
  /// **'Class schedule'**
  String get studentProfileSchedule;

  /// Under a student's weekly lesson times: the time zone they are written in (an IANA name such as Africa/Cairo).
  ///
  /// In en, this message translates to:
  /// **'Times in {zone}'**
  String studentProfileTimeZone(String zone);

  /// No description provided for @studentProfileNotYoursTitle.
  ///
  /// In en, this message translates to:
  /// **'You can\'t open this student\'s profile'**
  String get studentProfileNotYoursTitle;

  /// No description provided for @studentProfileNotYoursBody.
  ///
  /// In en, this message translates to:
  /// **'Only the student\'s own teacher can see it.'**
  String get studentProfileNotYoursBody;

  /// No description provided for @myPaymentsTitle.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get myPaymentsTitle;

  /// No description provided for @myPaymentsSettingsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your instalments and what has been paid'**
  String get myPaymentsSettingsSubtitle;

  /// No description provided for @billingPlanLabel.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get billingPlanLabel;

  /// The family's subscription plan, by its length in months.
  ///
  /// In en, this message translates to:
  /// **'{months, plural, =1{1-month plan} other{{months}-month plan}}'**
  String billingPlanMonths(int months);

  /// No description provided for @billingNoPlan.
  ///
  /// In en, this message translates to:
  /// **'No plan'**
  String get billingNoPlan;

  /// No description provided for @billingMethodLabel.
  ///
  /// In en, this message translates to:
  /// **'Payment method'**
  String get billingMethodLabel;

  /// No description provided for @billingMethodInvoice.
  ///
  /// In en, this message translates to:
  /// **'Invoice'**
  String get billingMethodInvoice;

  /// No description provided for @billingMethodBankTransfer.
  ///
  /// In en, this message translates to:
  /// **'Bank transfer'**
  String get billingMethodBankTransfer;

  /// No description provided for @billingNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get billingNotSet;

  /// No description provided for @billingPaidTotal.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get billingPaidTotal;

  /// No description provided for @billingOutstandingTotal.
  ///
  /// In en, this message translates to:
  /// **'Outstanding'**
  String get billingOutstandingTotal;

  /// No description provided for @billingOverdueTotal.
  ///
  /// In en, this message translates to:
  /// **'of which overdue'**
  String get billingOverdueTotal;

  /// No description provided for @billingInstalmentsTitle.
  ///
  /// In en, this message translates to:
  /// **'Instalments'**
  String get billingInstalmentsTitle;

  /// No description provided for @billingStatusOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get billingStatusOverdue;

  /// No description provided for @billingStatusDue.
  ///
  /// In en, this message translates to:
  /// **'Due today'**
  String get billingStatusDue;

  /// No description provided for @billingStatusUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get billingStatusUpcoming;

  /// No description provided for @billingStatusPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get billingStatusPaid;

  /// No description provided for @billingFamily.
  ///
  /// In en, this message translates to:
  /// **'Family'**
  String get billingFamily;

  /// An instalment's due date, already formatted for the reader.
  ///
  /// In en, this message translates to:
  /// **'Due {date}'**
  String billingDueOn(String date);

  /// A paid instalment: the day it was paid and how.
  ///
  /// In en, this message translates to:
  /// **'Paid {date} · {method}'**
  String billingPaidOn(String date, String method);

  /// A paid instalment whose payment method is not known.
  ///
  /// In en, this message translates to:
  /// **'Paid {date}'**
  String billingPaidOnNoMethod(String date);

  /// How many days an overdue instalment is late.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1 day late} other{{days} days late}}'**
  String billingDaysLate(int days);

  /// How many days until an upcoming instalment is due.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{in 1 day} other{in {days} days}}'**
  String billingDaysUntil(int days);

  /// No description provided for @billingEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No payments yet'**
  String get billingEmptyTitle;

  /// No description provided for @billingEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Your instalments will appear here.'**
  String get billingEmptyBody;

  /// No description provided for @billingDeniedTitle.
  ///
  /// In en, this message translates to:
  /// **'Payments are shown to the family\'s parents'**
  String get billingDeniedTitle;

  /// No description provided for @billingDeniedBody.
  ///
  /// In en, this message translates to:
  /// **'If you have a question, ask the academy.'**
  String get billingDeniedBody;

  /// No description provided for @tabPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get tabPayments;

  /// PD-30: the parent's bottom tab and screen for each child's subscription and the family's payments.
  ///
  /// In en, this message translates to:
  /// **'Subscriptions'**
  String get tabSubscriptions;

  /// PD-30: a plan's length, as in "3 Months — 24 Lessons".
  ///
  /// In en, this message translates to:
  /// **'{months, plural, =1{1 Month} other{{months} Months}}'**
  String subscriptionMonthCount(int months);

  /// PD-30: a plan's lessons, as in "3 Months — 24 Lessons".
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 Lesson} other{{count} Lessons}}'**
  String subscriptionLessonCount(int count);

  /// PD-30: a plan's length beside its lessons: "3 Months — 24 Lessons".
  ///
  /// In en, this message translates to:
  /// **'{months} — {lessons}'**
  String subscriptionPlanLessons(String months, String lessons);

  /// PD-30: a child with no subscription on record.
  ///
  /// In en, this message translates to:
  /// **'No subscription yet'**
  String get subscriptionNone;

  /// PD-30: a child's lessons left in their subscriptions.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No lessons left} =1{1 lesson left} other{{count} lessons left}}'**
  String subscriptionLessonsLeft(int count);

  /// PD-30: lessons used up; the lessons that may still happen while renewal is awaited.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No grace lessons left} =1{1 grace lesson left} other{{count} grace lessons left}}'**
  String subscriptionGraceLeft(int count);

  /// PD-30: a child's subscription chip: lessons go on.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get subscriptionStateOpen;

  /// PD-30: a child's subscription chip: lessons used up, grace lessons left.
  ///
  /// In en, this message translates to:
  /// **'Renewal due'**
  String get subscriptionStateGrace;

  /// PD-30: a child's subscription chip: locked for payment.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get subscriptionStateLocked;

  /// PD-30: why a child is locked: the subscription's lessons are used up.
  ///
  /// In en, this message translates to:
  /// **'Lessons used up'**
  String get subscriptionLessonsUsedUp;

  /// PD-30: why a child is locked: an instalment unpaid since the day after its due date.
  ///
  /// In en, this message translates to:
  /// **'Instalment {label} overdue since {date}'**
  String subscriptionOverdueSince(String label, String date);

  /// PD-30: a locked child with nothing to pay yet: ask the academy to renew.
  ///
  /// In en, this message translates to:
  /// **'Request renewal'**
  String get subscriptionRequestRenewal;

  /// PD-30: the renewal was asked for today.
  ///
  /// In en, this message translates to:
  /// **'Renewal requested'**
  String get subscriptionRenewalRequested;

  /// PD-30: the banner that replaces the composer in a group locked for payment.
  ///
  /// In en, this message translates to:
  /// **'Lessons are paused'**
  String get lockBannerTitle;

  /// PD-30: the locked banner, a parent's line: the child's lessons are used up.
  ///
  /// In en, this message translates to:
  /// **'{name}: lessons used up'**
  String lockBannerChildBalance(String name);

  /// PD-30: the locked banner, a parent's line: an instalment is overdue.
  ///
  /// In en, this message translates to:
  /// **'{name}: instalment {label} overdue since {date}'**
  String lockBannerChildOverdue(String name, String label, String date);

  /// PD-30: the locked banner, a teacher's line: no reason, nothing financial.
  ///
  /// In en, this message translates to:
  /// **'{name}\'s lessons are paused'**
  String lockBannerChildPaused(String name);

  /// PD-30: the locked banner when the server refused a send but named no child.
  ///
  /// In en, this message translates to:
  /// **'This group is paused for now.'**
  String get lockBannerGeneric;

  /// PD-30: the locked banner's button for a parent.
  ///
  /// In en, this message translates to:
  /// **'Go to Subscriptions'**
  String get lockBannerOpenSubscriptions;

  /// PD-30: the report's lesson number within the child's subscription.
  ///
  /// In en, this message translates to:
  /// **'Lesson {number} of {total}'**
  String reportLessonOf(int number, int total);

  /// PD-30: a report card's lesson number within the subscription.
  ///
  /// In en, this message translates to:
  /// **'{number} of {total}'**
  String cardLessonNumberOf(int number, int total);

  /// PD-30: a Schedule lesson suspended.
  ///
  /// In en, this message translates to:
  /// **'Suspended'**
  String get outcomeSuspended;

  /// PD-30: a Schedule lesson the system suspended while the child's group is locked for payment. No amount, no reason.
  ///
  /// In en, this message translates to:
  /// **'Suspended — payment'**
  String get outcomeSuspendedPayment;

  /// PD-30: the group card when a child's lessons are paused (no reason).
  ///
  /// In en, this message translates to:
  /// **'Lessons paused'**
  String get cardLessonsPausedTitle;

  /// PD-30: the family's direct-chat card when a child is locked.
  ///
  /// In en, this message translates to:
  /// **'Lessons paused — payment'**
  String get cardSubscriptionLockedTitle;

  /// PD-30: where to pay, on the locked card.
  ///
  /// In en, this message translates to:
  /// **'Renew or pay in Subscriptions.'**
  String get cardSubscriptionLockedHint;

  /// PD-30: the group card when a locked child's lessons resume.
  ///
  /// In en, this message translates to:
  /// **'Lessons are back on'**
  String get cardSubscriptionUnlockedTitle;

  /// No description provided for @roleSales.
  ///
  /// In en, this message translates to:
  /// **'Sales'**
  String get roleSales;

  /// No description provided for @roleSuperAdmin.
  ///
  /// In en, this message translates to:
  /// **'Super admin'**
  String get roleSuperAdmin;

  /// No description provided for @conversationsEmptyBodySales.
  ///
  /// In en, this message translates to:
  /// **'Trial groups and your conversations will appear here.'**
  String get conversationsEmptyBodySales;

  /// No description provided for @internalNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Internal note'**
  String get internalNoteLabel;

  /// No description provided for @trialGroupNotMember.
  ///
  /// In en, this message translates to:
  /// **'You are not a member of this group yet.'**
  String get trialGroupNotMember;

  /// No description provided for @trialGroupJoin.
  ///
  /// In en, this message translates to:
  /// **'Join this group'**
  String get trialGroupJoin;

  /// No description provided for @salesSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search parents or families'**
  String get salesSearchHint;

  /// No description provided for @salesSearchEmpty.
  ///
  /// In en, this message translates to:
  /// **'No parents found'**
  String get salesSearchEmpty;

  /// No description provided for @salesSearchTruncated.
  ///
  /// In en, this message translates to:
  /// **'Showing the first results. Type more to narrow the search.'**
  String get salesSearchTruncated;

  /// How many children a family has, in a search result.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No children} =1{1 child} other{{count} children}}'**
  String salesChildrenCount(int count);

  /// No description provided for @salesPaymentsDenied.
  ///
  /// In en, this message translates to:
  /// **'Payments are not available for your account.'**
  String get salesPaymentsDenied;

  /// No description provided for @billingCurrencyLabel.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get billingCurrencyLabel;

  /// No description provided for @billingStatusVoided.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get billingStatusVoided;

  /// A paid instalment: when, how, and which staff member recorded it.
  ///
  /// In en, this message translates to:
  /// **'Paid {date} · {method} · recorded by {name}'**
  String salesPaidRecordedBy(String date, String method, String name);

  /// A voided instalment: who voided it and why.
  ///
  /// In en, this message translates to:
  /// **'Voided by {name}: {reason}'**
  String salesVoidedBy(String name, String reason);

  /// A voided instalment whose voiding staff member is not known.
  ///
  /// In en, this message translates to:
  /// **'Voided: {reason}'**
  String salesVoidedReason(String reason);

  /// No description provided for @salesRecordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record payment'**
  String get salesRecordPayment;

  /// No description provided for @salesVoid.
  ///
  /// In en, this message translates to:
  /// **'Void'**
  String get salesVoid;

  /// No description provided for @salesPaidOnLabel.
  ///
  /// In en, this message translates to:
  /// **'Paid on'**
  String get salesPaidOnLabel;

  /// No description provided for @salesReferenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Reference (optional)'**
  String get salesReferenceLabel;

  /// No description provided for @salesRecordSave.
  ///
  /// In en, this message translates to:
  /// **'Record'**
  String get salesRecordSave;

  /// No description provided for @salesVoidTitle.
  ///
  /// In en, this message translates to:
  /// **'Void this instalment?'**
  String get salesVoidTitle;

  /// No description provided for @salesVoidFinal.
  ///
  /// In en, this message translates to:
  /// **'Voiding is final: the instalment can no longer be paid.'**
  String get salesVoidFinal;

  /// No description provided for @salesVoidReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get salesVoidReasonLabel;

  /// No description provided for @salesVoidConfirm.
  ///
  /// In en, this message translates to:
  /// **'Void instalment'**
  String get salesVoidConfirm;

  /// No description provided for @salesBillingStateConflict.
  ///
  /// In en, this message translates to:
  /// **'This instalment was already paid or voided. The list has been refreshed.'**
  String get salesBillingStateConflict;

  /// No description provided for @salesBillingInvalid.
  ///
  /// In en, this message translates to:
  /// **'Check the date and the reference, then try again.'**
  String get salesBillingInvalid;

  /// No description provided for @salesWriteFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save. Try again.'**
  String get salesWriteFailed;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Date & time'**
  String get settingsDateTime;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Time zone: {zone}'**
  String settingsDateTimeSubtitle(String zone);

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Set automatically'**
  String get timeZoneSetAutomatically;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Uses your phone\'s time zone, and changes by itself when you travel.'**
  String get timeZoneAutomaticHint;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Time zone'**
  String get timeZoneLabel;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Not known yet'**
  String get timeZoneUnknown;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Lesson times, reminders and notifications are shown in this time zone.'**
  String get timeZoneAppliesTo;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Search for a city'**
  String get timeZoneSearchHint;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'No time zone matches.'**
  String get timeZoneNoMatch;

  /// PD-22: Settings -> Date & time.
  ///
  /// In en, this message translates to:
  /// **'Could not change the time zone. Try again.'**
  String get timeZoneSaveFailed;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Amount due'**
  String get billingAmountDueTitle;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Pay'**
  String get billingPay;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Paid {paid} of {total}'**
  String billingPaidOfTotal(String paid, String total);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'{start} – {end}'**
  String billingPeriod(String start, String end);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'We\'re confirming your payment. This can take a minute.'**
  String get billingConfirmingPayment;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'How would you like to pay?'**
  String get billingPaySheetTitle;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Pay by card'**
  String get billingPayByCard;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Opens a secure payment page'**
  String get billingPayByCardHint;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Transfer the amount, then upload the receipt'**
  String get billingBankTransferHint;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Card payment isn\'t available right now. You can pay by bank transfer.'**
  String get billingPaymentsUnavailable;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'This has already been paid or is no longer open. The list has been refreshed.'**
  String get billingNoLongerOpen;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open the page. Try again.'**
  String get billingCouldNotOpen;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Amount to transfer'**
  String get billingTransferAmount;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Bank'**
  String get billingBankName;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Account name'**
  String get billingAccountName;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'IBAN'**
  String get billingIban;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Account number'**
  String get billingAccountNumber;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'SWIFT'**
  String get billingSwift;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get billingCopy;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get billingCopied;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'The academy hasn\'t added its bank details yet. Ask your supervisor for them.'**
  String get billingNoBankAccount;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Upload receipt'**
  String get billingUploadReceiptTitle;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get billingReceiptPhoto;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get billingReceiptCamera;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'PDF'**
  String get billingReceiptPdf;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'A screenshot or PDF of the transfer: JPEG, PNG, WebP or PDF, up to 10 MB.'**
  String get billingReceiptFileHint;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Photo attached'**
  String get billingReceiptAttachedPhoto;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get billingReceiptRemove;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Amount you transferred ({currency})'**
  String billingReceiptAmountLabel(String currency);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Transfer date'**
  String get billingReceiptDateLabel;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get billingReceiptNoteLabel;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Send receipt'**
  String get billingReceiptSend;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Receipt sent. The academy will confirm it soon.'**
  String get billingReceiptSent;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Attach the receipt first.'**
  String get billingReceiptNeedFile;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount you transferred.'**
  String get billingReceiptBadAmount;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Use a JPEG, PNG or WebP image, or a PDF.'**
  String get billingReceiptWrongType;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'The file is larger than 10 MB.'**
  String get billingReceiptTooLarge;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Allow access in Settings, then try again.'**
  String get billingReceiptPickDenied;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t use that file. Try another one.'**
  String get billingReceiptPickFailed;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Check the amount and the date, then try again.'**
  String get billingReceiptInvalid;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Transfer receipts'**
  String get billingReceiptsTitle;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Pending verification'**
  String get billingReceiptPending;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get billingReceiptApproved;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get billingReceiptRejected;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Reason: {reason}'**
  String billingReceiptRejectReason(String reason);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Transferred {date}'**
  String billingTransferredOn(String date);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Invoices'**
  String get billingInvoicesTitle;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Issued {date}'**
  String billingInvoiceIssued(String date);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Refunded'**
  String get billingInvoiceRefunded;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Partially refunded'**
  String get billingInvoicePartiallyRefunded;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Download'**
  String get billingInvoiceDownload;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Refunded {amount}'**
  String billingRefundedAmount(String amount);

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Card'**
  String get billingMethodCard;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Cash'**
  String get billingMethodCash;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Wait a while, then try again.'**
  String get billingTooManyAttempts;

  /// PD-27: Settings -> Payments.
  ///
  /// In en, this message translates to:
  /// **'This receipt can\'t be added: the amount is already paid or closed, or other receipts are still waiting to be checked.'**
  String get billingReceiptNotAccepted;

  /// PD-28: web portal sign-in checkbox (PD-23 'keep me signed in'). Only shown in a browser.
  ///
  /// In en, this message translates to:
  /// **'Keep me signed in on this device'**
  String get signInKeepSignedIn;

  /// PD-28: shown in the browser to a signed-in account that is not a teacher.
  ///
  /// In en, this message translates to:
  /// **'The web portal is for teachers'**
  String get webPortalTitle;

  /// PD-28: the web portal refusal, for a parent.
  ///
  /// In en, this message translates to:
  /// **'Please use the Jawwid app on your phone.'**
  String get webPortalFamilyBody;

  /// PD-28: the web portal refusal, for a staff member.
  ///
  /// In en, this message translates to:
  /// **'Please use Admin Web, or the Jawwid app on your phone.'**
  String get webPortalStaffBody;

  /// PD-28: shown in the browser instead of starting a recording.
  ///
  /// In en, this message translates to:
  /// **'Voice notes can be recorded in the phone app.'**
  String get voiceNoteWebUnavailable;

  /// PD-29: the child's Materials page title.
  ///
  /// In en, this message translates to:
  /// **'Materials'**
  String get materialsTitle;

  /// PD-29: an activity (a lesson page in the app) failed to load -- TLS, the network or a 404 -- instead of a blank page; Try again reloads it.
  ///
  /// In en, this message translates to:
  /// **'This lesson couldn\'t load.'**
  String get activityLoadFailed;

  /// PD-29: the entry to a child's Materials page.
  ///
  /// In en, this message translates to:
  /// **'Library, practice this week and the memorization map'**
  String get materialsEntrySubtitle;

  /// PD-29 tab.
  ///
  /// In en, this message translates to:
  /// **'Library'**
  String get materialsTabLibrary;

  /// PD-29 the practice line on a lesson report's card.
  ///
  /// In en, this message translates to:
  /// **'Practice this week'**
  String get materialsTabPractice;

  /// PD-29 amendment tab: what was opened for the child this academy week.
  ///
  /// In en, this message translates to:
  /// **'Opened this week'**
  String get materialsTabOpened;

  /// PD-29 amendment empty Opened this week.
  ///
  /// In en, this message translates to:
  /// **'Nothing opened yet this week'**
  String get materialsOpenedEmpty;

  /// PD-29 amendment which week Opened this week covers.
  ///
  /// In en, this message translates to:
  /// **'The week runs Saturday to Friday, academy time.'**
  String get materialsOpenedWeekNote;

  /// PD-29 amendment an item's last opening this week.
  ///
  /// In en, this message translates to:
  /// **'Last opened {when}'**
  String materialsOpenedLast(String when);

  /// PD-29 subject.
  ///
  /// In en, this message translates to:
  /// **'Quran'**
  String get materialsSubjectQuran;

  /// PD-29 subject.
  ///
  /// In en, this message translates to:
  /// **'Arabic language'**
  String get materialsSubjectArabic;

  /// PD-29 subject.
  ///
  /// In en, this message translates to:
  /// **'Islamic studies'**
  String get materialsSubjectIslamic;

  /// PD-29 Quran strand.
  ///
  /// In en, this message translates to:
  /// **'Memorization'**
  String get materialsStrandMemorization;

  /// PD-29 Quran strand.
  ///
  /// In en, this message translates to:
  /// **'Recitation'**
  String get materialsStrandRecitation;

  /// PD-29 Quran strand.
  ///
  /// In en, this message translates to:
  /// **'Word meanings'**
  String get materialsStrandWordMeanings;

  /// PD-29 Quran strand.
  ///
  /// In en, this message translates to:
  /// **'Tafsir'**
  String get materialsStrandTafsir;

  /// PD-29 item kind.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get materialsKindActivity;

  /// PD-29 item kind.
  ///
  /// In en, this message translates to:
  /// **'Audio'**
  String get materialsKindAudio;

  /// PD-29 item kind.
  ///
  /// In en, this message translates to:
  /// **'Video'**
  String get materialsKindVideo;

  /// PD-29 item kind.
  ///
  /// In en, this message translates to:
  /// **'PDF'**
  String get materialsKindPdf;

  /// PD-29 item kind.
  ///
  /// In en, this message translates to:
  /// **'Picture'**
  String get materialsKindImage;

  /// PD-29 age filter.
  ///
  /// In en, this message translates to:
  /// **'All ages'**
  String get materialsAgeAll;

  /// PD-29 an age band, e.g. Ages 7–9.
  ///
  /// In en, this message translates to:
  /// **'Ages {band}'**
  String materialsAgeBand(String band);

  /// PD-29 the child's own band in the filter.
  ///
  /// In en, this message translates to:
  /// **'{band} · your child\'s age'**
  String materialsAgeForChild(String band);

  /// PD-29 empty library.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet for this subject and age.'**
  String get materialsLibraryEmpty;

  /// PD-29 load failure.
  ///
  /// In en, this message translates to:
  /// **'Materials could not be loaded.'**
  String get materialsUnavailable;

  /// PD-29 an ayah range to practise.
  ///
  /// In en, this message translates to:
  /// **'Surah {surah}, ayahs {from}–{to}'**
  String materialsAyahRange(String surah, String from, String to);

  /// PD-29 a whole surah to practise.
  ///
  /// In en, this message translates to:
  /// **'Surah {surah}'**
  String materialsWholeSurah(String surah);

  /// PD-29 a retired item in practice.
  ///
  /// In en, this message translates to:
  /// **'This item is no longer in the library.'**
  String get materialsItemGone;

  /// PD-29 open an activity outside the app.
  ///
  /// In en, this message translates to:
  /// **'Open in browser'**
  String get materialsOpenExternally;

  /// PD-29 open failed.
  ///
  /// In en, this message translates to:
  /// **'This could not be opened on this device.'**
  String get materialsCannotOpen;

  /// PD-29 playback failed.
  ///
  /// In en, this message translates to:
  /// **'This could not be played.'**
  String get materialsPlayFailed;

  /// PD-29 report section.
  ///
  /// In en, this message translates to:
  /// **'Practice this week'**
  String get reportPracticeLabel;

  /// PD-29 report action.
  ///
  /// In en, this message translates to:
  /// **'Add ayahs'**
  String get reportPracticeAddAyahs;

  /// PD-29 report action.
  ///
  /// In en, this message translates to:
  /// **'From the library'**
  String get reportPracticeAddItem;

  /// PD-29 report edit hint.
  ///
  /// In en, this message translates to:
  /// **'Practice stays as it was unless you change it.'**
  String get reportPracticeKeep;

  /// PD-29 surah field.
  ///
  /// In en, this message translates to:
  /// **'Surah'**
  String get reportSurahLabel;

  /// PD-29 ayah field.
  ///
  /// In en, this message translates to:
  /// **'From ayah'**
  String get reportAyahFrom;

  /// PD-29 ayah field.
  ///
  /// In en, this message translates to:
  /// **'To ayah'**
  String get reportAyahTo;

  /// PD-29 ayah range error.
  ///
  /// In en, this message translates to:
  /// **'Ayahs 1 to {count}, the first not after the last.'**
  String reportAyahInvalid(String count);

  /// PD-29 add button.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get reportAdd;

  /// PD-29 item picker.
  ///
  /// In en, this message translates to:
  /// **'Search the library'**
  String get reportPickerSearch;

  /// PD-29 item picker.
  ///
  /// In en, this message translates to:
  /// **'No published items match.'**
  String get reportPickerEmpty;

  /// PD-31: the per-child ticket under + and the schedule button.
  ///
  /// In en, this message translates to:
  /// **'Change lesson time'**
  String get ticketChangeLessonTime;

  /// PD-31 slot picker: times before 12:00.
  ///
  /// In en, this message translates to:
  /// **'Morning'**
  String get slotsMorning;

  /// PD-31 slot picker: times from 12:00 to 17:00.
  ///
  /// In en, this message translates to:
  /// **'Afternoon'**
  String get slotsAfternoon;

  /// PD-31 slot picker: times from 17:00.
  ///
  /// In en, this message translates to:
  /// **'Evening'**
  String get slotsEvening;

  /// PD-31 slot picker: screen-reader label of a day chip.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 free time} other{{count} free times}}'**
  String slotsFreeCount(int count);

  /// PD-31: on a weekly time the teacher is busy at on these dates.
  ///
  /// In en, this message translates to:
  /// **'except {dates}'**
  String slotsExcept(String dates);

  /// PD-30/31: shown instead of the time chips while lessons are locked.
  ///
  /// In en, this message translates to:
  /// **'Lessons paused — payment'**
  String get slotsLocked;

  /// PD-31 slot picker: nothing to offer.
  ///
  /// In en, this message translates to:
  /// **'No free times right now.'**
  String get slotsNone;

  /// PD-31: first choice of Change lesson time.
  ///
  /// In en, this message translates to:
  /// **'This lesson only'**
  String get changeTimeOnce;

  /// PD-31: under This lesson only.
  ///
  /// In en, this message translates to:
  /// **'Move one lesson to another free time'**
  String get changeTimeOnceHint;

  /// PD-31: second choice of Change lesson time.
  ///
  /// In en, this message translates to:
  /// **'Every week'**
  String get changeTimeWeekly;

  /// PD-31: under Every week.
  ///
  /// In en, this message translates to:
  /// **'Change the regular weekly times'**
  String get changeTimeWeeklyHint;

  /// PD-31: above the child's upcoming lessons.
  ///
  /// In en, this message translates to:
  /// **'Which lesson?'**
  String get changeTimePickLesson;

  /// PD-31: nothing to move.
  ///
  /// In en, this message translates to:
  /// **'No upcoming lessons in the next four weeks.'**
  String get changeTimeNoLessons;

  /// PD-31: the lesson being moved.
  ///
  /// In en, this message translates to:
  /// **'Now: {when}'**
  String changeTimeCurrent(String when);

  /// PD-31: a time before and after a change.
  ///
  /// In en, this message translates to:
  /// **'{from} → {to}'**
  String changeTimeSummary(String from, String to);

  /// PD-31: moves the lesson.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get changeTimeConfirm;

  /// PD-31: how many lesson moves the family has left for this child this month.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No moves left this month} =1{1 move left this month} other{{count} moves left this month}}'**
  String changeTimeMovesLeft(int count);

  /// PD-31: a move refused because the time stopped being free.
  ///
  /// In en, this message translates to:
  /// **'That time was just taken. Please choose another.'**
  String get changeTimeTaken;

  /// PD-31 refusal: started.
  ///
  /// In en, this message translates to:
  /// **'This lesson has already started.'**
  String get moveRefusedStarted;

  /// PD-31 refusal: not_movable.
  ///
  /// In en, this message translates to:
  /// **'This lesson can\'t be moved.'**
  String get moveRefusedNotMovable;

  /// PD-31 refusal: family_already_moved.
  ///
  /// In en, this message translates to:
  /// **'This lesson has already been moved once.'**
  String get moveRefusedAlreadyMoved;

  /// PD-31 refusal: family_monthly_limit.
  ///
  /// In en, this message translates to:
  /// **'This month\'s limit of moves for this child has been reached.'**
  String get moveRefusedMonthlyLimit;

  /// PD-31 refusal: too_late.
  ///
  /// In en, this message translates to:
  /// **'It\'s too close to the start to move this lesson.'**
  String get moveRefusedTooLate;

  /// PD-31: above the weekly time cards.
  ///
  /// In en, this message translates to:
  /// **'Current weekly times'**
  String get weeklyCurrentTitle;

  /// PD-31: the child has no regular times.
  ///
  /// In en, this message translates to:
  /// **'No weekly times yet.'**
  String get weeklyNoCurrent;

  /// PD-31: replace one weekly time.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get weeklyChange;

  /// PD-31: stop one weekly time.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get weeklyRemove;

  /// PD-31: undo a change to one weekly time.
  ///
  /// In en, this message translates to:
  /// **'Undo'**
  String get weeklyUndo;

  /// PD-31: add a weekly time.
  ///
  /// In en, this message translates to:
  /// **'Add a time'**
  String get weeklyAdd;

  /// PD-31: above the picker when replacing a weekly time.
  ///
  /// In en, this message translates to:
  /// **'New time instead of {when}'**
  String weeklyPickReplacement(String when);

  /// PD-31: above the picker when adding a weekly time.
  ///
  /// In en, this message translates to:
  /// **'Choose a time to add'**
  String get weeklyPickAdded;

  /// PD-31: a removed weekly time.
  ///
  /// In en, this message translates to:
  /// **'Will stop'**
  String get weeklyWillStop;

  /// PD-31: when the new weekly times start.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get weeklyFrom;

  /// PD-31 summary: the first date of the change.
  ///
  /// In en, this message translates to:
  /// **'From {date}'**
  String weeklySummaryFrom(String date);

  /// PD-31 summary: an added weekly time.
  ///
  /// In en, this message translates to:
  /// **'Add {when}'**
  String weeklySummaryAdded(String when);

  /// PD-31 summary: a removed weekly time.
  ///
  /// In en, this message translates to:
  /// **'Stop {when}'**
  String weeklySummaryRemoved(String when);

  /// PD-31 summary: a weekly time kept.
  ///
  /// In en, this message translates to:
  /// **'{when} unchanged'**
  String weeklySummaryUnchanged(String when);

  /// PD-31 summary: a week the teacher already teaches at the new time.
  ///
  /// In en, this message translates to:
  /// **'{date} will be skipped'**
  String weeklySummarySkipped(String date);

  /// PD-31: a child's schedule (entry and screen title).
  ///
  /// In en, this message translates to:
  /// **'Schedule'**
  String get childScheduleTitle;

  /// PD-31: under the Schedule entry on a child's card.
  ///
  /// In en, this message translates to:
  /// **'Weekly times and upcoming lessons'**
  String get childScheduleEntrySubtitle;

  /// PD-31: section of a child's schedule.
  ///
  /// In en, this message translates to:
  /// **'Weekly times'**
  String get childScheduleWeekly;

  /// PD-31: section of a child's schedule.
  ///
  /// In en, this message translates to:
  /// **'Next four weeks'**
  String get childScheduleUpcoming;

  /// PD-31: empty lesson list.
  ///
  /// In en, this message translates to:
  /// **'No lessons in the next four weeks.'**
  String get childScheduleNoLessons;

  /// PD-31: a weekly-time request is pending.
  ///
  /// In en, this message translates to:
  /// **'A change of times is waiting for the supervision team.'**
  String get childSchedulePending;

  /// PD-31: load failure.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the schedule.'**
  String get childScheduleLoadFailed;

  /// PD-31: a lesson moved here, with the time it was moved from.
  ///
  /// In en, this message translates to:
  /// **'Was {when}'**
  String childLessonMovedFrom(String when);

  /// PD-31: the family apologised for this lesson.
  ///
  /// In en, this message translates to:
  /// **'Excused'**
  String get childLessonExcused;

  /// PD-31: lesson_moved card title.
  ///
  /// In en, this message translates to:
  /// **'Lesson moved'**
  String get cardMovedTitle;

  /// PD-31: lesson_moved card footnote.
  ///
  /// In en, this message translates to:
  /// **'Moved by the family'**
  String get cardMovedByFamily;

  /// PD-31: lesson_moved card footnote.
  ///
  /// In en, this message translates to:
  /// **'Moved by the teacher'**
  String get cardMovedByTeacher;

  /// PD-31: lesson_moved card footnote.
  ///
  /// In en, this message translates to:
  /// **'Moved by the supervision team'**
  String get cardMovedByStaff;

  /// PD-31: lessons the teacher moved this month. Neutral, not a violation.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Lessons moved: 1} other{Lessons moved: {count}}}'**
  String workloadMoved(int count);

  /// PD-32: the Chats chip that shows the viewer's starred messages.
  ///
  /// In en, this message translates to:
  /// **'Starred'**
  String get filterStarred;

  /// PD-32: the small label on a trial group, beside its name.
  ///
  /// In en, this message translates to:
  /// **'Trial'**
  String get trialBadge;

  /// PD-16 amendment: AUTH.SIGNUP_LOCKED, after 10 wrong codes in 24 hours.
  ///
  /// In en, this message translates to:
  /// **'Too many wrong codes. Please contact your supervisor.'**
  String get signupLocked;

  /// PD-32: the row on a child's card, and the screen title.
  ///
  /// In en, this message translates to:
  /// **'Feedback about the teacher'**
  String get feedbackEntryTitle;

  /// PD-32: under the entry row.
  ///
  /// In en, this message translates to:
  /// **'Praise, a suggestion or a complaint'**
  String get feedbackEntrySubtitle;

  /// PD-32: who the feedback is about.
  ///
  /// In en, this message translates to:
  /// **'Teacher: {name}'**
  String feedbackTeacherLine(String name);

  /// PD-32: heading over the list.
  ///
  /// In en, this message translates to:
  /// **'Your earlier feedback'**
  String get feedbackHistoryTitle;

  /// PD-32: empty list title.
  ///
  /// In en, this message translates to:
  /// **'No feedback sent yet'**
  String get feedbackEmpty;

  /// PD-32: empty list body.
  ///
  /// In en, this message translates to:
  /// **'Tell the administration what is going well, or what could be better.'**
  String get feedbackEmptyBody;

  /// PD-32: the child has no teacher, so there is no one to give feedback about.
  ///
  /// In en, this message translates to:
  /// **'No teacher is assigned to this child yet.'**
  String get feedbackNoTeacher;

  /// PD-32: the action, and the form's title.
  ///
  /// In en, this message translates to:
  /// **'New feedback'**
  String get feedbackNew;

  /// PD-32: when an item was sent.
  ///
  /// In en, this message translates to:
  /// **'Sent {date}'**
  String feedbackSentOn(String date);

  /// PD-32: status chip.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get feedbackStatusReceived;

  /// PD-32: status chip.
  ///
  /// In en, this message translates to:
  /// **'In review'**
  String get feedbackStatusInReview;

  /// PD-32: status chip.
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get feedbackStatusResolved;

  /// PD-32: over the staff reply.
  ///
  /// In en, this message translates to:
  /// **'Reply from the administration'**
  String get feedbackResponseLabel;

  /// PD-32: over the category chips.
  ///
  /// In en, this message translates to:
  /// **'What kind of feedback is it?'**
  String get feedbackCategoryLabel;

  /// PD-32: category.
  ///
  /// In en, this message translates to:
  /// **'Praise'**
  String get feedbackCategoryPraise;

  /// PD-32: category.
  ///
  /// In en, this message translates to:
  /// **'Suggestion'**
  String get feedbackCategorySuggestion;

  /// PD-32: category.
  ///
  /// In en, this message translates to:
  /// **'Complaint'**
  String get feedbackCategoryComplaint;

  /// PD-32: no category chosen.
  ///
  /// In en, this message translates to:
  /// **'Choose the kind of feedback.'**
  String get feedbackChooseCategory;

  /// PD-32: the text field.
  ///
  /// In en, this message translates to:
  /// **'Your feedback'**
  String get feedbackBodyLabel;

  /// PD-32: the text field hint.
  ///
  /// In en, this message translates to:
  /// **'Write what happened, or what you would like to change.'**
  String get feedbackBodyHint;

  /// PD-32: empty text.
  ///
  /// In en, this message translates to:
  /// **'Write your feedback first.'**
  String get feedbackBodyRequired;

  /// PD-32: said once, under the field.
  ///
  /// In en, this message translates to:
  /// **'The administration reviews every message. The teacher does not see who wrote it.'**
  String get feedbackPrivacyNote;

  /// PD-32: submit button.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get feedbackSubmit;

  /// PD-32: after a successful submit.
  ///
  /// In en, this message translates to:
  /// **'Thank you. Your feedback has reached the administration.'**
  String get feedbackSent;

  /// PD-32: COMM.FEEDBACK_LIMIT.
  ///
  /// In en, this message translates to:
  /// **'You have sent a lot of feedback today. Please try again tomorrow.'**
  String get feedbackLimit;

  /// PD-32: COMM.FEEDBACK_NOT_FOUND.
  ///
  /// In en, this message translates to:
  /// **'This child has no teacher to give feedback about right now.'**
  String get feedbackNotFound;

  /// PD-32: COMM.FEEDBACK_DENIED.
  ///
  /// In en, this message translates to:
  /// **'Only a parent can send feedback about a teacher.'**
  String get feedbackDenied;

  /// PD-32: any other failure.
  ///
  /// In en, this message translates to:
  /// **'Your feedback could not be sent. Please try again.'**
  String get feedbackFailed;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsCenterTitle;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get notificationsTabAll;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Unread'**
  String get notificationsTabUnread;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Requires action'**
  String get notificationsTabAction;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Lessons'**
  String get notificationsTabLessons;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get notificationsTabPayments;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Conversations'**
  String get notificationsTabConversations;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Announcements'**
  String get notificationsTabAnnouncements;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Mark all as read'**
  String get notificationsMarkAllRead;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Show older'**
  String get notificationsLoadOlder;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Open conversation'**
  String get notificationsActionOpenConversation;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'View lesson'**
  String get notificationsActionViewLesson;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'View payments'**
  String get notificationsActionViewPayments;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'View story'**
  String get notificationsActionOpenStories;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'View calls'**
  String get notificationsActionOpenCalls;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Quiet hours'**
  String get notificationSettingsQuietHours;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Notifications wait until quiet hours end, in your own time zone. Calls and lesson-start reminders always come through.'**
  String get notificationSettingsQuietHoursBody;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get notificationSettingsFrom;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Until'**
  String get notificationSettingsUntil;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Use the academy\'s default'**
  String get notificationSettingsUseDefault;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Show names on the lock screen'**
  String get notificationSettingsShowNames;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Show your child\'s name in lesson reminders and the amount in payment reminders while the phone is locked.'**
  String get notificationSettingsShowNamesBody;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Show the student\'s name in lesson reminders while the phone is locked.'**
  String get notificationSettingsShowNamesTeacherBody;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Push notifications'**
  String get notificationSettingsCategories;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Switched off, they still appear in Notifications, without an alert.'**
  String get notificationSettingsCategoriesBody;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Always on'**
  String get notificationSettingsLocked;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get notificationCategoryMessages;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Calls'**
  String get notificationCategoryCalls;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Tasks'**
  String get notificationCategoryTasks;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Announcements and stories'**
  String get notificationCategoryAnnouncements;

  /// PD-34: the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get notificationCategorySystem;

  /// PD-36: the @ list above the message box.
  ///
  /// In en, this message translates to:
  /// **'Mention someone'**
  String get mentionListLabel;

  /// No description provided for @mentionNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No one here by that name'**
  String get mentionNoMatch;

  /// PD-36: on an @ list row for someone not in the chat; picking them asks them in.
  ///
  /// In en, this message translates to:
  /// **'Asked to join'**
  String get mentionAskedToJoin;

  /// PD-36: the label inserted after @ for a parent's role mention of the child's supervisor.
  ///
  /// In en, this message translates to:
  /// **'supervisor'**
  String get mentionRoleSupervisor;

  /// PD-36: the label inserted after @ for a parent's role mention of the administration.
  ///
  /// In en, this message translates to:
  /// **'admin'**
  String get mentionRoleAdmin;

  /// No description provided for @mentionRoleSupervisorHint.
  ///
  /// In en, this message translates to:
  /// **'The child\'s supervisor'**
  String get mentionRoleSupervisorHint;

  /// No description provided for @mentionRoleAdminHint.
  ///
  /// In en, this message translates to:
  /// **'The supervisor and the operations manager'**
  String get mentionRoleAdminHint;

  /// No description provided for @mentionStaffManager.
  ///
  /// In en, this message translates to:
  /// **'Manager'**
  String get mentionStaffManager;

  /// No description provided for @mentionStaffSupervisor.
  ///
  /// In en, this message translates to:
  /// **'Supervisor'**
  String get mentionStaffSupervisor;

  /// No description provided for @mentionStaffCoverage.
  ///
  /// In en, this message translates to:
  /// **'Coverage supervisor'**
  String get mentionStaffCoverage;

  /// PD-36: Group Info, someone asked in who has not joined yet.
  ///
  /// In en, this message translates to:
  /// **'Mentioned — waiting'**
  String get mentionWaiting;

  /// PD-36: who asked them in, and when.
  ///
  /// In en, this message translates to:
  /// **'asked by {name}, {date}'**
  String mentionAskedBy(String name, String date);

  /// No description provided for @mentionSomeoneHere.
  ///
  /// In en, this message translates to:
  /// **'someone in this chat'**
  String get mentionSomeoneHere;

  /// PD-36: the @ marker on a chat row.
  ///
  /// In en, this message translates to:
  /// **'You were mentioned'**
  String get mentionedMark;

  /// PD-37: one person typing in the chat header.
  ///
  /// In en, this message translates to:
  /// **'{name} is typing…'**
  String typingOne(String name);

  /// PD-37: two people typing.
  ///
  /// In en, this message translates to:
  /// **'{first} and {second} are typing…'**
  String typingTwo(String first, String second);

  /// PD-37: the long-press entry on one's own message.
  ///
  /// In en, this message translates to:
  /// **'Message info'**
  String get messageInfoAction;

  /// PD-37: Message info section.
  ///
  /// In en, this message translates to:
  /// **'Read by'**
  String get messageInfoReadBy;

  /// PD-37: Message info section.
  ///
  /// In en, this message translates to:
  /// **'Delivered to'**
  String get messageInfoDeliveredTo;

  /// PD-37: Message info section.
  ///
  /// In en, this message translates to:
  /// **'Not delivered yet'**
  String get messageInfoPending;

  /// PD-37: an empty Message info section.
  ///
  /// In en, this message translates to:
  /// **'Nobody'**
  String get messageInfoNobody;

  /// PD-37: Message info could not be read.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load message info'**
  String get messageInfoFailed;

  /// PD-40: a department specialist without chat access signed in on the app.
  ///
  /// In en, this message translates to:
  /// **'This account uses Admin Web'**
  String get adminWebOnlyTitle;

  /// PD-40: why a department specialist cannot use the app, and where to go.
  ///
  /// In en, this message translates to:
  /// **'Department staff accounts work in Admin Web, in a browser. Sign in there with the same e-mail and password.'**
  String get adminWebOnlyBody;

  /// PD-40: dismisses the Admin Web notice and shows the sign-in form again.
  ///
  /// In en, this message translates to:
  /// **'Use another account'**
  String get adminWebOnlyAnotherAccount;

  /// PD-47: the Schedule's To do segment, with how many tasks are open.
  ///
  /// In en, this message translates to:
  /// **'To do ({count})'**
  String scheduleFilterTodo(int count);

  /// PD-47: the To do list is empty.
  ///
  /// In en, this message translates to:
  /// **'Nothing to do.'**
  String get todoEmpty;

  /// No description provided for @todoLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your tasks. Try again.'**
  String get todoLoadFailed;

  /// PD-47: a task's level (red).
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get taskLevelHigh;

  /// No description provided for @taskLevelMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get taskLevelMedium;

  /// No description provided for @taskLevelLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get taskLevelLow;

  /// PD-47: why a task's level was raised.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get taskReasonOverdue;

  /// No description provided for @taskReasonDueSoon.
  ///
  /// In en, this message translates to:
  /// **'Due soon'**
  String get taskReasonDueSoon;

  /// No description provided for @taskReasonSource.
  ///
  /// In en, this message translates to:
  /// **'Raised by its source'**
  String get taskReasonSource;

  /// PD-47: the tag on a financial task.
  ///
  /// In en, this message translates to:
  /// **'Finance'**
  String get taskFinance;

  /// No description provided for @taskTitleLessonReport.
  ///
  /// In en, this message translates to:
  /// **'Write the lesson report: {learner}, {when}'**
  String taskTitleLessonReport(String learner, String when);

  /// No description provided for @taskTitleReportCorrection.
  ///
  /// In en, this message translates to:
  /// **'Correct the lesson report: {learner}, {when}'**
  String taskTitleReportCorrection(String learner, String when);

  /// PD-47 PR-6b: the teacher's step of a trial.
  ///
  /// In en, this message translates to:
  /// **'Record attendance: {prospect}, trial {when}'**
  String taskTitleTrialAttendance(String prospect, String when);

  /// PD-47: a system task this build has no words for.
  ///
  /// In en, this message translates to:
  /// **'A task from the academy'**
  String get taskTitleFromAcademy;

  /// No description provided for @taskDue.
  ///
  /// In en, this message translates to:
  /// **'Due {when}'**
  String taskDue(String when);

  /// No description provided for @taskNoDue.
  ///
  /// In en, this message translates to:
  /// **'No due date'**
  String get taskNoDue;

  /// No description provided for @taskStateReturned.
  ///
  /// In en, this message translates to:
  /// **'Returned with instructions'**
  String get taskStateReturned;

  /// No description provided for @taskStateAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for your manager'**
  String get taskStateAwaiting;

  /// No description provided for @taskStateWithdrawn.
  ///
  /// In en, this message translates to:
  /// **'No longer needed'**
  String get taskStateWithdrawn;

  /// No description provided for @taskGivenBy.
  ///
  /// In en, this message translates to:
  /// **'Given by {name}'**
  String taskGivenBy(String name);

  /// No description provided for @taskInstructions.
  ///
  /// In en, this message translates to:
  /// **'Instructions'**
  String get taskInstructions;

  /// No description provided for @taskWithdrawnNotice.
  ///
  /// In en, this message translates to:
  /// **'The work behind this task no longer exists. Acknowledge it to clear it.'**
  String get taskWithdrawnNotice;

  /// No description provided for @taskOpenLesson.
  ///
  /// In en, this message translates to:
  /// **'Open the lesson'**
  String get taskOpenLesson;

  /// No description provided for @taskMarkDone.
  ///
  /// In en, this message translates to:
  /// **'Mark done'**
  String get taskMarkDone;

  /// No description provided for @taskAcknowledge.
  ///
  /// In en, this message translates to:
  /// **'Acknowledge'**
  String get taskAcknowledge;

  /// PD-47: the assignee says a task is outside their responsibility.
  ///
  /// In en, this message translates to:
  /// **'Not mine'**
  String get taskNotMine;

  /// No description provided for @taskNotMineHint.
  ///
  /// In en, this message translates to:
  /// **'Say why. Your manager decides what happens next.'**
  String get taskNotMineHint;

  /// No description provided for @taskComment.
  ///
  /// In en, this message translates to:
  /// **'Add a comment'**
  String get taskComment;

  /// No description provided for @taskSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get taskSend;

  /// No description provided for @taskActionFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t do that. Try again.'**
  String get taskActionFailed;

  /// No description provided for @taskDoneSnack.
  ///
  /// In en, this message translates to:
  /// **'Done.'**
  String get taskDoneSnack;

  /// No description provided for @taskNotMineSent.
  ///
  /// In en, this message translates to:
  /// **'Sent to your manager.'**
  String get taskNotMineSent;

  /// No description provided for @taskCommentSent.
  ///
  /// In en, this message translates to:
  /// **'Comment added.'**
  String get taskCommentSent;

  /// PD-47: the To do count when the list stopped before the end.
  ///
  /// In en, this message translates to:
  /// **'To do ({count}+)'**
  String scheduleFilterTodoMore(int count);

  /// PD-47 PR-4: a task entry's button in the Notification Center.
  ///
  /// In en, this message translates to:
  /// **'Open my To do'**
  String get notificationsActionOpenTask;

  /// PD-48: owner-approved 2026-10-29, word for word (design §17 Q7). Parent Settings row and page title.
  ///
  /// In en, this message translates to:
  /// **'About lesson audio'**
  String get lessonAudioAboutTitle;

  /// PD-48: owner-approved 2026-10-29, word for word. The About lesson audio text.
  ///
  /// In en, this message translates to:
  /// **'Pronunciation in the lessons is spoken by a computer voice. Every recording is checked and approved by two of our teachers before your child hears it. If the computer voice cannot say a word correctly, that word has no audio. Quran recitation is never computer-generated.'**
  String get lessonAudioAboutBody;

  /// PD-48: owner-approved 2026-10-29, word for word. The terms/privacy paragraph's bold opening.
  ///
  /// In en, this message translates to:
  /// **'Lesson pronunciation audio.'**
  String get lessonAudioTermsHeading;

  /// PD-48: owner-approved 2026-10-29, word for word. The terms/privacy paragraph after its opening.
  ///
  /// In en, this message translates to:
  /// **'Some lessons play the pronunciation of letters, words and sentences. This audio is generated by a computer voice. Before any child hears a recording, two of our teachers listen to it and approve it. A word the computer voice cannot say correctly has no audio. The Quran is never read by a computer voice. The text of our lessons is sent to our speech provider to produce the audio. No information about you or your child is sent.'**
  String get lessonAudioTermsBody;

  /// PD-48: owner-approved 2026-10-29, word for word. The line a parent ticks at sign-up and acknowledges once at the next sign-in.
  ///
  /// In en, this message translates to:
  /// **'I understand that lesson pronunciation audio is computer-generated and checked by the academy\'s teachers before use.'**
  String get lessonAudioNoticeAccept;

  /// PD-48: the section header above the terms/privacy paragraph (a UI label, not part of the approved text).
  ///
  /// In en, this message translates to:
  /// **'Terms and privacy'**
  String get lessonAudioTermsTitle;
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
