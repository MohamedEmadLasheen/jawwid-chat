import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { ALL_FAMILIES, ScopeService } from '../../platform/scope.service';
import { Actor } from '../../platform/types';
import { CommError, CommErrorCode } from '../../platform/errors';
import { ActorKind, AudienceKind, UNREFERENCED_AUDIENCE_KINDS } from '../contracts/vocab';

/** One clause of an audience, exactly as authored. */
export interface AudienceClause {
  kind: string;
  /** Null for the kinds that name no particular record. */
  refId?: string | null;
}

export interface ResolvedRecipient {
  actorId: string;
  actorKind: string;
  /** Present for contacts. Null for teachers, who belong to no family. */
  familyId: string | null;
  /** Which clause first matched. Reporting only, never an authorization input. */
  matchedKind: string;
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[];
  /** Distinct families reached. */
  familyIds: string[];
  /**
   * Clauses that resolved to fewer people than they name, and why.
   *
   * NOT errors. A label spanning the academy, targeted by a supervisor who
   * holds forty of its families, legitimately reaches forty -- but silently
   * reaching forty when the author believes they are reaching four hundred is
   * how a broadcast quietly under-delivers. Surfaced so the compose screen can
   * say so before the send.
   */
  notes: string[];
}

/**
 * THE audience resolver -- one authoritative layer, for stories and broadcast
 * alike.
 *
 * ## Why there is exactly one of these
 *
 * "All Thursday families, plus the Installments label, plus the teachers" has
 * to become a set of people somewhere. The tempting places are all wrong:
 *
 *   * IN FLUTTER -- the client would need every family, every label and every
 *     group to compute it, which is the directory of the academy's customers
 *     handed to a phone. And two clients would drift.
 *   * IN SQL, per feature -- stories and broadcast would each grow their own
 *     union query, and "the Thursday group" would come to mean two different
 *     sets of people depending on which one you asked.
 *   * IN THE CALLER -- every new surface reimplements scope, and the day one of
 *     them forgets, a supervisor broadcasts to the whole academy.
 *
 * So it lives here, and both features call it. The database vocabulary is
 * shared too (chat.story_audience.kind and chat.broadcast_audience.kind carry
 * the same CHECK), so the two cannot drift apart even in storage.
 *
 * ## What it guarantees
 *
 *   AUTHORIZED   every clause is checked against the AUTHOR's live scope.
 *                Nothing here trusts a family, label, group or user id from a
 *                client: an id the author may not reach resolves to nothing.
 *   DEDUPLICATED a person matched by three clauses appears once. The database
 *                enforces this again with a composite primary key, but the set
 *                is built deduplicated so the counts an operator is shown
 *                before sending are the counts that will be delivered.
 *   DETERMINISTIC recipients come back sorted by actor id, so the same audience
 *                resolves to the same list in the same order every time --
 *                which is what makes a resolution reproducible in a test and
 *                comparable in an audit.
 *   LIVE-ONLY    inactive contacts, deactivated teachers and contacts who
 *                cannot receive messages are excluded.
 *
 * ## The two shapes of refusal, and why they differ
 *
 * A clause that NAMES ONE RECORD (`family`, `group`, `label`, `teacher`,
 * `user`) outside the author's reach is REFUSED -- the author asked for
 * something specific and did not get it, and silently dropping it would send a
 * broadcast the author did not compose.
 *
 * A clause that names a SET (`all_families`, `assigned_families`) is
 * INTERSECTED with scope. `all_families` additionally requires an
 * organization-wide role, because for a supervisor "everyone" would otherwise
 * silently mean "my forty families", which is a different message.
 *
 * Both refusals report AUDIENCE_TARGET_NOT_FOUND for a forged id and for a real
 * id out of scope alike. Distinguishing them would make this endpoint an
 * existence oracle for other people's families.
 */
