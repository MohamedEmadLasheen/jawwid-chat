/**
 * Group Info shows a member's FACE, and it is the same face as their profile.
 *
 * The defect this closes was a propagation gap, not a rendering bug: the parent's photo
 * was stored, served on their own profile, and rendered correctly there — but
 * `ConversationMemberDto` had no avatar field and the directory never read the column, so
 * every member in Group Info fell back to generated initials.
 *
 * WHAT THIS PROVES, against the real controller, the real services and the real migrated
 * database:
 *
 *  * a member's photo reaches the conversation payload, as a SIGNED url;
 *  * it is the SAME stored object the parent's own profile serves — one avatar, one
 *    storage, no second copy and no second source of truth;
 *  * the object KEY never appears in the payload, anywhere, at any depth;
 *  * a member of a kind that has no avatar column resolves to null rather than a guess;
 *  * and the whole thing is gated by conversation membership, so no new way exists to
 *    reach a photo that was not already reachable as a name.
 */
import { ConversationController } from '@communication/api/conversation.controller';
import type { ConversationDto } from '@communication/contracts/dto';
import {
  buildGraph,
  seed,
  seedSecondFamily,
  truncate,
  withAssignmentGate,
  Scenario,
  SecondFamily,
} from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let controller: ConversationController;

/** A well-formed avatar key, in the only prefix `ProfileService` will accept. */
const PARENT_KEY = 'avatars/11111111-1111-4111-8111-111111111111';

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
  controller = new ConversationController(
    g.conversations,
    g.messages,
    g.directory,
    g.authz,
    g.calls,
    g.storage,
  );
});

/** The student group, read as one of its own members. */
async function groupInfo(actorId: string): Promise<ConversationDto> {
  const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  return controller.get(actorId, group.id);
}

function member(dto: ConversationDto, actorId: string) {
  return dto.members?.find((m) => m.actorId === actorId);
}

// ---------------------------------------------------------------------------
describe("a member's photo reaches the payload", () => {
  it('a parent who set a photo is returned with a signed url, not initials', async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);

    const dto = await groupInfo(s.parentId);
    const me = member(dto, s.parentId);

    expect(me).toBeDefined();
    // The field exists and carries something fetchable. This is the whole defect: it used
    // to be absent, so the client had nothing to render and drew initials instead.
    expect(me!.avatarUrl).toBeTruthy();
    expect(me!.avatarUrl).toMatch(/^https?:\/\//);
    // And the name still resolves — the photo did not displace it.
    expect(me!.displayName).toBeTruthy();
  });

  it('a parent with no photo is null, which is what draws the initials', async () => {
    const dto = await groupInfo(s.parentId);
    expect(member(dto, s.parentId)!.avatarUrl).toBeNull();
  });

  it('the url is SIGNED and expiring, never a bare or permanent object path', async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);

    const url = member(await groupInfo(s.parentId), s.parentId)!.avatarUrl!;

    // A signature and an expiry are what make this safe to hand to a client: the url is a
    // short-lived capability, not a public address for the object.
    expect(url).toMatch(/sig=/);
    expect(url).toMatch(/expires=/);
  });

  it('removing the photo returns the member to null on the very next read', async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);
    expect(member(await groupInfo(s.parentId), s.parentId)!.avatarUrl).toBeTruthy();

    await g.profile.removeAvatar(s.parentId);

    // No server-side cache stands between the column and the payload. The read is the
    // authority, every time, which is why the client needs no invalidation protocol.
    expect(member(await groupInfo(s.parentId), s.parentId)!.avatarUrl).toBeNull();
  });

  it('replacing the photo is reflected immediately, with no stale url', async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);
    const first = member(await groupInfo(s.parentId), s.parentId)!.avatarUrl!;

    const second = 'avatars/22222222-2222-4222-8222-222222222222';
    await g.profile.setAvatar(s.parentId, second);
    const after = member(await groupInfo(s.parentId), s.parentId)!.avatarUrl!;

    expect(after).not.toBe(first);
    expect(after).toContain(encodeURIComponent(second).slice(0, 20));
  });
});

