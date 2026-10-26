import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { ActorKind } from '../communication/contracts/vocab';
import { isUuid } from '../communication/conversations/conversation.service';
import { surahOf } from './quran-surahs';
import { MARK_STATUSES, type MarkStatus } from './vocab';

export const MAX_PRACTICE = 10;
export const MAX_MARKS = 30;

export type PracticeInput =
  | { kind: 'ayah_range'; surah: number; ayahFrom: number; ayahTo: number }
  | { kind: 'item'; itemId: string };

export interface MarkInput {
  surah: number;
  status: MarkStatus;
}

/** What a report body says about Materials. An absent key means "unchanged" on an edit. */
export interface ReportMaterialsInput {
  practice?: PracticeInput[];
  memorization?: MarkInput[];
}

/** Practice as the report card carries it. */
export type CardPractice =
  | { kind: 'ayah_range'; surah: number; ayahFrom: number; ayahTo: number }
  | { kind: 'item'; itemId: string; title: string };

type Tx = Prisma.TransactionClient;

interface ReportLesson {
  id: string;
  organizationId: string;
  learnerId: string | null;
  teacherId: string;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.MATERIAL_INVALID, reason, 400);
}

/**
 * Parse the optional `practice` and `memorization` of a report body. Pure:
 * the shapes, the counts, the surahs and their ayah ranges. Whether a library
 * item exists and is published is `resolve`'s, inside the transaction.
 */
export function parseReportMaterials(body: Record<string, unknown>): ReportMaterialsInput {
  const out: ReportMaterialsInput = {};
  if ('practice' in body && body.practice !== undefined) {
    const v = body.practice ?? [];
    if (!Array.isArray(v) || v.length > MAX_PRACTICE) throw invalid(`practice: a list of at most ${MAX_PRACTICE}`);
    const seen = new Set<string>();
    out.practice = v.map((raw, i) => {
      if (!raw || typeof raw !== 'object') throw invalid(`practice[${i}]: {surah, ayahFrom, ayahTo} or {itemId}`);
      const r = raw as Record<string, unknown>;
      let p: PracticeInput;
      if (typeof r.itemId === 'string') {
        if (!isUuid(r.itemId)) throw invalid(`practice[${i}].itemId: a library item id`);
        p = { kind: 'item', itemId: r.itemId };
      } else {
        const surah = surahOf(Number(r.surah));
        if (!surah || typeof r.surah !== 'number') throw invalid(`practice[${i}].surah: 1 to 114`);
        const from = r.ayahFrom ?? 1;
        const to = r.ayahTo ?? surah.ayahCount;
        if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)
            || from < 1 || to < from || to > surah.ayahCount) {
          throw invalid(`practice[${i}]: ayahs 1 to ${surah.ayahCount} of surah ${surah.number}, from <= to`);
        }
        p = { kind: 'ayah_range', surah: surah.number, ayahFrom: from, ayahTo: to };
      }
      const key = JSON.stringify(p);
      if (seen.has(key)) throw invalid(`practice[${i}]: listed twice`);
      seen.add(key);
      return p;
    });
  }
  if ('memorization' in body && body.memorization !== undefined) {
    const v = body.memorization ?? [];
    if (!Array.isArray(v) || v.length > MAX_MARKS) throw invalid(`memorization: a list of at most ${MAX_MARKS}`);
    const seen = new Set<number>();
    out.memorization = v.map((raw, i) => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const surah = typeof r.surah === 'number' ? surahOf(r.surah) : null;
      if (!surah) throw invalid(`memorization[${i}].surah: 1 to 114`);
      if (typeof r.status !== 'string' || !(MARK_STATUSES as readonly string[]).includes(r.status)) {
        throw invalid(`memorization[${i}].status: one of ${MARK_STATUSES.join(', ')}`);
      }
      if (seen.has(surah.number)) throw invalid(`memorization[${i}]: surah ${surah.number} listed twice`);
      seen.add(surah.number);
      return { surah: surah.number, status: r.status as MarkStatus };
    });
  }
  return out;
}

export function hasMaterials(input: ReportMaterialsInput): boolean {
  return input.practice !== undefined || input.memorization !== undefined;
}

/**
 * PD-29: what a lesson report carries for Materials -- "practice this week"
 * (ayah ranges and library items) and surah statuses for the child's
 * memorization map -- written in the report's own transaction.
 *
 * Provided by LessonModule (the report's writers call it); it depends on
 * nothing but the database, so MaterialsModule can import LessonModule
 * without a cycle.
 *
 * The database is the floor: chat.lesson_report_practice accepts rows only
 * with the report or beside a recorded revision, and chat.memorization_mark is
 * append-only and accepts a teacher's mark only for their own student.
 */
@Injectable()
export class ReportMaterials {
  constructor(private readonly prisma: PrismaService) {}

  /** The practice as the card shows it; refuses an item that is not a published item of this organization. */
  async resolve(db: Tx | PrismaService, organizationId: string, input: ReportMaterialsInput): Promise<CardPractice[] | undefined> {
    if (input.practice === undefined) return undefined;
    const ids = input.practice.flatMap((p) => (p.kind === 'item' ? [p.itemId] : []));
    const items = ids.length
      ? await db.materialItem.findMany({
          where: { id: { in: ids }, organizationId, status: 'published' },
          select: { id: true, titleAr: true, titleEn: true },
        })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return input.practice.map((p, i) => {
      if (p.kind === 'ayah_range') return p;
      const item = byId.get(p.itemId);
      if (!item) throw new CommError(CommErrorCode.MATERIAL_NOT_FOUND, `practice[${i}]: no such published library item`);
      return { kind: 'item', itemId: p.itemId, title: (item.titleAr ?? item.titleEn) as string };
    });
  }

