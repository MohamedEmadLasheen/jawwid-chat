/**
 * Stories — the whole lifecycle, and every property that makes it safe.
 *
 * Structured as the user journey, because that is what "implemented" means:
 *
 *   create -> upload media -> publish -> appears in the right feeds only ->
 *   opened -> view recorded -> owner sees viewers -> deleted / expired ->
 *   inaccessible -> media purged
 *
 * The negative cases are the point of the file. A publisher who is not a
 * publisher, a reader who is not in the audience, a story past its expiry, a
 * forged audience id, a view recorded on somebody else's behalf: each of those is
 * a way the feature could leak, and each has a test that fails if it starts
 * working.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, type Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { StoryAudienceKind, StoryState } from '@communication/contracts/vocab';
import { CommEvent } from '@communication/contracts/events';

const g = buildGraph();
const { prisma, stories, storySweeper } = g;

let s: Scenario;
/** finance staff: real staff, but not family-facing, so never a publisher. */
let financeId: string;
/** A second family, owned by otherAdmin, for the scoping cases. */
let otherFamilyId: string;
let otherFamilyParentId: string;
/** A contact that exists but may not communicate. */
let silentContactId: string;

async function publishedStory(
  authorId: string,
  audiences: Array<{ kind: string; refId?: string | null }>,
  body = 'hello families',
): Promise<string> {
  const draft = await stories.create(authorId, { body, audiences });
  await stories.publish(draft.id, authorId);
  return draft.id;
}

