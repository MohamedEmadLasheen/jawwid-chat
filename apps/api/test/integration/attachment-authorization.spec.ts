/**
 * Upload authorization must be SEND authority, not READ authority.
 *
 * `PUT /storage/:objectKey` only became a working route with voice messages.
 * Before that, an upload authorization was a signed URL pointing at nothing, so
 * gating it on `canRead` cost nothing. Now it grants a real storage write, and
 * an actor who may open a thread but may not post in it must not be able to
 * spend storage on a message that can never exist.
 *
 * These run against the real database because `canSend` resolves ownership,
 * coverage, membership and live presence from it -- the same facts the send
 * path uses. A stub would prove the call was made, not that the decision is the
 * same one.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

const voice = { kind: 'voice', mimeType: 'audio/mp4', byteSize: 20480 };

async function authorizeAs(conversationId: string, actorId: string, over: object = {}) {
  return g.attachments.authorizeUpload({ conversationId, actorId, ...voice, ...over });
}

/** The code a rejected authorization reported, or null if it was granted. */
async function refusalCode(conversationId: string, actorId: string, over: object = {}) {
  try {
    await authorizeAs(conversationId, actorId, over);
    return null;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
}

describe('a member who may send is authorized', () => {
  it('grants an upload to the parent in their own thread', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const grant = await authorizeAs(conv.id, s.parentId);

    expect(grant.objectKey).toContain(`conversations/${conv.id}/`);
    expect(grant.method).toBe('PUT');
    expect(grant.headers['content-type']).toBe('audio/mp4');
    expect(new Date(grant.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('grants an upload to the on-duty admin', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await expect(authorizeAs(conv.id, s.ownerId)).resolves.toBeDefined();
  });
});

describe('a member who may read but may not send is refused', () => {
  it('refuses a contact whose can_message capability is off', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.contact set can_message = false where id = '${s.parentId}'::uuid`,
    );

    // They can still open the thread...
    await expect(g.messages.list({ conversationId: conv.id, actorId: s.parentId })).resolves
      .toBeDefined();
    // ...but they cannot mint somewhere to write.
    expect(await refusalCode(conv.id, s.parentId)).toBe(CommErrorCode.CONTACT_CANNOT_MESSAGE);
  });

  it('refuses a silenced member', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation_member set is_silent = true
       where conversation_id = '${conv.id}'::uuid and actor_id = '${s.parentId}'::uuid`,
    );

    expect(await refusalCode(conv.id, s.parentId)).toBe(CommErrorCode.MEMBER_IS_SILENT);
  });

  it('refuses everyone once the conversation is archived', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set archived_at = now() where id = '${conv.id}'::uuid`,
    );

    expect(await refusalCode(conv.id, s.parentId)).toBe(CommErrorCode.CONVERSATION_ARCHIVED);
    expect(await refusalCode(conv.id, s.ownerId)).toBe(CommErrorCode.CONVERSATION_ARCHIVED);
  });

  it('refuses an actor who is not a member at all', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    expect(await refusalCode(conv.id, s.otherParentId)).toBe(
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('refuses a department manager who may READ a supervisor\'s teacher channel but is not a party to it', async () => {
    // PD-8: manager_c runs Operations, so they read admin_a's Teacher<->Admin
    // 1:1 -- which is what makes this the read-but-not-send case -- but it is
    // a channel between two other people, answerable only by its members.
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const manager = await g.conversations.requireActor(s.managerId);
    expect(await g.conversations.staffInScope(manager, conv)).toBe(true);

    expect(await refusalCode(conv.id, s.managerId)).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('refuses an admin outside the family\'s charge before anything else', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    g.coverage.onDutyId = null;

    // Not the owner, not on duty, not a member, not sticky: this admin may not
    // even read the conversation (staff scope, 2026-10-14), so no lane opens.
    expect(await refusalCode(conv.id, s.otherAdminId)).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(await refusalCode(conv.id, s.otherAdminId, { visibility: 'internal' })).toBe(
      CommErrorCode.STAFF_OUT_OF_SCOPE,
    );
  });

  it('refuses a deactivated actor', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
    );

    expect(await refusalCode(conv.id, s.parentId)).toBe(CommErrorCode.ACTOR_INACTIVE);
  });
});

describe('visibility is judged as the send path judges it', () => {
  it('lets an off-duty admin upload for an internal note', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    g.coverage.onDutyId = null;

    // Any family-facing admin who may READ the conversation may write an
    // internal note at any time, on duty or not, so the attachment for one must
    // be authorizable too. Since staff scope that reader is the family owner.
    await expect(
      authorizeAs(conv.id, s.ownerId, { visibility: 'internal' }),
    ).resolves.toBeDefined();
  });

  it('does not let a contact reach internal visibility', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    // Asking for the staff-only lane must not be a way around the customer gate.
    expect(await refusalCode(conv.id, s.parentId, { visibility: 'internal' })).toBe(
      CommErrorCode.CONTACT_CANNOT_WRITE_INTERNAL,
    );
  });
});

describe('the limits still apply to an authorized sender', () => {
  it('refuses an over-sized voice note before any upload happens', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    expect(await refusalCode(conv.id, s.parentId, { byteSize: 64 * 1024 * 1024 })).toBe(
      CommErrorCode.ATTACHMENT_TOO_LARGE,
    );
  });

  it('refuses a disallowed MIME type for a voice attachment', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    expect(await refusalCode(conv.id, s.parentId, { mimeType: 'text/html' })).toBe(
      CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
    );
  });
});
