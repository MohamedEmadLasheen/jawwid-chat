/**
 * PD-21 -- what a support session (an administrator acting as a parent or
 * teacher) may WRITE. Deny by default: these pin the allowlist so that a route
 * added later is refused in a support session until someone decides otherwise,
 * and so that nothing which acts in the person's name where others see it
 * (receipts, calls, reactions, edits, devices, logout) ever slips in.
 *
 * Pure: no database.
 */
import { SUPPORT_SESSION_WRITES, supportSessionMayCall } from '@platform/auth/support-session.interceptor';

describe('PD-21: the support-session allowlist', () => {
  it('every read is allowed', () => {
    for (const route of ['/conversations', '/conversations/:conversationId/messages', '/me', '/me/profile', '/calls/history']) {
      expect(supportSessionMayCall('GET', route)).toBe(true);
    }
  });

  it('sending a message, the person\'s own profile and private state are allowed -- with or without the global prefix', () => {
    expect(supportSessionMayCall('POST', '/conversations/:conversationId/messages')).toBe(true);
    expect(supportSessionMayCall('POST', '/api/v1/conversations/:conversationId/messages')).toBe(true);
    expect(supportSessionMayCall('PATCH', '/me/profile')).toBe(true);
    expect(supportSessionMayCall('post', '/conversations/:conversationId/messages/:messageId/star')).toBe(true);
  });

  it('nothing that acts in the person\'s name where others see it', () => {
    for (const [method, route] of [
      ['POST', '/conversations/:conversationId/messages/read'],
      ['POST', '/conversations/:conversationId/messages/:messageId/delivered'],
      ['POST', '/conversations/:conversationId/messages/:messageId/reactions'],
      ['DELETE', '/conversations/:conversationId/messages/:messageId/reactions'],
      ['POST', '/conversations/:conversationId/messages/:messageId/pin'],
      ['PATCH', '/conversations/:conversationId/messages/:messageId'],
      ['DELETE', '/conversations/:conversationId/messages/:messageId'],
      ['POST', '/conversations/:conversationId/messages/forward'],
      ['POST', '/calls'],
      ['POST', '/calls/:id/accept'],
      ['POST', '/scheduled-calls/:id/join'],
      ['POST', '/notifications/devices'],
      ['POST', '/notifications/:id/opened'],
      ['POST', '/stories/:id/view'],
      ['POST', '/lessons/:id/apology'],
      ['POST', '/lessons/:id/report'],
      ['POST', '/conversations/direct'],
      ['POST', '/conversations/:id/members'],
      ['POST', '/auth/logout'],
      ['POST', '/admin/impersonations'],
      ['POST', '/admin/accounts/:accountId/suspend'],
    ] as const) {
      expect({ method, route, allowed: supportSessionMayCall(method, route) }).toEqual({ method, route, allowed: false });
    }
  });

  it('a route not on the list is refused, whatever it is', () => {
    expect(supportSessionMayCall('POST', '/some/route/added/later')).toBe(false);
    expect(supportSessionMayCall('PUT', '/me/profile')).toBe(false);
  });

  it('the list is short and reviewed: a change here is a product decision', () => {
    expect(SUPPORT_SESSION_WRITES).toHaveLength(23);
  });
});