/** Wind a published story's expiry into the past, the way real time would. */
async function expireInPlace(storyId: string, minutesAgo = 5): Promise<void> {
  await prisma.story.update({
    where: { id: storyId },
    data: { expiresAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
}

beforeAll(async () => {
  await truncate(prisma);
  s = await seed(prisma);

  financeId = randomUUID();
  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${financeId}'::uuid, 'staff_f', 'finance', true)`,
  );

  otherFamilyId = randomUUID();
  otherFamilyParentId = randomUUID();
  silentContactId = randomUUID();
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${otherFamilyId}'::uuid, 'family_y', '${s.otherAdminId}'::uuid, 'ar')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values
       ('${otherFamilyParentId}'::uuid, '${otherFamilyId}'::uuid, 'parent_r', 'primary_guardian', true, true),
       ('${silentContactId}'::uuid, '${s.familyId}'::uuid, 'contact_s', 'authorized_contact', false, true)`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `truncate chat.story_view, chat.story_recipient, chat.story_audience, chat.story cascade`,
  );
  await prisma.outboxEvent.deleteMany({});
});

// ---------------------------------------------------------------------------

describe('who may publish', () => {
  it('an admin, a coverage admin and a manager may', async () => {
    for (const author of [s.ownerId, s.managerId]) {
      const draft = await stories.create(author, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      });
      expect(draft.state).toBe(StoryState.DRAFT);
    }
  });

  it('department staff may NOT — finance is real staff and still refused', async () => {
    await expect(
      stories.create(financeId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_CANNOT_PUBLISH });
  });

  it('a parent may NOT', async () => {
    await expect(
      stories.create(s.parentId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_CANNOT_PUBLISH });
  });

  it('a teacher may NOT', async () => {
    await expect(
      stories.create(s.teacherId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_CANNOT_PUBLISH });
  });

  it('an unknown actor is 401, never a default actor', async () => {
    await expect(
      stories.create(randomUUID(), {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.UNKNOWN_ACTOR });
  });
});

describe('composing', () => {
  it('refuses a story with neither body nor media', async () => {
    await expect(
      stories.create(s.ownerId, {
        body: '   ',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_EMPTY });
  });

  it('refuses a body over the configured maximum', async () => {
    await expect(
      stories.create(s.ownerId, {
        body: 'x'.repeat(2001),
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_TOO_LONG });
  });

  it('refuses a story with no audience at all', async () => {
    await expect(stories.create(s.ownerId, { body: 'x', audiences: [] })).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_EMPTY,
    });
  });

  it('accepts media with a kind, and refuses a key with no kind', async () => {
    const ok = await stories.create(s.ownerId, {
      body: null,
      mediaObjectKey: 'stories/abc',
      mediaKind: 'image',
      mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    expect(ok.mediaKind).toBe('image');

    await expect(
      stories.create(s.ownerId, {
        body: null,
        mediaObjectKey: 'stories/def',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
  });
});

describe('media upload authorization', () => {
  it('mints a signed, bound upload URL for a publisher', async () => {
    const auth = await stories.authorizeMediaUpload(s.ownerId, {
      mimeType: 'image/png',
      byteSize: 1024,
    });
    expect(auth.objectKey).toMatch(/^stories\//);
    expect(auth.uploadUrl).toContain('sig=');
    // The signature commits to the size, so the authorization cannot be spent on
    // a bigger file than it was issued for.
    expect(auth.uploadUrl).toContain('size=1024');
    expect(auth.method).toBe('PUT');
  });

  it('refuses a non-publisher', async () => {
    await expect(
      stories.authorizeMediaUpload(s.parentId, { mimeType: 'image/png', byteSize: 10 }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_CANNOT_PUBLISH });
  });

  it('refuses a disallowed mime type', async () => {
    await expect(
      stories.authorizeMediaUpload(s.ownerId, { mimeType: 'application/pdf', byteSize: 10 }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
  });

  it('refuses an oversized image and an oversized video, on their own limits', async () => {
    await expect(
      stories.authorizeMediaUpload(s.ownerId, {
        mimeType: 'image/png',
        byteSize: 11 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE });

    // The same size is fine for a video, which has its own ceiling.
    await expect(
      stories.authorizeMediaUpload(s.ownerId, {
        mimeType: 'video/mp4',
        byteSize: 11 * 1024 * 1024,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a zero or negative size', async () => {
    for (const byteSize of [0, -1]) {
      await expect(
        stories.authorizeMediaUpload(s.ownerId, { mimeType: 'image/png', byteSize }),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE });
    }
  });
});

describe('the audience is resolved server-side', () => {
  it('all_families reaches communicating contacts and nobody else', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: id } });
    const ids = recipients.map((r) => r.actorId).sort();

    expect(ids).toEqual([s.parentId, s.otherParentId, otherFamilyParentId].sort());
    // can_message = false is not a recipient.
    expect(ids).not.toContain(silentContactId);
    // Staff are never recipients of a publication they administer.
    expect(ids).not.toContain(s.ownerId);
  });

  it('all_teachers reaches active teachers only', async () => {
    // EVERY active teacher, including the one who teaches nobody in this
    // family: `all_teachers` is a broadcast to the teaching staff, and a
    // teacher's audience membership does not depend on whose children they
    // happen to teach. The PD-6 fixture added a third (teacher_e) precisely to
    // have an unrelated one, and it belongs in this audience like the others.
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_TEACHERS }]);
    const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } }))
      .map((r) => r.actorId)
      .sort();
    expect(ids).toEqual([s.teacherId, s.newTeacherId, s.unrelatedTeacherId].sort());
  });

  it('assigned_families reaches only the families the author supervises', async () => {
    // family_x is owned by admin_a (s.ownerId); family_y by admin_b.
    const mine = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.ASSIGNED_FAMILIES },
    ]);
    const mineIds = (await prisma.storyRecipient.findMany({ where: { storyId: mine } }))
      .map((r) => r.actorId)
      .sort();
    expect(mineIds).toEqual([s.parentId, s.otherParentId].sort());
    expect(mineIds).not.toContain(otherFamilyParentId);

    const theirs = await publishedStory(s.otherAdminId, [
      { kind: StoryAudienceKind.ASSIGNED_FAMILIES },
    ]);
    const theirIds = (await prisma.storyRecipient.findMany({ where: { storyId: theirs } })).map(
      (r) => r.actorId,
    );
    expect(theirIds).toEqual([otherFamilyParentId]);
  });

  it('overlapping clauses produce ONE row per person', async () => {
    const id = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.ALL_FAMILIES },
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
      { kind: StoryAudienceKind.CONTACT, refId: s.parentId },
    ]);
    const rows = await prisma.storyRecipient.findMany({ where: { storyId: id } });
    const forParent = rows.filter((r) => r.actorId === s.parentId);
    expect(forParent).toHaveLength(1);
    expect(new Set(rows.map((r) => r.actorId)).size).toBe(rows.length);
  });

  it('a forged or unknown audience id is refused, not silently dropped', async () => {
    for (const kind of [
      StoryAudienceKind.FAMILY,
      StoryAudienceKind.TEACHER,
      StoryAudienceKind.CONTACT,
      StoryAudienceKind.CONVERSATION,
    ]) {
      await expect(
        stories.create(s.ownerId, { body: 'x', audiences: [{ kind, refId: randomUUID() }] }),
      ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
    }
  });

  it('a clause that names a record when it must not, and vice versa, is refused', async () => {
    await expect(
      stories.create(s.ownerId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES, refId: s.familyId }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });

    await expect(
      stories.create(s.ownerId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.FAMILY }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
  });

  it('an unknown audience kind is refused', async () => {
    await expect(
      stories.create(s.ownerId, { body: 'x', audiences: [{ kind: 'label', refId: randomUUID() }] }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
  });

  it('a deactivated contact stops being a recipient of NEW stories', async () => {
    await prisma.contact.update({ where: { id: s.otherParentId }, data: { isActive: false } });
    try {
      const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
      const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } })).map(
        (r) => r.actorId,
      );
      expect(ids).not.toContain(s.otherParentId);
      expect(ids).toContain(s.parentId);
    } finally {
      await prisma.contact.update({ where: { id: s.otherParentId }, data: { isActive: true } });
    }
  });

  it('the audience is a SNAPSHOT: a contact added later does not receive it', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const latecomer = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${latecomer}'::uuid, '${s.familyId}'::uuid, 'parent_z', 'authorized_contact', true, true)`,
    );
    try {
      const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } })).map(
        (r) => r.actorId,
      );
      expect(ids).not.toContain(latecomer);
      await expect(stories.feed(latecomer)).resolves.toEqual([]);
    } finally {
      await prisma.contact.delete({ where: { id: latecomer } });
    }
  });

  it('resolves again at publish, under the author’s scope at that moment', async () => {
    const draft = await stories.create(s.ownerId, {
      body: 'x',
      audiences: [{ kind: StoryAudienceKind.ASSIGNED_FAMILIES }],
    });

    // Everyone the clause would have reached stops being reachable between
    // drafting and publishing. If the audience were materialised at CREATE, this
    // story would still go out to them; because it is resolved again at PUBLISH,
    // there is nobody left and publishing is refused.
    //
    // Deliberately NOT done by moving the family to another supervisor: that
    // needs chat.transfer_ownership(), which is broken on main independently of
    // stories (it passes six arguments to the five-argument chat.log_event and
    // raises 42883). Using it here would couple this test to an unrelated defect.
    await prisma.contact.updateMany({
      where: { familyId: s.familyId },
      data: { isActive: false },
    });
    try {
      await expect(stories.publish(draft.id, s.ownerId)).rejects.toMatchObject({
        code: CommErrorCode.STORY_AUDIENCE_EMPTY,
      });
    } finally {
      // Every contact of the family, not just the two communicating ones: the
      // silent contact is deactivated by the updateMany above too, and leaving it
      // inactive would make a later test see ACTOR_INACTIVE instead of the
      // STORY_CANNOT_READ it is asserting. is_active and can_message are separate
      // flags and only the former is touched here.
      await prisma.contact.updateMany({
        where: { familyId: s.familyId },
        data: { isActive: true },
      });
    }
  });
});

