/**
 * WHICH DEVICE MAY RECEIVE WHAT, and what a call push carries.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, above every other assertion here: a VoIP
 * token must never receive a non-call payload. On iOS a PushKit delivery that
 * does not immediately report a call to CallKit terminates the app, and repeat
 * offences revoke the entitlement — so "a new message reached a VoIP token" is
 * not a wasted notification, it is a crash loop and an App Review rejection.
 *
 * Before W8-W1 `NotificationService.deliver` sent every notification to every
 * active token of the recipient, so exactly that happened.
 *
 * No database, no provider, no device: this is the rule itself.
 */
import {
  buildPushData,
  callIdFromDedupeKey,
  isCallNotification,
  mayDeliverTo,
} from '@communication/notifications/call-push-routing';

const CALL_ID = '11111111-2222-4333-8444-555555555555';

const voip = { platform: 'ios', isVoip: true };
const iosAlert = { platform: 'ios', isVoip: false };
const android = { platform: 'android', isVoip: false };
const web = { platform: 'web', isVoip: false };

describe('what counts as a call', () => {
  it('the two ringing events, and only those', () => {
    expect(isCallNotification('call_started')).toBe(true);
    expect(isCallNotification('group_call_started')).toBe(true);
  });

  it('a MISSED call is not a call', () => {
    // There is nothing to report to CallKit for a call that already ended, so a
    // PushKit delivery for it would be the violation this module prevents.
    expect(isCallNotification('call_missed')).toBe(false);
  });

  it('nor is anything else', () => {
    for (const other of [
      'message_published',
      'approval_decision',
      'class_reminder',
      'payment_reminder',
      '',
    ]) {
      expect(isCallNotification(other)).toBe(false);
    }
  });
});

describe('the routing rule', () => {
  it('a VoIP token receives calls', () => {
    expect(mayDeliverTo(true, voip)).toBe(true);
  });

  it('A VoIP TOKEN NEVER RECEIVES A NON-CALL — the guarantee', () => {
    expect(mayDeliverTo(false, voip)).toBe(false);
  });

  it('an iOS standard token receives non-calls only', () => {
    // The call goes to PushKit; sending it here as well would ring twice.
    expect(mayDeliverTo(false, iosAlert)).toBe(true);
    expect(mayDeliverTo(true, iosAlert)).toBe(false);
  });

  it('Android receives both, because FCM has no VoIP channel', () => {
    // The naive rule `isVoip === isCall` would silently stop every Android
    // phone from ever being told about a call: no FCM token is ever VoIP.
    expect(mayDeliverTo(true, android)).toBe(true);
    expect(mayDeliverTo(false, android)).toBe(true);
  });

  it('web is treated like Android', () => {
    expect(mayDeliverTo(true, web)).toBe(true);
    expect(mayDeliverTo(false, web)).toBe(true);
  });

  it('every device kind has a defined answer for both cases', () => {
    for (const token of [voip, iosAlert, android, web]) {
      for (const isCall of [true, false]) {
        expect(typeof mayDeliverTo(isCall, token)).toBe('boolean');
      }
    }
  });
});

describe('the call id, read from the dedupe key', () => {
  it('reads the id a call producer put there', () => {
    expect(callIdFromDedupeKey(`incoming_call:${CALL_ID}:actor-1`)).toBe(CALL_ID);
    expect(callIdFromDedupeKey(`group_call_started:${CALL_ID}:actor-1`)).toBe(CALL_ID);
    expect(callIdFromDedupeKey(`missed_call:${CALL_ID}:actor-1`)).toBe(CALL_ID);
  });

  it('refuses anything that is not a uuid in that position', () => {
    expect(callIdFromDedupeKey('new_message:msg_17:actor-1')).toBeNull();
    expect(callIdFromDedupeKey('incoming_call::actor-1')).toBeNull();
    expect(callIdFromDedupeKey('incoming_call:not-a-uuid:actor-1')).toBeNull();
  });

  it('refuses a key with the wrong number of segments', () => {
    expect(callIdFromDedupeKey(CALL_ID)).toBeNull();
    expect(callIdFromDedupeKey(`a:${CALL_ID}`)).toBeNull();
    expect(callIdFromDedupeKey(`a:${CALL_ID}:b:c`)).toBeNull();
    expect(callIdFromDedupeKey('')).toBeNull();
  });
});

describe('the payload', () => {
  it('a call carries callId', () => {
    const data = buildPushData({
      eventType: 'call_started',
      notificationId: 'n_1',
      conversationId: 'c_1',
      dedupeKey: `incoming_call:${CALL_ID}:actor-1`,
    });

    expect(data).toEqual({
      eventType: 'call_started',
      notificationId: 'n_1',
      conversationId: 'c_1',
      callId: CALL_ID,
    });
  });

  it('a group call carries it too', () => {
    const data = buildPushData({
      eventType: 'group_call_started',
      notificationId: 'n_1',
      conversationId: 'c_1',
      dedupeKey: `group_call_started:${CALL_ID}:actor-1`,
    });

    expect(data.callId).toBe(CALL_ID);
  });

  it('a NON-call never carries a callId, whatever its dedupe key looks like',
    () => {
      const data = buildPushData({
        eventType: 'message_published',
        notificationId: 'n_1',
        conversationId: 'c_1',
        // Deliberately call-shaped: the event type decides, not the key.
        dedupeKey: `new_message:${CALL_ID}:actor-1`,
      });

      expect(data).not.toHaveProperty('callId');
    });

  it('a missed call carries no callId either', () => {
    const data = buildPushData({
      eventType: 'call_missed',
      notificationId: 'n_1',
      conversationId: 'c_1',
      dedupeKey: `missed_call:${CALL_ID}:actor-1`,
    });

    expect(data).not.toHaveProperty('callId');
  });

  it('a call whose id cannot be read still produces a usable payload', () => {
    // Better an absent id than an invented one: the push still wakes the app.
    const data = buildPushData({
      eventType: 'call_started',
      notificationId: 'n_1',
      conversationId: 'c_1',
      dedupeKey: 'incoming_call:garbage:actor-1',
    });

    expect(data).not.toHaveProperty('callId');
    expect(data.eventType).toBe('call_started');
  });

  it('an absent conversationId is omitted, not sent as empty', () => {
    const data = buildPushData({
      eventType: 'call_started',
      notificationId: 'n_1',
      conversationId: null,
      dedupeKey: `incoming_call:${CALL_ID}:actor-1`,
    });

    expect(data).not.toHaveProperty('conversationId');
  });

  it('the payload can carry nothing else — four keys is the maximum', () => {
    const data = buildPushData({
      eventType: 'call_started',
      notificationId: 'n_1',
      conversationId: 'c_1',
      dedupeKey: `incoming_call:${CALL_ID}:actor-1`,
    });

    // It is BUILT, never copied from a row, so there is no field a future
    // column could arrive through.
    expect(Object.keys(data).sort()).toEqual([
      'callId',
      'conversationId',
      'eventType',
      'notificationId',
    ]);
    const carried = JSON.stringify(data);
    expect(carried).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWT
    expect(carried).not.toMatch(/jawwid-/); // no room name
    expect(carried).not.toMatch(/roomName|livekit|accessToken|apiSecret/i);
    expect(carried).not.toMatch(/@|\+\d{6,}/); // no contact channel
  });
});
