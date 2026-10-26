import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/billing/presentation/my_payments_screen.dart';
import '../features/calls/presentation/active_call_screen.dart';
import '../features/calls/presentation/calls_screen.dart';
import '../features/conversations/application/chat_realtime.dart';
import '../features/conversations/presentation/chats_screen.dart';
import '../features/lessons/presentation/child_schedule_screen.dart';
import '../features/lessons/presentation/teacher_schedule_screen.dart';
import '../features/materials/presentation/child_materials_screen.dart';
import '../features/messages/presentation/chat_screen_route.dart';
import '../features/messages/presentation/conversation_media_screen.dart';
import '../features/messages/presentation/starred_messages_screen.dart';
import '../features/notifications/presentation/notification_center_screen.dart';
import '../features/notifications/presentation/notification_settings_screen.dart';
import '../features/profile/presentation/my_profile_screen.dart';
import '../features/profile/presentation/profile_screen.dart';
import '../features/sales_payments/presentation/family_billing_screen.dart';
import '../features/sales_payments/presentation/sales_payments_screen.dart';
import '../features/sessions/presentation/devices_screen.dart';
import '../features/settings/presentation/date_time_screen.dart';
import '../features/settings/presentation/settings_screen.dart';
import '../features/stories/presentation/story_viewer_screen.dart';
import '../features/student_profile/presentation/student_profile_screen.dart';
import '../features/supervision/presentation/my_leave_screen.dart';
import '../features/teacher_profile/presentation/teacher_profile_screen.dart';
import '../shared/models/user_role.dart';
import 'providers.dart';
import 'shells/app_shell.dart';

/// Route paths, named once so deep links and in-app navigation cannot drift apart (§52).
abstract final class Routes {
  static const splash = '/';
  static const signIn = '/sign-in';
  static const chats = '/chats';
  static const calls = '/calls';
  static const settings = '/settings';

  /// PD-9/PD-10: the teacher's own schedule. A parent who follows a link here is sent
  /// to Chats (see the redirect).
  static const schedule = '/schedule';

  /// Retired destinations. They are not routes any more — Home and Groups both dissolved
  /// into Chats — but they are kept named here because notifications, saved links and
  /// earlier installs still point at them, and a stale link must land somewhere sensible
  /// rather than on a 404.
  static const retiredHome = '/home';
  static const retiredGroups = '/groups';

  static String conversation(String id) => '/chats/$id';

  /// A conversation opened at one message (a search hit): the thread loads older
  /// history until that message is on screen.
  static String conversationAt(String id, String messageId) =>
      '/chats/$id?m=${Uri.encodeQueryComponent(messageId)}';

  /// The live call (W7). Outside the tab shell and outside `/chats`, because a
  /// call is not a section of the app and is not a child of one conversation: an
  /// incoming call can arrive while the user is anywhere.
  static const activeCall = '/call';

  /// A person's profile, or a group's info. Reached only by tapping an avatar or a name —
  /// there is no Profile tab, and there never will be.
  static String conversationProfile(String id) => '/chats/$id/info';

  /// What has been shared in one conversation. Secondary navigation, reached only from
  /// conversation info — never a section of the app (§29).
  static String conversationMedia(String id) => '/chats/$id/media';

  /// The signed-in user's own account. Deliberately under Settings rather than alongside
  /// the profiles above: "my account" and "someone else's profile" are different things.
  static const myAccount = '/settings/account';

  /// PD-12: a teacher's own leave balance and requests.
  static const myLeave = '/settings/leave';

  /// The viewer's starred messages (their private bookmarks).
  static const starred = '/settings/starred';

  /// PD-23: the account's own sessions -- every device signed in, and signing them out.
  static const devices = '/settings/devices';

  /// PD-34: the account's own Notification Center (the bell on Chats).
  static const notifications = '/notifications';

  /// PD-34: quiet hours, names on the lock screen, which kinds push.
  static const notificationSettings = '/settings/notifications';

  /// PD-22: the account's time zone -- follow the phone, or a zone picked by hand.
  static const dateTime = '/settings/date-time';