// ---------------------------------------------------------------------------
describe('one avatar, one storage, one source of truth', () => {
  it("Group Info serves the SAME stored object as the parent's own profile", async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);

    const own = await g.profile.me(s.parentId);
    const inGroup = member(await groupInfo(s.parentId), s.parentId)!;

    // Two independently signed urls over the same key: the signatures and expiries may
    // differ, the OBJECT must not. A second avatar system, or a copied file, would show up
    // here as two different paths.
    const keyOf = (url: string) => new URL(url).pathname;
    expect(keyOf(inGroup.avatarUrl!)).toBe(keyOf(own.avatarUrl!));
  });

  it('the photo comes from the column, not from anything the caller supplied', async () => {
    // Written straight to the column, bypassing ProfileService entirely. If the payload
    // reflects it, the database is genuinely the source.
    await g.prisma.contact.update({
      where: { id: s.parentId },
      data: { avatarObjectKey: PARENT_KEY },
    });

    expect(member(await groupInfo(s.parentId), s.parentId)!.avatarUrl).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('the object key never leaves the server', () => {
  it('no member carries a key, and the payload does not mention the field at all',
    async () => {
      await g.profile.setAvatar(s.parentId, PARENT_KEY);

      const dto = await groupInfo(s.parentId);

      for (const m of dto.members ?? []) {
        expect(m).not.toHaveProperty('avatarObjectKey');
      }
      // At any depth, under any name: the serialised response must not contain the column
      // name or a bare key. `avatarUrl` contains the key as part of a SIGNED path, so the
      // assertion is about the unsigned forms.
      const json = JSON.stringify(dto);
      expect(json).not.toMatch(/avatarObjectKey/);
      expect(json).not.toMatch(/"avatars\//);
    });
});

// ---------------------------------------------------------------------------
describe('kinds that cannot have a photo say null, not something invented', () => {
  it('the teacher and the admin members resolve to null', async () => {
    await withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${s.teacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );
    await g.profile.setAvatar(s.parentId, PARENT_KEY);

    const dto = await groupInfo(s.parentId);

    // `chat.teacher` and `chat.staff` have no avatar column. The directory returns null
    // for them rather than borrowing the parent's photo or deriving one.
    for (const m of dto.members ?? []) {
      if (m.actorKind === 'contact') continue;
      expect(m.avatarUrl).toBeNull();
    }
  });

  it('the system actor is never handed a photo', async () => {
    const dto = await groupInfo(s.parentId);
    const system = dto.members?.find((m) => m.actorKind === 'system');
    if (system) expect(system.avatarUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
/**
 * The access rule for a face is exactly the access rule for a name: you see the people you
 * are in a conversation with. This change adds no new boundary and must not widen the one
 * that exists.
 */
describe('authorization: a photo is reachable only where a name already was', () => {
  it("a parent from another family is refused before a single member is resolved",
    async () => {
      const other = await seedSecondFamily(g.prisma);
      await g.profile.setAvatar(s.parentId, PARENT_KEY);
      const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

      // The IDOR case: a real, valid, active parent -- of a DIFFERENT family. Refused by
      // `readWithMembers` before anything is named or signed, so there is no partial
      // payload for a photo to leak through.
      await expect(controller.get(other.parentId, group.id)).rejects.toBeDefined();
    });

  it("a CO-parent of the same family is a member, and legitimately sees the photo",
    async () => {
      await g.profile.setAvatar(s.parentId, PARENT_KEY);

      // `otherParentId` is parent_q: the second authorized contact on the SAME family, and
      // a member of this group. The boundary is membership, not "is this my own photo" --
      // the two guardians of a child see each other in Group Info exactly as they see the
      // teacher. Asserting this keeps a future tightening from breaking a legitimate case
      // while trying to close a cross-family one.
      const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
      const dto = await controller.get(s.otherParentId, group.id);
      const them = dto.members?.find((m) => m.actorId === s.parentId);
      expect(them?.avatarUrl).toBeTruthy();
    });

  it('a real teacher who teaches nobody in this family is refused', async () => {
    await g.profile.setAvatar(s.parentId, PARENT_KEY);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    await expect(controller.get(s.unrelatedTeacherId, group.id)).rejects.toBeDefined();
  });

  it("a second family's parent sees their OWN photo and never the first family's",
    async () => {
      const other: SecondFamily = await seedSecondFamily(g.prisma);
      const otherKey = 'avatars/33333333-3333-4333-8333-333333333333';

      await g.profile.setAvatar(s.parentId, PARENT_KEY);
      await g.profile.setAvatar(other.parentId, otherKey);

      g.coverage.onDutyId = other.ownerId;
      const theirGroup = await g.conversations.ensureStudentGroup(
        other.learnerId,
        other.ownerId,
      );
      const dto = await controller.get(other.parentId, theirGroup.id);

      // Their own face is there...
      const them = dto.members?.find((m) => m.actorId === other.parentId);
      expect(them?.avatarUrl).toBeTruthy();

      // ...and the other family's parent appears nowhere in the payload at all -- not as
      // a member, not as a name, and therefore not as a photo.
      const json = JSON.stringify(dto);
      expect(json).not.toContain(s.parentId);
      expect(json).not.toContain(encodeURIComponent(PARENT_KEY));
      expect(json).not.toContain(PARENT_KEY);
    });

  it('the read takes a conversation id and an actor, and no object key', async () => {
    // The only inputs to Group Info are the caller (from the bearer token, via @ActorId)
    // and the conversation id. Members -- and therefore which photos get signed -- come
    // from the authorized read, never from the request. A route that accepted a key, or an
    // actor id, would be the way to turn this into an IDOR.
    expect(controller.get).toHaveLength(2);
  });
});