describe('publishing', () => {
  it('records publication facts and enqueues exactly one outbox event', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const row = await prisma.story.findUniqueOrThrow({ where: { id } });

    expect(row.state).toBe(StoryState.PUBLISHED);
    expect(row.publishedAt).not.toBeNull();
    expect(row.publishedBy).toBe(s.ownerId);
    // An expiring publication with no expiry is how a story becomes a notice board.
    expect(row.expiresAt).not.toBeNull();
    expect(row.expiresAt!.getTime() - row.publishedAt!.getTime()).toBe(24 * 3_600_000);

    const events = await prisma.outboxEvent.findMany({
      where: { type: CommEvent.STORY_PUBLISHED },
    });
    expect(events).toHaveLength(1);
    // The event carries no content: it is a nudge to refetch, not a delivery.
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.storyId).toBe(id);
    expect(payload).not.toHaveProperty('body');
    expect(payload).not.toHaveProperty('mediaUrl');
  });

  it('refuses to publish twice', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.publish(id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_ALREADY_PUBLISHED,
    });
  });

  it("an admin cannot publish another admin's draft; a manager can", async () => {
    const draft = await stories.create(s.ownerId, {
      body: 'x',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await expect(stories.publish(draft.id, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.publish(draft.id, s.managerId)).resolves.toMatchObject({
      state: StoryState.PUBLISHED,
    });
  });

  it('writes an audit row naming the delivery size', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'story', entityId: id, action: 'story.published' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.after as Record<string, unknown>).recipientCount).toBe(3);
  });
});

