import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind, CardKind } from '../communication/contracts/vocab';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { CardPoster } from '../supervision/card-poster';
import { TeacherFileService } from './teacher-file.service';

const TEXT_MAX = 4000;
const TITLE_MAX = 200;
const GOAL_MAX = 1000;
const LABEL_MAX = 80;
const GOALS_MAX = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_STATUSES = ['open', 'met', 'missed', 'dropped'] as const;

const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, why, 400);
const notFound = () => new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'not found');

interface Criterion { id: string; label_en: string; label_ar: string; position: number; is_active: boolean }

/**
 * PD-35: teacher evaluations and improvement plans, on the Teacher File.
 *
 *   criteria     what an evaluation scores (1-5): the organization's rows, seven
 *                to start with (owner Q4). The Teachers Manager and the super
 *                admin add, rename, reorder and retire them; none is ever deleted.
 *   evaluation   a period, scores, notes, recommendations -- written by whoever
 *                works on the teacher (PD-35 scope; the Teachers department,
 *                with the switch off). Append-only: a correction supersedes.
 *   plan         goals with due dates; a goal's status is its latest update.
 *   share        the TEACHER reads an evaluation or a plan only once it is shared
 *                (owner Q4): a card in their supervision conversation, and
 *                GET me/evaluations. Never anything unshared, never another's.
 */
