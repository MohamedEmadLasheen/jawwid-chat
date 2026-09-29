import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SYSTEM_ACTOR } from './types';
import { ActorKind } from '../communication/contracts/vocab';

/**
 * Display identity for actors a caller is ALREADY authorized to see.
 *
 * ## Why this is not `IdentityService`
 *
 * `IdentityService.resolveActor` answers "who is this, and what may they do" --
 * it returns a full `Actor` carrying `familyId`, `canMessage`, `staffRole` and
 * the activity flags authorization decisions are made from. Rendering a name
 * needs none of that, and resolving one actor there costs up to three
 * primary-key lookups because it probes each principal table in turn.
 *
 * A group of eight members would therefore cost twenty-four queries per
 * conversation, and a chat list of twenty conversations would multiply that
 * again. That is the N+1 this service exists to foreclose: it takes the whole
 * set at once and spends AT MOST THREE queries regardless of how many actors
 * are asked for -- one per principal table, each an `IN` over primary keys.
 *
 * ## What it deliberately does not do
 *
 * It is NOT an authorization boundary and must never be used as one. It answers
 * "what is this actor called", nothing else, and a caller that hands it an id
 * it has not already authorized will get a name it had no right to. Every
 * caller in this codebase passes ids drawn from rows the request already
 * proved it may read -- conversation membership, message authorship -- and new
 * callers must do the same.
 *
 * The returned shape carries a name and a kind and NOTHING ELSE. No phone (the
 * schema has no such column, G-07), no email, no family id, no capability
 * flags: a field added to `chat.contact` cannot reach a client through here,
 * because every field is enumerated by hand exactly as the DTO mappers are.
 */
export interface DisplayIdentity {
  readonly actorId: string;
  readonly kind: string;
  readonly displayName: string;
}

/** One actor to resolve. The kind narrows the lookup to a single table. */
export interface ActorRef {
  readonly actorId: string;
  readonly actorKind: string;
}

export interface DirectoryService {
  /**
   * Resolve many actors at once.
   *
   * Unresolvable ids are ABSENT from the map rather than present with a
   * placeholder name: a caller must be able to tell "this actor has no row any
   * more" from "this actor is called something". Rendering the difference is
   * the client's decision, and it must never be an id (boundary doc 25).
   */
  resolveMany(refs: readonly ActorRef[]): Promise<Map<string, DisplayIdentity>>;
}

@Injectable()
export class PrismaDirectoryService implements DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMany(refs: readonly ActorRef[]): Promise<Map<string, DisplayIdentity>> {
    const resolved = new Map<string, DisplayIdentity>();
    if (refs.length === 0) return resolved;

    // Bucketed by kind so each table is asked exactly once. Deduplicated,
    // because the same admin appears on every message they wrote.
    const staffIds = new Set<string>();
    const contactIds = new Set<string>();
    const teacherIds = new Set<string>();

    for (const ref of refs) {
      if (!ref.actorId) continue;
      switch (ref.actorKind) {
        case ActorKind.STAFF:
          staffIds.add(ref.actorId);
          break;
        case ActorKind.CONTACT:
          contactIds.add(ref.actorId);
          break;
        case ActorKind.TEACHER:
          teacherIds.add(ref.actorId);
          break;
        // The system actor is a constant, not a row. It is resolved without a
        // query so a system message never costs one.
        case ActorKind.SYSTEM:
          resolved.set(ref.actorId, {
            actorId: ref.actorId,
            kind: ActorKind.SYSTEM,
            displayName: SYSTEM_ACTOR.displayName,
          });
          break;
        default:
          break;
      }
    }

    // Three queries, in parallel, whatever the size of the input.
    const [staff, contacts, teachers] = await Promise.all([
      staffIds.size
        ? this.prisma.staff.findMany({
            where: { id: { in: [...staffIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      contactIds.size
        ? this.prisma.contact.findMany({
            where: { id: { in: [...contactIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      teacherIds.size
        ? this.prisma.teacher.findMany({
            where: { id: { in: [...teacherIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    for (const row of staff) {
      resolved.set(row.id, { actorId: row.id, kind: ActorKind.STAFF, displayName: row.name });
    }
    for (const row of contacts) {
      resolved.set(row.id, { actorId: row.id, kind: ActorKind.CONTACT, displayName: row.name });
    }
    for (const row of teachers) {
      resolved.set(row.id, { actorId: row.id, kind: ActorKind.TEACHER, displayName: row.name });
    }

    return resolved;
  }
}