describe('the reader’s feed', () => {
  it('a recipient sees the story; a non-recipient sees nothing', async () => {
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.FAMILY, refId: s.familyId }]);

    const mine = await stories.feed(s.parentId);
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toBe('hello families');
    expect(mine[0].viewed).toBe(false);

    // Another academy family was never in the audience.
    await expect(stories.feed(otherFamilyParentId)).resolves.toEqual([]);
  });

  it('a draft is in nobody’s feed', async () => {
    await stories.create(s.ownerId, {
      body: 'unpublished',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await expect(stories.feed(s.parentId)).resolves.toEqual([]);
  });

  it('a contact who may not communicate has no feed at all', async () => {
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.feed(silentContactId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_READ,
    });
  });

  it('a deactivated actor has no feed', async () => {
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await prisma.contact.update({ where: { id: s.parentId }, data: { isActive: false } });
    try {
      await expect(stories.feed(s.parentId)).rejects.toMatchObject({
        code: CommErrorCode.ACTOR_INACTIVE,
      });
    } finally {
      await prisma.contact.update({ where: { id: s.parentId }, data: { isActive: true } });
    }
  });

  it('carries a signed, short-lived media URL and never the object key', async () => {
    const draft = await stories.create(s.ownerId, {
      body: 'with a picture',
      mediaObjectKey: 'stories/known-key',
      mediaKind: 'image',
      mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await stories.publish(draft.id, s.ownerId);

    const [item] = await stories.feed(s.parentId);
    expect(item.mediaUrl).toContain('sig=');
    expect(item.mediaUrl).toContain('expires=');
    expect(JSON.stringify(item)).not.toContain('mediaObjectKey');
  });
});

describe('view tracking', () => {
  it('records the first view and dedupes the second', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);

    await expect(stories.markViewed(id, s.parentId)).resolves.toEqual({ ok: true });
    await expect(stories.markViewed(id, s.parentId)).resolves.toEqual({ ok: true });

    const views = await prisma.storyView.findMany({ where: { storyId: id } });
    expect(views).toHaveLength(1);
    expect((await stories.feed(s.parentId))[0].viewed).toBe(true);
  });

  it('a NON-RECIPIENT cannot record a view, and is told only "not found"', async () => {
    const id = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
    ]);
    await expect(stories.markViewed(id, otherFamilyParentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    expect(await prisma.storyView.count({ where: { storyId: id } })).toBe(0);
  });

  it('is not an existence oracle: a real id and a random id answer alike', async () => {
    const real = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
    ]);
    const nonexistent = randomUUID();

    const a = await stories.markViewed(real, otherFamilyParentId).catch((e) => e);
    const b = await stories.markViewed(nonexistent, otherFamilyParentId).catch((e) => e);
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
    expect(a.status).toBe(b.status);
  });

  it('the database refuses a view row even if the service is bypassed', async () => {
    const id = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
    ]);
    // Straight at the table, past every service check. The trigger holds.
    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.story_view (story_id, actor_id)
         values ('${id}'::uuid, '${otherFamilyParentId}'::uuid)`,
      ),
    ).rejects.toThrow(/not in the audience/);
  });
});

describe('the viewer list', () => {
  it('a publisher sees who viewed, with a display name and no contact channel', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.markViewed(id, s.parentId);

    const viewers = await stories.viewers(id, s.ownerId);
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toMatchObject({ actorId: s.parentId, actorKind: 'contact' });
    expect(viewers[0].displayName).toBe('parent_p');
    // PRIVACY: the Actor contract carries no phone or email, so neither can appear.
    const serialised = JSON.stringify(viewers);
    expect(serialised).not.toMatch(/phone|email|@/i);
  });

  it('a RECIPIENT may not read the viewer list of a story they received', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.markViewed(id, s.parentId);
    await expect(stories.viewers(id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_PUBLISH,
    });
  });

  it('a teacher may not', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_TEACHERS }]);
    await expect(stories.viewers(id, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_PUBLISH,
    });
  });

  it('reports the count to the publisher list as well', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.markViewed(id, s.parentId);
    await stories.markViewed(id, s.otherParentId);

    const listed = (await stories.list(s.ownerId)).find((x) => x.id === id);
    expect(listed).toMatchObject({ recipientCount: 3, viewCount: 2 });
  });
});

describe('expiration is enforced server-side', () => {
  it('a story past its expiry leaves the feed IMMEDIATELY, with no sweep', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    expect(await stories.feed(s.parentId)).toHaveLength(1);

    await expireInPlace(id);

    // No sweep has run: the row still says `published`.
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).state).toBe(
      StoryState.PUBLISHED,
    );
    // And it is already gone. THIS is the defect the Phase 5 lineage had.
    expect(await stories.feed(s.parentId)).toEqual([]);
  });

  it('an expired story cannot be viewed directly either', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expireInPlace(id);
    await expect(stories.markViewed(id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_EXPIRED,
    });
  });

  it('the sweep retires it and emits a retirement event', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expireInPlace(id);

    expect(await storySweeper.expireDue()).toBe(1);
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).state).toBe(
      StoryState.EXPIRED,
    );
    const retired = await prisma.outboxEvent.findMany({ where: { type: CommEvent.STORY_RETIRED } });
    expect(retired).toHaveLength(1);
    expect((retired[0].payload as Record<string, unknown>).reason).toBe('expired');
  });

  it('the sweep is idempotent: running it twice changes nothing more', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expireInPlace(id);
    expect(await storySweeper.expireDue()).toBe(1);
    expect(await storySweeper.expireDue()).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { type: CommEvent.STORY_RETIRED } })).toBe(1);
  });

  it('an expired story cannot be republished', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expireInPlace(id);
    await storySweeper.expireDue();
    await expect(stories.publish(id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_EXPIRED,
    });
  });

  it('a live story is untouched by the sweep', async () => {
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    expect(await storySweeper.expireDue()).toBe(0);
    expect(await stories.feed(s.parentId)).toHaveLength(1);
  });
});

describe('deletion', () => {
  it('ends access immediately and keeps the row as the audit trail', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    expect(await stories.feed(s.parentId)).toHaveLength(1);

    await expect(stories.remove(id, s.ownerId, 'posted in error')).resolves.toEqual({
      ok: true,
      alreadyDeleted: false,
    });

    expect(await stories.feed(s.parentId)).toEqual([]);
    const row = await prisma.story.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe(StoryState.DELETED);
    expect(row.deletedBy).toBe(s.ownerId);
    expect(row.deletedReason).toBe('posted in error');
  });

  it('requires a reason', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.remove(id, s.ownerId, '  ')).rejects.toMatchObject({
      code: CommErrorCode.STORY_DELETE_REASON_REQUIRED,
    });
  });

  it('is idempotent', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.remove(id, s.ownerId, 'first');
    await expect(stories.remove(id, s.ownerId, 'again')).resolves.toEqual({
      ok: true,
      alreadyDeleted: true,
    });
  });

  it('a deleted story cannot be viewed', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.remove(id, s.ownerId, 'gone');
    await expect(stories.markViewed(id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_DELETED,
    });
  });

  it('a non-publisher cannot delete; another admin cannot; a manager can', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.remove(id, s.parentId, 'nope')).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_PUBLISH,
    });
    await expect(stories.remove(id, s.otherAdminId, 'nope')).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.remove(id, s.managerId, 'manager override')).resolves.toMatchObject({
      ok: true,
    });
  });

  it('deletion is terminal at the database level', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.remove(id, s.ownerId, 'gone');
    await expect(
      prisma.$executeRawUnsafe(
        `update chat.story set state = 'published' where id = '${id}'::uuid`,
      ),
    ).rejects.toThrow(/deletion is terminal/);
  });

  it('emits a retirement event so clients drop it without polling', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.remove(id, s.ownerId, 'gone');
    const retired = await prisma.outboxEvent.findMany({ where: { type: CommEvent.STORY_RETIRED } });
    expect(retired).toHaveLength(1);
    expect((retired[0].payload as Record<string, unknown>).reason).toBe('deleted');
  });
});

describe('media retention', () => {
  const key = 'stories/retention-probe';

  async function storyWithMedia(): Promise<string> {
    const draft = await stories.create(s.ownerId, {
      body: 'with media',
      mediaObjectKey: key,
      mediaKind: 'image',
      mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await stories.publish(draft.id, s.ownerId);
    return draft.id;
  }

  it('does NOT purge media while the retention window is open', async () => {
    const id = await storyWithMedia();
    await expireInPlace(id);
    await storySweeper.expireDue();

    expect(await storySweeper.purgeDueMedia()).toBe(0);
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).mediaObjectKey).toBe(key);
  });

  it('purges media once the window has closed, and clears the key', async () => {
    const id = await storyWithMedia();
    // Access ended four days ago; retention is 72h.
    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 96 * 3_600_000) },
    });

    expect(await storySweeper.purgeDueMedia()).toBe(1);
    const row = await prisma.story.findUniqueOrThrow({ where: { id } });
    expect(row.mediaObjectKey).toBeNull();
    expect(row.mediaPurgedAt).not.toBeNull();
  });

  it('measures the window from deletion for a story an operator removed', async () => {
    const id = await storyWithMedia();
    await stories.remove(id, s.ownerId, 'wrong picture');

    // Just deleted: still inside retention, so the content is recoverable.
    expect(await storySweeper.purgeDueMedia()).toBe(0);

    await prisma.story.update({
      where: { id },
      data: { deletedAt: new Date(Date.now() - 96 * 3_600_000) },
    });
    expect(await storySweeper.purgeDueMedia()).toBe(1);
  });

  it('is idempotent and stops handing out URLs for purged media', async () => {
    const id = await storyWithMedia();
    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 96 * 3_600_000) },
    });
    expect(await storySweeper.purgeDueMedia()).toBe(1);
    expect(await storySweeper.purgeDueMedia()).toBe(0);

    const listed = (await stories.list(s.ownerId)).find((x) => x.id === id);
    // Null, not a URL that would 404.
    expect(listed!.mediaUrl).toBeNull();
  });

  it('the sweep as a whole reports both halves', async () => {
    const id = await storyWithMedia();
    await expireInPlace(id);
    const result = await storySweeper.sweep();
    expect(result).toEqual({ expired: 1, purged: 0 });
  });
});

describe('cross-tenant and cross-actor isolation', () => {
  it('a publisher cannot read another organization’s story', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    // Move the story to another tenant, then ask for it as our own publisher.
    const otherOrg = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values
         ('${otherOrg}'::uuid, 'other-${otherOrg.slice(0, 8)}', 'Other Academy')`,
    );
    await prisma.$executeRawUnsafe(
      `update chat.story set organization_id = '${otherOrg}'::uuid where id = '${id}'::uuid`,
    );
    try {
      await expect(stories.viewers(id, s.ownerId)).rejects.toMatchObject({
        code: CommErrorCode.STORY_NOT_FOUND,
      });
      await expect(stories.remove(id, s.ownerId, 'x')).rejects.toMatchObject({
        code: CommErrorCode.STORY_NOT_FOUND,
      });
      expect((await stories.list(s.ownerId)).map((x) => x.id)).not.toContain(id);
    } finally {
      await prisma.$executeRawUnsafe(
        `update chat.story set organization_id = chat.default_organization_id() where id = '${id}'::uuid`,
      );
      await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    }
  });

  it('the publisher list never leaks a draft to a reader path', async () => {
    await stories.create(s.ownerId, {
      body: 'secret draft',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await expect(stories.list(s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_PUBLISH,
    });
  });
});

