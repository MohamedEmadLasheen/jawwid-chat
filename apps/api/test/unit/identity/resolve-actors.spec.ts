import type { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService, actorRefKey } from '@platform/identity.service';
import { ActorKind } from '@communication/contracts/vocab';

/**
 * `IdentityService.resolveActors` — the bounded identity primitive.
 *
 * The property under test is a COST, so it is tested by counting the queries the
 * service issues. Everything else in this file exists to make that count
 * meaningful: the double implements exactly the three calls the service makes and
 * throws on anything else, so a passing count cannot come from a double that
 * quietly answered something the real client would not.
 *
 * Why the cost is worth a test of its own: `resolveActor` probes three tables in
 * turn because it is handed an id and no kind. Called once per row on a
 * 100-message page that is up to 300 sequential queries, and an author is not
 * bounded by conversation membership — family-facing staff may post in any
 * conversation — so deduplicating by author does not bound it either. The only
 * thing that bounds it is the kind, which every caller already has.
 */

interface StaffRow {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}
interface ContactRow {
  id: string;
  name: string;
  isActive: boolean;
  familyId: string;
  canMessage: boolean;
  organizationId: string;
  family: { language: string };
}
interface TeacherRow {
  id: string;
  name: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}

const ORG = '00000000-0000-0000-0000-0000000000aa';

/** Counts what the service asks the database, and answers from memory. */
class CountingDb {
  readonly calls: string[] = [];

  constructor(
    private readonly staffRows: StaffRow[] = [],
    private readonly contactRows: ContactRow[] = [],
    private readonly teacherRows: TeacherRow[] = [],
  ) {}

  /** Queries issued, in order. The whole point of this file. */
  get queryCount(): number {
    return this.calls.length;
  }

  readonly staff = {
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      this.calls.push('staff.findMany');
      return this.staffRows.filter((r) => args.where.id.in.includes(r.id));
    },
    findUnique: async () => {
      throw new Error('resolveActors must never use a single-row lookup');
    },
  };

  readonly contact = {
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      this.calls.push('contact.findMany');
      return this.contactRows.filter((r) => args.where.id.in.includes(r.id));
    },
    findUnique: async () => {
      throw new Error('resolveActors must never use a single-row lookup');
    },
  };

  readonly teacher = {
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      this.calls.push('teacher.findMany');
      return this.teacherRows.filter((r) => args.where.id.in.includes(r.id));
    },
    findUnique: async () => {
      throw new Error('resolveActors must never use a single-row lookup');
    },
  };

  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }
}

const staffRow = (id: string, name: string): StaffRow => ({
  id,
  name,
  role: 'admin',
  isActive: true,
  leftAt: null,
  organizationId: ORG,
});
const contactRow = (id: string, name: string): ContactRow => ({
  id,
  name,
  isActive: true,
  familyId: 'f1',
  canMessage: true,
  organizationId: ORG,
  family: { language: 'ar' },
});
const teacherRow = (id: string, name: string): TeacherRow => ({
  id,
  name,
  isActive: true,
  leftAt: null,
  organizationId: ORG,
});

describe('resolveActors — query cost', () => {
  it('issues NO query for an empty reference list', async () => {
    const db = new CountingDb();
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([]);

    expect(resolved.size).toBe(0);
    expect(db.queryCount).toBe(0);
  });

  it('issues no query for a kind that is absent', async () => {
    const db = new CountingDb([staffRow('s1', 'admin_a')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    await identity.resolveActors([{ actorId: 's1', actorKind: ActorKind.STAFF }]);

    // One kind present, one query. Not three.
    expect(db.calls).toEqual(['staff.findMany']);
  });

  it('two kinds present cost exactly two queries', async () => {
    const db = new CountingDb([staffRow('s1', 'admin_a')], [contactRow('c1', 'parent_p')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 'c1', actorKind: ActorKind.CONTACT },
    ]);

    expect(db.queryCount).toBe(2);
    expect(db.calls.sort()).toEqual(['contact.findMany', 'staff.findMany']);
  });

  it('all supported kinds cost one query each, and no more', async () => {
    const db = new CountingDb(
      [staffRow('s1', 'admin_a')],
      [contactRow('c1', 'parent_p')],
      [teacherRow('t1', 'teacher_c')],
    );
    const identity = new PrismaIdentityService(db.asPrisma());

    await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 'c1', actorKind: ActorKind.CONTACT },
      { actorId: 't1', actorKind: ActorKind.TEACHER },
      // SYSTEM is a constant, not a row: it must add no query.
      { actorId: '00000000-0000-0000-0000-000000000000', actorKind: ActorKind.SYSTEM },
    ]);

    expect(db.queryCount).toBe(3);
  });

  it('a page of eighty rows by one author is still one query', async () => {
    // THE PROPERTY THIS WHOLE CHANGE EXISTS FOR. The cost must not grow with the
    // number of rows.
    const db = new CountingDb([staffRow('s1', 'admin_a')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    const refs = Array.from({ length: 80 }, () => ({
      actorId: 's1',
      actorKind: ActorKind.STAFF,
    }));
    const resolved = await identity.resolveActors(refs);

    expect(db.queryCount).toBe(1);
    expect(resolved.size).toBe(1);
  });

  it('a hundred distinct authors of one kind is still one query', async () => {
    // Not merely deduplication: the cost is bounded by KIND, so even a page on
    // which every row has a different author does not fan out.
    const rows = Array.from({ length: 100 }, (_, i) => staffRow(`s${i}`, `admin_${i}`));
    const db = new CountingDb(rows);
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors(
      rows.map((r) => ({ actorId: r.id, actorKind: ActorKind.STAFF })),
    );

    expect(db.queryCount).toBe(1);
    expect(resolved.size).toBe(100);
  });
});