@Injectable()
export class TeacherEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly files: TeacherFileService,
    private readonly supervisionChats: SupervisionConversationService,
    private readonly cards: CardPoster,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Criteria
  // ------------------------------------------------------------------

  async criteria(actorId: string) {
    const { actor, access } = await this.files.gate(actorId, (a) => a.canView);
    return { canEdit: access.canEditPersonal, criteria: (await this.criteriaOf(actor.organizationId as string, true)).map(criterionDto) };
  }

  /** { labelEn, labelAr } -- the Teachers Manager's and the super admin's. */
  async addCriterion(actorId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canEditPersonal);
    const org = actor.organizationId as string;
    const labelEn = text(body.labelEn, 'labelEn', LABEL_MAX, true) as string;
    const labelAr = text(body.labelAr, 'labelAr', LABEL_MAX, true) as string;
    await this.prisma.$transaction(async (tx) => {
      const [{ next }] = await tx.$queryRaw<Array<{ next: number }>>`
        SELECT coalesce(max(position), 0) + 1 AS next FROM chat.evaluation_criterion WHERE organization_id = ${org}::uuid`;
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO chat.evaluation_criterion (organization_id, label_en, label_ar, position, updated_by)
        VALUES (${org}::uuid, ${labelEn}, ${labelAr}, ${Number(next)}::int, ${actor.actorId}::uuid) RETURNING id::text`;
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'evaluation_criterion.added', entity: 'evaluation_criterion', entityId: row.id,
        after: { labelEn, labelAr }, reason: 'evaluation criterion added',
      });
    });
    return this.criteria(actorId);
  }

  /** { labelEn?, labelAr?, position?, isActive? } */
  async updateCriterion(actorId: string, criterionId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canEditPersonal);
    const org = actor.organizationId as string;
    if (!isUuid(criterionId)) throw notFound();
    const current = (await this.criteriaOf(org, true)).find((c) => c.id === criterionId);
    if (!current) throw notFound();
    const labelEn = (text(body.labelEn, 'labelEn', LABEL_MAX, false) ?? current.label_en) as string;
    const labelAr = (text(body.labelAr, 'labelAr', LABEL_MAX, false) ?? current.label_ar) as string;
    const position = body.position === undefined ? current.position : body.position;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > 999) throw invalid('position: 0 to 999');
    const isActive = body.isActive === undefined ? current.is_active : body.isActive;
    if (typeof isActive !== 'boolean') throw invalid('isActive: true or false');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE chat.evaluation_criterion
           SET label_en = ${labelEn}, label_ar = ${labelAr}, position = ${position}::int, is_active = ${isActive},
               updated_by = ${actor.actorId}::uuid, updated_at = now()
         WHERE id = ${criterionId}::uuid`;
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'evaluation_criterion.changed', entity: 'evaluation_criterion', entityId: criterionId,
        before: criterionDto(current), after: { labelEn, labelAr, position, isActive }, reason: 'evaluation criterion changed',
      });
    });
    return this.criteria(actorId);
  }

  // ------------------------------------------------------------------
  // One teacher's evaluations and plans
  // ------------------------------------------------------------------

  async forTeacher(actorId: string, teacherId: string) {
    const { actor, access } = await this.files.gate(actorId, (a) => a.canView);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    return { canWrite: access.canWriteSupervision, ...(await this.records(teacher.organizationId, teacher.id, false)) };
  }

  /** { periodFrom, periodTo, scores: { criterionId: 1..5 }, notes?, recommendations?, supersedesId? } */
  async evaluate(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canWriteSupervision);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const periodFrom = day(body.periodFrom, 'periodFrom');
    const periodTo = day(body.periodTo, 'periodTo');
    if (periodTo < periodFrom) throw invalid('periodTo: on or after periodFrom');
    const active = new Set((await this.criteriaOf(teacher.organizationId, false)).map((c) => c.id));
    const scores = scoresOf(body.scores, active);
    const notes = text(body.notes, 'notes', TEXT_MAX, false);
    const recommendations = text(body.recommendations, 'recommendations', TEXT_MAX, false);
    const supersedesId = body.supersedesId === undefined || body.supersedesId === null ? null : body.supersedesId;
    if (supersedesId !== null && (typeof supersedesId !== 'string' || !isUuid(supersedesId))) throw invalid('supersedesId: a uuid');
    const id = await this.conflictAware(() =>
      this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO chat.teacher_evaluation (organization_id, teacher_id, period_from, period_to, scores, notes, recommendations, author_id, supersedes_id)
          VALUES (${teacher.organizationId}::uuid, ${teacher.id}::uuid, ${periodFrom}::date, ${periodTo}::date, ${JSON.stringify(scores)}::jsonb,
                  ${notes}, ${recommendations}, ${actor.actorId}::uuid, ${supersedesId}::uuid)
          RETURNING id::text`;
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'teacher_evaluation.recorded', entity: 'teacher', entityId: teacher.id,
          after: { evaluationId: row.id, periodFrom, periodTo, supersedesId }, reason: 'teacher evaluation recorded',
        });
        return row.id;
      }),
    );
    return { evaluationId: id, ...(await this.records(teacher.organizationId, teacher.id, false)) };
  }

  /** The teacher may now read it: a card in their supervision conversation. Once. */
  async shareEvaluation(actorId: string, evaluationId: string) {
    const { actor } = await this.files.gate(actorId, (a) => a.canWriteSupervision);
    if (!isUuid(evaluationId)) throw notFound();
    const [e] = await this.prisma.$queryRaw<Array<{ teacher_id: string; period_from: Date; period_to: Date; scores: Record<string, number>; recommendations: string | null; shared: boolean }>>`
      SELECT e.teacher_id::text, e.period_from, e.period_to, e.scores, e.recommendations,
             EXISTS (SELECT 1 FROM chat.teacher_evaluation_share s WHERE s.evaluation_id = e.id) AS shared
        FROM chat.teacher_evaluation e WHERE e.id = ${evaluationId}::uuid AND e.organization_id = ${actor.organizationId}::uuid`;
    if (!e) throw notFound();
    const teacher = await this.files.requireTeacher(actor, e.teacher_id);
    if (e.shared) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this evaluation is already shared', 409);
    const criteria = new Map((await this.criteriaOf(teacher.organizationId, true)).map((c) => [c.id, c]));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO chat.teacher_evaluation_share (evaluation_id, shared_by) VALUES (${evaluationId}::uuid, ${actor.actorId}::uuid)`;
      const lang = await this.languageOf(teacher.id);
      const payload = {
        evaluationId,
        periodFrom: isoDay(e.period_from),
        periodTo: isoDay(e.period_to),
        scores: Object.entries(e.scores).map(([id, score]) => ({
          criterion: lang === 'ar' ? criteria.get(id)?.label_ar ?? '' : criteria.get(id)?.label_en ?? '',
          score,
        })),
        recommendations: e.recommendations,
      };
      const conv = await this.supervisionChats.ensureInTx(tx, teacher.id, teacher.organizationId, actor.actorId);
      await this.cards.post(tx, conv, actor, { kind: CardKind.EVALUATION_SHARED, payload, body: renderEvaluationCard(payload, lang) });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'teacher_evaluation.shared', entity: 'teacher', entityId: teacher.id,
        after: { evaluationId }, reason: 'evaluation shared with the teacher',
      });
    });
    return this.records(teacher.organizationId, teacher.id, false);
  }

  /** { title, evaluationId?, goals: [{ body, dueOn? }] } */
  async plan(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canWriteSupervision);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const title = text(body.title, 'title', TITLE_MAX, true) as string;
    const evaluationId = body.evaluationId === undefined || body.evaluationId === null ? null : body.evaluationId;
    if (evaluationId !== null && (typeof evaluationId !== 'string' || !isUuid(evaluationId))) throw invalid('evaluationId: a uuid');
    if (!Array.isArray(body.goals) || body.goals.length === 0 || body.goals.length > GOALS_MAX) throw invalid(`goals: 1 to ${GOALS_MAX}`);
    const goals = body.goals.map((g, i) => {
      const o = (g ?? {}) as Record<string, unknown>;
      return {
        body: text(o.body, `goals[${i}].body`, GOAL_MAX, true) as string,
        dueOn: o.dueOn === undefined || o.dueOn === null || o.dueOn === '' ? null : day(o.dueOn, `goals[${i}].dueOn`),
      };
    });
    const planId = await this.conflictAware(() =>
      this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO chat.teacher_improvement_plan (organization_id, teacher_id, evaluation_id, title, author_id)
          VALUES (${teacher.organizationId}::uuid, ${teacher.id}::uuid, ${evaluationId}::uuid, ${title}, ${actor.actorId}::uuid)
          RETURNING id::text`;
        for (const [i, g] of goals.entries()) {
          await tx.$executeRaw`
            INSERT INTO chat.teacher_improvement_goal (plan_id, position, body, due_on)
            VALUES (${row.id}::uuid, ${i + 1}::int, ${g.body}, ${g.dueOn}::date)`;
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'improvement_plan.created', entity: 'teacher', entityId: teacher.id,
          after: { planId: row.id, goals: goals.length }, reason: 'improvement plan created',
        });
        return row.id;
      }),
    );
    return { planId, ...(await this.records(teacher.organizationId, teacher.id, false)) };
  }

  async sharePlan(actorId: string, planId: string) {
    const { actor } = await this.files.gate(actorId, (a) => a.canWriteSupervision);
    if (!isUuid(planId)) throw notFound();
    const [p] = await this.prisma.$queryRaw<Array<{ teacher_id: string; title: string; shared: boolean }>>`
      SELECT p.teacher_id::text, p.title,
             EXISTS (SELECT 1 FROM chat.teacher_improvement_plan_share s WHERE s.plan_id = p.id) AS shared
        FROM chat.teacher_improvement_plan p WHERE p.id = ${planId}::uuid AND p.organization_id = ${actor.organizationId}::uuid`;
    if (!p) throw notFound();
    const teacher = await this.files.requireTeacher(actor, p.teacher_id);
    if (p.shared) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this plan is already shared', 409);
    const goals = await this.prisma.$queryRaw<Array<{ body: string; due_on: Date | null }>>`
      SELECT body, due_on FROM chat.teacher_improvement_goal WHERE plan_id = ${planId}::uuid ORDER BY position`;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO chat.teacher_improvement_plan_share (plan_id, shared_by) VALUES (${planId}::uuid, ${actor.actorId}::uuid)`;
      const lang = await this.languageOf(teacher.id);
      const payload = { planId, title: p.title, goals: goals.map((g) => ({ body: g.body, dueOn: g.due_on ? isoDay(g.due_on) : null })) };
      const conv = await this.supervisionChats.ensureInTx(tx, teacher.id, teacher.organizationId, actor.actorId);
      await this.cards.post(tx, conv, actor, { kind: CardKind.IMPROVEMENT_PLAN_SHARED, payload, body: renderPlanCard(payload, lang) });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'improvement_plan.shared', entity: 'teacher', entityId: teacher.id,
        after: { planId }, reason: 'improvement plan shared with the teacher',
      });
    });
    return this.records(teacher.organizationId, teacher.id, false);
  }

  /** { status: open | met | missed | dropped, note? } */
  async goalStatus(actorId: string, goalId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canWriteSupervision);
    if (!isUuid(goalId)) throw notFound();
    const [g] = await this.prisma.$queryRaw<Array<{ teacher_id: string }>>`
      SELECT p.teacher_id::text FROM chat.teacher_improvement_goal g
        JOIN chat.teacher_improvement_plan p ON p.id = g.plan_id
       WHERE g.id = ${goalId}::uuid AND p.organization_id = ${actor.organizationId}::uuid`;
    if (!g) throw notFound();
    const teacher = await this.files.requireTeacher(actor, g.teacher_id);
    const status = body.status;
    if (typeof status !== 'string' || !(GOAL_STATUSES as readonly string[]).includes(status)) {
      throw invalid(`status: ${GOAL_STATUSES.join(' | ')}`);
    }
    const note = text(body.note, 'note', GOAL_MAX, false);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO chat.teacher_improvement_goal_update (goal_id, status, note, by_id)
        VALUES (${goalId}::uuid, ${status}, ${note}, ${actor.actorId}::uuid)`;
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'improvement_goal.status', entity: 'teacher', entityId: teacher.id,
        after: { goalId, status }, reason: note ?? `goal ${status}`,
      });
    });
    return this.records(teacher.organizationId, teacher.id, false);
  }

  /** The teacher's own: what was shared with them, and nothing else. */
  async mine(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.TEACHER_FILE_DENIED, 'a teacher\'s own evaluations');
    }
    return this.records(actor.organizationId, actor.actorId, true);
  }

  // ------------------------------------------------------------------

  private async records(organizationId: string, teacherId: string, sharedOnly: boolean) {
    const [criteria, evaluations, plans, goals] = await Promise.all([
      this.criteriaOf(organizationId, true),
      this.prisma.$queryRaw<Array<{ id: string; period_from: Date; period_to: Date; scores: Record<string, number>; notes: string | null; recommendations: string | null; author_id: string; author_name: string; created_at: Date; supersedes_id: string | null; superseded: boolean; shared_at: Date | null }>>`
        SELECT e.id::text, e.period_from, e.period_to, e.scores, e.notes, e.recommendations,
               e.author_id::text, s.name AS author_name, e.created_at, e.supersedes_id::text,
               EXISTS (SELECT 1 FROM chat.teacher_evaluation n WHERE n.supersedes_id = e.id) AS superseded,
               sh.shared_at
          FROM chat.teacher_evaluation e
          JOIN chat.staff s ON s.id = e.author_id
          LEFT JOIN chat.teacher_evaluation_share sh ON sh.evaluation_id = e.id
         WHERE e.teacher_id = ${teacherId}::uuid AND (NOT ${sharedOnly} OR sh.shared_at IS NOT NULL)
         ORDER BY e.created_at DESC
         LIMIT 100`,
      this.prisma.$queryRaw<Array<{ id: string; title: string; evaluation_id: string | null; author_name: string; created_at: Date; shared_at: Date | null }>>`
        SELECT p.id::text, p.title, p.evaluation_id::text, s.name AS author_name, p.created_at, sh.shared_at
          FROM chat.teacher_improvement_plan p
          JOIN chat.staff s ON s.id = p.author_id
          LEFT JOIN chat.teacher_improvement_plan_share sh ON sh.plan_id = p.id
         WHERE p.teacher_id = ${teacherId}::uuid AND (NOT ${sharedOnly} OR sh.shared_at IS NOT NULL)
         ORDER BY p.created_at DESC
         LIMIT 100`,
      this.prisma.$queryRaw<Array<{ id: string; plan_id: string; position: number; body: string; due_on: Date | null; status: string | null; note: string | null; at: Date | null }>>`
        SELECT g.id::text, g.plan_id::text, g.position, g.body, g.due_on, u.status, u.note, u.at
          FROM chat.teacher_improvement_goal g
          JOIN chat.teacher_improvement_plan p ON p.id = g.plan_id
          LEFT JOIN LATERAL (SELECT x.status, x.note, x.at FROM chat.teacher_improvement_goal_update x
                              WHERE x.goal_id = g.id ORDER BY x.at DESC, x.id DESC LIMIT 1) u ON true
         WHERE p.teacher_id = ${teacherId}::uuid
         ORDER BY g.plan_id, g.position`,
    ]);
    const label = new Map(criteria.map((c) => [c.id, c]));
    return {
      criteria: criteria.map(criterionDto),
      evaluations: evaluations.map((e) => ({
        id: e.id,
        periodFrom: isoDay(e.period_from),
        periodTo: isoDay(e.period_to),
        scores: Object.entries(e.scores).map(([criterionId, score]) => ({
          criterionId,
          labelEn: label.get(criterionId)?.label_en ?? '',
          labelAr: label.get(criterionId)?.label_ar ?? '',
          score,
        })),
        notes: sharedOnly ? null : e.notes,
        recommendations: e.recommendations,
        author: { id: e.author_id, name: e.author_name },
        createdAt: e.created_at.toISOString(),
        supersedesId: e.supersedes_id,
        superseded: e.superseded,
        sharedAt: e.shared_at?.toISOString() ?? null,
      })),
      plans: plans.map((p) => ({
        id: p.id,
        title: p.title,
        evaluationId: p.evaluation_id,
        author: { name: p.author_name },
        createdAt: p.created_at.toISOString(),
        sharedAt: p.shared_at?.toISOString() ?? null,
        goals: goals.filter((g) => g.plan_id === p.id).map((g) => ({
          id: g.id,
          position: g.position,
          body: g.body,
          dueOn: g.due_on ? isoDay(g.due_on) : null,
          status: g.status ?? 'open',
          note: g.note,
          updatedAt: g.at?.toISOString() ?? null,
        })),
      })),
    };
  }

  private async criteriaOf(organizationId: string, all: boolean): Promise<Criterion[]> {
    await this.prisma.$executeRaw`SELECT chat.ensure_evaluation_criteria(${organizationId}::uuid)`;
    return this.prisma.$queryRaw<Criterion[]>`
      SELECT id::text, label_en, label_ar, position, is_active FROM chat.evaluation_criterion
       WHERE organization_id = ${organizationId}::uuid AND (${all} OR is_active)
       ORDER BY position, label_en`;
  }

  private async languageOf(teacherId: string): Promise<'ar' | 'en'> {
    const teacher: Actor = await this.conversations.requireActor(teacherId);
    return teacher.locale === 'en' ? 'en' : 'ar';
  }

  private async conflictAware<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const known = /(an evaluation scores the organization's active criteria|a score is a whole number from 1 to 5|an evaluation supersedes one of the same teacher|a plan follows an evaluation of the same teacher)/.exec(msg);
      if (known) throw invalid(known[1]);
      if (/teacher_evaluation_supersedes_id_key/.test(msg)) {
        throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this evaluation is already superseded', 409);
      }
      throw e;
    }
  }
}

function criterionDto(c: Criterion) {
  return { id: c.id, labelEn: c.label_en, labelAr: c.label_ar, position: c.position, isActive: c.is_active };
}

function text(v: unknown, name: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) throw invalid(`${name}: required`);
    return null;
  }
  if (typeof v !== 'string') throw invalid(`${name}: text`);
  const t = v.trim();
  if (t.length > max) throw invalid(`${name}: at most ${max} characters`);
  return t;
}

function day(v: unknown, name: string): string {
  if (typeof v !== 'string' || !DAY_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw invalid(`${name}: a date as YYYY-MM-DD`);
  return v;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function scoresOf(v: unknown, active: ReadonlySet<string>): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid('scores: { criterionId: 1..5 }');
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
    if (!active.has(k)) throw invalid('scores: an active criterion of this organization');
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 5) throw invalid('scores: a whole number from 1 to 5');
    out[k] = s;
  }
  if (Object.keys(out).length === 0) throw invalid('scores: at least one criterion');
  return out;
}

/** The evaluation card's plain-text body, in the teacher's language. */
export function renderEvaluationCard(
  p: { periodFrom: string; periodTo: string; scores: Array<{ criterion: string; score: number }>; recommendations: string | null },
  lang: 'ar' | 'en',
): string {
  const ar = lang === 'ar';
  return [
    ar ? `📋 تقييمك — ${p.periodFrom} → ${p.periodTo}` : `📋 Your evaluation — ${p.periodFrom} → ${p.periodTo}`,
    ...p.scores.map((s) => `• ${s.criterion}: ${s.score}/5`),
    ...(p.recommendations ? [ar ? `التوصيات: ${p.recommendations}` : `Recommendations: ${p.recommendations}`] : []),
  ].join('\n');
}

/** The improvement plan card's plain-text body, in the teacher's language. */
export function renderPlanCard(p: { title: string; goals: Array<{ body: string; dueOn: string | null }> }, lang: 'ar' | 'en'): string {
  const ar = lang === 'ar';
  return [
    ar ? `🎯 خطة تحسين — ${p.title}` : `🎯 Improvement plan — ${p.title}`,
    ...p.goals.map((g, i) => `${i + 1}. ${g.body}${g.dueOn ? (ar ? ` (حتى ${g.dueOn})` : ` (by ${g.dueOn})`) : ''}`),
  ].join('\n');
}
