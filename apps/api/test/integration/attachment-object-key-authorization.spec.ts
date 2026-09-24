/**
 * An object key is a name, never a capability.
 *
 *   > Knowing an object key must never be sufficient to obtain a signed URL
 *   > or otherwise read an object.
 *
 * ## The vulnerability these reproduce
 *
 * The bucket is private, so a signed URL IS the capability to read an object.
 * `signUrlsForMessages` minted one for every attachment of every message the
 * caller was allowed to see — and an attachment's `objectKey` arrives from the
 * CLIENT on send and was stored verbatim. So a member of conversation B could
 * send a message in B carrying conversation A's object key, be trivially
 * authorized to read their own message, and be handed a signed URL for A's
 * object by the ordinary read path.
 *
 * `object_key` is `unique` in the schema, which blocks re-using a key that is
 * already attached somewhere. That is a collision constraint, not an access
 * control: it surfaces as a 500 rather than a refusal, and
 * `thumbnail_object_key` carries no constraint at all — so the same attack
 * went straight through the thumbnail field.
 *
 * These run against the real database because the fix is anchored in
 * server-side state: attachment -> message -> conversation. A stub would prove
 * a function was called, not that the relationship holds.
 */
import { randomUUID } from 'node:crypto';
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

/** Conversation A: the family thread. Conversation B: the student group. */
async function conversationA() {
  return g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
}
async function conversationB() {
  return g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
}

/** A real, authorized object key in [conversationId], as the server mints it. */
async function mintKeyIn(conversationId: string, actorId: string): Promise<string> {
  const auth = await g.attachments.authorizeUpload({
    conversationId,
    actorId,
    kind: 'image',
    mimeType: 'image/png',
    byteSize: 1024,
  });
  return auth.objectKey;
}

function imageAttachment(objectKey: string, thumbnailObjectKey?: string) {
  return {
    kind: 'image',
    objectKey,
    mimeType: 'image/png',
    byteSize: 1024,
    ...(thumbnailObjectKey ? { thumbnailObjectKey } : {}),
  };
}

/** Signed URLs the read path would hand back for a message. */
async function signedFor(messageId: string) {
  return g.attachments.signUrlsForMessages([messageId]);
}

// -------------------------------------------------------------------------
describe('TEST 1 — a known object key from another conversation is refused on send', () => {
  it('refuses the attachment outright', async () => {
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);

    await expect(
      g.messages.send({
        conversationId: b.id,
        senderId: s.parentId,
        type: 'image',
        body: 'borrowed',
        attachments: [imageAttachment(keyFromA)],
      }),
    ).rejects.toMatchObject({
      code: CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION,
    });
  });

  it('is a 403 policy refusal, not a 500 from a unique constraint', async () => {
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);

    try {
      await g.messages.send({
        conversationId: b.id,
        senderId: s.parentId,
        type: 'image',
        attachments: [imageAttachment(keyFromA)],
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CommError);
      expect((error as CommError).status).toBe(403);
    }
  });

  it('persists nothing — the foreign key never reaches the database', async () => {
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);

    await g.messages
      .send({
        conversationId: b.id,
        senderId: s.parentId,
        type: 'image',
        attachments: [imageAttachment(keyFromA)],
      })
      .catch(() => undefined);

    const rows = await g.prisma.messageAttachment.findMany({
      where: { objectKey: keyFromA },
    });
    expect(rows).toEqual([]);
  });

  it('refuses it in the THUMBNAIL field too — the unconstrained half', async () => {
    // thumbnail_object_key has no unique constraint, so this was the clean
    // bypass even where object_key collided.
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);
    const ownKey = await mintKeyIn(b.id, s.parentId);

    await expect(
      g.messages.send({
        conversationId: b.id,
        senderId: s.parentId,
        type: 'image',
        attachments: [imageAttachment(ownKey, keyFromA)],
      }),
    ).rejects.toMatchObject({
      code: CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION,
    });
  });
});

