import {
  NOTIFICATION_REGISTRY,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  OPTIONAL_CATEGORIES,
  PRIORITY_RANK,
  announcementNotificationType,
  definitionOf,
  messageNotificationType,
  ruleEventNotificationType,
  templateKeyFor,
} from '@communication/contracts/notifications';

/**
 * The registry is the one place a notification type is defined, so these are
 * the tests that stop a future type shipping without a category, a deep link,
 * or a decision about whether it may put a child's name on a lock screen.
 */
describe('notification type registry', () => {
  const all = Object.values(NOTIFICATION_REGISTRY);

  it('every type is complete', () => {
    for (const def of all) {
      expect(Object.values(NotificationCategory)).toContain(def.category);
      expect(Object.values(NotificationPriority)).toContain(def.priority);
      expect(typeof def.essential).toBe('boolean');
      expect(typeof def.pushCarriesContent).toBe('boolean');
      expect(def.templateKey).toBeTruthy();
      expect(typeof def.deepLink).toBe('function');
    }
  });

  it('its key and its type agree', () => {
    for (const [key, def] of Object.entries(NOTIFICATION_REGISTRY)) {
      expect(def.type).toBe(key);
    }
  });

  it('refuses a type it does not know rather than inventing one', () => {
    expect(() => definitionOf('NOT_A_TYPE' as NotificationType)).toThrow(/unknown notification type/);
  });

  // -- the product rules, as assertions ------------------------------------

  it('no message notification puts its content on a lock screen', () => {
    // A message preview is the most private thing this system carries, and a
    // push travels through Google's and Apple's infrastructure to a screen that
    // can be read without unlocking the phone.
    const messaging = all.filter((d) => d.category === NotificationCategory.MESSAGING);
    expect(messaging.length).toBeGreaterThan(0);
    for (const def of messaging) expect(def.pushCarriesContent).toBe(false);
  });

  it('an approval notification never carries content either', () => {
    expect(definitionOf(NotificationType.APPROVAL_REQUESTED).pushCarriesContent).toBe(false);
    expect(definitionOf(NotificationType.APPROVAL_DECIDED).pushCarriesContent).toBe(false);
  });

  it('the notifications a parent cannot afford to miss are essential', () => {
    for (const type of [
      NotificationType.CLASS_SCHEDULE_CHANGED,
      NotificationType.CLASS_CANCELLED,
      NotificationType.INCOMING_CALL,
      NotificationType.URGENT_ANNOUNCEMENT,
    ]) {
      expect(definitionOf(type).essential).toBe(true);
    }
  });

  it('a missed call is NOT essential, because the Calls switch must mean something', () => {
    // Essential means "ignore the parent's preference". The Calls category
    // exists so a parent can decline being buzzed about missed calls; if this
    // were essential that switch would silently do nothing. Nothing is lost:
    // in-app is never disableable, so the missed call still reaches the centre
    // and the badge either way.
    expect(definitionOf(NotificationType.MISSED_CALL).essential).toBe(false);
    expect(definitionOf(NotificationType.MISSED_CALL).groupable).toBe(false);
    expect(definitionOf(NotificationType.MISSED_CALL).priority).toBe(NotificationPriority.HIGH);
  });

  it('an incoming call IS essential, because a call that cannot ring is not a call', () => {
    expect(definitionOf(NotificationType.INCOMING_CALL).essential).toBe(true);
    expect(definitionOf(NotificationType.INCOMING_CALL).bypassQuietHours).toBe(true);
  });

  it('every optional category has at least one type a parent can actually mute', () => {
    // The inverse of the rule above, and the one that catches a lying switch:
    // a category offered in settings whose every type is essential is a toggle
    // that does nothing.
    for (const category of OPTIONAL_CATEGORIES) {
      const types = all.filter((d) => d.category === category);
      if (types.length === 0) continue;
      expect(types.some((d) => !d.essential)).toBe(true);
    }
  });

  it('a reminder is NOT essential, so a parent may mute it', () => {
    // The point of the essential/optional split: "remind me before class" and
    // "the class is cancelled" live in one category and must behave differently.
    expect(definitionOf(NotificationType.CLASS_REMINDER).essential).toBe(false);
    expect(definitionOf(NotificationType.CLASS_REMINDER).category).toBe(
      definitionOf(NotificationType.CLASS_CANCELLED).category,
    );
  });

  it('nothing that would hide information is groupable', () => {
    // Collapsing "3 missed calls" or two schedule changes into one line destroys
    // exactly the detail that makes them matter.
    for (const type of [
      NotificationType.MISSED_CALL,
      NotificationType.CLASS_SCHEDULE_CHANGED,
      NotificationType.CLASS_CANCELLED,
      NotificationType.URGENT_ANNOUNCEMENT,
      NotificationType.INCOMING_CALL,
    ]) {
      expect(definitionOf(type).groupable).toBe(false);
    }
  });

  it('nothing urgent is groupable', () => {
    for (const def of all) {
      if (def.priority === NotificationPriority.URGENT) expect(def.groupable).toBe(false);
    }
  });

  it('only messaging groups at all', () => {
    for (const def of all) {
      if (def.groupable) expect(def.category).toBe(NotificationCategory.MESSAGING);
    }
  });

  it('only essential types bypass quiet hours', () => {
    // Waking a family at 2am is reserved for something that cannot wait until
    // morning. If a non-essential type could do it, quiet hours would be
    // decorative.
    for (const def of all) {
      if (def.bypassQuietHours) expect(def.essential).toBe(true);
    }
  });

  it('a category that carries only essential types is not offered as optional', () => {
    for (const category of Object.values(NotificationCategory)) {
      const types = all.filter((d) => d.category === category);
      if (types.length === 0) continue;
      const allEssential = types.every((d) => d.essential);
      if (allEssential) expect(OPTIONAL_CATEGORIES.has(category)).toBe(false);
    }
  });

  // -- deep links ----------------------------------------------------------

  it('every type produces a deep link', () => {
    const ctx = {
      conversationId: 'c1',
      messageId: 'm1',
      callId: 'k1',
      learnerId: 'l1',
      announcementId: 'a1',
    };
    for (const def of all) {
      const link = def.deepLink(ctx);
      expect(link.startsWith('/')).toBe(true);
      expect(link).not.toContain('undefined');
      expect(link).not.toContain('null');
    }
  });

  it('degrades to a usable route when the ids are gone', () => {
    // A notification about a deleted conversation must land somewhere sensible
    // rather than on /chats/undefined.
    for (const def of all) {
      const link = def.deepLink({});
      expect(link.startsWith('/')).toBe(true);
      expect(link).not.toContain('undefined');
      expect(link).not.toContain('null');
    }
  });

  it('links a message to its own position in the thread', () => {
    expect(
      definitionOf(NotificationType.VOICE_MESSAGE_RECEIVED).deepLink({
        conversationId: 'c1',
        messageId: 'm7',
      }),
    ).toBe('/chats/c1?message=m7');
  });

  it('links a missed call to the call, not just the thread', () => {
    expect(
      definitionOf(NotificationType.MISSED_CALL).deepLink({ conversationId: 'c1', callId: 'k9' }),
    ).toBe('/chats/c1?call=k9');
  });

  it('links a schedule change to the child whose class moved', () => {
    expect(
      definitionOf(NotificationType.CLASS_SCHEDULE_CHANGED).deepLink({ learnerId: 'l3' }),
    ).toBe('/learners/l3/classes');
  });

  // -- grouping keys -------------------------------------------------------

  it('groups a burst per sender per thread, not per thread', () => {
    const def = definitionOf(NotificationType.MESSAGE_RECEIVED);
    const a = def.groupKey!({ conversationId: 'c1', senderId: 's1' });
    const b = def.groupKey!({ conversationId: 'c1', senderId: 's2' });
    const c = def.groupKey!({ conversationId: 'c2', senderId: 's1' });

    expect(a).toBe(def.groupKey!({ conversationId: 'c1', senderId: 's1' }));
    // Two teachers writing in one group are two notifications, not "3 new
    // messages" from nobody in particular.
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  // -- template selection --------------------------------------------------

  it('uses the child-aware template only when there is a child', () => {
    const def = definitionOf(NotificationType.MESSAGE_RECEIVED);
    expect(templateKeyFor(def, true)).toBe('message_received_child');
    expect(templateKeyFor(def, false)).toBe('message_received');
  });

  it('falls back to the plain template when a type has no child variant', () => {
    const def = definitionOf(NotificationType.ACADEMY_ANNOUNCEMENT);
    expect(def.childTemplateKey).toBeUndefined();
    expect(templateKeyFor(def, true)).toBe(def.templateKey);
  });

  // -- mappings ------------------------------------------------------------

  it('maps a message type onto the right notification', () => {
    expect(messageNotificationType('text')).toBe(NotificationType.MESSAGE_RECEIVED);
    expect(messageNotificationType('voice')).toBe(NotificationType.VOICE_MESSAGE_RECEIVED);
    expect(messageNotificationType('image')).toBe(NotificationType.MEDIA_MESSAGE_RECEIVED);
    expect(messageNotificationType('video')).toBe(NotificationType.MEDIA_MESSAGE_RECEIVED);
    expect(messageNotificationType('file')).toBe(NotificationType.MEDIA_MESSAGE_RECEIVED);
  });

  it('notifies nobody about a system message', () => {
    // "Sara joined the group" is the conversation narrating itself.
    expect(messageNotificationType('system')).toBeNull();
  });

  it('escalates an announcement by its priority', () => {
    expect(announcementNotificationType('normal')).toBe(NotificationType.ACADEMY_ANNOUNCEMENT);
    expect(announcementNotificationType('important')).toBe(NotificationType.IMPORTANT_ANNOUNCEMENT);
    expect(announcementNotificationType('urgent')).toBe(NotificationType.URGENT_ANNOUNCEMENT);
  });

  it('treats an unknown announcement priority as normal, never as urgent', () => {
    expect(announcementNotificationType('SHOUT')).toBe(NotificationType.ACADEMY_ANNOUNCEMENT);
  });

  it('gives a rule event its notification type, or nothing', () => {
    expect(ruleEventNotificationType('class_scheduled')).toBe(NotificationType.CLASS_REMINDER);
    expect(ruleEventNotificationType('call_missed')).toBe(NotificationType.MISSED_CALL);
    // An operator who enables a rule for an event nobody produces gets nothing,
    // rather than a notification with invented semantics.
    expect(ruleEventNotificationType('student_graduated')).toBeNull();
  });

  it('ranks priorities in the order the product states them', () => {
    expect(PRIORITY_RANK.low).toBeLessThan(PRIORITY_RANK.normal);
    expect(PRIORITY_RANK.normal).toBeLessThan(PRIORITY_RANK.high);
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.urgent);
  });

  it('keeps urgent rare', () => {
    // Not a style rule: an urgent notification bypasses quiet hours and mutes,
    // so if a quarter of the registry were urgent the escalation would be
    // meaningless. This fails loudly if someone adds a third one casually.
    const urgent = all.filter((d) => d.priority === NotificationPriority.URGENT);
    expect(urgent.map((d) => d.type).sort()).toEqual(
      [NotificationType.INCOMING_CALL, NotificationType.URGENT_ANNOUNCEMENT].sort(),
    );
  });
});
