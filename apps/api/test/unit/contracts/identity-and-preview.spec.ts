/**
 * The pure halves of the Parent identity work: batched name resolution, system
 * event parsing, and list-row preview text.
 *
 * These are unit tests because each is a total function over its input and the
 * cases that matter -- an id nobody holds, a payload that is not JSON, a body
 * that is four thousand characters of nothing -- are cheaper and clearer to
 * state here than to manufacture in a database.
 */
import { PrismaDirectoryService } from '@platform/directory.service';
import { toPreviewText, toSystemEventDto } from '@communication/contracts/dto';

// ---------------------------------------------------------------------------
// Batched identity
// ---------------------------------------------------------------------------

/** Counts calls so the N+1 claim is asserted rather than asserted-about. */
function fakePrisma() {
  const calls = { staff: 0, contact: 0, teacher: 0 };
  return {
    calls,
    staff: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        calls.staff += 1;
        return where.id.in.filter((id) => id.startsWith('s')).map((id) => ({ id, name: `staff-${id}` }));
      },
    },
    contact: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        calls.contact += 1;
        return where.id.in.filter((id) => id.startsWith('c')).map((id) => ({ id, name: `contact-${id}` }));
      },
    },
    teacher: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        calls.teacher += 1;
        return where.id.in.filter((id) => id.startsWith('t')).map((id) => ({ id, name: `teacher-${id}` }));
      },
    },
  };
}

describe('DirectoryService resolves many actors without an N+1', () => {
  it('spends at most one query per principal table, whatever the input size', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const refs = [];
    for (let i = 0; i < 50; i += 1) {
      refs.push({ actorId: `s${i}`, actorKind: 'staff' });
      refs.push({ actorId: `c${i}`, actorKind: 'contact' });
      refs.push({ actorId: `t${i}`, actorKind: 'teacher' });
    }

    const resolved = await directory.resolveMany(refs);

    expect(resolved.size).toBe(150);
    expect(prisma.calls).toEqual({ staff: 1, contact: 1, teacher: 1 });
  });

  it('deduplicates: one admin who wrote thirty messages is looked up once', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const refs = Array.from({ length: 30 }, () => ({ actorId: 's1', actorKind: 'staff' }));
    await directory.resolveMany(refs);

    expect(prisma.calls.staff).toBe(1);
  });

  it('spends no query at all on an empty input', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const resolved = await directory.resolveMany([]);

    expect(resolved.size).toBe(0);
    expect(prisma.calls).toEqual({ staff: 0, contact: 0, teacher: 0 });
  });

  it('asks no table it was given no ids for', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    await directory.resolveMany([{ actorId: 's1', actorKind: 'staff' }]);

    expect(prisma.calls).toEqual({ staff: 1, contact: 0, teacher: 0 });
  });

  it('OMITS an id it cannot resolve rather than inventing a name', async () => {
    // The caller must be able to tell "this principal is gone" from "this
    // principal is called something", and the id is never the fallback.
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const resolved = await directory.resolveMany([
      { actorId: 's1', actorKind: 'staff' },
      { actorId: 'nobody', actorKind: 'staff' },
    ]);

    expect(resolved.get('s1')?.displayName).toBe('staff-s1');
    expect(resolved.has('nobody')).toBe(false);
  });

  it('resolves the system actor without touching the database', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const resolved = await directory.resolveMany([
      { actorId: '00000000-0000-0000-0000-000000000000', actorKind: 'system' },
    ]);

    expect(resolved.get('00000000-0000-0000-0000-000000000000')?.displayName).toBe('Jawwid');
    expect(prisma.calls).toEqual({ staff: 0, contact: 0, teacher: 0 });
  });

  it('carries a name and a kind and nothing else', async () => {
    // The privacy invariant the DTO mappers hold: fields are enumerated, never
    // spread, so a column added to chat.contact cannot arrive through here.
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const resolved = await directory.resolveMany([{ actorId: 'c1', actorKind: 'contact' }]);

    expect(Object.keys(resolved.get('c1')!).sort()).toEqual(['actorId', 'displayName', 'kind']);
  });

  it('ignores an unknown actor kind instead of guessing a table', async () => {
    const prisma = fakePrisma();
    const directory = new PrismaDirectoryService(prisma as never);

    const resolved = await directory.resolveMany([{ actorId: 'x1', actorKind: 'robot' }]);

    expect(resolved.size).toBe(0);
    expect(prisma.calls).toEqual({ staff: 0, contact: 0, teacher: 0 });
  });
});

// ---------------------------------------------------------------------------
// System events
// ---------------------------------------------------------------------------

describe('toSystemEventDto turns a stored payload into a named event', () => {
  it('reads the kind and the remaining fields as parameters', () => {
    expect(toSystemEventDto('{"kind":"group.created","learner":"Adam"}')).toEqual({
      kind: 'group.created',
      params: { learner: 'Adam' },
    });
  });

  it('stringifies numeric parameters, so the client formats one type', () => {
    expect(toSystemEventDto('{"kind":"group.membership_changed","added":2,"removed":0}')).toEqual({
      kind: 'group.membership_changed',
      params: { added: '2', removed: '0' },
    });
  });

  it('keeps an unknown future kind rather than dropping it', () => {
    expect(toSystemEventDto('{"kind":"group.renamed","title":"new"}')?.kind).toBe('group.renamed');
  });

  it('returns null on anything unparseable, and never throws', () => {
    for (const body of ['', 'not json', '[]', 'null', '"a string"', '{"no":"kind"}', '{"kind":""}']) {
      expect(() => toSystemEventDto(body)).not.toThrow();
      expect(toSystemEventDto(body)).toBeNull();
    }
    expect(toSystemEventDto(null)).toBeNull();
  });

  it('drops a nested object rather than passing a structure the client cannot render', () => {
    expect(toSystemEventDto('{"kind":"x","nested":{"a":1},"flat":"ok"}')).toEqual({
      kind: 'x',
      params: { flat: 'ok' },
    });
  });
});

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

describe('toPreviewText decides what a list row may quote', () => {
  it('quotes a text message', () => {
    expect(toPreviewText('text', 'see you at five')).toBe('see you at five');
  });

  it('collapses whitespace so a multi-line message stays one row', () => {
    expect(toPreviewText('text', 'line one\n\n  line two')).toBe('line one line two');
  });

  it('bounds a very long body and marks the truncation', () => {
    const preview = toPreviewText('text', 'x'.repeat(4000))!;
    expect(preview.length).toBeLessThanOrEqual(141);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns null for a voice note, an image and a file', () => {
    // The type is the whole story and the WORDS belong to the client, which is
    // the only side that knows the reader's language.
    expect(toPreviewText('voice', null)).toBeNull();
    expect(toPreviewText('image', null)).toBeNull();
    expect(toPreviewText('file', 'invoice.pdf')).toBeNull();
  });

  it('NEVER returns a system message body, which is a payload', () => {
    expect(toPreviewText('system', '{"kind":"group.created","learner":"Adam"}')).toBeNull();
  });

  it('returns null for an empty or whitespace-only body', () => {
    expect(toPreviewText('text', '')).toBeNull();
    expect(toPreviewText('text', '   \n ')).toBeNull();
    expect(toPreviewText('text', null)).toBeNull();
  });
});
