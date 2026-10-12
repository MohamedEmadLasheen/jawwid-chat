import { ConversationService } from '@communication/conversations/conversation.service';
import { actorRefKey } from '@platform/identity.service';
import { ActorKind, ConversationType } from '@communication/contracts/vocab';
import type { Actor } from '@platform/types';

/**
 * The face on a chat-list ROW: the other person in a 1:1.
 *
 * The property this file defends is a COST, so it is tested by counting. The chat list
 * deliberately loads no members per row — `toConversationDto` is called without them
 * because resolving per row would be one identity batch per conversation — so the counterpart
 * work has to be bounded for the whole page or it reintroduces exactly what that decision
 * removed. One membership query, one resolver call, however many rows.
 *
 * Everything else here is about not showing the WRONG face, which matters more than showing
 * one: a staff actor lists conversations they are not in, and `chat.staff` / `chat.contact` /
 * `chat.teacher` have independently generated ids.
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const VIEWER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const THIRD = '33333333-3333-3333-3333-333333333333';
const SHARED_ID = '44444444-4444-4444-4444-444444444444';

interface MemberRow {
  conversationId: string;
  actorId: string;
  actorKind: string;
}

function actor(id: string, kind: string, avatarObjectKey: string | null): Actor {
  return {
    actorId: id,
    kind: kind as Actor['kind'],
    displayName: `name-${id.slice(0, 4)}-${kind}`,
    locale: 'ar',
    isActive: true,
    organizationId: ORG,
    avatarObjectKey,
  };
}

/** Counts what the service asks, and answers from memory. */
class CountingDeps {
  readonly calls: string[] = [];

  constructor(
    private readonly memberRows: MemberRow[],
    private readonly actors: Actor[],
  ) {}

  get queryCount(): number {
    return this.calls.length;
  }

  readonly prisma = {
    conversationMember: {
      findMany: async (args: {
        where: { conversationId: { in: string[] }; leftAt: null };
      }) => {
        this.calls.push('conversationMember.findMany');
        return this.memberRows.filter((r) =>
          args.where.conversationId.in.includes(r.conversationId),
        );
      },
    },
  };

  readonly identity = {
    resolveActor: async () => {
      throw new Error('counterpartsFor must never resolve one actor at a time');
    },
    resolveActors: async (refs: readonly { actorId: string; actorKind: string }[]) => {
      this.calls.push('identity.resolveActors');
      const out = new Map<string, Actor>();
      for (const ref of refs) {
        const found = this.actors.find(
          (a) => a.actorId === ref.actorId && a.kind === ref.actorKind,
        );
        if (found) out.set(actorRefKey(ref), found);
      }
      return out;
    },
  };

  build(): ConversationService {
    return new ConversationService(
      this.prisma as never,
      {} as never,
      {} as never,
      this.identity as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }
}

const direct = (id: string) => ({ id, type: ConversationType.DIRECT });
const group = (id: string) => ({ id, type: ConversationType.STUDENT_GROUP });

describe('the counterpart of a direct conversation', () => {
  it('is the OTHER member, not the viewer', async () => {
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.STAFF },
      ],
      [actor(OTHER, ActorKind.STAFF, 'avatars/staff/x/p.jpg')],
    );

    const result = await deps.build().counterpartsFor([direct('c1')], VIEWER);

    expect(result.get('c1')?.actorId).toBe(OTHER);
    expect(result.get('c1')?.avatarObjectKey).toBe('avatars/staff/x/p.jpg');
  });

  it('resolves even when the counterpart has NO photo -- the row just gets no face', async () => {
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.STAFF },
      ],
      [actor(OTHER, ActorKind.STAFF, null)],
    );

    const result = await deps.build().counterpartsFor([direct('c1')], VIEWER);

    expect(result.get('c1')?.avatarObjectKey).toBeNull();
  });

  it('is ABSENT when the counterpart does not resolve', async () => {
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.STAFF },
      ],
      [], // resolves to nothing
    );

    expect((await deps.build().counterpartsFor([direct('c1')], VIEWER)).has('c1')).toBe(
      false,
    );
  });
});

