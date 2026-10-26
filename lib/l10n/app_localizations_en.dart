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
  String get signInFailedLocked =>
      'Too many attempts. Try again in a few minutes.';

  @override
  String get signInFailedRoleUnsupported =>
      'This account cannot sign in to the Jawwid app. Staff accounts use the Jawwid console.';

  @override
  String get sessionExpiredTitle => 'You have been signed out';

  @override
  String get sessionExpiredBody => 'Your session ended. Please sign in again.';

  @override
  String get sessionUnreachableBody =>
      'Couldn\'t reach Jawwid to open your session. You\'re still signed in — check your connection and try again.';

  @override
  String get signOutAction => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of Jawwid on this device?';

  @override
  String get tabChats => 'Chats';

  @override
  String get tabCalls => 'Calls';

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
  String typingMany(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count people are typing…',
      one: '$count person is typing…',
    );
    return '$_temp0';
  }

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
  String get callOutgoing => 'Calling…';

  @override
  String get callEnded => 'Call ended';

  @override
  String get callSendMessageInstead => 'Send a message instead';

  @override
  String get callNoAnswer => 'No answer';

  @override
  String get callMissedIncoming => 'Missed call';

  @override
  String get callAgain => 'Call again';

  @override
  String get callRecordVoice => 'Record voice message';

  @override
  String get callMessage => 'Message';

  @override
  String get callVoiceTitle => 'Jawwid voice call';

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
  String get settingsAppearance => 'Appearance';

  @override
  String get settingsAppearanceAuto => 'Auto';

  @override
  String get settingsAppearanceLight => 'Light';

  @override
  String get settingsAppearanceDark => 'Dark';

  @override
  String get settingsLanguageArabic => 'العربية';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSystem => 'Follow device';

  @override
  String get settingsNotifications => 'Notifications';

  @override
  String get settingsDevices => 'Devices & sessions';

  @override
  String get devicesThisDevice => 'This device';

  @override
  String devicesLastActive(String when) {
    return 'Last active $when';
  }

  @override
  String get devicesSignOutOther => 'Sign out this device';

  @override
  String devicesSignedIn(String date) {
    return 'Signed in $date';
  }

  @override
  String get devicesJustNow => 'just now';

  @override
  String devicesMinutesAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutes ago',
      one: '1 minute ago',
    );
    return '$_temp0';
  }

  @override
  String devicesHoursAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count hours ago',
      one: '1 hour ago',
    );
    return '$_temp0';
  }

  @override
  String devicesDaysAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days ago',
      one: '1 day ago',
    );
    return '$_temp0';
  }

  @override
  String get devicesNeverUsed => 'Not used since sign-in';

  @override
  String get devicesPlatformIphone => 'iPhone';

  @override
  String get devicesPlatformAndroid => 'Android phone';

  @override
  String get devicesPlatformWeb => 'Web browser';

  @override
  String get devicesPlatformUnknown => 'Unknown device';

  @override
  String devicesSignOutConfirmTitle(String device) {
    return 'Sign out $device?';
  }

  @override
  String get devicesSignOutConfirmBody =>
      'That device will need your password to sign in again.';

  @override
  String get devicesSignOutAllOthers => 'Sign out all other devices';

  @override
  String get devicesSignOutAllOthersConfirm =>
      'Sign out of every other device? Only this device stays signed in.';

  @override
  String get devicesSignedOutOne => 'Signed out of that device';

  @override
  String devicesSignedOutOthers(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Signed out of $count devices',
      one: 'Signed out of 1 device',
      zero: 'No other devices were signed in',
    );
    return '$_temp0';
  }

  @override
  String get devicesSignOutFailed =>
      'Could not sign that device out. Try again.';

  @override
  String get devicesEmpty => 'No active sessions';

  @override
  String get appLockTitle => 'App lock';

  @override
  String get appLockToggle => 'Lock with Face ID, fingerprint or passcode';

  @override
  String get appLockToggleSubtitle =>
      'Ask to unlock when you return to the app';

  @override
  String get appLockUnavailable =>
      'Set up Face ID, a fingerprint or a passcode on this device to use app lock.';

  @override
  String get appLockTimeoutLabel => 'Lock automatically';

  @override
  String get appLockTimeoutImmediately => 'Immediately';

  @override
  String get appLockTimeoutOneMinute => 'After 1 minute';

  @override
  String get appLockTimeoutFifteenMinutes => 'After 15 minutes';

  @override
  String get appLockTimeoutOneHour => 'After 1 hour';

  @override
  String get appLockReason => 'Unlock Jawwid';

  @override
  String get appLockLockedTitle => 'Jawwid is locked';

  @override
  String get appLockLockedBody => 'Unlock to see your chats.';

  @override
  String get appLockUnlockAction => 'Unlock';

  @override
  String get appLockFailed => 'Could not unlock. Try again.';

  @override
  String get appLockOfferTitle => 'Lock the app?';

  @override
  String get appLockOfferBody =>
      'Use Face ID, your fingerprint or your passcode to open Jawwid, so your chats stay private if someone else picks up your phone. You can change this anytime in Settings.';

  @override
  String get appLockOfferAccept => 'Turn on';

  @override
  String get appLockOfferDecline => 'Not now';

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

  @override
  String get filterAll => 'All';

  @override
  String get filterUnread => 'Unread';

  @override
  String get filterGroups => 'Groups';

  @override
  String get filterFavorites => 'Favourites';

  @override
  String get filterEmptyUnread => 'Nothing unread';

  @override
  String get filterEmptyUnreadBody =>
      'You have read everything. New messages will appear here.';

  @override
  String get filterEmptyGroups => 'No student groups yet';

  @override
  String get filterEmptyFavorites => 'No favourites yet';

  @override
  String get filterEmptyFavoritesBody =>
      'Press and hold a conversation to add it to your favourites.';

  @override
  String get favoriteAction => 'Add to favourites';

  @override
  String get unfavoriteAction => 'Remove from favourites';

  @override
  String get favoriteLabel => 'Favourite';

  @override
  String get searchClear => 'Clear search';

  @override
  String get searchEmptyBody => 'Search covers conversation and group names.';

  @override
  String get archivedShow => 'Show archived';

  @override
  String get archivedHide => 'Hide archived';

  @override
  String get callHistoryEmptyBody => 'Calls you take part in will appear here.';

  @override
  String get callsUnavailableTitle => 'Calls are not available yet';

  @override
  String get callsUnavailableBody =>
      'Calling has not been switched on for this app yet. Nothing is missing from your account.';

  @override
  String get conversationActionsTitle => 'Conversation options';

  @override
  String get groupInfoTitle => 'Group info';

  @override
  String get groupLearnerLabel => 'Student';

  @override
  String get groupMemberUnresolved => 'Member';

  @override
  String get memberMessageAction => 'Message';

  @override
  String get myAccountTitle => 'My account';

  @override
  String get childrenTitle => 'Children';

  @override
  String get childGroupLabel => 'Group';

  @override
  String get childTeacherLabel => 'Teacher';

  @override
  String get childLevelLabel => 'Level';

  @override
  String get childSubscriptionLabel => 'Subscription';

  @override
  String get childScheduleLabel => 'Schedule';

  @override
  String get childrenEmpty => 'No children are linked to your account yet.';

  @override
  String get contactInfoTitle => 'Contact information';

  @override
  String get contactInfoUnavailable =>
      'Jawwid does not hold phone numbers or email addresses in this app yet.';

  @override
  String get fieldNotAvailableYet => 'Not available yet';

  @override
  String get profileNoDirectContact =>
      'You can reach the teacher in your child\'s group.';

  @override
  String get messageActionsTitle => 'Message options';

  @override
  String get deleteAction => 'Delete';

  @override
  String get deleteForMeAction => 'Delete for me';

  @override
  String get deleteForEveryoneAction => 'Delete for everyone';

  @override
  String get deleteForMeExplainer => 'It stays visible to everyone else.';

  @override
  String get deleteForEveryoneExplainer =>
      'Removed from the conversation for everyone.';

  @override
  String get copiedConfirmation => 'Copied';

  @override
  String get openAction => 'Open';

  @override
  String get saveAction => 'Save';

  @override
  String get attachCamera => 'Camera';

  @override
  String get attachPhoto => 'Photo';

  @override
  String get attachFile => 'File';

  @override
  String get attachmentPhotoLabel => 'Photo';

  @override
  String get attachmentFileLabel => 'File';

  @override
  String get attachmentVoiceLabel => 'Voice message';

  @override
  String get attachmentVideoLabel => 'Video';

  @override
  String get attachmentSendTitle => 'Send this?';

  @override
  String get attachmentTooLarge => 'That file is too large to send.';

  @override
  String get attachmentTypeNotAllowed =>
      'That kind of file can\'t be sent here.';

  @override
  String get attachmentPickFailed => 'Couldn\'t open that. Please try again.';

  @override
  String get cameraPermissionDenied =>
      'Jawwid needs permission to use the camera. You can allow it in Settings.';

  @override
  String get cameraUnavailable => 'This device has no camera available.';

  @override
  String get attachmentPermissionDenied =>
      'Jawwid needs permission to open your photos. You can allow it in Settings.';

  @override
  String get attachmentUnsupported => 'This device can\'t pick files.';

  @override
  String get attachmentUploadFailed =>
      'Unable to send the file. Please try again.';

  @override
  String get attachmentUploading => 'Sending…';

  @override
  String get replyOriginalUnavailable => 'Original message';

  @override
  String get mediaAndFilesTitle => 'Media & files';

  @override
  String get mediaPhotosTab => 'Photos';

  @override
  String get mediaFilesTab => 'Files';

  @override
  String get mediaVoiceTab => 'Voice';

  @override
  String get mediaEmpty => 'Nothing shared here yet';

  @override
  String get mediaEmptyBody =>
      'Photos, files and voice messages from this conversation appear here.';

  @override
  String get mediaLoadOlder => 'Load older';

  @override
  String get notificationsMuted => 'Notifications muted';

  @override
  String get notificationsMutedExplainer => 'You still receive messages.';

  @override
  String reactionCountSemantics(String emoji, int count) {
    return '$emoji, $count reactions';
  }

  @override
  String reactionYoursSemantics(String emoji) {
    return '$emoji, including yours';
  }

  @override
  String fileSizeKb(String size) {
    return '$size KB';
  }

  @override
  String fileSizeMb(String size) {
    return '$size MB';
  }

  @override
  String storyRingUnviewed(String label) {
    return 'Unviewed story: $label';
  }

  @override
  String storyRingViewed(String label) {
    return 'Viewed story: $label';
  }

  @override
  String get storyClose => 'Close story';

  @override
  String get storyPrevious => 'Previous story';

  @override
  String get storyNext => 'Next story';

  @override
  String get storyImageLabel => 'Story image';

  @override
  String get storyMediaFailed => 'This picture could not be loaded.';

  @override
  String get storyUnavailable => 'This story is no longer available.';

  @override
  String get storyVideoLabel => 'Story video';

  @override
  String get storyVideoFailed => 'This video could not be played.';

  @override
  String get storyVideoRetry => 'Try again';

  @override
  String get storyTextLabel => 'Story';

  @override
  String get storyVoiceLabel => 'Voice story';

  @override
  String get storyVoiceFailed => 'This voice note could not be played.';

  @override
  String get storyVoicePlay => 'Play voice story';

  @override
  String get storyVoicePause => 'Pause voice story';

  @override
  String get storyCtaWhatsApp => 'Chat on WhatsApp';

  @override
  String get storyCtaMessage => 'Send a message';

  @override
  String get storyCtaLink => 'Learn more';

  @override
  String get storyCtaFailed => 'That didn\'t open. Please try again.';

  @override
  String get storiesEmpty => 'No stories yet';

  @override
  String get storiesEmptyBody => 'Stories published to you will appear here.';

  @override
  String systemGroupCreated(String learner) {
    return 'Student Group created for $learner';
  }

  @override
  String get systemGroupCreatedNoLearner => 'Student Group created';

  @override
  String systemGroupMembersUpdated(int added, int removed) {
    return 'Group members updated (+$added / −$removed)';
  }

  @override
  String get systemGroupArchived => 'Group archived';

  @override
  String systemGroupSupervisorChanged(String name) {
    return '$name is now this group\'s supervisor';
  }

  @override
  String get systemGroupSupervisorChangedNoName =>
      'This group\'s supervisor changed';

  @override
  String systemDirectSupervisorChanged(String name) {
    return '$name is now your supervisor; the chat history is kept';
  }

  @override
  String get systemDirectSupervisorChangedNoName =>
      'Your supervisor changed; the chat history is kept';

  @override
  String get systemGroupLearnerDetached =>
      'A child of this group moved to another supervisor';

  @override
  String get systemUpdate => 'System update';

  @override
  String get lessonTicketsHeader => 'Lesson';

  @override
  String get ticketReport => 'Lesson report';

  @override
  String get ticketWriteReport => 'Write lesson report';

  @override
  String lessonsOtherLessons(int count) {
    return 'Other lessons ($count)';
  }

  @override
  String get lessonsOtherLessonsTitle => 'Other lessons';

  @override
  String lessonsOtherUnreported(int count) {
    return 'Other unreported lessons ($count)';
  }

  @override
  String get scheduleFilterAll => 'All';

  @override
  String scheduleFilterNeedsReport(int count) {
    return 'Needs a report ($count)';
  }

  @override
  String get scheduleNeedsReportHeader => 'Still owed a report';

  @override
  String get scheduleLessonNoActions => 'Nothing to do for this lesson now.';

  @override
  String get scheduleLessonLoadFailed =>
      'Couldn\'t load this lesson. Try again.';

  @override
  String get ticketAbsence => 'Student absent';

  @override
  String get ticketApology => 'Apologise for the lesson';

  @override
  String get ticketTeacherApology => 'I can\'t teach this lesson';

  @override
  String get ticketLateApology => 'Late apology (emergency)';

  @override
  String ticketLessonAt(String when) {
    return 'Lesson of $when';
  }

  @override
  String get reportCoveredLabel => 'What was covered';

  @override
  String get reportHomeworkLabel => 'Homework (optional)';

  @override
  String get reportRatingLabel => 'Rating (optional)';

  @override
  String get reportNoteLabel => 'Note (optional)';

  @override
  String get ticketReasonLabel => 'Reason';

  @override
  String get ticketAbsenceHint =>
      'No apology was received and the lesson time has passed.';

  @override
  String get ticketLateApologyHint =>
      'A supervisor will review it. Until then the lesson counts as an absence.';

  @override
  String get ticketTeacherApologyHint =>
      'A make-up lesson will be arranged with the family.';

  @override
  String get ticketSubmit => 'Send';

  @override
  String get ticketSent => 'Sent';

  @override
  String get ticketFailed => 'Couldn\'t send. Please try again.';

  @override
  String get ticketNoLongerAllowed =>
      'This lesson can no longer be updated this way.';

  @override
  String get cardReportTitle => 'Lesson report';

  @override
  String get cardAbsenceTitle => 'Absent from the lesson';

  @override
  String get cardApologyTitle => 'Apology';

  @override
  String get cardTeacherApologyTitle => 'The teacher can\'t teach this lesson';

  @override
  String get cardCancelledTitle => 'Lesson cancelled';

  @override
  String get cardTeacherAbsentTitle =>
      'Lesson not held — the teacher was absent';

  @override
  String get cardLateApologyTitle => 'Late apology';

  @override
  String get cardRulingExcusedTitle => 'Apology accepted';

  @override
  String get cardRulingCreditedTitle => 'Recorded as an absence';

  @override
  String get cardUnderReview => 'Under review by the supervision team';

  @override
  String get cardMakeupOwed => 'A make-up lesson will be arranged.';

  @override
  String get cardCovered => 'Covered';

  @override
  String get cardHomework => 'Homework';

  @override
  String get cardRating => 'Rating';

  @override
  String get cardNote => 'Note';

  @override
  String get cardReason => 'Reason';

  @override
  String get ticketBookMakeup => 'Book the make-up lesson';

  @override
  String ticketFor(String name) {
    return 'For $name';
  }

  @override
  String get makeupPickDay => 'Choose a day';

  @override
  String get makeupPickTime => 'Choose a time';

  @override
  String get makeupNoSlots =>
      'No free times in the next two weeks. The supervision team will arrange the make-up.';

  @override
  String get makeupBook => 'Book';

  @override
  String makeupLength(int minutes) {
    return '$minutes minutes';
  }

  @override
  String get scheduleChangeHint =>
      'The supervision team will confirm the change.';

  @override
  String get scheduleChangeNoOptions =>
      'There are no other free times right now.';

  @override
  String get scheduleChangeSend => 'Send request';

  @override
  String get ticketLoadFailed =>
      'Couldn\'t load the free times. Please try again.';

  @override
  String get cardMakeupBookedTitle => 'Make-up lesson booked';

  @override
  String get cardMakeupResolvedTitle => 'Missed lesson resolved';

  @override
  String get cardMakeupActionSubstitute => 'A substitute teacher';

  @override
  String get cardMakeupActionCredit => 'A credit to the family';

  @override
  String get cardMakeupActionExtension => 'The package is extended';

  @override
  String get cardMakeupActionWaived => 'No make-up needed';

  @override
  String get cardScheduleRequestedTitle =>
      'Request to change the regular times';

  @override
  String get cardScheduleApprovedTitle => 'New regular times confirmed';

  @override
  String get cardScheduleRejectedTitle =>
      'The change of regular times was not approved';

  @override
  String cardEveryWeek(String when) {
    return 'Every $when';
  }

  @override
  String get tabSchedule => 'Schedule';

  @override
  String get scheduleEmpty => 'No lessons in the next two weeks.';

  @override
  String get scheduleLoadFailed => 'Couldn\'t load your schedule.';

  @override
  String get phaseUpcoming => 'Upcoming';

  @override
  String get phaseInProgress => 'In progress';

  @override
  String get phaseAwaitingClose => 'Needs report';

  @override
  String get phaseOverdue => 'Report overdue';

  @override
  String get outcomeHeld => 'Held';

  @override
  String get outcomeStudentApology => 'Student apologised';

  @override
  String get outcomeTeacherApology => 'Teacher apologised';

  @override
  String get outcomeAdminCancelled => 'Cancelled';

  @override
  String get outcomeStudentNoShow => 'Student absent';

  @override
  String get outcomeTeacherNoShow => 'Teacher absent';

  @override
  String get outcomeRescheduled => 'Moved';

  @override
  String get lessonKindMakeup => 'Make-up';

  @override
  String get cardTransferredTitle => 'New teacher';

  @override
  String cardTransferredBody(String teacher) {
    return '$teacher will teach from now on.';
  }

  @override
  String get cardHandoverTitle => 'A new student';

  @override
  String get cardHandoverFrom => 'Previous teacher';

  @override
  String get cardHandoverNote => 'Handover';

  @override
  String get cardPausedTitle => 'Lessons paused';

  @override
  String cardPausedUntil(String date) {
    return 'Until $date';
  }

  @override
  String get cardStoppedTitle => 'Lessons stopped';

  @override
  String get cardReturnSoonTitle => 'Lessons resume soon';

  @override
  String cardReturnOn(String date) {
    return 'Back on $date';
  }

  @override
  String get cardResumedTitle => 'Lessons resumed';

  @override
  String get cardBonusTitle => 'A bonus for you';

  @override
  String get progressTitle => 'This month';

  @override
  String get progressAttended => 'Attended';

  @override
  String get progressApologised => 'Apologised';

  @override
  String get progressAbsent => 'Absent';

  @override
  String progressStreak(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lessons in a row',
      one: '1 lesson in a row',
      zero: 'No streak yet',
    );
    return '$_temp0';
  }

  @override
  String progressAllTime(int count) {
    return '$count lessons attended in total';
  }

  @override
  String progressMakeupsOwed(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count make-up lessons owed',
      one: '1 make-up lesson owed',
    );
    return '$_temp0';
  }

  @override
  String progressNext(String when) {
    return 'Next lesson: $when';
  }

  @override
  String progressLastCovered(String covered) {
    return 'Last lesson: $covered';
  }

  @override
  String get progressCertificates => 'Certificates will appear here.';

  @override
  String get progressUnavailable => 'Progress isn\'t available right now.';

  @override
  String get workloadTitle => 'This month';

  @override
  String workloadHeld(int lessons, String hours) {
    return '$lessons lessons · $hours h';
  }

  @override
  String workloadNeedsReport(int count) {
    return '$count need a report';
  }

  @override
  String workloadOnTime(String percent) {
    return '$percent reports on time';
  }

  @override
  String get supervisionChatTitle => 'Supervision';

  @override
  String get supervisionChatSubtitle => 'Teachers department · private';

  @override
  String get supervisionTicketsHeader => 'Requests';

  @override
  String get ticketCertificate => 'Request a certificate';

  @override
  String get ticketLeave => 'Request leave';

  @override
  String get certificateFormTitle => 'Request a certificate';

  @override
  String get certificateFormHint =>
      'Sent privately to the Teachers department. When the certificate is issued, it is posted to the student\'s group, where you and the parents receive it.';

  @override
  String get certificateStudent => 'Student';

  @override
  String get certificateTitleField => 'Certificate';

  @override
  String get certificateTitleHint => 'e.g. Juz Amma';

  @override
  String get certificateAchievement => 'Achievement';

  @override
  String get certificateAchievedOn => 'Date achieved';

  @override
  String get certificateGrade => 'Grade (optional)';

  @override
  String get certificatePrintedName => 'Name as it should be printed';

  @override
  String get certificateNote => 'Note to the department (optional)';

  @override
  String get leaveFormTitle => 'Request leave';

  @override
  String get leaveFormHint =>
      'Sent privately to the Teachers department. Approved days are deducted from your balance.';

  @override
  String get leaveFirstDay => 'First day';

  @override
  String get leaveLastDay => 'Last day';

  @override
  String get leaveReason => 'Reason';

  @override
  String leaveDaysCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days',
      one: '1 day',
    );
    return '$_temp0';
  }

  @override
  String leaveBalanceNow(String balance) {
    return 'Your balance now: $balance';
  }

  @override
  String get leaveSameYear => 'Send a separate request for each year.';

  @override
  String get leaveLastBeforeFirst => 'The last day is before the first day.';

  @override
  String get formRequired => 'Required';

  @override
  String get formSend => 'Send';

  @override
  String get myLeaveTitle => 'My leave';

  @override
  String myLeaveAllowance(String year) {
    return 'Allowance $year';
  }

  @override
  String get myLeaveUsed => 'Used';

  @override
  String get myLeaveBalance => 'Balance';

  @override
  String get myLeaveNoAllowance => 'Not set yet';

  @override
  String get myLeaveNoRequests => 'No leave requests this year.';

  @override
  String get myLeaveRequest => 'Request leave';

  @override
  String get myLeaveWithdraw => 'Withdraw';

  @override
  String get myLeaveWithdrawConfirm => 'Withdraw this leave request?';

  @override
  String get leaveStateRequested => 'Waiting';

  @override
  String get leaveStateApproved => 'Approved';

  @override
  String get leaveStateDeclined => 'Not approved';

  @override
  String get leaveStateWithdrawn => 'Withdrawn';

  @override
  String get leaveStateCancelled => 'Cancelled';

  @override
  String get cardCertificateRequestedTitle => 'Certificate request';

  @override
  String get cardCertificateIssuedTitle => 'Certificate';

  @override
  String get cardCertificateDeclinedTitle => 'Certificate request not approved';

  @override
  String get cardLeaveRequestedTitle => 'Leave request';

  @override
  String get cardLeaveApprovedTitle => 'Leave approved';

  @override
  String get cardLeaveDeclinedTitle => 'Leave not approved';

  @override
  String get cardLeaveWithdrawnTitle => 'Leave request withdrawn';

  @override
  String get cardLeaveCancelledTitle => 'Leave cancelled';

  @override
  String get cardAchievement => 'Achievement';

  @override
  String get cardGrade => 'Grade';

  @override
  String get cardDays => 'Days';

  @override
  String get cardBalance => 'Balance';

  @override
  String get cardDaysReturned => 'Days returned';

  @override
  String get cardCongratulations =>
      'Congratulations! The certificate is attached.';

  @override
  String get leaveNotAllowed =>
      'These dates can\'t be requested: they overlap another request or have already passed.';

  @override
  String get progressCertificatesTitle => 'Certificates';

  @override
  String get cardDisciplineWarningTitle => 'Warning';

  @override
  String get cardDisciplineDeduction1Title => 'First deduction';

  @override
  String get cardDisciplineDeduction2Title => 'Second deduction';

  @override
  String get cardDisciplineTemporaryTitle => 'Temporary suspension';

  @override
  String get cardDisciplinePermanentTitle => 'Permanent suspension';

  @override
  String get cardViolation => 'What happened';

  @override
  String cardViolationLate(String minutes) {
    return '$minutes minutes late';
  }

  @override
  String get cardViolationNoShow => 'Absent from the lesson';

  @override
  String get cardViolationApology => 'Apologised for the lesson';

  @override
  String get cardViolationAbsence => 'Absent';

  @override
  String get cardViolationComplaint => 'A complaint was upheld';

  @override
  String chatTeacherOnLeave(String name, String date) {
    return '$name is on leave until $date. Messages still reach them.';
  }

  @override
  String chatTeacherAway(String name, String date) {
    return '$name is away until $date. Messages still reach them.';
  }

  @override
  String cardViolationStep(String step) {
    return 'Violation $step this month';
  }

  @override
  String get cardPayrollNote => 'The amount is set in payroll.';

  @override
  String get trialGroupTitle => 'Trial lessons';

  @override
  String get trialGroupSubtitle => 'Sales · staff only';

  @override
  String get trialTicketsHeader => 'Trials';

  @override
  String get trialReportTitle => 'Trial report';

  @override
  String get trialAttended => 'Attended';

  @override
  String get trialDidNotAttend => 'Did not attend';

  @override
  String get trialCovered => 'What was covered';

  @override
  String get trialRating => 'Rating';

  @override
  String get trialNote => 'Note (optional)';

  @override
  String get cardTrialBookedTitle => 'Trial lesson booked';

  @override
  String get cardTrialCancelledTitle => 'Trial cancelled';

  @override
  String get cardTrialReportTitle => 'Trial report';

  @override
  String get cardTrialNoShowTitle =>
      'The student did not attend the trial lesson.';

  @override
  String get cardTrialSubscribedTitle => 'The student has subscribed.';

  @override
  String get cardTrialNotSubscribedTitle => 'The student did not subscribe.';

  @override
  String get cardTrialLevel => 'Level';

  @override
  String get cardTrialCorrectionTitle => 'Outcome corrected';

  @override
  String get cardTrialNewOutcome => 'Now';

  @override
  String get callsSearchHint => 'Search by name';

  @override
  String get callActionStart => 'Start call';

  @override
  String get callActionNewLink => 'New call link';

  @override
  String get callActionSelectMember => 'Select a member';

  @override
  String get callActionSchedule => 'Schedule call';

  @override
  String get callsSectionUpcoming => 'Upcoming';

  @override
  String get callsSectionFavorites => 'Favourites';

  @override
  String get callsSectionRecent => 'Recent';

  @override
  String get callsUpcomingEmpty => 'No scheduled calls';

  @override
  String get callsUpcomingError => 'Upcoming calls could not be loaded.';

  @override
  String get callsFavoritesEmpty =>
      'Add a chat to your favourites to call it from here.';

  @override
  String get callsSearchNoMatch => 'Nothing matched your search';

  @override
  String get callsUnnamed => 'Unnamed chat';

  @override
  String get callBack => 'Call back';

  @override
  String get callDirectionOutgoing => 'Outgoing';

  @override
  String get callDirectionIncoming => 'Incoming';

  @override
  String callWhen(String day, String time) {
    return '$day, $time';
  }

  @override
  String get callPickerPeople => 'People';

  @override
  String get callPickerGroups => 'Groups';

  @override
  String get callPickerEmpty => 'There are no chats to choose from.';

  @override
  String get callPickerNoMatch => 'No chats match your search';

  @override
  String get callRefusedParentGroup =>
      'Only staff or the teacher can start a group call';

  @override
  String get callRefusedGeneric => 'Calls are not available in this chat';

  @override
  String get scheduledCallDefaultTitle => 'Scheduled call';

  @override
  String get scheduledCallLinkLabel => 'Call link';

  @override
  String get scheduledCallStateOpen => 'Open now';

  @override
  String get scheduledCallStateUpcoming => 'Scheduled';

  @override
  String get scheduledCallJoin => 'Join';

  @override
  String get scheduledCallCancel => 'Cancel call';

  @override
  String get scheduledCallCancelConfirmTitle => 'Cancel this call?';

  @override
  String get scheduledCallCancelConfirmBody =>
      'Everyone in the chat will see that it was cancelled.';

  @override
  String get scheduledCallKeep => 'Keep';

  @override
  String get scheduledCallCancelled => 'Call cancelled';

  @override
  String scheduledCallBy(String name) {
    return 'By $name';
  }

  @override
  String get scheduledCallJoinHint =>
      'You can join from 10 minutes before the start.';

  @override
  String get scheduledJoinNotJoinable =>
      'This call is not open to join right now';

  @override
  String get scheduledJoinWaitingForHost =>
      'The call starts when staff or the teacher join';

  @override
  String get scheduledJoinBusy => 'Finish your current call first';

  @override
  String get callScheduleDate => 'Date';

  @override
  String get callScheduleTime => 'Time';

  @override
  String get callScheduleTitleLabel => 'Title (optional)';

  @override
  String get callScheduleInPast => 'Choose a time in the future';

  @override
  String callSchedulePosted(String chat) {
    return 'Scheduled — posted in $chat';
  }

  @override
  String callLinkPosted(String chat) {
    return 'Call link posted in $chat';
  }

  @override
  String get callLinkJoinNow => 'Join now';

  @override
  String get callLinkOpenChat => 'Open chat';

  @override
  String get profilePhotoTitle => 'Profile photo';

  @override
  String get profilePhotoHint => 'Everyone you chat with sees this photo.';

  @override
  String get profilePhotoAdd => 'Add photo';

  @override
  String get profilePhotoChange => 'Change photo';

  @override
  String get profilePhotoRemove => 'Remove photo';

  @override
  String get profilePhotoSaving => 'Saving…';

  @override
  String get profilePhotoFailed => 'The photo could not be saved. Try again.';

  @override
  String get profilePhotoInvalid =>
      'Use a JPEG, PNG or WebP photo, at least 64 × 64 pixels and under 2 MB.';

  @override
  String get childrenPhotosTitle => 'Children\'s photos';

  @override
  String get childrenPhotosHint =>
      'Shown in your child\'s groups, to their teacher and supervisor.';

  @override
  String get starAction => 'Star';

  @override
  String get unstarAction => 'Unstar';

  @override
  String get pinAction => 'Pin message';

  @override
  String get unpinAction => 'Unpin message';

  @override
  String get starredMark => 'Starred';

  @override
  String get pinnedMark => 'Pinned';

  @override
  String get pinnedBannerOne => 'Pinned message';

  @override
  String pinnedBannerOf(int index, int total) {
    return 'Pinned message $index of $total';
  }

  @override
  String get starredMessagesTitle => 'Starred messages';

  @override
  String get starredMessagesEmpty =>
      'No starred messages yet. Long-press a message and choose Star.';

  @override
  String get forwardAction => 'Forward';

  @override
  String get forwardTitle => 'Forward to…';

  @override
  String get forwardEmpty => 'No chats to forward to.';

  @override
  String forwardSendTo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Send to $count',
      zero: 'Send',
    );
    return '$_temp0';
  }

  @override
  String get forwardMax => 'You can choose at most 10 chats.';

  @override
  String forwardDone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Forwarded to $count chats',
      one: 'Forwarded to 1 chat',
    );
    return '$_temp0';
  }

  @override
  String get forwardedLabel => 'Forwarded';

  @override
  String get sentBySupportLabel => 'Sent by support';

  @override
  String get editedMark => 'Edited';

  @override
  String get selectAction => 'Select messages';

  @override
  String selectedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count selected',
      one: '1 selected',
    );
    return '$_temp0';
  }

  @override
  String get cancelSelection => 'Cancel selection';

  @override
  String get searchInChat => 'Search in chat';

  @override
  String get searchMessagesHint => 'Search messages';

  @override
  String get searchClose => 'Close search';

  @override
  String get searchOlder => 'Older match';

  @override
  String get searchNewer => 'Newer match';

  @override
  String get searchNoMatches => 'No matching messages';

  @override
  String get searchTooShort => 'Type at least 2 characters';

  @override
  String searchPosition(int index, String total) {
    return '$index of $total';
  }

  @override
  String get searchMessagesSection => 'Messages';

  @override
  String get searchMessagesNone => 'No matching messages in your chats';

  @override
  String get chatThemeAction => 'Chat theme';

  @override
  String get chatWallpaperBadType =>
      'That is not a valid JPEG, PNG or WebP image.';

  @override
  String get chatWallpaperTooLarge => 'That image is too large (4 MB at most).';

  @override
  String get chatWallpaperBadSize =>
      'The image must be between 200 and 4096 pixels on each side.';

  @override
  String get chatWallpaperAnimated =>
      'An animated image cannot be used as a wallpaper.';

  @override
  String get chatThemeHint =>
      'Only you see this. It changes this chat\'s background on all your devices.';

  @override
  String get chatThemeDefault => 'Default';

  @override
  String get chatThemeLagoon => 'Lagoon';

  @override
  String get chatThemeSand => 'Sand';

  @override
  String get chatThemeRose => 'Rose';

  @override
  String get chatThemeSky => 'Sky';

  @override
  String get chatThemeLilac => 'Lilac';

  @override
  String get chatThemeOlive => 'Olive';

  @override
  String get chatThemeSlate => 'Slate';

  @override
  String get chatThemeDusk => 'Dusk';

  @override
  String get chatWallpaperTitle => 'Photo wallpaper';

  @override
  String get chatWallpaperChoose => 'Choose a photo';

  @override
  String get chatWallpaperReplace => 'Change photo';

  @override
  String get chatWallpaperRemove => 'Remove photo';

  @override
  String get teacherProfileTitle => 'Teacher professional profile';

  @override
  String get teacherProfileSettingsEntry => 'Professional profile';

  @override
  String get teacherProfileSettingsSubtitle => 'What families read about you';

  @override
  String get teacherProfileAboutSection => 'About';

  @override
  String get teacherProfileBioLabel => 'Bio';

  @override
  String get teacherProfileBioHint => 'A short introduction for families.';

  @override
  String get teacherProfileProfessionalSection => 'Professional information';

  @override
  String get teacherProfileSpecializationLabel => 'Specialization';

  @override
  String get teacherProfileQualificationsLabel => 'Qualifications';

  @override
  String get teacherProfileExperienceLabel => 'Experience';

  @override
  String get teacherProfileLanguagesLabel => 'Languages';

  @override
  String get teacherProfileLanguagesHint =>
      'Separate each language with a comma.';

  @override
  String get teacherProfileCertificatesSection => 'Certificates';

  @override
  String get teacherProfileCertificatesEmpty => 'No certificates yet.';

  @override
  String get teacherProfileAddCertificate => 'Add certificate';

  @override
  String get teacherProfileCertificateTitleLabel => 'Certificate title';

  @override
  String get teacherProfileCertificateIssuerLabel => 'Issuing organization';

  @override
  String get teacherProfileCertificateYearLabel => 'Year issued';

  @override
  String get teacherProfileCertificateFile => 'Choose file';

  @override
  String teacherProfileCertificateFileChosen(String name) {
    return '$name ready to upload';
  }

  @override
  String get teacherProfileCertificateUploading => 'Uploading…';

  @override
  String get teacherProfileCertificateOpen => 'Open';

  @override
  String get teacherProfileCertificateRemove => 'Remove';

  @override
  String get teacherProfileCertificateRemoveTitle => 'Remove this certificate?';

  @override
  String get teacherProfileCertificateRemoveBody =>
      'It will be removed from your profile. The file is deleted.';

  @override
  String get teacherProfileCertificatePending => 'Awaiting review';

  @override
  String get teacherProfileCertificateApproved => 'Approved';

  @override
  String get teacherProfileCertificateRejected => 'Not accepted';

  @override
  String get teacherProfileSave => 'Save';

  @override
  String get teacherProfileSaving => 'Saving…';

  @override
  String get teacherProfileSaved => 'Saved';

  @override
  String get teacherProfileEmptyTitle => 'Build your professional profile';

  @override
  String get teacherProfileEmptyBody =>
      'Tell families about your background. Your changes are saved and visible right away.';

  @override
  String get teacherProfileUnavailable =>
      'Your professional profile is not available right now.';

  @override
  String get teacherProfileCertificateTitleRequired =>
      'Give the certificate a title.';

  @override
  String get teacherProfileCertificateFileRequired => 'Choose a file first.';

  @override
  String get teacherProfileCertificateBadType => 'Choose a PDF, JPEG or PNG.';

  @override
  String get teacherProfileCertificateTooLarge =>
      'That file is larger than 10 MB.';

  @override
  String get teacherProfileCertificateEdit => 'Edit';

  @override
  String get teacherProfileCertificateEditTitle => 'Edit certificate';

  @override
  String get teacherProfileCertificateEditNote =>
      'Editing the details sends this certificate for review again. The file is not changed.';

  @override
  String get teacherProfileNameLabel => 'Your name';

  @override
  String get teacherProfileNameSave => 'Save name';

  @override
  String get teacherProfileNameSaved => 'Name saved';

  @override
  String get teacherProfileNameRequired => 'Enter your name.';

  @override
  String get teacherProfilePhotoChoose => 'Profile photo';

  @override
  String get teacherProfilePhotoReplace => 'Replace photo';

  @override
  String get teacherProfilePhotoRemove => 'Remove photo';

  @override
  String get teacherProfilePhotoRemoveTitle => 'Remove your photo?';

  @override
  String get teacherProfilePhotoRemoveBody =>
      'Your profile will show your initials instead.';

  @override
  String get teacherProfilePhotoUploading => 'Uploading photo…';

  @override
  String get teacherProfileCertificateSave => 'Save certificate';

  @override
  String get myProfileTitle => 'My profile';

  @override
  String get myProfileSettingsSubtitle => 'Your photo, name and about';

  @override
  String get profileAboutLabel => 'About';

  @override
  String get profileAboutHint => 'A little about you';

  @override
  String get profileAboutEmpty => 'Nothing added yet';

  @override
  String get profileNameLabel => 'Name';

  @override
  String get profileNameEmptyError => 'Please enter a name';

  @override
  String get profileNameTooLongError => 'That name is too long';

  @override
  String get profileAboutTooLongError => 'That is too long';

  @override
  String get profileEdit => 'Edit';

  @override
  String get profileSave => 'Save';

  @override
  String get profileCancel => 'Cancel';

  @override
  String get profileSaved => 'Saved';

  @override
  String get profileSaveFailed => 'That could not be saved. Please try again.';

  @override
  String get profilePhotoRemoveFailed =>
      'That photo could not be removed. Please try again.';

  @override
  String get profilePhotoEditLabel => 'Change your photo';

  @override
  String profileChildPhotoEditLabel(String name) {
    return 'Change $name\'s photo';
  }

  @override
  String profileChildEditTitle(String name) {
    return '$name\'s profile';
  }

  @override
  String get profileLoadFailed => 'Your profile could not be loaded.';

  @override
  String get ticketReportChoose => 'What happened in this lesson?';

  @override
  String get ticketReportAttended => 'Student attended';

  @override
  String get ticketReportNotAttended => 'Student did not attend';

  @override
  String get ticketAbsenceConfirm =>
      'The group will be told that the student did not attend this lesson.';

  @override
  String get reportLessonNumberLabel => 'Lesson number';

  @override
  String get reportTopicsLabel => 'What did the student learn?';

  @override
  String get reportDetailsLabel => 'Details (optional, short)';

  @override
  String get reportPerformanceLabel => 'Performance in this lesson';

  @override
  String get reportNextLabel => 'For the next lesson';

  @override
  String get reportHomeworkDetailsLabel => 'Homework details (optional)';

  @override
  String get reportPrivateNoteLabel => 'Private note (supervisors only)';

  @override
  String get reportNeedsCovered => 'Choose a topic or write a short line.';

  @override
  String get reportEdit => 'Edit report';

  @override
  String get reportUpdated => 'Report updated';

  @override
  String get topicNewMemorization => 'New memorization';

  @override
  String get topicRevision => 'Revision';

  @override
  String get topicRecitation => 'Recitation';

  @override
  String get topicTajweed => 'Tajweed rules';

  @override
  String get topicReading => 'Reading';

  @override
  String get topicWriting => 'Writing';

  @override
  String get topicGrammar => 'Grammar';

  @override
  String get topicVocabulary => 'Vocabulary';

  @override
  String get topicIslamicStudies => 'Islamic studies';

  @override
  String get topicAssessment => 'Test / assessment';

  @override
  String get taskMemorizeNew => 'Memorize the new part';

  @override
  String get taskRevisePrevious => 'Revise previous lessons';

  @override
  String get taskPractiseRecitation => 'Practise recitation';

  @override
  String get taskPractiseReading => 'Practise reading';

  @override
  String get taskWrittenHomework => 'Written homework';

  @override
  String get taskPrepareNext => 'Prepare the next lesson';

  @override
  String get taskNothing => 'Nothing this time';

  @override
  String get level5 => 'Excellent';

  @override
  String get level4 => 'Very good';

  @override
  String get level3 => 'Good';

  @override
  String get level2 => 'Fair';

  @override
  String get level1 => 'Needs more work';

  @override
  String get cardLessonNumber => 'Lesson no.';

  @override
  String get cardNextLesson => 'For the next lesson';

  @override
  String get cardPerformance => 'Performance';

  @override
  String get cardCorrectedTitle => 'Lesson record corrected';

  @override
  String get cardCorrectedNow => 'Now recorded as';

  @override
  String get cardExcusedAfterTitle => 'Excused after the lesson started';

  @override
  String get cardReportCorrected => 'Corrected by the supervisor';

  @override
  String get cardOutcomeHeld => 'The student attended';

  @override
  String get cardOutcomeStudentNoShow => 'The student did not attend';

  @override
  String get cardOutcomeExcusedBefore => 'Student excused before the start';

  @override
  String get cardOutcomeExcusedAfter => 'Student excused after the start';

  @override
  String get cardOutcomeTeacherApology => 'The teacher apologised';

  @override
  String get cardOutcomeTeacherNoShow => 'The teacher was absent';

  @override
  String get cardOutcomeCancelled => 'Cancelled';

  @override
  String get makeupOtherTime => 'Another agreed date and time';

  @override
  String get makeupAgreedHint =>
      'Record the make-up once you and the family have agreed on a time.';

  @override
  String makeupChosen(String when) {
    return 'Chosen: $when';
  }

  @override
  String get groupChildrenTitle => 'Children in this group';

  @override
  String groupChildAge(int age) {
    String _temp0 = intl.Intl.pluralLogic(
      age,
      locale: localeName,
      other: '$age years',
      one: '1 year',
    );
    return '$_temp0';
  }

  @override
  String get groupChildAgeLabel => 'Age';

  @override
  String get groupChildCourse => 'Course';

  @override
  String get groupChildSchedule => 'Lesson days and times';

  @override
  String get groupChildPackage => 'Package';

  @override
  String groupChildPackageLessons(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lessons',
      one: '1 lesson',
    );
    return '$_temp0';
  }

  @override
  String get groupChildTeacher => 'Teacher';

  @override
  String get groupChildNotSet => 'Not set';

  @override
  String get groupChildNoSchedule => 'No regular times yet';

  @override
  String groupChildMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes min',
      one: '1 min',
    );
    return '$_temp0';
  }

  @override
  String get signupOpen => 'New parent? Create your account';

  @override
  String get signupTitle => 'Create your parent account';

  @override
  String get signupEmailIntro =>
      'Enter the e-mail address you gave the academy when you subscribed.';

  @override
  String get signupEmailLabel => 'E-mail';

  @override
  String get signupEmailInvalid => 'Enter a valid e-mail address.';

  @override
  String get signupSendCode => 'Get my code';

  @override
  String get signupCodeSent =>
      'Your supervisor will send you a 6-digit code on WhatsApp. Enter it below with the password you want.';

  @override
  String get signupCodeLabel => '6-digit code';

  @override
  String get signupPasswordLabel => 'New password (at least 8 characters)';

  @override
  String get signupPasswordConfirmLabel => 'Repeat the password';

  @override
  String get signupPasswordTooShort => 'Use at least 8 characters.';

  @override
  String get signupPasswordsDiffer => 'The passwords do not match.';

  @override
  String get signupFinish => 'Create account';

  @override
  String get signupCodeInvalid =>
      'That code is not valid or has expired. Ask for a new one.';

  @override
  String get signupNewCode => 'Send a new code';

  @override
  String get signupTooMany => 'Too many attempts. Try again in a few minutes.';

  @override
  String get signupFailed => 'Something went wrong. Try again.';

  @override
  String get resetOpen => 'Forgot your password? I have a reset code';

  @override
  String get resetTitle => 'Set a new password';

  @override
  String get resetIntro =>
      'Ask the academy for a one-time code. Then enter your login, the code and a new password of your own. Nobody else will know it.';

  @override
  String get resetUsernameLabel => 'Your login (e-mail)';

  @override
  String get resetUsernameRequired => 'Enter your login.';

  @override
  String get resetCodeLabel => '6-digit code';

  @override
  String get resetCodeInvalid =>
      'That code is not valid, has expired or was already used. Ask the academy for a new one.';

  @override
  String get resetFinish => 'Set password';

  @override
  String get recoveryOpen => 'Trouble signing in?';

  @override
  String get recoveryTitle => 'Get back into your account';

  @override
  String get recoveryIntro =>
      'Choose what you need help with. It only takes a minute.';

  @override
  String get recoveryUnavailable =>
      'To get back into your account, ask your supervisor for a one-time reset code, then enter it here.';

  @override
  String get recoveryForgotPassword => 'I forgot my password';

  @override
  String get recoveryForgotPasswordHint =>
      'We\'ll e-mail a code to the address you sign in with.';

  @override
  String get recoveryForgotEmail => 'I forgot my e-mail';

  @override
  String get recoveryForgotEmailHint =>
      'We\'ll send a code on WhatsApp to the phone number the academy has for you.';

  @override
  String get recoveryHaveCode => 'I have a code from the academy';

  @override
  String get recoveryHaveCodeHint =>
      'Your supervisor gave you a one-time reset code.';

  @override
  String get recoveryStillStuck =>
      'Still stuck? Your supervisor can send you a one-time reset code.';

  @override
  String recoveryStep(int number, int total) {
    return 'Step $number of $total';
  }

  @override
  String get recoverySendCode => 'Send code';

  @override
  String get recoveryResend => 'Send a new code';

  @override
  String recoveryResendIn(int seconds) {
    return 'Send a new code in $seconds s';
  }

  @override
  String get recoveryResent =>
      'A new code is on its way. Only the newest code works.';

  @override
  String get recoveryContinue => 'Continue';

  @override
  String get recoveryChangeEmail => 'Use a different e-mail';

  @override
  String get recoveryChangePhone => 'Use a different number';

  @override
  String get recoveryCodeFormat => 'Enter the 6 digits of the code.';

  @override
  String get recoveryCodeInvalid =>
      'That code is wrong or has expired. Check it, or send a new one.';

  @override
  String get forgotPasswordTitle => 'Reset your password';

  @override
  String get forgotPasswordIntro =>
      'Enter the e-mail you sign in with. We\'ll send you a 6-digit code.';

  @override
  String forgotPasswordCodeSent(String email, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes minutes',
      one: '1 minute',
    );
    return 'If $email is a parent account, a 6-digit code is on its way. It works for $_temp0; check your spam folder if you can\'t see it. Then choose a new password.';
  }

  @override
  String get forgotEmailTitle => 'Find your sign-in e-mail';

  @override
  String get forgotEmailIntro =>
      'Enter your phone number, the one the academy has for you. We\'ll send a 6-digit code to it on WhatsApp.';

  @override
  String get forgotEmailPhoneLabel => 'Phone number';

  @override
  String get forgotEmailPhoneHint =>
      'If your number is not Egyptian, start with + and the country code.';

  @override
  String get forgotEmailPhoneInvalid => 'Enter your phone number.';

  @override
  String forgotEmailCodeSent(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes minutes',
      one: '1 minute',
    );
    return 'If this number is on file, a 6-digit code is on its way on WhatsApp. It works for $_temp0.';
  }

  @override
  String get forgotEmailFound => 'Your sign-in e-mail is:';

  @override
  String get forgotEmailFoundMany =>
      'This phone number belongs to more than one account. Choose the one you want:';

  @override
  String get forgotEmailSignIn => 'Sign in with this e-mail';

  @override
  String get forgotEmailSetPassword => 'I forgot my password too';

  @override
  String get studentProfileTitle => 'Student profile';

  @override
  String get studentProfileView => 'View profile';

  @override
  String get studentProfileTeacher => 'Assigned teacher';

  @override
  String get studentProfileSchedule => 'Class schedule';

  @override
  String studentProfileTimeZone(String zone) {
    return 'Times in $zone';
  }

  @override
  String get studentProfileNotYoursTitle =>
      'You can\'t open this student\'s profile';

  @override
  String get studentProfileNotYoursBody =>
      'Only the student\'s own teacher can see it.';

  @override
  String get myPaymentsTitle => 'Payments';

  @override
  String get myPaymentsSettingsSubtitle =>
      'Your instalments and what has been paid';

  @override
  String get billingPlanLabel => 'Plan';

  @override
  String billingPlanMonths(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: '$months-month plan',
      one: '1-month plan',
    );
    return '$_temp0';
  }

  @override
  String get billingNoPlan => 'No plan';

  @override
  String get billingMethodLabel => 'Payment method';

  @override
  String get billingMethodInvoice => 'Invoice';

  @override
  String get billingMethodBankTransfer => 'Bank transfer';

  @override
  String get billingNotSet => 'Not set';

  @override
  String get billingPaidTotal => 'Paid';

  @override
  String get billingOutstandingTotal => 'Outstanding';

  @override
  String get billingOverdueTotal => 'of which overdue';

  @override
  String get billingInstalmentsTitle => 'Instalments';

  @override
  String get billingStatusOverdue => 'Overdue';

  @override
  String get billingStatusDue => 'Due today';

  @override
  String get billingStatusUpcoming => 'Upcoming';

  @override
  String get billingStatusPaid => 'Paid';

  @override
  String get billingFamily => 'Family';

  @override
  String billingDueOn(String date) {
    return 'Due $date';
  }

  @override
  String billingPaidOn(String date, String method) {
    return 'Paid $date · $method';
  }

  @override
  String billingPaidOnNoMethod(String date) {
    return 'Paid $date';
  }

  @override
  String billingDaysLate(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days days late',
      one: '1 day late',
    );
    return '$_temp0';
  }

  @override
  String billingDaysUntil(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'in $days days',
      one: 'in 1 day',
    );
    return '$_temp0';
  }

  @override
  String get billingEmptyTitle => 'No payments yet';

  @override
  String get billingEmptyBody => 'Your instalments will appear here.';

  @override
  String get billingDeniedTitle =>
      'Payments are shown to the family\'s parents';

  @override
  String get billingDeniedBody => 'If you have a question, ask the academy.';

  @override
  String get tabPayments => 'Payments';

  @override
  String get roleSales => 'Sales';

  @override
  String get roleSuperAdmin => 'Super admin';

  @override
  String get conversationsEmptyBodySales =>
      'Trial groups and your conversations will appear here.';

  @override
  String get internalNoteLabel => 'Internal note';

  @override
  String get trialGroupNotMember => 'You are not a member of this group yet.';

  @override
  String get trialGroupJoin => 'Join this group';

  @override
  String get salesSearchHint => 'Search parents or families';

  @override
  String get salesSearchEmpty => 'No parents found';

  @override
  String get salesSearchTruncated =>
      'Showing the first results. Type more to narrow the search.';

  @override
  String salesChildrenCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count children',
      one: '1 child',
      zero: 'No children',
    );
    return '$_temp0';
  }

  @override
  String get salesPaymentsDenied =>
      'Payments are not available for your account.';

  @override
  String get billingCurrencyLabel => 'Currency';

  @override
  String get billingStatusVoided => 'Voided';

  @override
  String salesPaidRecordedBy(String date, String method, String name) {
    return 'Paid $date · $method · recorded by $name';
  }

  @override
  String salesVoidedBy(String name, String reason) {
    return 'Voided by $name: $reason';
  }

  @override
  String salesVoidedReason(String reason) {
    return 'Voided: $reason';
  }

  @override
  String get salesRecordPayment => 'Record payment';

  @override
  String get salesVoid => 'Void';

  @override
  String get salesPaidOnLabel => 'Paid on';

  @override
  String get salesReferenceLabel => 'Reference (optional)';

  @override
  String get salesRecordSave => 'Record';

  @override
  String get salesVoidTitle => 'Void this instalment?';

  @override
  String get salesVoidFinal =>
      'Voiding is final: the instalment can no longer be paid.';

  @override
  String get salesVoidReasonLabel => 'Reason';

  @override
  String get salesVoidConfirm => 'Void instalment';

  @override
  String get salesBillingStateConflict =>
      'This instalment was already paid or voided. The list has been refreshed.';

  @override
  String get salesBillingInvalid =>
      'Check the date and the reference, then try again.';

  @override
  String get salesWriteFailed => 'Could not save. Try again.';

  @override
  String get settingsDateTime => 'Date & time';

  @override
  String settingsDateTimeSubtitle(String zone) {
    return 'Time zone: $zone';
  }

  @override
  String get timeZoneSetAutomatically => 'Set automatically';

  @override
  String get timeZoneAutomaticHint =>
      'Uses your phone\'s time zone, and changes by itself when you travel.';

  @override
  String get timeZoneLabel => 'Time zone';

  @override
  String get timeZoneUnknown => 'Not known yet';

  @override
  String get timeZoneAppliesTo =>
      'Lesson times, reminders and notifications are shown in this time zone.';

  @override
  String get timeZoneSearchHint => 'Search for a city';

  @override
  String get timeZoneNoMatch => 'No time zone matches.';

  @override
  String get timeZoneSaveFailed => 'Could not change the time zone. Try again.';

  @override
  String get billingAmountDueTitle => 'Amount due';

  @override
  String get billingPay => 'Pay';

  @override
  String billingPaidOfTotal(String paid, String total) {
    return 'Paid $paid of $total';
  }

  @override
  String billingPeriod(String start, String end) {
    return '$start – $end';
  }

  @override
  String get billingConfirmingPayment =>
      'We\'re confirming your payment. This can take a minute.';

  @override
  String get billingPaySheetTitle => 'How would you like to pay?';

  @override
  String get billingPayByCard => 'Pay by card';

  @override
  String get billingPayByCardHint => 'Opens a secure payment page';

  @override
  String get billingBankTransferHint =>
      'Transfer the amount, then upload the receipt';

  @override
  String get billingPaymentsUnavailable =>
      'Card payment isn\'t available right now. You can pay by bank transfer.';

  @override
  String get billingNoLongerOpen =>
      'This has already been paid or is no longer open. The list has been refreshed.';

  @override
  String get billingCouldNotOpen => 'Couldn\'t open the page. Try again.';

  @override
  String get billingTransferAmount => 'Amount to transfer';

  @override
  String get billingBankName => 'Bank';

  @override
  String get billingAccountName => 'Account name';

  @override
  String get billingIban => 'IBAN';

  @override
  String get billingAccountNumber => 'Account number';

  @override
  String get billingSwift => 'SWIFT';

  @override
  String get billingCopy => 'Copy';

  @override
  String get billingCopied => 'Copied';

  @override
  String get billingNoBankAccount =>
      'The academy hasn\'t added its bank details yet. Ask your supervisor for them.';

  @override
  String get billingUploadReceiptTitle => 'Upload receipt';

  @override
  String get billingReceiptPhoto => 'Photo';

  @override
  String get billingReceiptCamera => 'Camera';

  @override
  String get billingReceiptPdf => 'PDF';

  @override
  String get billingReceiptFileHint =>
      'A screenshot or PDF of the transfer: JPEG, PNG, WebP or PDF, up to 10 MB.';

  @override
  String get billingReceiptAttachedPhoto => 'Photo attached';

  @override
  String get billingReceiptRemove => 'Remove';

  @override
  String billingReceiptAmountLabel(String currency) {
    return 'Amount you transferred ($currency)';
  }

  @override
  String get billingReceiptDateLabel => 'Transfer date';

  @override
  String get billingReceiptNoteLabel => 'Note (optional)';

  @override
  String get billingReceiptSend => 'Send receipt';

  @override
  String get billingReceiptSent =>
      'Receipt sent. The academy will confirm it soon.';

  @override
  String get billingReceiptNeedFile => 'Attach the receipt first.';

  @override
  String get billingReceiptBadAmount => 'Enter the amount you transferred.';

  @override
  String get billingReceiptWrongType =>
      'Use a JPEG, PNG or WebP image, or a PDF.';

  @override
  String get billingReceiptTooLarge => 'The file is larger than 10 MB.';

  @override
  String get billingReceiptPickDenied =>
      'Allow access in Settings, then try again.';

  @override
  String get billingReceiptPickFailed =>
      'Couldn\'t use that file. Try another one.';

  @override
  String get billingReceiptInvalid =>
      'Check the amount and the date, then try again.';

  @override
  String get billingReceiptsTitle => 'Transfer receipts';

  @override
  String get billingReceiptPending => 'Pending verification';

  @override
  String get billingReceiptApproved => 'Approved';

  @override
  String get billingReceiptRejected => 'Rejected';

  @override
  String billingReceiptRejectReason(String reason) {
    return 'Reason: $reason';
  }

  @override
  String billingTransferredOn(String date) {
    return 'Transferred $date';
  }

  @override
  String get billingInvoicesTitle => 'Invoices';

  @override
  String billingInvoiceIssued(String date) {
    return 'Issued $date';
  }

  @override
  String get billingInvoiceRefunded => 'Refunded';

  @override
  String get billingInvoicePartiallyRefunded => 'Partially refunded';

  @override
  String get billingInvoiceDownload => 'Download';

  @override
  String billingRefundedAmount(String amount) {
    return 'Refunded $amount';
  }

  @override
  String get billingMethodCard => 'Card';

  @override
  String get billingMethodCash => 'Cash';

  @override
  String get billingTooManyAttempts =>
      'Too many attempts. Wait a while, then try again.';

  @override
  String get billingReceiptNotAccepted =>
      'This receipt can\'t be added: the amount is already paid or closed, or other receipts are still waiting to be checked.';

  @override
  String get signInKeepSignedIn => 'Keep me signed in on this device';

  @override
  String get webPortalTitle => 'The web portal is for teachers';

  @override
  String get webPortalFamilyBody => 'Please use the Jawwid app on your phone.';

  @override
  String get webPortalStaffBody =>
      'Please use Admin Web, or the Jawwid app on your phone.';

  @override
  String get voiceNoteWebUnavailable =>
      'Voice notes can be recorded in the phone app.';

  @override
  String get materialsTitle => 'Materials';

  @override
  String get materialsEntrySubtitle =>
      'Library, practice this week and the memorization map';

  @override
  String get materialsTabLibrary => 'Library';

  @override
  String get materialsTabPractice => 'Practice this week';

  @override
  String get materialsTabProgress => 'Memorization map';

  @override
  String get materialsSubjectAll => 'All';

  @override
  String get materialsSubjectQuran => 'Quran';

  @override
  String get materialsSubjectArabic => 'Arabic language';

  @override
  String get materialsSubjectIslamic => 'Islamic studies';

  @override
  String get materialsStrandMemorization => 'Memorization';

  @override
  String get materialsStrandRecitation => 'Recitation';

  @override
  String get materialsStrandWordMeanings => 'Word meanings';

  @override
  String get materialsStrandTafsir => 'Tafsir';

  @override
  String get materialsKindActivity => 'Activity';

  @override
  String get materialsKindAudio => 'Audio';

  @override
  String get materialsKindVideo => 'Video';

  @override
  String get materialsKindPdf => 'PDF';

  @override
  String get materialsKindImage => 'Picture';

  @override
  String get materialsAgeAll => 'All ages';

  @override
  String materialsAgeBand(String band) {
    return 'Ages $band';
  }

  @override
  String materialsAgeForChild(String band) {
    return '$band · your child\'s age';
  }

  @override
  String get materialsLibraryEmpty =>
      'Nothing here yet for this subject and age.';

  @override
  String get materialsUnavailable => 'Materials could not be loaded.';

  @override
  String get materialsPracticeEmpty =>
      'Nothing to practise yet. It appears here when the teacher adds it to a lesson report.';

  @override
  String get materialsPracticeLatest =>
      'Nothing new this week. The latest practice:';

  @override
  String materialsPracticeFrom(String day) {
    return 'From the lesson of $day';
  }

  @override
  String materialsAyahRange(String surah, String from, String to) {
    return 'Surah $surah, ayahs $from–$to';
  }

  @override
  String materialsWholeSurah(String surah) {
    return 'Surah $surah';
  }

  @override
  String get materialsListen => 'Listen';

  @override
  String get materialsItemGone => 'This item is no longer in the library.';

  @override
  String get materialsNextTasks => 'For next lesson';

  @override
  String get materialsHomework => 'Homework';

  @override
  String get materialsStatusNotStarted => 'Not started';

  @override
  String get materialsStatusInProgress => 'In progress';

  @override
  String get materialsStatusMemorized => 'Memorized';

  @override
  String get materialsStatusNeedsRevision => 'Needs revision';

  @override
  String materialsJuz(String n) {
    return 'Juz’ $n';
  }

  @override
  String get materialsHistory => 'History';

  @override
  String get materialsHistoryEmpty => 'Nothing recorded for this surah yet.';

  @override
  String get materialsSourceReport => 'Lesson report';

  @override
  String get materialsSourceReportEdit => 'Edited report';

  @override
  String get materialsSourceCorrection => 'Correction';

  @override
  String get materialsByTeacher => 'Teacher';

  @override
  String get materialsByAcademy => 'The academy';

  @override
  String get materialsCorrect => 'Correct';

  @override
  String get materialsCorrectReason => 'Reason (required)';

  @override
  String get materialsOpenExternally => 'Open in browser';

  @override
  String get materialsOpenedInTab => 'The activity opened in a new tab.';

  @override
  String get materialsCannotOpen => 'This could not be opened on this device.';

  @override
  String get materialsPlayFailed => 'This could not be played.';

  @override
  String get reportPracticeLabel => 'Practice this week';

  @override
  String get reportPracticeAddAyahs => 'Add ayahs';

  @override
  String get reportPracticeAddItem => 'From the library';

  @override
  String get reportPracticeKeep =>
      'Practice stays as it was unless you change it.';

  @override
  String get reportMemorizationLabel => 'Memorization map';

  @override
  String get reportMemorizationAdd => 'Mark a surah';

  @override
  String get reportSurahLabel => 'Surah';

  @override
  String get reportAyahFrom => 'From ayah';

  @override
  String get reportAyahTo => 'To ayah';

  @override
  String reportAyahInvalid(String count) {
    return 'Ayahs 1 to $count, the first not after the last.';
  }

  @override
  String get reportAdd => 'Add';

  @override
  String get reportPickerSearch => 'Search the library';

  @override
  String get reportPickerEmpty => 'No published items match.';

  @override
  String get materialsCorrectReasonHint => 'Parents can see this reason.';

  @override
  String get ticketChangeLessonTime => 'Change lesson time';

  @override
  String get slotsMorning => 'Morning';

  @override
  String get slotsAfternoon => 'Afternoon';

  @override
  String get slotsEvening => 'Evening';

  @override
  String slotsFreeCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count free times',
      one: '1 free time',
    );
    return '$_temp0';
  }

  @override
  String slotsExcept(String dates) {
    return 'except $dates';
  }

  @override
  String get slotsLocked => 'Lessons paused — payment';

  @override
  String get slotsNone => 'No free times right now.';

  @override
  String get changeTimeOnce => 'This lesson only';

  @override
  String get changeTimeOnceHint => 'Move one lesson to another free time';

  @override
  String get changeTimeWeekly => 'Every week';

  @override
  String get changeTimeWeeklyHint => 'Change the regular weekly times';

  @override
  String get changeTimePickLesson => 'Which lesson?';

  @override
  String get changeTimeNoLessons =>
      'No upcoming lessons in the next four weeks.';

  @override
  String changeTimeCurrent(String when) {
    return 'Now: $when';
  }

  @override
  String changeTimeSummary(String from, String to) {
    return '$from → $to';
  }

  @override
  String get changeTimeConfirm => 'Confirm';

  @override
  String changeTimeMovesLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count moves left this month',
      one: '1 move left this month',
      zero: 'No moves left this month',
    );
    return '$_temp0';
  }

  @override
  String get changeTimeTaken =>
      'That time was just taken. Please choose another.';

  @override
  String get moveRefusedStarted => 'This lesson has already started.';

  @override
  String get moveRefusedNotMovable => 'This lesson can\'t be moved.';

  @override
  String get moveRefusedAlreadyMoved =>
      'This lesson has already been moved once.';

  @override
  String get moveRefusedMonthlyLimit =>
      'This month\'s limit of moves for this child has been reached.';

  @override
  String get moveRefusedTooLate =>
      'It\'s too close to the start to move this lesson.';

  @override
  String get weeklyCurrentTitle => 'Current weekly times';

  @override
  String get weeklyNoCurrent => 'No weekly times yet.';

  @override
  String get weeklyChange => 'Change';

  @override
  String get weeklyRemove => 'Remove';

  @override
  String get weeklyUndo => 'Undo';

  @override
  String get weeklyAdd => 'Add a time';

  @override
  String weeklyPickReplacement(String when) {
    return 'New time instead of $when';
  }

  @override
  String get weeklyPickAdded => 'Choose a time to add';

  @override
  String get weeklyWillStop => 'Will stop';

  @override
  String get weeklyFrom => 'From';

  @override
  String weeklySummaryFrom(String date) {
    return 'From $date';
  }

  @override
  String weeklySummaryAdded(String when) {
    return 'Add $when';
  }

  @override
  String weeklySummaryRemoved(String when) {
    return 'Stop $when';
  }

  @override
  String weeklySummaryUnchanged(String when) {
    return '$when unchanged';
  }

  @override
  String weeklySummarySkipped(String date) {
    return '$date will be skipped';
  }

  @override
  String get childScheduleTitle => 'Schedule';

  @override
  String get childScheduleEntrySubtitle => 'Weekly times and upcoming lessons';

  @override
  String get childScheduleWeekly => 'Weekly times';

  @override
  String get childScheduleUpcoming => 'Next four weeks';

  @override
  String get childScheduleNoLessons => 'No lessons in the next four weeks.';

  @override
  String get childSchedulePending =>
      'A change of times is waiting for the supervision team.';

  @override
  String get childScheduleLoadFailed => 'Couldn\'t load the schedule.';

  @override
  String childLessonMovedFrom(String when) {
    return 'Was $when';
  }

  @override
  String get childLessonExcused => 'Excused';

  @override
  String get cardMovedTitle => 'Lesson moved';

  @override
  String get cardMovedByFamily => 'Moved by the family';

  @override
  String get cardMovedByTeacher => 'Moved by the teacher';

  @override
  String get cardMovedByStaff => 'Moved by the supervision team';

  @override
  String workloadMoved(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Lessons moved: $count',
      one: 'Lessons moved: 1',
    );
    return '$_temp0';
  }

  @override
  String get filterStarred => 'Starred';

  @override
  String get trialBadge => 'Trial';

  @override
  String get signupLocked =>
      'Too many wrong codes. Please contact your supervisor.';

  @override
  String get feedbackEntryTitle => 'Feedback about the teacher';

  @override
  String get feedbackEntrySubtitle => 'Praise, a suggestion or a complaint';

  @override
  String feedbackTeacherLine(String name) {
    return 'Teacher: $name';
  }

  @override
  String get feedbackHistoryTitle => 'Your earlier feedback';

  @override
  String get feedbackEmpty => 'No feedback sent yet';

  @override
  String get feedbackEmptyBody =>
      'Tell the administration what is going well, or what could be better.';

  @override
  String get feedbackNoTeacher => 'No teacher is assigned to this child yet.';

  @override
  String get feedbackNew => 'New feedback';

  @override
  String feedbackSentOn(String date) {
    return 'Sent $date';
  }

  @override
  String get feedbackStatusReceived => 'Received';

  @override
  String get feedbackStatusInReview => 'In review';

  @override
  String get feedbackStatusResolved => 'Resolved';

  @override
  String get feedbackResponseLabel => 'Reply from the administration';

  @override
  String get feedbackCategoryLabel => 'What kind of feedback is it?';

  @override
  String get feedbackCategoryPraise => 'Praise';

  @override
  String get feedbackCategorySuggestion => 'Suggestion';

  @override
  String get feedbackCategoryComplaint => 'Complaint';

  @override
  String get feedbackChooseCategory => 'Choose the kind of feedback.';

  @override
  String get feedbackBodyLabel => 'Your feedback';

  @override
  String get feedbackBodyHint =>
      'Write what happened, or what you would like to change.';

  @override
  String get feedbackBodyRequired => 'Write your feedback first.';

  @override
  String get feedbackPrivacyNote =>
      'The administration reviews every message. The teacher does not see who wrote it.';

  @override
  String get feedbackSubmit => 'Send';

  @override
  String get feedbackSent =>
      'Thank you. Your feedback has reached the administration.';

  @override
  String get feedbackLimit =>
      'You have sent a lot of feedback today. Please try again tomorrow.';

  @override
  String get feedbackNotFound =>
      'This child has no teacher to give feedback about right now.';

  @override
  String get feedbackDenied =>
      'Only a parent can send feedback about a teacher.';

  @override
  String get feedbackFailed =>
      'Your feedback could not be sent. Please try again.';

  @override
  String get notificationsCenterTitle => 'Notifications';

  @override
  String get notificationsTabAll => 'All';

  @override
  String get notificationsTabUnread => 'Unread';

  @override
  String get notificationsTabAction => 'Requires action';

  @override
  String get notificationsTabLessons => 'Lessons';

  @override
  String get notificationsTabPayments => 'Payments';

  @override
  String get notificationsTabConversations => 'Conversations';

  @override
  String get notificationsTabAnnouncements => 'Announcements';

  @override
  String get notificationsMarkAllRead => 'Mark all as read';

  @override
  String get notificationsLoadOlder => 'Show older';

  @override
  String get notificationsActionOpenConversation => 'Open conversation';

  @override
  String get notificationsActionViewLesson => 'View lesson';

  @override
  String get notificationsActionViewPayments => 'View payments';

  @override
  String get notificationsActionOpenStories => 'View story';

  @override
  String get notificationsActionOpenCalls => 'View calls';

  @override
  String get notificationSettingsQuietHours => 'Quiet hours';

  @override
  String get notificationSettingsQuietHoursBody =>
      'Notifications wait until quiet hours end, in your own time zone. Calls and lesson-start reminders always come through.';

  @override
  String get notificationSettingsFrom => 'From';

  @override
  String get notificationSettingsUntil => 'Until';

  @override
  String get notificationSettingsUseDefault => 'Use the academy\'s default';

  @override
  String get notificationSettingsShowNames => 'Show names on the lock screen';

  @override
  String get notificationSettingsShowNamesBody =>
      'Show your child\'s name in lesson reminders and the amount in payment reminders while the phone is locked.';

  @override
  String get notificationSettingsShowNamesTeacherBody =>
      'Show the student\'s name in lesson reminders while the phone is locked.';

  @override
  String get notificationSettingsCategories => 'Push notifications';

  @override
  String get notificationSettingsCategoriesBody =>
      'Switched off, they still appear in Notifications, without an alert.';

  @override
  String get notificationSettingsLocked => 'Always on';

  @override
  String get notificationCategoryMessages => 'Messages';

  @override
  String get notificationCategoryCalls => 'Calls';

  @override
  String get notificationCategoryTasks => 'Tasks';

  @override
  String get notificationCategoryAnnouncements => 'Announcements and stories';

  @override
  String get notificationCategorySystem => 'System';
}