@Injectable()
export class AudienceResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async resolve(
    actor: Actor,
    clauses: readonly AudienceClause[],
    now: Date = new Date(),
  ): Promise<ResolvedAudience> {
    if (!clauses || clauses.length === 0) {
      throw new CommError(CommErrorCode.AUDIENCE_EMPTY, 'an audience must name somebody', 400);
    }

    this.validateShape(clauses);

    const familyScope = await this.scope.visibleFamilies(actor, now);
    const organizationWide = familyScope === ALL_FAMILIES;
    const scopedFamilyIds = organizationWide ? null : new Set(familyScope as readonly string[]);

    const notes: string[] = [];
    // Which families each clause contributed, and which teachers. Kept as two
    // sets rather than one, because a family becomes SEVERAL recipients (its
    // contacts) and a teacher is exactly one.
    const familyMatch = new Map<string, string>(); // familyId -> first matching kind
    const teacherMatch = new Map<string, string>(); // teacherId -> first matching kind

    for (const clause of clauses) {
      switch (clause.kind) {
        case AudienceKind.ALL_FAMILIES: {
          if (!organizationWide) {
            throw new CommError(
              CommErrorCode.AUDIENCE_TOO_BROAD,
              'only an organization-wide role may target every family; ' +
                'use assigned_families to reach your own',
            );
          }
          const ids = await this.familyIdsInOrganization(actor);
          for (const id of ids) this.note(familyMatch, id, clause.kind);
          break;
        }

        case AudienceKind.ASSIGNED_FAMILIES: {
          // Deliberately means the author's OWN scope, even for a manager --
          // for whom it is the whole organization, which is exactly right.
          const ids = organizationWide
            ? await this.familyIdsInOrganization(actor)
            : [...(scopedFamilyIds ?? [])];
          if (ids.length === 0) notes.push('assigned_families matched no families');
          for (const id of ids) this.note(familyMatch, id, clause.kind);
          break;
        }

        case AudienceKind.ALL_TEACHERS: {
          if (!organizationWide) {
            throw new CommError(
              CommErrorCode.AUDIENCE_TOO_BROAD,
              'only an organization-wide role may target every teacher',
            );
          }
          const teachers = await this.prisma.teacher.findMany({
            where: { isActive: true, ...this.org(actor) },
            select: { id: true },
          });
          for (const t of teachers) this.note(teacherMatch, t.id, clause.kind);
          break;
        }

        case AudienceKind.FAMILY: {
          const familyId = clause.refId as string;
          const family = await this.prisma.family.findFirst({
            where: { id: familyId, ...this.org(actor) },
            select: { id: true },
          });
          // A forged id and an out-of-scope id are the same answer on purpose.
          if (!family || !this.inScope(familyId, organizationWide, scopedFamilyIds)) {
            throw this.targetNotFound('family', familyId);
          }
          this.note(familyMatch, familyId, clause.kind);
          break;
        }

        case AudienceKind.LABEL: {
          const labelId = clause.refId as string;
          const label = await this.prisma.label.findFirst({
            where: { id: labelId, deletedAt: null, ...this.org(actor) },
            select: { id: true, name: true },
          });
          if (!label) throw this.targetNotFound('label', labelId);

          const rows = await this.prisma.familyLabel.findMany({
            where: { labelId },
            select: { familyId: true },
          });
          // A label is organization-wide vocabulary, so it is INTERSECTED with
          // scope rather than refused: a supervisor filing families under
          // "Installments" should be able to reach their own Installments
          // families without being able to reach anyone else's.
          const reachable = rows
            .map((r) => r.familyId)
            .filter((id) => this.inScope(id, organizationWide, scopedFamilyIds));
          if (reachable.length < rows.length) {
            notes.push(
              `label "${label.name}" covers ${rows.length} families; ` +
                `${reachable.length} are within your scope`,
            );
          }
          for (const id of reachable) this.note(familyMatch, id, clause.kind);
          break;
        }

        case AudienceKind.GROUP: {
          const groupId = clause.refId as string;
          const group = await this.prisma.group.findFirst({
            where: { id: groupId, ...this.org(actor) },
            select: { id: true, name: true, state: true },
          });
          if (!group) throw this.targetNotFound('group', groupId);

          // CURRENT members only -- leftAt null. A student who left the group
          // in March is not in the audience for a message about it in
          // September, and the history rows are there precisely so that
          // "current" is a question with an answer.
          const members = await this.prisma.groupMember.findMany({
            where: { groupId, leftAt: null, learner: { isActive: true } },
            select: { learner: { select: { familyId: true } } },
          });
          const ids = [...new Set(members.map((m) => m.learner.familyId))];
          const reachable = ids.filter((id) =>
            this.inScope(id, organizationWide, scopedFamilyIds),
          );
          if (reachable.length < ids.length) {
            notes.push(
              `group "${group.name}" covers ${ids.length} families; ` +
                `${reachable.length} are within your scope`,
            );
          }
          for (const id of reachable) this.note(familyMatch, id, clause.kind);
          break;
        }

        case AudienceKind.TEACHER: {
          const teacherId = clause.refId as string;
          const teacher = await this.prisma.teacher.findFirst({
            where: { id: teacherId, isActive: true, ...this.org(actor) },
            select: { id: true },
          });
          if (!teacher) throw this.targetNotFound('teacher', teacherId);
          // A teacher belongs to no family, so family scope cannot decide this.
          // The rule instead is the relationship that already exists: a
          // supervisor may address a teacher who teaches one of their students.
          if (!organizationWide && !(await this.teacherTeachesInScope(teacherId, scopedFamilyIds))) {
            throw this.targetNotFound('teacher', teacherId);
          }
          this.note(teacherMatch, teacherId, clause.kind);
          break;
        }

        case AudienceKind.USER: {
          const userId = clause.refId as string;
          const contact = await this.prisma.contact.findFirst({
            where: { id: userId, isActive: true, ...this.org(actor) },
            select: { id: true, familyId: true },
          });
          if (contact) {
            if (!this.inScope(contact.familyId, organizationWide, scopedFamilyIds)) {
              throw this.targetNotFound('user', userId);
            }
            // Noted directly rather than through their family, so "these two
            // people" does not silently become "both their whole households".
            this.note(familyMatch, `contact:${contact.id}`, clause.kind);
            break;
          }
          const teacher = await this.prisma.teacher.findFirst({
            where: { id: userId, isActive: true, ...this.org(actor) },
            select: { id: true },
          });
          if (!teacher) throw this.targetNotFound('user', userId);
          if (!organizationWide && !(await this.teacherTeachesInScope(userId, scopedFamilyIds))) {
            throw this.targetNotFound('user', userId);
          }
          this.note(teacherMatch, userId, clause.kind);
          break;
        }

        default:
          throw new CommError(
            CommErrorCode.AUDIENCE_KIND_INVALID,
            `unknown audience kind ${clause.kind}`,
            400,
          );
      }
    }

    const recipients = await this.materialise(familyMatch, teacherMatch, actor);

    return {
      // Deterministic: same audience, same order, every time.
      recipients: recipients.sort((a, b) => a.actorId.localeCompare(b.actorId)),
      familyIds: [
        ...new Set(recipients.map((r) => r.familyId).filter((id): id is string => id !== null)),
      ].sort(),
      notes,
    };
  }

  /**
   * Turn matched families and teachers into the people who will actually be
   * written to.
   *
   * TWO QUERIES, not one per family. The naive shape here -- loop the families,
   * fetch each one's contacts -- is an N+1 that runs once per family in the
   * audience, which for "all families" is the whole customer base.
   */
  private async materialise(
    familyMatch: Map<string, string>,
    teacherMatch: Map<string, string>,
    actor: Actor,
  ): Promise<ResolvedRecipient[]> {
    const out = new Map<string, ResolvedRecipient>();

    const namedContactIds: string[] = [];
    const familyIds: string[] = [];
    for (const key of familyMatch.keys()) {
      if (key.startsWith('contact:')) namedContactIds.push(key.slice('contact:'.length));
      else familyIds.push(key);
    }

    if (familyIds.length > 0) {
      const contacts = await this.prisma.contact.findMany({
        where: {
          familyId: { in: familyIds },
          isActive: true,
          // A contact who may not be messaged is not a recipient. This is the
          // same capability flag the messaging path honours; a broadcast is not
          // an exemption from it.
          canMessage: true,
          ...this.org(actor),
        },
        select: { id: true, familyId: true },
      });
      for (const c of contacts) {
        out.set(c.id, {
          actorId: c.id,
          actorKind: ActorKind.CONTACT,
          familyId: c.familyId,
          matchedKind: familyMatch.get(c.familyId) ?? AudienceKind.FAMILY,
        });
      }
    }

    if (namedContactIds.length > 0) {
      const contacts = await this.prisma.contact.findMany({
        where: { id: { in: namedContactIds }, isActive: true, canMessage: true },
        select: { id: true, familyId: true },
      });
      for (const c of contacts) {
        // A named contact whose family was ALSO matched keeps whichever clause
        // landed first; the person is one recipient either way.
        if (!out.has(c.id)) {
          out.set(c.id, {
            actorId: c.id,
            actorKind: ActorKind.CONTACT,
            familyId: c.familyId,
            matchedKind: familyMatch.get(`contact:${c.id}`) ?? AudienceKind.USER,
          });
        }
      }
    }

    if (teacherMatch.size > 0) {
      const teachers = await this.prisma.teacher.findMany({
        where: { id: { in: [...teacherMatch.keys()] }, isActive: true },
        select: { id: true },
      });
      for (const t of teachers) {
        if (!out.has(t.id)) {
          out.set(t.id, {
            actorId: t.id,
            actorKind: ActorKind.TEACHER,
            familyId: null,
            matchedKind: teacherMatch.get(t.id) ?? AudienceKind.TEACHER,
          });
        }
      }
    }

    return [...out.values()];
  }

  /** Shape validation, before a single query runs. */
  private validateShape(clauses: readonly AudienceClause[]): void {
    const known = new Set<string>(Object.values(AudienceKind));
    for (const clause of clauses) {
      if (!known.has(clause.kind)) {
        throw new CommError(
          CommErrorCode.AUDIENCE_KIND_INVALID,
          `unknown audience kind ${clause.kind}`,
          400,
        );
      }
      const needsRef = !UNREFERENCED_AUDIENCE_KINDS.has(clause.kind);
      if (needsRef && !clause.refId) {
        throw new CommError(
          CommErrorCode.AUDIENCE_KIND_INVALID,
          `audience kind ${clause.kind} requires a target id`,
          400,
        );
      }
      if (!needsRef && clause.refId) {
        throw new CommError(
          CommErrorCode.AUDIENCE_KIND_INVALID,
          `audience kind ${clause.kind} takes no target id`,
          400,
        );
      }
    }
  }

  /** First clause to match a target wins, so `matchedKind` is stable. */
  private note(map: Map<string, string>, key: string, kind: string): void {
    if (!map.has(key)) map.set(key, kind);
  }

  private inScope(
    familyId: string,
    organizationWide: boolean,
    scopedFamilyIds: Set<string> | null,
  ): boolean {
    return organizationWide || (scopedFamilyIds?.has(familyId) ?? false);
  }

  private async teacherTeachesInScope(
    teacherId: string,
    scopedFamilyIds: Set<string> | null,
  ): Promise<boolean> {
    if (!scopedFamilyIds || scopedFamilyIds.size === 0) return false;
    const learner = await this.prisma.learner.findFirst({
      where: { teacherId, isActive: true, familyId: { in: [...scopedFamilyIds] } },
      select: { id: true },
    });
    return learner !== null;
  }

  private async familyIdsInOrganization(actor: Actor): Promise<string[]> {
    const rows = await this.prisma.family.findMany({
      where: { ...this.org(actor) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private org(actor: Actor) {
    return actor.organizationId ? { organizationId: actor.organizationId } : {};
  }

  private targetNotFound(kind: string, id: string): CommError {
    return new CommError(
      CommErrorCode.AUDIENCE_TARGET_NOT_FOUND,
      // The id is echoed because the caller supplied it; nothing about the
      // record it may or may not name is revealed.
      `no ${kind} ${id} that you may address`,
      404,
    );
  }
}
