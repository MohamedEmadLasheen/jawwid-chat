import { Inject, Injectable } from '@nestjs/common';
import type { MaterialItem, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { currentRequestOrigin } from '../platform/request-origin';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';
import { SchedulingService } from '../lessons/scheduling.service';
import { ageOn } from '../lessons/enrollment.service';
import { LessonOutcome } from '../communication/contracts/vocab';
import { SURAHS, surahOf } from './quran-surahs';
import { PlayTokenSigner, PLAY_TOKEN_TTL_SECONDS } from './play-token';
import { MaterialsAdminService, renderTemplate } from './materials-admin.service';
import { sortMaterials } from './ordering';
import { academyWeekStart } from './week';
import { ACADEMY_ZONE, canonicalZone } from '../platform/time-zone';
import { linkPresentation, readMaterialsConfig, type MaterialsConfig } from './materials-config';
import { AGE_GROUPS, MARK_STATUSES, SUBJECTS, ageGroupOf, type AgeGroup } from './vocab';

/** How long a signed storage URL for a file (audio, video, PDF, image) lives. */
export const FILE_URL_TTL_SECONDS = 60 * 60;
const PRACTICE_WINDOW_DAYS = 7;
const MAX_REASON = 1000;

function notFound(what = 'library item') {
  return new CommError(CommErrorCode.MATERIAL_NOT_FOUND, `no such ${what}`);
}
function invalid(reason: string) {
  return new CommError(CommErrorCode.MATERIAL_INVALID, reason, 400);
}

/**
 * PD-29 (amended 2026-10-26): what a child's Materials page reads -- the open
 * library (one subject at a time, defaulting to the child's age band) and what
 * was opened for the child this academy week -- and the one call that hands a
 * viewer something to play (recording it for a child when one is named). The
 * memorization map is retired: its routes answer 410, its marks are kept.
 *
 * Who: a child's page is LESSON_ACTS.read_materials -- the family, the child's
 * own teacher, and the staff whose PD-8 scope reaches the child (the same
 * lessonStanding every lesson route uses); anyone else gets the same 404 as an
 * unknown child.
 *
 * The library itself is open: every active person of the organization may
 * open a published item. `open` is the access decision -- the item's object
 * key never reaches a client. It returns a short-lived signed STORAGE URL for
 * a file (so audio and video stream from storage with native HTTP Range, not
 * through this process), the URL for a lesson of the lessons site or a link,
 * and a play URL for a package, whose every file request is re-authorized
 * (play.controller.ts) -- with the one `presentation` a client must use:
 *
 *   frame-isolated  a package from OUR origin: sandbox "allow-scripts allow-forms"
 *   frame-site      a link on the frame allowlist (the lessons site, or
 *                   MATERIALS_FRAME_ORIGINS): sandbox "allow-scripts
 *                   allow-same-origin allow-forms" -- it keeps its own origin
 *   browser         any other https link: opened in the browser, never embedded
 *   file            a signed storage URL
 */
@Injectable()
export class MaterialsReaderService {
  private readonly playTokens = new PlayTokenSigner();
  /** Read once at startup: an invalid value stops the API rather than mis-framing anything. */
  private readonly config: MaterialsConfig = readMaterialsConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly scheduling: SchedulingService,
    private readonly admin: MaterialsAdminService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  surahs() {
    return { surahs: SURAHS, ageGroups: AGE_GROUPS, subjects: SUBJECTS, markStatuses: MARK_STATUSES };
  }

  // ------------------------------------------------------------------
  // The teacher's picker
  // ------------------------------------------------------------------

  /** Published items, for a teacher (or staff) attaching practice to a report. */
  async picker(actorId: string, query: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    if ((actor.kind !== ActorKind.TEACHER && actor.kind !== ActorKind.STAFF) || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.MATERIAL_DENIED, 'the item picker is for teachers and staff');
    }
    const where: Prisma.MaterialItemWhereInput = { organizationId: actor.organizationId, status: 'published' };
    if (typeof query.subject === 'string' && query.subject) where.subject = query.subject;
    if (typeof query.ageGroup === 'string' && query.ageGroup) where.OR = [{ ageGroups: { has: query.ageGroup } }, { ageGroups: { isEmpty: true } }];
    if (typeof query.surah === 'string' && /^\d{1,3}$/.test(query.surah)) where.surah = Number(query.surah);
    if (typeof query.q === 'string' && query.q.trim()) {
      const q = query.q.trim();
      where.AND = [{ OR: [{ titleAr: { contains: q, mode: 'insensitive' } }, { titleEn: { contains: q, mode: 'insensitive' } }] }];
    }
    const items = await this.prisma.materialItem.findMany({ where, take: 300 });
    return { items: sortMaterials(items).map(itemDto) };
  }

  // ------------------------------------------------------------------
  // A child's page
  // ------------------------------------------------------------------

  async library(actorId: string, learnerId: string, query: Record<string, unknown>) {
    const { actor, learner, standing } = await this.child(actorId, learnerId, 'read_materials');
    const age = await this.ageOf(learner.id);
    const childGroup = ageGroupOf(age);
    const requested = typeof query.ageGroup === 'string' ? query.ageGroup : undefined;
    if (requested && requested !== 'all' && !(AGE_GROUPS as readonly string[]).includes(requested)) throw invalid(`ageGroup: all or one of ${AGE_GROUPS.join(', ')}`);
    const group: AgeGroup | null = requested === 'all' ? null : ((requested as AgeGroup | undefined) ?? childGroup);
    const subject = typeof query.subject === 'string' && query.subject ? query.subject : undefined;
    if (subject && !(SUBJECTS as readonly string[]).includes(subject)) throw invalid(`subject: one of ${SUBJECTS.join(', ')}`);
    const where: Prisma.MaterialItemWhereInput = { organizationId: learner.organizationId, status: 'published' };
    if (subject) where.subject = subject;
    if (group) where.OR = [{ ageGroups: { has: group } }, { ageGroups: { isEmpty: true } }];
    const items = sortMaterials(await this.prisma.materialItem.findMany({ where, take: 1000 }));
    return {
      child: { id: learner.id, name: learner.name, age, ageGroup: childGroup },
      ageGroup: group ?? 'all',
      subject: subject ?? null,
      items: items.map(itemDto),
      viewer: viewerOf(standing, actor),
    };
  }

  /**
   * Practice this week: the practice, next-lesson tasks and homework of the
   * child's live reports of the last seven days, newest first. When there are
   * none, the latest report that carried practice, with its date, so the page
   * is never empty only because a week passed.
   */
  async practice(actorId: string, learnerId: string) {
    const { learner } = await this.child(actorId, learnerId, 'read_materials');
    const since = new Date(Date.now() - PRACTICE_WINDOW_DAYS * 24 * 3_600_000);
    const select = { lessonId: true, submittedAt: true, lessonNumber: true, nextTasks: true, homework: true } as const;
    let reports = await this.prisma.lessonReport.findMany({
      where: { deletedAt: null, submittedAt: { gte: since }, lesson: { learnerId: learner.id, outcome: LessonOutcome.HELD } },
      orderBy: { submittedAt: 'desc' },
      take: 10,
      select,
    });
    let current = true;
    if (reports.length === 0) {
      const latest = await this.prisma.$queryRaw<Array<{ lesson_id: string }>>`
        SELECT p.lesson_id FROM chat.lesson_report_practice p
          JOIN chat.lesson_report r ON r.lesson_id = p.lesson_id
          JOIN chat.lesson l ON l.id = r.lesson_id
         WHERE l.learner_id = ${learner.id}::uuid AND l.outcome = 'held' AND r.deleted_at IS NULL AND p.withdrawn_at IS NULL
         ORDER BY r.submitted_at DESC LIMIT 1`;
      if (latest[0]) {
        reports = await this.prisma.lessonReport.findMany({ where: { lessonId: latest[0].lesson_id }, select });
        current = false;
      }
    }
    const lessonIds = reports.map((r) => r.lessonId);
    const rows = lessonIds.length
      ? await this.prisma.lessonReportPractice.findMany({ where: { lessonId: { in: lessonIds }, withdrawnAt: null }, orderBy: [{ position: 'asc' }] })
      : [];
    const itemIds = [...new Set(rows.flatMap((r) => (r.itemId ? [r.itemId] : [])))];
    const items = itemIds.length ? await this.prisma.materialItem.findMany({ where: { id: { in: itemIds } } }) : [];
    const itemById = new Map(items.map((i) => [i.id, i]));
    const recited = await this.recitedSurahs(learner.organizationId);
    return {
      child: { id: learner.id, name: learner.name },
      current,
      windowDays: PRACTICE_WINDOW_DAYS,
      reports: reports.map((r) => ({
        lessonId: r.lessonId,
        submittedAt: r.submittedAt.toISOString(),
        lessonNumber: r.lessonNumber,
        nextTasks: r.nextTasks,
        homework: r.homework,
        practice: rows.filter((p) => p.lessonId === r.lessonId).map((p) => {
          if (p.kind === 'item') {
            const item = itemById.get(p.itemId as string);
            return item && item.status === 'published'
              ? { kind: 'item', item: itemDto(item) }
              : { kind: 'item', item: null };
          }
          const surah = surahOf(p.surah as number)!;
          return {
            kind: 'ayah_range',
            surah: surah.number, nameAr: surah.nameAr, nameEn: surah.nameEn,
            ayahFrom: p.ayahFrom, ayahTo: p.ayahTo, wholeSurah: p.ayahFrom === 1 && p.ayahTo === surah.ayahCount,
            hasRecitation: recited(surah.number),
          };
        }),
      })),
    };
  }

  /**
   * PD-29 amendment: the materials opened FOR this child during the academy's
   * current week (Saturday to Friday, academy time zone): each item once, with
   * its last opening and how many times, most recent first. Who: the same
   * standing as the library (read_materials) -- the family, the child's own
   * teacher, staff in PD-8 scope.
   */
  async opened(actorId: string, learnerId: string) {
    const { learner } = await this.child(actorId, learnerId, 'read_materials');
    const zone = await this.academyZone();
    const since = academyWeekStart(new Date(), zone);
    const rows = await this.prisma.$queryRaw<Array<{ item_id: string; last: Date; n: number }>>`
      SELECT item_id::text, max(opened_at) AS last, count(*)::int AS n
        FROM chat.material_open
       WHERE learner_id = ${learner.id}::uuid AND opened_at >= ${since}
       GROUP BY item_id
       ORDER BY last DESC
       LIMIT 200`;
    const items = rows.length ? await this.prisma.materialItem.findMany({ where: { id: { in: rows.map((r) => r.item_id) } } }) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return {
      child: { id: learner.id, name: learner.name },
      weekStartsAt: since.toISOString(),
      timeZone: zone,
      items: rows.flatMap((r) => {
        const item = byId.get(r.item_id);
        if (!item) return [];
        return [{ item: itemDto(item), available: item.status === 'published', lastOpenedAt: r.last.toISOString(), times: r.n }];
      }),
    };
  }

  // ------------------------------------------------------------------
  // Opening something to play
  // ------------------------------------------------------------------

  /**
   * The access decision for one item. Any active person of the item's
   * organization may open a published item (the library is open); the
   * library's managers may also open a draft or retired one to preview it.
   */
  async open(actorId: string, itemId: string, body: Record<string, unknown> = {}) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(itemId) || !actor.isActive || !actor.organizationId) throw notFound();
    const item = await this.prisma.materialItem.findFirst({ where: { id: itemId, organizationId: actor.organizationId } });
    if (!item) throw notFound();
    if (item.status !== 'published' && !(await this.admin.mayManage(actor))) throw notFound();
    if (actor.kind === ActorKind.CONTACT && !actor.familyId) throw notFound();
    // PD-29 amendment: opened FOR a child -- the viewer must be able to read
    // that child's page (the same rule as the library); recorded once it opens.
    let learner: { id: string; organizationId: string } | null = null;
    if (body.learnerId !== undefined && body.learnerId !== null) {
      if (typeof body.learnerId !== 'string') throw invalid('learnerId: a child id');
      learner = (await this.scheduling.learnerFor(actor, body.learnerId, 'read_materials')).learner;
      if (learner.organizationId !== item.organizationId) throw notFound();
    }
    const opened = await this.present(item, actor);
    if (learner) {
      await this.prisma.materialOpen.create({
        data: {
          organizationId: item.organizationId, learnerId: learner.id, itemId: item.id,
          openedBy: actor.actorId, openedByKind: actor.kind === ActorKind.CONTACT ? 'contact' : actor.kind === ActorKind.TEACHER ? 'teacher' : 'staff',
        },
      });
    }
    return opened;
  }

  /** What to play and how (`presentation`), for this viewer. */
  private async present(item: MaterialItem, actor: Actor) {

    if (item.source === 'site') {
      if (!this.config.siteBase) {
        throw new CommError(CommErrorCode.MATERIAL_UNAVAILABLE, 'the lessons site is not configured on this deployment', 409);
      }
      return { itemId: item.id, kind: item.kind, mode: 'link', presentation: 'frame-site', url: `${this.config.siteBase}${item.sitePath}` };
    }
    if (item.source === 'url') {
      return { itemId: item.id, kind: item.kind, mode: 'link', presentation: linkPresentation(item.url as string, this.config), url: item.url };
    }
    if (item.source === 'file') {
      const url = await this.storage.signedReadUrl(item.objectKey as string, FILE_URL_TTL_SECONDS);
      return {
        itemId: item.id, kind: item.kind, mode: 'file', presentation: 'file', url, mimeType: item.mimeType,
        expiresAt: new Date(Date.now() + FILE_URL_TTL_SECONDS * 1000).toISOString(),
      };
    }
    const token = this.playTokens.sign(item.id, item.objectKey as string, actor.actorId);
    const entry = (item.packageEntry as string).split('/').map(encodeURIComponent).join('/');
    return {
      itemId: item.id, kind: item.kind, mode: 'package', presentation: 'frame-isolated',
      url: `${apiBase()}/materials/play/${item.id}/${token}/${entry}`,
      expiresAt: new Date(Date.now() + PLAY_TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** A surah's recitation from the organization's default source: its own track, or the source's template. */
  async openRecitation(actorId: string, surahParam: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!actor.isActive || !actor.organizationId) throw notFound('recitation');
    if (actor.kind === ActorKind.CONTACT && !actor.familyId) throw notFound('recitation');
    const surah = /^\d{1,3}$/.test(surahParam) ? surahOf(Number(surahParam)) : null;
    if (!surah) throw notFound('surah');
    const source = await this.prisma.recitationSource.findFirst({ where: { organizationId: actor.organizationId, isDefault: true, isActive: true } });
    if (!source) throw notFound('recitation');
    const track = await this.prisma.recitationTrack.findUnique({ where: { sourceId_surah: { sourceId: source.id, surah: surah.number } } });
    let url: string | null = null;
    if (track?.url) url = track.url;
    else if (track?.objectKey) url = await this.storage.signedReadUrl(track.objectKey, FILE_URL_TTL_SECONDS);
    else if (source.urlTemplate) url = renderTemplate(source.urlTemplate, surah.number);
    if (!url) throw notFound('recitation');
    return { surah: surah.number, source: { name: source.name }, url };
  }

  // ------------------------------------------------------------------

  private async academyZone(): Promise<string> {
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    return canonicalZone(row?.value) ?? ACADEMY_ZONE;
  }

  private async child(actorId: string, learnerId: string, act: 'read_materials') {
    const actor = await this.conversations.requireActor(actorId);
    const { learner, standing } = await this.scheduling.learnerFor(actor, learnerId, act);
    return { actor, learner, standing };
  }

  private async ageOf(learnerId: string): Promise<number | null> {
    const e = await this.prisma.learnerEnrollment.findUnique({ where: { learnerId } });
    const now = new Date();
    // The same rule as the group details and the Student Profile (PD-15 / PD-16).
    return e?.birthDate ? ageOn(e.birthDate, now) : e?.statedAge && e.statedAgeOn ? e.statedAge + ageOn(e.statedAgeOn, now) : null;
  }

  /** Which surahs the organization's default recitation source covers. */
  private async recitedSurahs(organizationId: string): Promise<(surah: number) => boolean> {
    const source = await this.prisma.recitationSource.findFirst({ where: { organizationId, isDefault: true, isActive: true } });
    if (!source) return () => false;
    if (source.urlTemplate) return () => true;
    const tracks = await this.prisma.recitationTrack.findMany({ where: { sourceId: source.id }, select: { surah: true } });
    const set = new Set(tracks.map((t) => t.surah));
    return (n) => set.has(n);
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      const text = e instanceof Error ? e.message : String(e);
      if (/insufficient_privilege|42501/.test(text)) {
        throw new CommError(CommErrorCode.MATERIAL_DENIED, /message: "([^"]+)"/.exec(text)?.[1] ?? 'not permitted');
      }
      if (/23514|check_violation/i.test(text)) throw invalid(/message: "([^"]+)"/.exec(text)?.[1] ?? 'not allowed');
      throw e;
    }
  }
}

/** An item as a reader sees it: what it is, never where its bytes are. */
export function itemDto(i: MaterialItem) {
  return {
    id: i.id,
    titleAr: i.titleAr,
    titleEn: i.titleEn,
    subject: i.subject,
    strand: i.strand,
    kind: i.kind,
    mode: i.source === 'url' || i.source === 'site' ? 'link' : i.source,
    ageGroups: i.ageGroups,
    surah: i.surah,
    description: i.description,
  };
}

function viewerOf(standing: string, actor: Actor): 'family' | 'teacher' | 'staff' {
  if (standing === 'family' || actor.kind === ActorKind.CONTACT) return 'family';
  return standing === 'teacher' ? 'teacher' : 'staff';
}

/** `MEDIA_PUBLIC_BASE_URL` (absolute, ending in the API prefix) or this request's origin + /api/v1 -- as RT-037 links. */
function apiBase(): string {
  const configured = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const origin = currentRequestOrigin();
  return origin ? `${origin}/api/v1` : '/api/v1';
}