  /// The teacher's professional profile. A SEPARATE destination from
  /// [myAccount]: that screen is who you are, this one is what families read
  /// about you, and the two have different audiences and different lifecycles.
  static const teacherProfile = '/settings/professional-profile';

  /// The parent's own EDITABLE profile — photo, name and About, and the same three for each
  /// of their children. Separate from [myAccount], which is a read-only summary shared with
  /// the teacher role: conflating them would hand a teacher controls that do not apply.
  static const myProfile = '/settings/profile';

  /// PD-17: the parent's own payments. Parents only -- anyone else following a link here
  /// is sent to Chats (see the redirect) -- and of parents, the server answers only the
  /// one who holds billing for the family.
  static const myPayments = '/settings/payments';

  /// PD-20: Sales' Payments tab -- find a family by a parent's name. Sales only (see the
  /// redirect); the server decides again on every request.
  static const salesPayments = '/payments';

  /// One family's instalments, opened from a search result.
  static String salesFamilyBilling(String familyId) => '$salesPayments/families/$familyId';

  /// One story, opened full-screen from the rail.
  ///
  /// A real route rather than a bare `Navigator.push`, for the same reason the media screen is
  /// one: the back button, the Android system back gesture and a notification deep link all
  /// have to land somewhere, and a story that lapsed before the link was followed must reach a
  /// screen that says so rather than a 404.
  static String story(String id) => '/stories/$id';

  /// PD-17: one of the signed-in teacher's own students. Teachers only -- anyone else
  /// following a link here is sent to Chats (see the redirect) -- and the server answers
  /// a teacher who is not this child's with a 404 regardless.
  static String studentProfile(String learnerId) => '$studentsPrefix/$learnerId';
  static const studentsPrefix = '/students';

  /// PD-29: one child's Materials (Library, Practice this week, Progress map) -- for the
  /// family, the child's own teacher and staff the server allows; the server decides.
  /// `?tab=progress` opens on the map.
  static String childMaterials(String learnerId, {bool progress = false}) =>
      '/children/$learnerId/materials${progress ? '?tab=progress' : ''}';

  /// PD-31: one child's weekly times and lessons for the next four weeks, read-only,
  /// with "Change lesson time". The family's own; the server decides.
  static String childSchedule(String learnerId) => '/children/$learnerId/schedule';
}