describe('it never shows a face that is not this row\'s', () => {
  it('gives NOTHING when the viewer is not a member -- a staff actor lists every 1:1', async () => {
    // `listForActor` returns every conversation for staff, member or not. Two strangers in
    // a 1:1 have no "other" person relative to this viewer, and picking either would put
    // somebody's face on a chat that is not theirs.
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: THIRD, actorKind: ActorKind.TEACHER },
      ],
      [
        actor(OTHER, ActorKind.CONTACT, 'avatars/contact/o/p.jpg'),
        actor(THIRD, ActorKind.TEACHER, 'avatars/teacher/t/p.jpg'),
      ],
    );

    const result = await deps.build().counterpartsFor([direct('c1')], VIEWER);

    expect(result.size).toBe(0);
    expect(deps.calls).not.toContain('identity.resolveActors');
  });

  it('gives NOTHING when the viewer is not a member and there is exactly ONE other', async () => {
    // The case that ISOLATES the membership guard. The sibling test above has two other
    // members, so the "exactly one counterpart" rule would reject it anyway — a mutation
    // that deleted the membership check still passed. Here one member has left, leaving a
    // single live stranger, and without the membership check their face would be served to
    // a staff actor on a chat they are not in.
    const deps = new CountingDeps(
      [{ conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.CONTACT }],
      [actor(OTHER, ActorKind.CONTACT, 'avatars/contact/o/p.jpg')],
    );

    const result = await deps.build().counterpartsFor([direct('c1')], VIEWER);

    expect(result.size).toBe(0);
    expect(deps.calls).not.toContain('identity.resolveActors');
  });

  it('gives NOTHING when a direct conversation somehow has three live members', async () => {
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.STAFF },
        { conversationId: 'c1', actorId: THIRD, actorKind: ActorKind.TEACHER },
      ],
      [actor(OTHER, ActorKind.STAFF, 'avatars/staff/x/p.jpg')],
    );

    expect((await deps.build().counterpartsFor([direct('c1')], VIEWER)).size).toBe(0);
  });

  it('does not confuse two actor KINDS that share an id', async () => {
    // chat.staff and chat.teacher generate ids independently, so `STAFF:x` and `TEACHER:x`
    // are different people. A map keyed on the id alone would hand one the other's face.
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: SHARED_ID, actorKind: ActorKind.TEACHER },
        { conversationId: 'c2', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c2', actorId: SHARED_ID, actorKind: ActorKind.STAFF },
      ],
      [
        actor(SHARED_ID, ActorKind.TEACHER, 'avatars/teacher/shared/p.jpg'),
        actor(SHARED_ID, ActorKind.STAFF, 'avatars/staff/shared/p.jpg'),
      ],
    );

    const result = await deps.build().counterpartsFor([direct('c1'), direct('c2')], VIEWER);

    expect(result.get('c1')?.kind).toBe(ActorKind.TEACHER);
    expect(result.get('c1')?.avatarObjectKey).toBe('avatars/teacher/shared/p.jpg');
    expect(result.get('c2')?.kind).toBe(ActorKind.STAFF);
    expect(result.get('c2')?.avatarObjectKey).toBe('avatars/staff/shared/p.jpg');
  });
});

describe('a group is not a person', () => {
  it('gives no counterpart for a group, and does not even query for one', async () => {
    const deps = new CountingDeps([], []);

    const result = await deps.build().counterpartsFor([group('g1'), group('g2')], VIEWER);

    expect(result.size).toBe(0);
    expect(deps.queryCount).toBe(0);
  });

  it('handles a mixed page: the 1:1 gets a face, the group does not', async () => {
    const deps = new CountingDeps(
      [
        { conversationId: 'c1', actorId: VIEWER, actorKind: ActorKind.CONTACT },
        { conversationId: 'c1', actorId: OTHER, actorKind: ActorKind.STAFF },
      ],
      [actor(OTHER, ActorKind.STAFF, 'avatars/staff/x/p.jpg')],
    );

    const result = await deps
      .build()
      .counterpartsFor([group('g1'), direct('c1'), group('g2')], VIEWER);

    expect([...result.keys()]).toEqual(['c1']);
  });
});

describe('the work is BOUNDED per page, not per conversation', () => {
  function pageOf(size: number): CountingDeps {
    const rows: MemberRow[] = [];
    const actors: Actor[] = [];
    for (let i = 0; i < size; i++) {
      const other = `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`;
      rows.push({ conversationId: `c${i}`, actorId: VIEWER, actorKind: ActorKind.CONTACT });
      rows.push({ conversationId: `c${i}`, actorId: other, actorKind: ActorKind.STAFF });
      actors.push(actor(other, ActorKind.STAFF, `avatars/staff/${i}/p.jpg`));
    }
    return new CountingDeps(rows, actors);
  }

  it('costs the SAME number of queries for 1 row and for 200', async () => {
    const one = pageOf(1);
    await one.build().counterpartsFor([direct('c0')], VIEWER);

    const many = pageOf(200);
    const page = Array.from({ length: 200 }, (_, i) => direct(`c${i}`));
    const result = await many.build().counterpartsFor(page, VIEWER);

    expect(result.size).toBe(200);
    expect(one.calls).toEqual(['conversationMember.findMany', 'identity.resolveActors']);
    expect(many.calls).toEqual(['conversationMember.findMany', 'identity.resolveActors']);
    expect(many.queryCount).toBe(one.queryCount);
    expect(many.queryCount).toBe(2);
  });

  it('asks the resolver ONCE, with every counterpart in one call', async () => {
    const deps = pageOf(50);
    const page = Array.from({ length: 50 }, (_, i) => direct(`c${i}`));

    let batchSizes: number[] = [];
    const original = deps.identity.resolveActors;
    deps.identity.resolveActors = async (refs) => {
      batchSizes.push(refs.length);
      return original.call(deps.identity, refs);
    };

    await deps.build().counterpartsFor(page, VIEWER);

    expect(batchSizes).toEqual([50]);
  });

  it('never resolves one actor at a time', async () => {
    // The double throws on `resolveActor`, so a per-row implementation cannot pass.
    const deps = pageOf(10);
    const page = Array.from({ length: 10 }, (_, i) => direct(`c${i}`));

    await expect(deps.build().counterpartsFor(page, VIEWER)).resolves.toBeDefined();
  });

  it('does nothing at all for an empty page', async () => {
    const deps = new CountingDeps([], []);
    expect((await deps.build().counterpartsFor([], VIEWER)).size).toBe(0);
    expect(deps.queryCount).toBe(0);
  });
});