// -------------------------------------------------------------------------
describe('TEST 2 / TEST 3 — the signing boundary refuses independently', () => {
  /**
   * The write-path check is defence in depth. This proves the signing boundary
   * refuses on its own, by planting the row directly — which is what a bypass
   * of the write path, or a row written before this fix existed, looks like.
   */
  async function plantForeignAttachment(intoConversationId: string, foreignKey: string) {
    const message = await g.messages.send({
      conversationId: intoConversationId,
      senderId: s.parentId,
      body: 'carrier',
    });
    await g.prisma.$executeRawUnsafe(
      `update chat.message_attachment set object_key = '${foreignKey}'
       where message_id = '${message.id}'::uuid`,
    );
    // The carrier has no attachment yet; insert one directly.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.message_attachment
         (id, message_id, kind, object_key, mime_type, byte_size)
       values ('${randomUUID()}'::uuid, '${message.id}'::uuid, 'image',
               '${foreignKey}', 'image/png', 1024)`,
    );
    return message.id;
  }

  it('does not sign a foreign object key even when the row exists', async () => {
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);

    const carrier = await plantForeignAttachment(b.id, keyFromA);

    const signed = await signedFor(carrier);

    // Nothing signed for that attachment at all.
    expect(signed.size).toBe(0);
  });

  it('does not sign a foreign THUMBNAIL even when the row exists', async () => {
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);
    const ownKey = await mintKeyIn(b.id, s.parentId);

    const message = await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(ownKey)],
    });
    await g.prisma.$executeRawUnsafe(
      `update chat.message_attachment set thumbnail_object_key = '${keyFromA}'
       where message_id = '${message.id}'::uuid`,
    );

    const signed = await signedFor(message.id);
    const entry = [...signed.values()][0];

    // The legitimate object is still readable; the foreign thumbnail is not.
    expect(entry.url).toBeTruthy();
    expect(entry.thumbnailUrl).toBeNull();
  });

  it('one refused row does not make the conversation unreadable', async () => {
    // The read path must degrade, not fail: a bad row is somebody else's
    // problem, not a reason the whole thread stops loading.
    const a = await conversationA();
    const b = await conversationB();
    const keyFromA = await mintKeyIn(a.id, s.parentId);
    const goodKey = await mintKeyIn(b.id, s.parentId);

    const good = await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(goodKey)],
    });
    const carrier = await plantForeignAttachment(b.id, keyFromA);

    const signed = await g.attachments.signUrlsForMessages([good.id, carrier]);

    // Exactly one entry: the legitimate attachment.
    expect(signed.size).toBe(1);
    expect([...signed.values()][0].url).toBeTruthy();
  });
});

// -------------------------------------------------------------------------
describe('TEST 4 / TEST 6 — legitimate access still works, including re-issue', () => {
  it('an authorized member gets a signed URL for their conversation object', async () => {
    const b = await conversationB();
    const ownKey = await mintKeyIn(b.id, s.parentId);

    const message = await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(ownKey)],
    });

    const signed = await signedFor(message.id);
    expect(signed.size).toBe(1);
    expect([...signed.values()][0].url).toContain('expires=');
  });

  it('a legitimate thumbnail in the same conversation is signed', async () => {
    const b = await conversationB();
    const ownKey = await mintKeyIn(b.id, s.parentId);
    const ownThumb = await mintKeyIn(b.id, s.parentId);

    const message = await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(ownKey, ownThumb)],
    });

    const entry = [...(await signedFor(message.id)).values()][0];
    expect(entry.url).toBeTruthy();
    expect(entry.thumbnailUrl).toBeTruthy();
  });

  it('re-issuing after expiry is authorization-protected, not a free refresh', async () => {
    // Re-signing is not a cached decision. The relationship is re-read from
    // the database on every call, so a row that stops qualifying stops being
    // signed -- which is what makes an expired URL a real expiry rather than a
    // formality anyone can refresh.
    //
    // The message's own conversation cannot be moved to demonstrate this:
    // `chat.message` carries an immutability trigger on its identity columns
    // (`chat.message identity columns are immutable`), so the binding this fix
    // rests on cannot be rewritten even by direct SQL. The attachment row is
    // the mutable half, so that is what changes here.
    const a = await conversationA();
    const b = await conversationB();
    const ownKey = await mintKeyIn(b.id, s.parentId);

    const message = await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(ownKey)],
    });

    // First issue, and a second: both succeed while the row still qualifies.
    expect([...(await signedFor(message.id)).values()][0].url).toBeTruthy();
    expect([...(await signedFor(message.id)).values()][0].url).toBeTruthy();

    // The row now points outside the conversation.
    const keyFromA = await mintKeyIn(a.id, s.parentId);
    await g.prisma.$executeRawUnsafe(
      `update chat.message_attachment set object_key = '${keyFromA}'
       where message_id = '${message.id}'::uuid`,
    );

    // The next re-issue refuses. Nothing was remembered from the two that
    // succeeded.
    expect((await signedFor(message.id)).size).toBe(0);
  });
});

// -------------------------------------------------------------------------
describe('TEST 5 — a non-member never reaches the signing path', () => {
  it('cannot read the conversation, so cannot obtain its URLs', async () => {
    const b = await conversationB();
    const ownKey = await mintKeyIn(b.id, s.parentId);
    await g.messages.send({
      conversationId: b.id,
      senderId: s.parentId,
      type: 'image',
      attachments: [imageAttachment(ownKey)],
    });

    // A contact of another family entirely.
    const outsiderFamily = randomUUID();
    const outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${outsiderFamily}'::uuid, 'family_z', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${outsider}'::uuid, '${outsiderFamily}'::uuid, 'parent_out',
               'primary_guardian', true, true)`,
    );

    await expect(
      g.messages.list({ conversationId: b.id, actorId: outsider }),
    ).rejects.toBeInstanceOf(CommError);
  });

  it('cannot mint an upload authorization there either', async () => {
    const b = await conversationB();
    const outsiderFamily = randomUUID();
    const outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${outsiderFamily}'::uuid, 'family_z', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${outsider}'::uuid, '${outsiderFamily}'::uuid, 'parent_out',
               'primary_guardian', true, true)`,
    );

    await expect(
      g.attachments.authorizeUpload({
        conversationId: b.id,
        actorId: outsider,
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 1024,
      }),
    ).rejects.toBeInstanceOf(CommError);
  });
});

// -------------------------------------------------------------------------
describe('TEST 7 — object key manipulation', () => {
  it('refuses every shape that tries to leave the namespace', async () => {
    const b = await conversationB();
    const a = await conversationA();

    const hostile = [
      `conversations/${a.id}/${randomUUID()}`, // another conversation
      `conversations/${b.id}/../${a.id}/${randomUUID()}`, // traversal
      `conversations/${b.id}/sub/${randomUUID()}`, // extra segment
      `conversations/${b.id}`, // the prefix itself
      `conversations/${b.id}x/${randomUUID()}`, // prefix confusion
      `conversations/${b.id}/`, // trailing separator
      `/conversations/${b.id}/${randomUUID()}`, // absolute
      `conversations\\${b.id}\\${randomUUID()}`, // backslashes
      `conversations/${b.id}//${randomUUID()}`, // empty segment
      `conversations/${b.id}/${randomUUID()}\u0000.png`, // NUL
      `conversations/${b.id}/${randomUUID()}`, // control char
      `CONVERSATIONS/${b.id}/${randomUUID()}`, // case
      `${randomUUID()}`, // no namespace
    ];

    for (const objectKey of hostile) {
      await expect(
        g.messages.send({
          conversationId: b.id,
          senderId: s.parentId,
          type: 'image',
          attachments: [imageAttachment(objectKey)],
        }),
      ).rejects.toMatchObject(
        { code: CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION },
      );
    }
  });

  it('refuses encoded traversal as the literal segment it is', async () => {
    // %2e%2e is not decoded here; it is simply not this conversation's
    // namespace. Either way the answer is no.
    const b = await conversationB();
    await expect(
      g.messages.send({
        conversationId: b.id,
        senderId: s.parentId,
        type: 'image',
        attachments: [imageAttachment(`conversations/%2e%2e/${randomUUID()}`)],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION });
  });
});