/// Rebuilds on every authentication change, so a session ending immediately evicts every
/// protected screen rather than leaving stale data on screen (§7).
/// Leave the call screen for its conversation — "Message" or "Record voice
/// message" after a call that is over.
///
/// The call route is popped FIRST, by us: [CallPresenter] then finds nothing of
/// its own on top and pops nothing else. If the conversation is what is now
/// underneath (the call was placed from it) it is REPLACED rather than pushed a
/// second time, so Back never lands on the same chat.
void openConversationFromCall(
  GoRouter router,
  String conversationId, {
  required bool recordVoice,
}) {
  final target = Routes.conversation(conversationId);
  final location = recordVoice ? '$target?voice=1' : target;
  if (router.state.uri.path == Routes.activeCall && router.canPop()) {
    router.pop();
  }
  if (router.routerDelegate.currentConfiguration.uri.path == target) {
    router.replace(location);
  } else {
    router.push(location);
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = _AuthRefresh(ref);
  ref.onDispose(notifier.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: notifier,
    redirect: (context, state) => _redirect(ref, state.matchedLocation),
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (context, state) => const _SplashScreen(),
      ),
      GoRoute(
        path: Routes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => _RoleShell(
          currentRoute: state.matchedLocation,
          child: child,
        ),
        routes: [
          GoRoute(
            path: Routes.chats,
            builder: (context, state) => const ChatsScreen(),
          ),
          GoRoute(
            path: Routes.calls,
            builder: (context, state) => const CallsScreen(),
          ),
          GoRoute(
            path: Routes.settings,
            builder: (context, state) => const SettingsScreen(),
          ),
          GoRoute(
            path: Routes.schedule,
            builder: (context, state) => const TeacherScheduleScreen(),
          ),
          GoRoute(
            path: Routes.salesPayments,
            builder: (context, state) => const SalesPaymentsScreen(),
          ),
        ],
      ),
      // Conversations open full-screen, above the tab bar, so the thread gets the whole
      // viewport — the composer and keyboard already claim a large share of a small screen.
      GoRoute(
        path: '${Routes.chats}/:conversationId',
        builder: (context, state) => ChatScreenRoute(
          conversationId: state.pathParameters['conversationId']!,
          focusMessageId: state.uri.queryParameters['m'],
          startVoiceRecording: state.uri.queryParameters['voice'] == '1',
        ),
      ),
      // The profile sits outside the tab shell, like the conversation it belongs to: it is
      // pushed on top, keeps a back button, and never highlights a tab.
      GoRoute(
        path: '${Routes.chats}/:conversationId/info',
        builder: (context, state) => ConversationProfileScreen(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      GoRoute(
        path: '${Routes.chats}/:conversationId/media',
        builder: (context, state) => ConversationMediaScreen(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      // W7. Pushed on top of everything, with no tab highlighted: a call takes the
      // screen while it lasts. Leaving it returns to whatever was underneath.
      GoRoute(
        path: Routes.activeCall,
        builder: (context, state) => ActiveCallScreen(
          onLeave: () {
            if (context.canPop()) context.pop();
          },
          onOpenConversation: (conversationId, {required recordVoice}) =>
              openConversationFromCall(
                GoRouter.of(context),
                conversationId,
                recordVoice: recordVoice,
              ),
        ),
      ),
      GoRoute(
        path: Routes.myAccount,
        builder: (context, state) => const MyAccountScreen(),
      ),
      GoRoute(
        path: Routes.myLeave,
        builder: (context, state) => const MyLeaveScreen(),
      ),
      GoRoute(
        path: Routes.starred,
        builder: (context, state) => const StarredMessagesScreen(),
      ),
      GoRoute(
        path: Routes.devices,
        builder: (context, state) => const DevicesScreen(),
      ),
      GoRoute(
        path: Routes.notifications,
        builder: (context, state) => const NotificationCenterScreen(),
      ),
      GoRoute(
        path: Routes.notificationSettings,
        builder: (context, state) => const NotificationSettingsScreen(),
      ),
      GoRoute(
        path: Routes.dateTime,
        builder: (context, state) => const DateTimeScreen(),
      ),
      GoRoute(
        path: Routes.teacherProfile,
        builder: (context, state) => const TeacherProfileScreen(),
      ),
      GoRoute(
        path: Routes.myProfile,
        builder: (context, state) => const MyProfileScreen(),
      ),
      GoRoute(
        path: Routes.myPayments,
        builder: (context, state) => const MyPaymentsScreen(),
      ),
      // Outside the shell, like a conversation: pushed over the search, with a back
      // button. The family's name rides along only for the title while it loads.
      GoRoute(
        path: '${Routes.salesPayments}/families/:familyId',
        builder: (context, state) => FamilyBillingScreen(
          familyId: state.pathParameters['familyId']!,
          familyName: state.extra is String ? state.extra! as String : null,
        ),
      ),
      GoRoute(
        path: '/children/:learnerId/materials',
        builder: (context, state) => ChildMaterialsScreen(
          learnerId: state.pathParameters['learnerId']!,
          childName: state.extra is String ? state.extra! as String : null,
          initialTab: state.uri.queryParameters['tab'] == 'progress' ? 2 : 0,
        ),
      ),
      GoRoute(
        path: '/children/:learnerId/schedule',
        builder: (context, state) => ChildScheduleScreen(
          learnerId: state.pathParameters['learnerId']!,
          childName: state.extra is String ? state.extra! as String : null,
        ),
      ),
      GoRoute(
        path: '${Routes.studentsPrefix}/:learnerId',
        builder: (context, state) => StudentProfileScreen(
          learnerId: state.pathParameters['learnerId']!,
        ),
      ),
      // Full-screen, above the tab bar: a story is the whole viewport for as long as it is
      // open, and a tab bar underneath it would be something to tap by accident.
      GoRoute(
        path: '/stories/:storyId',
        builder: (context, state) => StoryViewerScreen(
          storyId: state.pathParameters['storyId']!,
        ),
      ),
      // The two retired destinations, registered purely to forward. Declared as real routes
      // rather than left to the top-level redirect so that an old link is *matched* and
      // forwarded, instead of falling through to an error page.
      GoRoute(
        path: Routes.retiredHome,
        redirect: (context, state) => Routes.chats,
      ),
      GoRoute(
        path: Routes.retiredGroups,
        redirect: (context, state) => Routes.chats,
      ),
    ],
  );
});

/// Where an unauthenticated or undecided session may go.
///
/// A deep link's target id is *not* validated here — the backend remains the authority on
/// whether this user may see that conversation (§52). This only decides signed-in vs not,
/// and forwards the two retired destinations.
String? _redirect(Ref ref, String location) {
  final auth = ref.read(authControllerProvider);

  // Decide nothing until the stored session has been read, or the app flashes the login
  // screen on every cold start.
  if (auth is AuthUnknown) {
    return location == Routes.splash ? null : Routes.splash;
  }

  final atEntry = location == Routes.signIn || location == Routes.splash;

  // Signed out: go to sign-in unless already there. Treating the splash as an acceptable
  // destination here is what stranded the app on the loading spinner — the splash is a
  // waiting state for AuthUnknown only, never somewhere to come to rest.
  if (!auth.isAuthenticated) {
    return location == Routes.signIn ? null : Routes.signIn;
  }

  // Signing in lands on the conversations, with nothing in between. "I opened Jawwid Chat,
  // so I see my chats" is the whole mental model, and a dashboard stop on the way would
  // undo it on every single launch.
  if (atEntry) return Routes.chats;

  // Home and Groups are gone. Both were views of the same conversations, so both forward
  // to the list that now holds them; Groups arrives at Chats, where the Groups chip is one
  // tap away.
  if (location == Routes.retiredHome || location == Routes.retiredGroups) {
    return Routes.chats;
  }

  // The Schedule is a teacher's (PD-10). A parent following a stale or shared link lands
  // on their chats, where their children's lessons already arrive as cards.
  if (location == Routes.schedule && ref.read(currentRoleProvider) != UserRole.teacher) {
    return Routes.chats;
  }

  // A Student Profile is a teacher's (PD-17). A parent never reaches one: their own
  // children are in their own screens, and nothing of another family is theirs to open.
  if (location.startsWith('${Routes.studentsPrefix}/') && ref.read(currentRoleProvider) != UserRole.teacher) {
    return Routes.chats;
  }

  // Payments are a parent's (PD-17). A teacher never sees a family's money.
  if (location == Routes.myPayments && ref.read(currentRoleProvider) != UserRole.parent) {
    return Routes.chats;
  }

  // PD-20: the remaining one-role screens. A parent's own editable profile is a
  // parent's; a teacher's professional profile and leave are a teacher's. Sales -- staff,
  // whom the server refuses on every one of them -- reaches none.
  final role = ref.read(currentRoleProvider);
  if (location == Routes.myProfile && role != UserRole.parent) return Routes.chats;
  if ((location == Routes.teacherProfile || location == Routes.myLeave) && role != UserRole.teacher) {
    return Routes.chats;
  }

  // Sales' Payments (find a family, its instalments, record a payment) is Sales' alone.
  if ((location == Routes.salesPayments || location.startsWith('${Routes.salesPayments}/')) && role != UserRole.sales) {
    return Routes.chats;
  }

  return null;
}

class _RoleShell extends ConsumerWidget {
  const _RoleShell({required this.currentRoute, required this.child});

  final String currentRoute;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(currentRoleProvider);
    if (role == null) return const _SplashScreen();

    // Live chat for as long as a signed-in shell is on screen: the list and
    // open threads follow the server without a pull-to-refresh.
    ref.watch(chatRealtimeProvider);

    return AppShell(
      role: role,
      currentRoute: currentRoute,
      onDestinationSelected: (route) => context.go(route),
      child: child,
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
}

class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(this._ref) {
    _subscription = _ref.listen(
      authControllerProvider,
      (_, _) => notifyListeners(),
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
