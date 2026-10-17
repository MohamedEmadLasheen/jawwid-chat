import type { PrismaClient } from '@prisma/client';

/**
 * QA ONLY -- the single place the PD-8 seed (`org-chat-seed.ts`) writes a
 * child's teacher.
 *
 * `chat.learner.teacher_id` is the academy's fact, owned by Core and guarded by
 * a trigger (20260923130000): Chat never edits a teaching assignment (OD-04).
 * Assignment ingestion from Core is the gate's real owner and does not exist in
 * this repository yet, so the QA seed stands in for it here, exactly as the
 * integration fixtures do (test/integration/harness.ts withAssignmentGate). It
 * is reachable only from the seed CLI, which refuses non-local targets.
 *
 * Kept to one function in its own file so the elevation-gate allowlist in
 * test/unit/auth/db-identity-boundary.spec.ts names exactly this, and nothing
 * else in src may open the gate.
 */
export async function insertLearnerWithTeacherForQa(
  prisma: PrismaClient,
  row: { learnerId: string; organizationId: string; familyId: string; name: string; teacherId: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`select set_config('chat.syncing_assignment', 'on', true)`,
    prisma.$executeRaw`insert into chat.learner (id, organization_id, family_id, name, teacher_id)
                       values (${row.learnerId}::uuid, ${row.organizationId}::uuid, ${row.familyId}::uuid,
                               ${row.name}, ${row.teacherId}::uuid)`,
  ]);
}