describe('resolveActors — the reference key is (actorKind, actorId)', () => {
  it('asks for a duplicated reference once', async () => {
    const db = new CountingDb([staffRow('s1', 'admin_a')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 's1', actorKind: ActorKind.STAFF },
    ]);

    expect(db.calls).toEqual(['staff.findMany']);
  });

  it('keeps the same id under two kinds as two different actors', async () => {
    // chat.staff, chat.contact and chat.teacher generate ids independently, so a
    // collision is representable — and a map keyed on the id alone would return
    // one when asked for the other. That is a cross-actor identity leak, not a
    // cache miss.
    const shared = 'cafe0000-0000-0000-0000-000000000001';
    const db = new CountingDb([staffRow(shared, 'admin_a')], [], [teacherRow(shared, 'teacher_c')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([
      { actorId: shared, actorKind: ActorKind.STAFF },
      { actorId: shared, actorKind: ActorKind.TEACHER },
    ]);

    expect(resolved.size).toBe(2);
    expect(resolved.get(actorRefKey({ actorId: shared, actorKind: ActorKind.STAFF }))!.displayName)
      .toBe('admin_a');
    expect(resolved.get(actorRefKey({ actorId: shared, actorKind: ActorKind.TEACHER }))!.displayName)
      .toBe('teacher_c');
  });

  it('does not answer a reference whose kind is wrong', async () => {
    // The id exists — as a staff member. Asked for as a teacher it is nobody.
    const db = new CountingDb([staffRow('s1', 'admin_a')], [], []);
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.TEACHER },
    ]);

    expect(resolved.size).toBe(0);
  });
});

describe('resolveActors — what it returns', () => {
  it('returns the canonical Actor, with displayName from the principal row', async () => {
    const db = new CountingDb(
      [staffRow('s1', 'admin_a')],
      [contactRow('c1', 'parent_p')],
      [teacherRow('t1', 'teacher_c')],
    );
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 'c1', actorKind: ActorKind.CONTACT },
      { actorId: 't1', actorKind: ActorKind.TEACHER },
    ]);

    // One field, one source: staff.name / contact.name / teacher.name, all
    // arriving as Actor.displayName. Never a role and never a label.
    expect(
      [...resolved.values()].map((a) => `${a.kind}:${a.displayName}`).sort(),
    ).toEqual(['contact:parent_p', 'staff:admin_a', 'teacher:teacher_c']);
  });

  it('omits an unresolved actor rather than inventing one', async () => {
    const db = new CountingDb([staffRow('s1', 'admin_a')]);
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([
      { actorId: 's1', actorKind: ActorKind.STAFF },
      { actorId: 'gone', actorKind: ActorKind.STAFF },
    ]);

    // Absent, not a placeholder: no empty Actor, no 'Unknown', no id-as-name.
    expect(resolved.size).toBe(1);
    expect(resolved.has(actorRefKey({ actorId: 'gone', actorKind: ActorKind.STAFF }))).toBe(false);
  });

  it('skips a reference with no id without querying for it', async () => {
    const db = new CountingDb();
    const identity = new PrismaIdentityService(db.asPrisma());

    const resolved = await identity.resolveActors([{ actorId: '', actorKind: ActorKind.STAFF }]);

    expect(resolved.size).toBe(0);
    expect(db.queryCount).toBe(0);
  });

  it('answers SYSTEM from the constant, with no query', async () => {
    const db = new CountingDb();
    const identity = new PrismaIdentityService(db.asPrisma());

    const ref = { actorId: '00000000-0000-0000-0000-000000000000', actorKind: ActorKind.SYSTEM };
    const resolved = await identity.resolveActors([ref]);

    expect(db.queryCount).toBe(0);
    expect(resolved.get(actorRefKey(ref))?.kind).toBe(ActorKind.SYSTEM);
  });
});