describe('a group audience', () => {
  it('reaches the group’s parents and teachers, not its staff moderators', async () => {
    const conversationId = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.conversation (id, type, family_id, learner_id, title)
       values ('${conversationId}'::uuid, 'student_group', '${s.familyId}'::uuid,
               '${s.learnerId}'::uuid, 'group_g')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
         ('${conversationId}'::uuid, 'contact', '${s.parentId}'::uuid, 'parent'),
         ('${conversationId}'::uuid, 'teacher', '${s.teacherId}'::uuid, 'teacher'),
         ('${conversationId}'::uuid, 'staff',   '${s.ownerId}'::uuid,  'admin')`,
    );
    try {
      const id = await publishedStory(s.ownerId, [
        { kind: StoryAudienceKind.CONVERSATION, refId: conversationId },
      ]);
      const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } }))
        .map((r) => r.actorId)
        .sort();
      expect(ids).toEqual([s.parentId, s.teacherId].sort());
      expect(ids).not.toContain(s.ownerId);
    } finally {
      await prisma.$executeRawUnsafe(
        `delete from chat.conversation where id = '${conversationId}'::uuid`,
      );
    }
  });

  it('refuses a direct conversation as an audience', async () => {
    const conversationId = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.conversation (id, type, family_id, direct_key)
       values ('${conversationId}'::uuid, 'direct', '${s.familyId}'::uuid, 'dk-${conversationId}')`,
    );
    try {
      await expect(
        stories.create(s.ownerId, {
          body: 'x',
          audiences: [{ kind: StoryAudienceKind.CONVERSATION, refId: conversationId }],
        }),
      ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
    } finally {
      await prisma.$executeRawUnsafe(
        `delete from chat.conversation where id = '${conversationId}'::uuid`,
      );
    }
  });
});

describe('a teacher reader', () => {
  it('sees a story published to all_teachers and records a view', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_TEACHERS }]);
    const feed = await stories.feed(s.teacherId);
    expect(feed.map((f) => f.id)).toEqual([id]);

    await stories.markViewed(id, s.teacherId);
    expect((await stories.feed(s.teacherId))[0].viewed).toBe(true);
    // A parent was not in this audience.
    await expect(stories.feed(s.parentId)).resolves.toEqual([]);
  });
});

describe('the feed is ordered and bounded', () => {
  it('returns newest first', async () => {
    const first = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], 'one');
    // publishedAt is set from the service clock; nudge the first one back so the
    // ordering assertion is about ordering and not about timer resolution.
    await prisma.story.update({
      where: { id: first },
      data: { publishedAt: new Date(Date.now() - 60_000) },
    });
    const second = await publishedStory(
      s.ownerId,
      [{ kind: StoryAudienceKind.ALL_FAMILIES }],
      'two',
    );

    const feed = await stories.feed(s.parentId);
    expect(feed.map((f) => f.id)).toEqual([second, first]);
  });
});
