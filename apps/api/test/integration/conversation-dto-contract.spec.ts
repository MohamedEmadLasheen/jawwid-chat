/**
 * The contract test for ConversationDto's two new fields.
 *
 * The original defect was an API CONTRACT gap: the client was written against
 * a payload that never carried what it needed. So this asserts the payload the
 * controller actually returns — field names, types and semantics — rather than
 * the services underneath it, which `conversation-context.spec.ts` covers.
 *
 * WHAT THIS PROVES: the real ConversationController, holding the real services,
 * against the real migrated database, returns an object carrying `learner` and
 * `unreadCount` with the documented shapes.
 *
 * WHAT IT DOES NOT PROVE: HTTP framing. There is no supertest/Nest-bootstrap
 * layer in this repository and this is not the change that should introduce
 * one. Nest serialises a returned plain object as-is, so the gap is the JSON
 * encoder and the route decorators, both of which are framework behaviour.
 */
import { randomUUID } from 'node:crypto';
import { ConversationController } from '@communication/api/conversation.controller';
import type { ConversationDto } from '@communication/contracts/dto';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let controller: ConversationController;

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
  controller = new ConversationController(g.conversations, g.messages, g.calls);
});

async function listBody(actorId: string): Promise<{ conversations: ConversationDto[] }> {
  return controller.list(actorId);
}

describe('GET /conversations — the response a parent actually receives', () => {
  it('carries learner and unreadCount on a student group', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'hello' });

    const body = await listBody(s.parentId);
    const dto = body.conversations.find((c) => c.id === group.id)!;

    // Names and types, exactly as documented.
    expect(dto.learner).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(dto.learner).toEqual({ id: s.learnerId, name: 'learner_l' });
    expect(typeof dto.unreadCount).toBe('number');
    expect(dto.unreadCount).toBe(1);
  });

  it('carries unreadCount as a number, and learner as null, on the family thread',
    async () => {
      const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

      const body = await listBody(s.parentId);
      const dto = body.conversations.find((c) => c.id === thread.id)!;

      expect(typeof dto.unreadCount).toBe('number');
      expect(dto.unreadCount).toBe(0);
      // A conversation about the family, not about one child.
      expect(dto.learner ?? null).toBeNull();
    });

  it('every conversation in the list carries a numeric unreadCount', async () => {
    // Never undefined on this route. A client that has to distinguish "no
    // badge" from "the server did not say" ends up inventing local state,
    // which is the thing this phase exists to remove.
    await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const body = await listBody(s.parentId);

    expect(body.conversations.length).toBeGreaterThan(1);
    for (const dto of body.conversations) {
      expect(typeof dto.unreadCount).toBe('number');
    }
  });

  it('keeps every field existing consumers already read', async () => {
    // Additive, not a reshape. `learnerId` in particular stays: it remains the
    // authority on whether a conversation has a learner at all, and something
    // may already depend on it.
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listBody(s.parentId)).conversations[0];

    for (const field of [
      'id',
      'type',
      'familyId',
      'learnerId',
      'title',
      'state',
      'needsReply',
      'lastSeq',
      'lastActivityAt',
      'archivedAt',
      'teacherRequiresApproval',
      'parentRequiresApproval',
    ]) {
      expect(dto).toHaveProperty(field);
    }
    expect(typeof dto.lastSeq).toBe('string');
  });

  it('exposes no learner field beyond id and name', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.learner set level = 'advanced' where id = '${s.learnerId}'::uuid`,
    );
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listBody(s.parentId)).conversations.find((c) => c.learner)!;

    expect(Object.keys(dto.learner!).sort()).toEqual(['id', 'name']);
  });
});

describe('GET /conversations/:id — the detail response', () => {
  it('carries the same two fields', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'hi' });

    const dto = await controller.get(s.parentId, group.id);

    expect(dto.learner).toEqual({ id: s.learnerId, name: 'learner_l' });
    expect(dto.unreadCount).toBe(1);
  });

  it('refuses a conversation the actor is not in, before counting anything',
    async () => {
      const otherContact = await g.prisma.contact.create({
        data: {
          familyId: s.familyId,
          name: 'parent_z',
          rolePreset: 'authorized_contact',
          canMessage: true,
          canViewProgress: false,
          canManageSchedule: false,
          canManageBilling: false,
          canManageContacts: false,
          canCancel: false,
          isActive: true,
        },
      });
      const theirThread = await g.conversations.getOrCreateDirect(
        otherContact.id,
        s.otherAdminId,
      );

      await expect(controller.get(s.teacherId, theirThread.id)).rejects.toThrow();
    });
});

/**
 * Gap O3. The detail route returned no `members` at all -- not nameless ones --
 * so a client could render nobody, and a teacher had no way to name the parent
 * they are authorized to speak to.
 */
describe('GET /conversations/:id — members, with names (O3)', () => {
  it('returns every live member with a renderable name', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = await controller.get(s.teacherId, group.id);
    const members = dto.members!;

    expect(members).toBeDefined();

    // The three the group is built from, each named from its own table:
    // contact.name, staff.name, teacher.name -- one spelling, resolved by
    // IdentityService, never assembled from the title or an id.
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: s.parentId, actorKind: 'contact', displayName: 'parent_p' }),
        expect.objectContaining({ actorId: s.ownerId, actorKind: 'staff', displayName: 'admin_a' }),
        expect.objectContaining({ actorId: s.teacherId, actorKind: 'teacher', displayName: 'teacher_c' }),
      ]),
    );
  });

  it('exposes no member field beyond the six on the contract', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = await controller.get(s.teacherId, group.id);

    // Exact equality, not a subset: this is the tripwire that stops a widened
    // Prisma include or a convenience field reaching a client through the member
    // list. `canOpenDirect` is the sixth and is declared in API-CONTRACT.md; a
    // seventh should fail here until it is declared there too.
    for (const member of dto.members!) {
      expect(Object.keys(member).sort()).toEqual(
        ['actorId', 'actorKind', 'canOpenDirect', 'displayName', 'isSilent', 'memberRole'],
      );
    }
  });

  it('spells canOpenDirect on every member, false included', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // Omitting the field for the false ones would make "not allowed" and "old
    // server" indistinguishable to a client, and the client fails closed on both
    // -- so the bug would hide until someone wondered why a channel never appeared.
    const dto = await controller.get(s.teacherId, group.id);

    expect(dto.members!.length).toBeGreaterThan(0);
    expect(dto.members!.every((m) => typeof m.canOpenDirect === 'boolean')).toBe(true);
  });

  it('a name is never an id, and an unresolvable member yields an empty string', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // A membership row outlives the actor it names (BR-5), so this state is
    // reachable in production and must not render as a uuid.
    const ghost = randomUUID();
    await g.prisma.conversationMember.create({
      data: {
        conversationId: group.id,
        actorId: ghost,
        actorKind: 'staff',
        memberRole: 'observer',
      },
    });

    const dto = await controller.get(s.teacherId, group.id);
    const orphan = dto.members!.find((m) => m.actorId === ghost)!;

    expect(orphan.displayName).toBe('');
    for (const member of dto.members!) {
      expect(member.displayName).not.toBe(member.actorId);
    }
  });

  it('the LIST route still carries no members, so a list is not N identity queries',
    async () => {
      await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

      const body = await listBody(s.teacherId);

      expect(body.conversations.length).toBeGreaterThan(0);
      for (const c of body.conversations) {
        expect(c.members).toBeUndefined();
      }
    });
});
