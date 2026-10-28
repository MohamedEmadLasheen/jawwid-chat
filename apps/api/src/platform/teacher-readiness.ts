import type { PrismaService } from './prisma.service';

/**
 * PD-43 (plan §3.5-§3.7, G8): what the pickers say beside a teacher -- the
 * Sales subscription form and Change teacher. Warnings only: a teacher still
 * being set up may be given students (owner Q5, "students allowed").
 *
 * Read live from chat.teacher_setup_state and the login's status; never an
 * amount, never the Teacher File's contents.
 */
export interface TeacherReadiness {
  /** Any step of the set-up checklist is open. */
  setupIncomplete: boolean;
  /** No login yet, or a login that has never been used. */
  notSignedIn: boolean;
  /** No live primary supervisor: the Teachers Manager covers them (§3.7). */
  noSupervisor: boolean;
  /** Suspended through Accounts (G8): temporary, so a warning too. */
  loginSuspended: boolean;
}

export async function teacherReadiness(prisma: PrismaService, teacherIds: string[]): Promise<Map<string, TeacherReadiness>> {
  if (teacherIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; state: Record<string, boolean>; status: string | null }>>`
    SELECT t.id::text AS id, chat.teacher_setup_state(t.id) AS state, a.status
      FROM unnest(${teacherIds}::uuid[]) AS u(id)
      JOIN chat.teacher t ON t.id = u.id
      LEFT JOIN chat.account a ON a.id = t.account_id`;
  return new Map(
    rows.map((r) => [
      r.id,
      {
        setupIncomplete: Object.values(r.state).some((done) => done === false),
        notSignedIn: r.status === null || r.status === 'provisioned',
        noSupervisor: r.state.supervisor === false,
        loginSuspended: r.status === 'suspended',
      },
    ]),
  );
}