  /** Refuse Materials on a lesson that has no child (a trial) before anything is written. */
  assertApplies(lesson: ReportLesson, input: ReportMaterialsInput, actor: Actor) {
    if (!hasMaterials(input)) return;
    if (!lesson.learnerId) throw invalid('practice and memorization belong to a student\'s lesson, not a trial');
    if (input.memorization?.length && actor.kind !== ActorKind.TEACHER) {
      throw invalid('memorization: staff correct a child\'s map from the map itself, with a reason');
    }
  }

  /** With a new report: its practice rows and its marks. */
  async writeNew(tx: Tx, lesson: ReportLesson, actor: Actor, input: ReportMaterialsInput) {
    if (!lesson.learnerId) return;
    if (input.practice?.length) await this.insertPractice(tx, lesson, input.practice);
    if (input.memorization?.length) {
      await tx.memorizationMark.createMany({
        data: input.memorization.map((m) => this.mark(lesson, actor, m, 'report')),
      });
    }
  }

  /**
   * With an edited report (a revision already written in this transaction):
   * practice that changed is withdrawn and replaced; a surah whose status
   * differs from what this report last said gains a new `report_edit` mark.
   * Nothing is overwritten or removed.
   */
  async writeEdit(tx: Tx, lesson: ReportLesson, actor: Actor, input: ReportMaterialsInput) {
    if (!lesson.learnerId) return;
    if (input.practice !== undefined) {
      const live = await tx.lessonReportPractice.findMany({ where: { lessonId: lesson.id, withdrawnAt: null }, orderBy: { position: 'asc' } });
      const same = live.length === input.practice.length
        && live.every((row, i) => JSON.stringify(practiceOf(row)) === JSON.stringify(input.practice![i]));
      if (!same) {
        if (live.length) {
          await tx.lessonReportPractice.updateMany({ where: { lessonId: lesson.id, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
        }
        if (input.practice.length) await this.insertPractice(tx, lesson, input.practice);
      }
    }
    if (input.memorization?.length) {
      const previous = await tx.memorizationMark.findMany({
        where: { lessonId: lesson.id, surah: { in: input.memorization.map((m) => m.surah) } },
        orderBy: { seq: 'desc' },
      });
      const last = new Map<number, string>();
      for (const p of previous) if (!last.has(p.surah)) last.set(p.surah, p.status);
      const changed = input.memorization.filter((m) => last.get(m.surah) !== m.status);
      if (changed.length) {
        await tx.memorizationMark.createMany({ data: changed.map((m) => this.mark(lesson, actor, m, 'report_edit')) });
      }
    }
  }

  /** A report's live practice, as the card shows it. */
  async cardPractice(db: Tx | PrismaService, lessonId: string): Promise<CardPractice[]> {
    const rows = await db.lessonReportPractice.findMany({ where: { lessonId, withdrawnAt: null }, orderBy: { position: 'asc' } });
    const ids = rows.flatMap((r) => (r.itemId ? [r.itemId] : []));
    const items = ids.length ? await db.materialItem.findMany({ where: { id: { in: ids } }, select: { id: true, titleAr: true, titleEn: true } }) : [];
    const byId = new Map(items.map((i) => [i.id, (i.titleAr ?? i.titleEn) as string]));
    return rows.map((r) =>
      r.kind === 'item'
        ? { kind: 'item' as const, itemId: r.itemId as string, title: byId.get(r.itemId as string) ?? '' }
        : { kind: 'ayah_range' as const, surah: r.surah as number, ayahFrom: r.ayahFrom as number, ayahTo: r.ayahTo as number },
    );
  }

  private async insertPractice(tx: Tx, lesson: ReportLesson, practice: PracticeInput[]) {
    await tx.lessonReportPractice.createMany({
      data: practice.map((p, i) => ({
        organizationId: lesson.organizationId,
        lessonId: lesson.id,
        position: i + 1,
        kind: p.kind,
        ...(p.kind === 'item' ? { itemId: p.itemId } : { surah: p.surah, ayahFrom: p.ayahFrom, ayahTo: p.ayahTo }),
      })),
    });
  }

  private mark(lesson: ReportLesson, actor: Actor, m: MarkInput, source: 'report' | 'report_edit') {
    return {
      organizationId: lesson.organizationId,
      learnerId: lesson.learnerId as string,
      surah: m.surah,
      status: m.status,
      source,
      lessonId: lesson.id,
      byKind: 'teacher',
      byId: actor.actorId,
    };
  }
}

function practiceOf(row: { kind: string; surah: number | null; ayahFrom: number | null; ayahTo: number | null; itemId: string | null }): PracticeInput {
  return row.kind === 'item'
    ? { kind: 'item', itemId: row.itemId as string }
    : { kind: 'ayah_range', surah: row.surah as number, ayahFrom: row.ayahFrom as number, ayahTo: row.ayahTo as number };
}
