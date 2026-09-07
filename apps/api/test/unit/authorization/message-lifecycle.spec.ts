/**
 * Phase 2 -- the decisions about acting on a message that already exists.
 *
 * These live in AuthorizationService for the same reason every other one does:
 * "who may edit" and "who may delete for everyone" must have exactly ONE
 * definition. The mobile long-press menu and the admin console both hide
 * actions the user cannot take, and a UI that hides what the server allows (or
 * offers what it refuses) is how a permission model stops being believed.
 */
import { CommErrorCode } from '@platform/errors';
import type { MessageFacts } from '@platform/authorization.service';
import { Permission } from '@platform/rbac/permissions';
import { admin, authzWithOnDuty, manager, parent, superAdmin } from '../../support/fixtures';

const authz = authzWithOnDuty(null);

const MINUTE = 60_000;
const WINDOW = 15 * MINUTE;

const published = (over: Partial<MessageFacts> = {}): MessageFacts => ({
  authorId: 'parent-1',
  type: 'text',
  moderation: 'published',
  deletedForAll: false,
  ...over,
});

// -------------------------------------------------------------------------
describe('canEditMessage', () => {
  it('allows the author inside the window', () => {
    expect(authz.canEditMessage(parent(), published(), 5 * MINUTE, WINDOW).allowed).toBe(true);
  });

  it('refuses anyone who is not the author -- including a manager and a super_admin', () => {
    for (const actor of [admin(), manager(), superAdmin()]) {
      const d = authz.canEditMessage(actor, published(), 0, WINDOW);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_MESSAGE_AUTHOR);
    }
  });

  it('refuses the author once the window has closed', () => {
    const d = authz.canEditMessage(parent(), published(), WINDOW + 1, WINDOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.EDIT_WINDOW_EXPIRED);
  });

  it('refuses a message in any state that has no lawful edit', () => {
    const cases: Array<Partial<MessageFacts>> = [
      { deletedForAll: true },
      { moderation: 'pending' },
      { moderation: 'rejected' },
      { type: 'image' },
      { type: 'voice' },
      { type: 'system' },
    ];
    for (const over of cases) {
      const d = authz.canEditMessage(parent(), published(over), 0, WINDOW);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.MESSAGE_NOT_EDITABLE);
    }
  });

  it('refuses a deactivated actor, even on their own message inside the window', () => {
    const d = authz.canEditMessage(
      { ...parent(), isActive: false },
      published(),
      0,
      WINDOW,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('refuses an author whose messages.send was revoked by a per-account DENY', () => {
    const silenced = parent();
    const permissions = new Set(silenced.permissions);
    permissions.delete(Permission.MESSAGES_SEND);

    const d = authz.canEditMessage({ ...silenced, permissions }, published(), 0, WINDOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.PERMISSION_DENIED);
  });

  it('refuses a message with no author at all -- a system message belongs to nobody', () => {
    const d = authz.canEditMessage(parent(), published({ authorId: null }), 0, WINDOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_MESSAGE_AUTHOR);
  });
});

// -------------------------------------------------------------------------
describe('canDeleteForEveryone', () => {
  it('allows the author inside the window', () => {
    expect(
      authz.canDeleteForEveryone(parent(), published(), 5 * MINUTE, WINDOW).allowed,
    ).toBe(true);
  });

  it('refuses the author once the window has closed', () => {
    const d = authz.canDeleteForEveryone(parent(), published(), WINDOW + 1, WINDOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.DELETE_WINDOW_EXPIRED);
  });

  it('allows anyone holding messages.delete, at any age, on anybody\'s message', () => {
    for (const actor of [manager(), superAdmin()]) {
      expect(actor.permissions!.has(Permission.MESSAGES_DELETE)).toBe(true);
      expect(
        authz.canDeleteForEveryone(actor, published(), 100 * WINDOW, WINDOW).allowed,
      ).toBe(true);
    }
  });

  it('refuses a non-author who does NOT hold messages.delete, however senior their title', () => {
    // An `admin` is family-facing and may read the conversation. Reading is not
    // deleting, and the key -- not the role name -- is what decides.
    expect(admin().permissions!.has(Permission.MESSAGES_DELETE)).toBe(false);
    const d = authz.canDeleteForEveryone(admin(), published(), 0, WINDOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_MESSAGE_AUTHOR);
  });

  it('honours a per-account DENY on messages.delete against a manager', () => {
    const restricted = manager();
    const permissions = new Set(restricted.permissions);
    permissions.delete(Permission.MESSAGES_DELETE);

    const d = authz.canDeleteForEveryone(
      { ...restricted, permissions },
      published(),
      0,
      WINDOW,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_MESSAGE_AUTHOR);
  });

  it('refuses a deactivated actor even when they hold the key', () => {
    const d = authz.canDeleteForEveryone(
      { ...manager(), isActive: false },
      published(),
      0,
      WINDOW,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });
});

// -------------------------------------------------------------------------
describe('canDeleteForMe', () => {
  it('allows any active actor -- hiding your own copy destroys nothing', () => {
    for (const actor of [parent(), admin(), manager()]) {
      expect(authz.canDeleteForMe(actor).allowed).toBe(true);
    }
  });

  it('refuses a deactivated actor', () => {
    const d = authz.canDeleteForMe({ ...parent(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('is a DIFFERENT decision from deleting for everyone, not a weaker spelling of it', () => {
    // The author's window has closed, so the global delete is refused -- and
    // hiding their own copy is still allowed. Conflating the two is exactly the
    // bug that makes "delete for me" delete for everybody.
    const expired = authz.canDeleteForEveryone(parent(), published(), WINDOW + 1, WINDOW);
    expect(expired.allowed).toBe(false);
    expect(authz.canDeleteForMe(parent()).allowed).toBe(true);
  });
});
