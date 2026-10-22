import type { Prisma } from '@prisma/client';

/**
 * PD-26: a teacher on leave or suspended today is not given new students
 * (a transfer, a subscription form naming them). Null when they may be; else
 * the reason, naming the day they are back. A plain day off does not count.
 */
export async function awayRefusal(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teacher: { id: string; name: string },
): Promise<string | null> {
  const [away] = await db.$queryRaw<Array<{ kind: string; until: Date }>>`
    SELECT kind, until FROM chat.teacher_away(${teacher.id}::uuid, chat.academy_today())`;
  if (!away || away.kind === 'day_off') return null;
  const until = away.until.toISOString().slice(0, 10);
  return away.kind === 'leave'
    ? `${teacher.name} is on leave until ${until}; choose another teacher`
    : `${teacher.name} is suspended until ${until}; choose another teacher`;
}

