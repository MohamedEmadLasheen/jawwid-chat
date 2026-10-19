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
  String get callOutgoing => 'Calling…';

  @override
  String get callEnded => 'Call ended';

  @override
  String get callSendMessageInstead => 'Send a message instead';

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
  String get systemUpdate => 'System update';

  @override
  String get lessonTicketsHeader => 'Lesson';

  @override
  String get ticketReport => 'Lesson report';

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
  String get ticketBookMakeup => 'Book a make-up lesson';

  @override
  String get ticketRequestScheduleChange => 'Change regular lesson times';

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
  String get scheduleChangePick => 'Choose the new weekly times';

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
  String cardViolationStep(String step) {
    return 'Violation $step this month';
  }

  @override
  String get cardPayrollNote => 'The amount is set in payroll.';
}
