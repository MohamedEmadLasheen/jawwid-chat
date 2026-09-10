// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class L10nEn extends L10n {
  L10nEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Jawwid';

  @override
  String get signInTitle => 'Sign in to Jawwid';

  @override
  String get signInSubtitle =>
      'Your account is created by Jawwid. There is no public sign-up.';

  @override
  String get usernameLabel => 'Username';

  @override
  String get passwordLabel => 'Password';

  @override
  String get signInAction => 'Sign in';

  @override
  String get signInFailedCredentials =>
      'That username or password is not correct.';

  @override
  String get signInFailedDisabled =>
      'This account is no longer active. Please contact Jawwid.';

  @override
  String get sessionExpiredTitle => 'You have been signed out';

  @override
  String get sessionExpiredBody => 'Your session ended. Please sign in again.';

  @override
  String get signOutAction => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of Jawwid on this device?';

  @override
  String get tabChats => 'Chats';

  @override
  String get tabHome => 'Home';

  @override
  String get tabGroups => 'Groups';

  @override
  String get homeYourChildren => 'Your children';

  @override
  String get homeMessageJawwid => 'Message Jawwid';

  @override
  String get homeNeedsReply => 'Needs a reply';

  @override
  String get tabCalls => 'Calls';

  @override
  String get tabNotifications => 'Updates';

  @override
  String get tabProfile => 'Profile';

  @override
  String get sectionJawwid => 'Jawwid';

  @override
  String get sectionStaff => 'Jawwid team';

  @override
  String get sectionMyGroups => 'My groups';

  @override
  String sectionLearner(String name) {
    return '$name';
  }

  @override
  String handledBy(String name) {
    return 'Handled by $name';
  }

  @override
  String get conversationsEmptyTitle => 'No conversations yet';

  @override
  String get conversationsEmptyBodyParent =>
      'When Jawwid or your child\'s group sends a message, it will appear here.';

  @override
  String get conversationsEmptyBodyTeacher =>
      'Your assigned student groups will appear here.';

  @override
  String get conversationsErrorTitle => 'Could not load your chats';

  @override
  String unreadCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count unread messages',
      one: '1 unread message',
    );
    return '$_temp0';
  }

  @override
  String get pinAction => 'Pin';

  @override
  String get unpinAction => 'Unpin';

  @override
  String get muteAction => 'Mute';

  @override
  String get unmuteAction => 'Unmute';

  @override
  String get archiveAction => 'Archive';

  @override
  String get unarchiveAction => 'Unarchive';

  @override
  String get archivedLabel => 'Archived';

  @override
  String get mutedLabel => 'Muted';

  @override
  String get composerHint => 'Message';

  @override
  String get composerSend => 'Send';

  @override
  String get composerAttach => 'Attach';

  @override
  String get composerRecord => 'Record a voice note';

  @override
  String get composerRecording => 'Recording';

  @override
  String get composerSlideToCancel => 'Slide to cancel';

  @override
  String get composerReadOnly => 'You can no longer send messages here.';

  @override
  String get voiceRecordingInProgress => 'Recording a voice message';

  @override
  String voiceRecordingElapsed(String duration) {
    return '$duration recorded';
  }

  @override
  String get voiceStopRecording => 'Stop recording';

  @override
  String get voiceDeleteRecording => 'Delete recording';

  @override
  String get voiceReviewTitle => 'Review your voice message';

  @override
  String get voiceSendRecording => 'Send voice message';

  @override
  String get voicePlay => 'Play';

  @override
  String get voicePause => 'Pause';

  @override
  String get voiceReplay => 'Play again';

  @override
  String get voiceMessageLabel => 'Voice message';

  @override
  String voiceMessageDuration(String duration) {
    return 'Voice message, $duration';
  }

  @override
  String get voiceLoading => 'Loading audio…';

  @override
  String get voicePlaybackFailed => 'This voice message could not be played.';

  @override
  String get voiceUploading => 'Sending voice message';

  @override
  String get voicePermissionDeniedTitle => 'Microphone access is off';

  @override
  String get voicePermissionDeniedBody =>
      'Allow microphone access in your device settings to record a voice message.';

  @override
  String get voiceUnsupported => 'This device cannot record voice messages.';

  @override
  String get voiceTooShort => 'Hold longer to record a voice message.';

  @override
  String get voiceRecordingFailed =>
      'The recording could not be completed. Please try again.';

  @override
  String get messageStateSending => 'Sending';

  @override
  String get messageStateSent => 'Sent';

  @override
  String get messageStateDelivered => 'Delivered';

  @override
  String get messageStateRead => 'Read';

  @override
  String get messageStateFailed => 'Not sent';

  @override
  String get messageStatePendingApproval => 'Pending approval';

  @override
  String get messageStateRejected => 'Not approved';

  @override
  String messageRejectedReason(String reason) {
    return 'Not approved: $reason';
  }

  @override
  String get messageDeleted => 'This message was deleted';

  @override
  String get messageRetry => 'Retry';

  @override
  String get messageDiscard => 'Discard';

  @override
  String get messageQueuedOffline => 'Waiting for a connection';

  @override
  String get replyAction => 'Reply';

  @override
  String replyingTo(String name) {
    return 'Replying to $name';
  }

  @override
  String get reactAction => 'React';

  @override
  String get copyAction => 'Copy';

  @override
  String typingSingle(String name) {
    return '$name is typing…';
  }

  @override
  String get typingMany => 'Several people are typing…';

  @override
  String get loadingOlder => 'Loading earlier messages…';

  @override
  String get loadOlderFailed => 'Could not load earlier messages.';

  @override
  String get messagesEmptyTitle => 'No messages yet';

  @override
  String get messagesEmptyBody => 'Say hello to start the conversation.';

  @override
  String get groupMembersTitle => 'Members';

  @override
  String get groupMemberRoleParent => 'Parent';

  @override
  String get groupMemberRoleTeacher => 'Teacher';

  @override
  String get groupMemberRoleAdmin => 'Jawwid';

  @override
  String get groupApprovalNotice =>
      'Messages here are reviewed by Jawwid before everyone sees them.';

  @override
  String get callVoice => 'Voice call';

  @override
  String get callGroup => 'Group call';

  @override
  String get callIncoming => 'Incoming call';

  @override
  String get callConnecting => 'Connecting…';

  @override
  String get callReconnecting => 'Reconnecting…';

  @override
  String get callAccept => 'Accept';

  @override
  String get callDecline => 'Decline';

  @override
  String get callEnd => 'End';

  @override
  String get callMute => 'Mute';

  @override
  String get callUnmute => 'Unmute';

  @override
  String get callSpeaker => 'Speaker';

  @override
  String get callHistoryTitle => 'Calls';

  @override
  String get callHistoryEmpty => 'No calls yet';

  @override
  String get callOutcomeAnswered => 'Answered';

  @override
  String get callOutcomeMissed => 'Missed';

  @override
  String get callOutcomeDeclined => 'Declined';

  @override
  String callDuration(int minutes, int seconds) {
    return '${minutes}m ${seconds}s';
  }

  @override
  String get callFailedMicrophone =>
      'Jawwid needs microphone access to make calls.';

  @override
  String get callFailedNotAllowed => 'This call is not available.';

  @override
  String get callFailedNetwork =>
      'The call could not connect. Check your connection and try again.';

  @override
  String get notificationsTitle => 'Updates';

  @override
  String get notificationsEmpty => 'You are all caught up';

  @override
  String get notificationPermissionTitle => 'Turn on notifications';

  @override
  String get notificationPermissionBody =>
      'Jawwid uses notifications for class reminders, messages, and calls.';

  @override
  String get notificationPermissionAction => 'Open settings';

  @override
  String get profileTitle => 'Profile';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageArabic => 'العربية';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSystem => 'Follow device';

  @override
  String get settingsNotifications => 'Notifications';

  @override
  String get settingsDevices => 'Active devices';

  @override
  String get devicesThisDevice => 'This device';

  @override
  String devicesLastActive(String when) {
    return 'Last active $when';
  }

  @override
  String get devicesSignOutOther => 'Sign out this device';

  @override
  String get searchHint => 'Search your chats';

  @override
  String get searchEmpty => 'Nothing matched your search';

  @override
  String get retryAction => 'Try again';

  @override
  String get cancelAction => 'Cancel';

  @override
  String get okAction => 'OK';

  @override
  String get closeAction => 'Close';

  @override
  String get errorNetworkTitle => 'No connection';

  @override
  String get errorNetworkBody =>
      'Check your internet connection and try again.';

  @override
  String get errorTimeoutTitle => 'This is taking too long';

  @override
  String get errorServerTitle => 'Something went wrong';

  @override
  String get errorServerBody => 'Please try again in a moment.';

  @override
  String get errorForbiddenTitle => 'Not available';

  @override
  String get errorForbiddenBody => 'You do not have access to this.';

  @override
  String get errorNotFoundTitle => 'Not found';

  @override
  String get errorNotFoundBody => 'This is no longer available.';

  @override
  String get todayLabel => 'Today';

  @override
  String get yesterdayLabel => 'Yesterday';
}
