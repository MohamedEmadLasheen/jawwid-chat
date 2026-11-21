import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { ACADEMY_ZONE, canonicalZone, localDate } from '../platform/time-zone';
import { isUuid } from '../communication/conversations/conversation.service';
import { contactKeyHash, normaliseEmailForKey } from '../new-students/contact-key';
import { e164ForKey } from '../new-students/intake-input';
import { familyChannelSlots, fillFamilyChannels } from '../parent-profile/parent-record.service';
import {
  LeadInputError,
  NO_CONTACT,
  STAGES,
  canConvert,
  checkMarkContacted,
  checkTransition,
  contactFieldNames,
  decideConversion,
  decideLeadAccess,
  deriveStage,
  followUpDue,
  isStage,
  matchesFilter,
  planChannelMerge,
  optDay,
  optText,
  pageOf,
  parseContact,
  reqText,
  type ChannelKind,
  type ContactDto,
  type ContactPresence,
  type DerivedStage,
  type LeadFilter,
  type LeadStanding,
  type ParsedContact,
  type Stage,
  type StoredStage,
  type TransitionVerdict,
  type TrialFact,
} from './pipeline-stage';

type Tx = Prisma.TransactionClient;

interface KeyedChannel {
  value: string;
  hash: string;
}

/** A lead's channels, keyed. `hashes` is every distinct key, for the family lookup. */
interface LeadKeys {
  email: KeyedChannel | null;
  phone: KeyedChannel | null;
  whatsapp: KeyedChannel | null;
  hashes: string[];
}

/** The pipeline reads at most this many prospects of an academy to build a page (stages are derived, so the page is cut after). */
export const PIPELINE_SCAN_LIMIT = 5000;

const denied = () => new CommError(CommErrorCode.SALES_LEAD_DENIED, 'the Sales pipeline is for the Sales department and the super admin', 403);
const notFound = () => new CommError(CommErrorCode.SALES_LEAD_NOT_FOUND, 'no such lead', 404);
const invalid = (why: string) => new CommError(CommErrorCode.SALES_LEAD_INVALID, why, 400);
const stateError = (why: string) => new CommError(CommErrorCode.SALES_LEAD_STATE, why, 409);
/** The intake's own wording for "this parent is already here and not yours": it says nothing about the family. */
const unavailable = () => new CommError(CommErrorCode.PARENT_EXISTS, 'this e-mail or number cannot be used here; ask your manager', 409);

/** Run a validator; its LeadInputError becomes a 400 that names the field, never a value. */
function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof LeadInputError) throw invalid(e.message);
    throw e;
  }
}

function verdictError(v: Extract<TransitionVerdict, { ok: false }>): CommError {
  switch (v.code) {
    case 'stage_derived': return stateError('a trial or the hand-over decides this lead\'s stage; it is not moved by hand');
    case 'not_allowed': return stateError('this stage change is not allowed from the lead\'s current stage');
    case 'lost_reason_required': return invalid('lostReason: required to mark a lead lost');
    default: return invalid('lostReason: not a known reason');
  }
}

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const dayDate = (s: string | null | undefined): Date | null | undefined => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));

interface Caller {
  staffId: string;
  organizationId: string;
  standing: LeadStanding;
}

interface Facts {
  id: string;
  displayName: string;
  level: string | null;
  note: string | null;
  createdAt: Date;
  pipelineStage: StoredStage | null;
  lostReason: string | null;
  lastContactedAt: Date | null;
  nextFollowUpOn: string | null;
  followUpNote: string | null;
  convertedAt: Date | null;
  convertedFamilyId: string | null;
  trials: TrialFact[];
  trialLessonIds: string[];
}

/**
 * PD-59: the Sales pipeline.
 *
 * A lead is a chat.trial_prospect. Its stage is derived on every read
 * (pipeline-stage.ts); only New Lead, Contacted and Lost-before-a-trial are
 * stored. The prospective parent's contact is CONFINED (G-07): this is the ONLY
 * source that names chat.sales_lead_contact (sales-pipeline-confinement.spec.ts),
 * and it is read and written only here.
 *
 *  - WHO: decided on the server for every call, before any lookup
 *    (decideLeadAccess): the super admin and staff in the Sales department.
 *  - LIST rows never carry a value of the contact -- only whether a channel
 *    exists. The DETAIL read returns it and is audited, in the same transaction
 *    as the read (sales_lead.contact_viewed).
 *  - Every change is audited by field NAME; no value of the contact reaches an
 *    audit row, a log line or an error message.
 *  - CONVERT never creates a second parent: the lead's keyed e-mail / phones are
 *    matched against the families already in Chat (PD-42's contact key).
 */
@Injectable()
export class SalesPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Who
  // ------------------------------------------------------------------

  /** The caller's standing, or a refusal. Staff only; the answer comes from the database, never the token. */
  async caller(actorId: string): Promise<Caller> {
    if (!isUuid(actorId)) throw denied();
    const [row] = await this.prisma.$queryRaw<Array<{ organization_id: string; role: string; is_active: boolean; left: boolean; sales: string | null }>>`
      SELECT s.organization_id::text AS organization_id, s.role, s.is_active, (s.left_at IS NOT NULL) AS left,
             chat.sales_department_role(s.id) AS sales
        FROM chat.staff s
       WHERE s.id = ${actorId}::uuid`;
    const standing = decideLeadAccess({
      isStaff: !!row,
      isActive: row?.is_active === true,
      left: row?.left === true,
      role: row?.role ?? null,
      salesRole: row?.sales === 'manager' || row?.sales === 'member' ? row.sales : null,
    });
    if (!row || !standing) throw denied();
    return { staffId: actorId, organizationId: row.organization_id, standing };
  }

  /** What the page may offer: advisory (the server decides each call again). */
  async access(actorId: string) {
    try {
      const c = await this.caller(actorId);
      return { allowed: true, standing: c.standing };
    } catch {
      return { allowed: false, standing: null };
    }
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  /**
   * The pipeline: leads with their derived stage, filtered by ?stage, ?q (a
   * name), ?followUp=due, paged (?limit, ?offset). `counts` is every stage's
   * total over the whole academy (the board's column heads). No contact value.
   */
  async list(actorId: string, query: { stage?: string; q?: string; followUp?: string; limit?: string; offset?: string }) {
    const c = await this.caller(actorId);
    const filter: LeadFilter = parsed(() => {
      if (query.stage !== undefined && query.stage !== '' && !isStage(query.stage)) throw new LeadInputError('stage: a known stage');
      if (query.followUp !== undefined && query.followUp !== '' && query.followUp !== 'due') throw new LeadInputError('followUp: due');
      const q = optText(query.q, 'q', 120);
      // The search is a query string (it reaches request logs): a name only, never a number or an e-mail.
      if (q && (/\d{4,}/.test(q.replace(/[\s().+-]/g, '')) || q.includes('@'))) throw new LeadInputError('q: search by name only');
      return {
        stage: query.stage ? (query.stage as Stage) : null,
        q: q ?? null,
        followUp: query.followUp === 'due' ? 'due' : null,
      };
    });
    const page = parsed(() => pageOf(query.limit, query.offset));
    const today = await this.today();
    const now = new Date();

    const prospects = await this.prisma.trialProspect.findMany({
      where: { organizationId: c.organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: PIPELINE_SCAN_LIMIT,
      select: {
        id: true, displayName: true, level: true, createdAt: true,
        pipelineStage: true, lostReason: true, lastContactedAt: true, nextFollowUpOn: true, followUpNote: true,
        convertedAt: true, convertedFamilyId: true,
        lessons: {
          where: { kind: 'trial' },
          select: { id: true, startsAt: true, outcome: true, trialOutcome: { select: { result: true, reasonCode: true } } },
        },
      },
    });
    const presence = await this.presence(c.organizationId);
    const lessonIds = prospects.flatMap((p) => p.lessons.map((l) => l.id));
    const enrolled = new Set(
      lessonIds.length === 0
        ? []
        : (await this.prisma.studentEnrolment.findMany({ where: { lessonId: { in: lessonIds } }, select: { lessonId: true } })).map((e) => e.lessonId),
    );

    const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    let dueCount = 0;
    const rows = prospects.map((p) => {
      const derived = deriveStage({
        pipelineStage: asStored(p.pipelineStage), lostReason: p.lostReason, convertedAt: p.convertedAt, now,
        trials: p.lessons.map(trialFact),
      });
      counts[derived.stage] += 1;
      const nextFollowUpOn = day(p.nextFollowUpOn);
      const due = followUpDue({ stage: derived.stage, nextFollowUpOn }, today);
      if (due) dueCount += 1;
      return {
        id: p.id,
        displayName: p.displayName,
        level: p.level,
        stage: derived.stage,
        lostReason: derived.lostReason,
        manualStage: derived.manual,
        lastContactedAt: p.lastContactedAt?.toISOString() ?? null,
        nextFollowUpOn,
        followUpDue: due,
        followUpNote: p.followUpNote,
        createdAt: p.createdAt.toISOString(),
        handedOver: p.convertedAt !== null || p.lessons.some((l) => enrolled.has(l.id)),
        contact: presence.get(p.id) ?? NO_CONTACT,
      };
    });
    const matched = rows.filter((r) => matchesFilter(r, filter, today));
    return {
      leads: matched.slice(page.offset, page.offset + page.limit),
      total: matched.length,
      counts,
      dueCount,
      limit: page.limit,
      offset: page.offset,
      truncated: prospects.length === PIPELINE_SCAN_LIMIT,
    };
  }

  /** One lead with its contact. The read of the contact is audited, in the same transaction. */
  async get(actorId: string, leadId: string) {
    const c = await this.caller(actorId);
    this.requireId(leadId);
    return this.prisma.$transaction((tx) => this.readIn(tx, c, leadId, true));
  }

  /**
   * The lead as the page shows it. `viewed` is a genuine detail read: it writes the audit row for the
   * contact it returns. A write returns the lead too, without a second "view" row: the write is itself
   * audited, and the caller just typed what comes back.
   */
  private async readIn(tx: Tx, c: Caller, leadId: string, viewed: boolean) {
    const f = await this.facts(tx, c, leadId);
    const derived = this.derive(f, new Date());
    const contact = await this.contactOf(tx, leadId);
    if (contact && viewed) {
      await this.audit.audit(tx, {
        actorId: c.staffId, action: 'sales_lead.contact_viewed', entity: 'trial_prospect', entityId: leadId,
        after: { fields: ['parentName', 'phone', 'whatsapp', 'email'].filter((k) => contact[k as keyof ContactDto]) },
        reason: 'a lead\'s contact details were read (PD-59)',
      });
    }
    return this.detail(f, derived, contact, await this.today());
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  /** { displayName, level?, note?, contact?: {parentName, phone?, whatsapp?, email?, country?}, nextFollowUpOn?, followUpNote? } */
  async create(actorId: string, body: Record<string, unknown>) {
    const c = await this.caller(actorId);
    const input = parsed(() => {
      const displayName = reqText(body.displayName, 'displayName', 120);
      const level = optText(body.level, 'level', 80) ?? null;
      const note = optText(body.note, 'note', 1000) ?? null;
      const nextFollowUpOn = optDay(body.nextFollowUpOn, 'nextFollowUpOn') ?? null;
      const followUpNote = optText(body.followUpNote, 'followUpNote', 1000) ?? null;
      const contact = body.contact === undefined || body.contact === null ? null : parseContact(body.contact);
      if (contact) mergeContact(null, contact);
      return { displayName, level, note, nextFollowUpOn, followUpNote, contact };
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.trialProspect.create({
        data: {
          organizationId: c.organizationId, displayName: input.displayName, level: input.level, note: input.note, createdBy: c.staffId,
          pipelineStage: 'new_lead', nextFollowUpOn: dayDate(input.nextFollowUpOn) ?? null, followUpNote: input.followUpNote,
        },
      });
      // A booking reads its students from here (as TrialService.createProspect writes it).
      await tx.trialStudent.create({
        data: { prospectId: p.id, organizationId: p.organizationId, position: 1, displayName: input.displayName, level: input.level, note: input.note },
      });
      if (input.contact) {
        const merged = mergeContact(null, input.contact);
        await tx.salesLeadContact.create({
          data: {
            prospectId: p.id, organizationId: c.organizationId, parentName: merged.parentName, confinedLeadPhone: merged.phone,
            confinedLeadWhatsapp: merged.whatsapp, confinedLeadEmail: merged.email, countryCode: merged.country, createdBy: c.staffId,
          },
        });
      }
      await this.audit.audit(tx, {
        actorId: c.staffId, action: 'sales_lead.created', entity: 'trial_prospect', entityId: p.id,
        after: { displayName: input.displayName, stage: 'new_lead', contact: input.contact ? contactFieldNames(input.contact) : [] },
        reason: 'lead recorded (PD-59)',
      });
      return this.readIn(tx, c, p.id, false);
    });
    return created;
  }

  /**
   * { stage?, lostReason?, contact?, nextFollowUpOn?, followUpNote? } -- the stage only by the
   * rules of checkTransition; the contact as a patch (a field left out stays, null clears).
   */
  async update(actorId: string, leadId: string, body: Record<string, unknown>) {
    const c = await this.caller(actorId);
    this.requireId(leadId);
    const input = parsed(() => {
      const stage = body.stage === undefined ? undefined : body.stage;
      if (stage !== undefined && (typeof stage !== 'string' || !['new_lead', 'contacted', 'lost'].includes(stage))) {
        throw new LeadInputError('stage: new_lead, contacted or lost (the others are derived)');
      }
      const lostReason = optText(body.lostReason, 'lostReason', 40);
      const nextFollowUpOn = optDay(body.nextFollowUpOn, 'nextFollowUpOn');
      const followUpNote = optText(body.followUpNote, 'followUpNote', 1000);
      const contact = body.contact === undefined ? undefined : parseContact(body.contact);
      return { stage: stage as StoredStage | undefined, lostReason: lostReason ?? null, nextFollowUpOn, followUpNote, contact };
    });
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lockedFacts(tx, c, leadId);
      const derived = this.derive(f, now);
      const data: Prisma.TrialProspectUpdateInput = {};
      const changed: string[] = [];
      let moved: { from: Stage; to: Stage } | null = null;

      if (input.stage !== undefined) {
        const v = checkTransition(derived, { to: input.stage, lostReason: input.lostReason });
        if (!v.ok) throw verdictError(v);
        if (v.next.pipelineStage !== f.pipelineStage || v.next.lostReason !== f.lostReason || derived.stage !== v.next.pipelineStage) {
          data.pipelineStage = v.next.pipelineStage;
          data.lostReason = v.next.lostReason;
          moved = { from: derived.stage, to: v.next.pipelineStage };
        }
      }
      if (input.nextFollowUpOn !== undefined) { data.nextFollowUpOn = dayDate(input.nextFollowUpOn); changed.push('nextFollowUpOn'); }
      if (input.followUpNote !== undefined) { data.followUpNote = input.followUpNote; changed.push('followUpNote'); }
      if (Object.keys(data).length > 0) await tx.trialProspect.update({ where: { id: leadId }, data });

      let contactFields: string[] = [];
      if (input.contact) contactFields = await this.writeContact(tx, c, f, input.contact);

      if (moved) {
        await this.audit.audit(tx, {
          actorId: c.staffId, action: 'sales_lead.stage_changed', entity: 'trial_prospect', entityId: leadId,
          before: { stage: moved.from }, after: { stage: moved.to, ...(moved.to === 'lost' ? { lostReason: input.lostReason } : {}) },
          reason: 'lead stage changed by hand (PD-59)',
        });
      }
      if (changed.length > 0) {
        await this.audit.audit(tx, {
          actorId: c.staffId, action: 'sales_lead.follow_up_changed', entity: 'trial_prospect', entityId: leadId,
          after: { fields: changed }, reason: 'lead follow-up changed (PD-59)',
        });
      }
      if (contactFields.length > 0) {
        await this.audit.audit(tx, {
          actorId: c.staffId, action: 'sales_lead.contact_updated', entity: 'trial_prospect', entityId: leadId,
          after: { fields: contactFields }, reason: 'lead contact details changed (PD-59)',
        });
      }
      return this.readIn(tx, c, leadId, false);
    });
  }

  /** { nextFollowUpOn?, followUpNote? } -- the lead was contacted now. */
  async markContacted(actorId: string, leadId: string, body: Record<string, unknown>) {
    const c = await this.caller(actorId);
    this.requireId(leadId);
    const input = parsed(() => ({
      nextFollowUpOn: optDay(body.nextFollowUpOn, 'nextFollowUpOn'),
      followUpNote: optText(body.followUpNote, 'followUpNote', 1000),
    }));
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lockedFacts(tx, c, leadId);
      const derived = this.derive(f, now);
      // A lead a trial or the hand-over decides can still be CONTACTED (a call before the trial): only the time moves.
      let next: { pipelineStage: StoredStage; lostReason: string | null } | null = null;
      if (derived.manual) {
        const v = checkMarkContacted(derived);
        if (!v.ok) throw verdictError(v);
        next = v.next;
      } else if (derived.stage === 'converted') {
        throw stateError('this lead is already converted');
      }
      await tx.trialProspect.update({
        where: { id: leadId },
        data: {
          lastContactedAt: now,
          ...(next ? { pipelineStage: next.pipelineStage, lostReason: next.lostReason } : {}),
          ...(input.nextFollowUpOn !== undefined ? { nextFollowUpOn: dayDate(input.nextFollowUpOn) } : {}),
          ...(input.followUpNote !== undefined ? { followUpNote: input.followUpNote } : {}),
        },
      });
      await this.audit.audit(tx, {
        actorId: c.staffId, action: 'sales_lead.contacted', entity: 'trial_prospect', entityId: leadId,
        before: { stage: derived.stage }, after: { stage: next?.pipelineStage ?? derived.stage },
        reason: 'lead marked contacted (PD-59)',
      });
      return this.readIn(tx, c, leadId, false);
    });
  }

  /**
   * Convert: hand the lead over to the families Operations works from, without a second parent and
   * without losing a channel. The lead's e-mail and phone numbers are keyed (PD-42's contact key) and
   * matched against the families already in Chat:
   *   - a family holds the parent (or, for a lead a subscribed trial already made Converted, Operations
   *     enrolled the trial into one): the lead is LINKED to it. Channels the family record lacks are
   *     first written into its EMPTY phone / e-mail slots; when a channel has no room the hand-over is
   *     REFUSED and the contact kept. Only then is the lead's own copy of the contact deleted;
   *   - none does: `intake_required` (the existing family intake is the hand-over; converting again links
   *     it) or, for a subscribed trial not yet enrolled, `awaiting_enrolment`;
   *   - a family holds it but is not the caller's (or the e-mail is a non-family account): ONE refusal,
   *     the intake's own, which says nothing about the family.
   * Every attempt is audited with its outcome code -- a refusal outside the rolled-back transaction --
   * and never with a value. A lead already handed over is never converted twice (row lock).
   */
  async convert(actorId: string, leadId: string) {
    const c = await this.caller(actorId);
    this.requireId(leadId);
    const now = new Date();
    let refusal: string | null = null;
    const refuse = (outcome: string, err: CommError): never => {
      refusal = outcome;
      throw err;
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const f = await this.lockedFacts(tx, c, leadId);
        const derived = this.derive(f, now);
        const handedOver = f.convertedAt !== null;
        if (!canConvert(derived.stage, handedOver)) {
          return refuse(
            derived.stage === 'lost' ? 'lost' : 'already_converted',
            stateError(derived.stage === 'lost' ? 'a lost lead is reopened before it is converted' : 'this lead is already converted'),
          );
        }
        const subscribedTrial = derived.stage === 'converted' && !handedOver;
        const contact = await this.contactOf(tx, leadId);
        if (!contact) return refuse('no_contact', stateError('this lead has no contact details to hand over'));
        let keys: LeadKeys;
        try {
          keys = this.keysOf(contact);
        } catch (e) {
          return refuse('number_unreadable', e as CommError);
        }
        const enrolment = subscribedTrial && f.trialLessonIds.length > 0
          ? await tx.studentEnrolment.findFirst({ where: { lessonId: { in: f.trialLessonIds } }, select: { familyId: true } })
          : null;
        const matched = enrolment ? null : await this.findFamily(tx, c.organizationId, keys.email?.value ?? null, keys.hashes);
        if (matched === 'blocked') return refuse('unavailable', unavailable());
        const owns = matched
          ? (await tx.$queryRaw<Array<{ owns: boolean }>>`SELECT chat.staff_owns_family(${c.staffId}::uuid, ${matched}::uuid) AS owns`)[0]?.owns === true
          : false;
        const decision = decideConversion({
          hasContact: true, matchedFamilyId: matched, callerMayHandle: owns, subscribedTrial, enrolledFamilyId: enrolment?.familyId ?? null,
        });
        switch (decision.kind) {
          case 'no_contact': return refuse('no_contact', stateError('this lead has no contact details to hand over'));
          case 'unavailable': return refuse('unavailable', unavailable());
          case 'intake_required':
          case 'awaiting_enrolment': {
            await this.audit.audit(tx, {
              actorId: c.staffId, action: 'sales_lead.convert_attempted', entity: 'trial_prospect', entityId: leadId,
              after: { outcome: decision.kind }, reason: 'lead conversion attempted (PD-59)',
            });
            return { outcome: decision.kind, familyId: null };
          }
          case 'link': {
            const merged = await this.mergeChannels(tx, c, decision.familyId, keys, contact, (o, e) => refuse(o, e));
            await tx.trialProspect.update({ where: { id: leadId }, data: { convertedAt: now, convertedFamilyId: decision.familyId } });
            // The family's own record holds every channel now: the lead's copy is not kept (the guard allows it once converted).
            await tx.salesLeadContact.delete({ where: { prospectId: leadId } });
            await this.audit.audit(tx, {
              actorId: c.staffId, action: 'sales_lead.converted', entity: 'trial_prospect', entityId: leadId,
              before: { stage: derived.stage },
              after: { stage: 'converted', familyId: decision.familyId, contactDeleted: true, channelsAdded: merged, outcome: 'linked' },
              reason: 'lead linked to its existing family (PD-59)',
            });
            return { outcome: 'linked', familyId: decision.familyId };
          }
        }
      });
    } catch (e) {
      if (refusal) await this.auditRefusal(c, leadId, refusal);
      throw e;
    }
  }

  /** A refused conversion is audited on its own, since its transaction rolled back. Never a value; never masks the refusal. */
  private async auditRefusal(c: Caller, leadId: string, outcome: string): Promise<void> {
    try {
      await this.prisma.$transaction((tx) =>
        this.audit.audit(tx, {
          actorId: c.staffId, action: 'sales_lead.convert_refused', entity: 'trial_prospect', entityId: leadId,
          after: { outcome }, reason: 'lead conversion refused (PD-59)',
        }),
      );
    } catch {
      // The refusal itself is what the caller must see.
    }
  }

  /**
   * Before the lead's contact is deleted, make sure the family record holds every channel it had: the
   * ones its keys already cover stay as they are, the rest go into the parent file's EMPTY slots
   * (src/parent-profile owns that file) and are keyed for the family. A key another family holds is
   * the intake's refusal; a channel with no room is refused and the contact kept. Returns the channel
   * kinds that were added (names only).
   */
  private async mergeChannels(
    tx: Tx, c: Caller, familyId: string, keys: LeadKeys, contact: ContactDto, refuse: (outcome: string, err: CommError) => never,
  ): Promise<ChannelKind[]> {
    const rows = await tx.familyContactKey.findMany({
      where: { organizationId: c.organizationId, keyHash: { in: keys.hashes } },
      select: { keyHash: true, familyId: true },
    });
    if (rows.some((r) => r.familyId !== familyId)) return refuse('unavailable', unavailable());
    const covered = new Set(rows.map((r) => r.keyHash));
    const slots = await familyChannelSlots(tx, { familyId, organizationId: c.organizationId });
    const plan = planChannelMerge(
      { phone: keys.phone?.hash ?? null, whatsapp: keys.whatsapp?.hash ?? null, email: keys.email?.hash ?? null },
      covered,
      slots ? { phoneEmpty: slots.phoneEmpty, emailEmpty: slots.emailEmpty } : null,
    );
    if (plan.missing.length > 0) {
      return refuse('channel_missing', stateError('the family\'s record has no room for one of the lead\'s contact channels (a second phone or WhatsApp number, or another e-mail); add it to the family\'s profile first, then convert again'));
    }
    const added: ChannelKind[] = [];
    const phoneKey = plan.fillPhoneFrom ? keys[plan.fillPhoneFrom] : null;
    if (slots && (phoneKey || plan.fillEmail)) {
      await fillFamilyChannels(tx, {
        contactId: slots.contactId, actorId: c.staffId,
        phone: plan.fillPhoneFrom ? contact[plan.fillPhoneFrom] : null,
        email: plan.fillEmail ? contact.email : null,
      });
    }
    if (phoneKey && plan.fillPhoneFrom) {
      await tx.familyContactKey.create({ data: { organizationId: c.organizationId, keyHash: phoneKey.hash, familyId, kind: 'phone', createdBy: c.staffId } });
      added.push(plan.fillPhoneFrom);
    }
    if (plan.fillEmail && keys.email) {
      await tx.familyContactKey.create({ data: { organizationId: c.organizationId, keyHash: keys.email.hash, familyId, kind: 'email', createdBy: c.staffId } });
      added.push('email');
    }
    return added;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private requireId(id: string) {
    if (!isUuid(id)) throw notFound();
  }

  private async zone(): Promise<string> {
    return canonicalZone(await this.config.get('stats.zone')) ?? ACADEMY_ZONE;
  }

  private async today(): Promise<string> {
    return localDate(new Date(), await this.zone());
  }

  private derive(f: Facts, now: Date): DerivedStage {
    return deriveStage({ pipelineStage: f.pipelineStage, lostReason: f.lostReason, convertedAt: f.convertedAt, trials: f.trials, now });
  }

  /** Which channels each lead has, as booleans -- the values never leave the database for a list. */
  private async presence(organizationId: string): Promise<Map<string, ContactPresence>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; phone: boolean; whatsapp: boolean; email: boolean }>>`
      SELECT c.prospect_id::text AS id, (c.phone IS NOT NULL) AS phone, (c.whatsapp IS NOT NULL) AS whatsapp, (c.email IS NOT NULL) AS email
        FROM chat.sales_lead_contact c
       WHERE c.organization_id = ${organizationId}::uuid`;
    return new Map(rows.map((r) => [r.id, { phone: r.phone, whatsapp: r.whatsapp, email: r.email }]));
  }

  private async facts(tx: Tx, c: Caller, leadId: string): Promise<Facts> {
    const p = await tx.trialProspect.findFirst({
      where: { id: leadId, organizationId: c.organizationId },
      select: {
        id: true, displayName: true, level: true, note: true, createdAt: true,
        pipelineStage: true, lostReason: true, lastContactedAt: true, nextFollowUpOn: true, followUpNote: true,
        convertedAt: true, convertedFamilyId: true,
        lessons: { where: { kind: 'trial' }, select: { id: true, startsAt: true, outcome: true, trialOutcome: { select: { result: true, reasonCode: true } } } },
      },
    });
    if (!p) throw notFound();
    return {
      id: p.id, displayName: p.displayName, level: p.level, note: p.note, createdAt: p.createdAt,
      pipelineStage: asStored(p.pipelineStage), lostReason: p.lostReason, lastContactedAt: p.lastContactedAt,
      nextFollowUpOn: day(p.nextFollowUpOn), followUpNote: p.followUpNote, convertedAt: p.convertedAt, convertedFamilyId: p.convertedFamilyId,
      trials: p.lessons.map(trialFact), trialLessonIds: p.lessons.map((l) => l.id),
    };
  }

  /** The lead's facts under a row lock, so two changes to one lead are decided one after the other. */
  private async lockedFacts(tx: Tx, c: Caller, leadId: string): Promise<Facts> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.trial_prospect WHERE id = ${leadId}::uuid AND organization_id = ${c.organizationId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    return this.facts(tx, c, leadId);
  }

  private async contactOf(tx: Tx, leadId: string): Promise<ContactDto | null> {
    const row = await tx.salesLeadContact.findUnique({ where: { prospectId: leadId } });
    if (!row) return null;
    return {
      parentName: row.parentName, phone: row.confinedLeadPhone, whatsapp: row.confinedLeadWhatsapp,
      email: row.confinedLeadEmail, country: row.countryCode,
    };
  }

  /** Apply a contact patch; returns the field names that were given (never values). */
  private async writeContact(tx: Tx, c: Caller, f: Facts, patch: ParsedContact): Promise<string[]> {
    const existing = await tx.salesLeadContact.findUnique({ where: { prospectId: f.id } });
    if (!existing && f.convertedAt) throw stateError('this lead was handed over; its contact is in the family\'s record');
    const merged = mergeContact(
      existing
        ? {
            parentName: existing.parentName, phone: existing.confinedLeadPhone, whatsapp: existing.confinedLeadWhatsapp,
            email: existing.confinedLeadEmail, country: existing.countryCode,
          }
        : null,
      patch,
    );
    const data = {
      parentName: merged.parentName, confinedLeadPhone: merged.phone, confinedLeadWhatsapp: merged.whatsapp,
      confinedLeadEmail: merged.email, countryCode: merged.country,
    };
    if (existing) await tx.salesLeadContact.update({ where: { prospectId: f.id }, data: { ...data, updatedBy: c.staffId } });
    else await tx.salesLeadContact.create({ data: { ...data, prospectId: f.id, organizationId: c.organizationId, createdBy: c.staffId } });
    return contactFieldNames(patch);
  }

  /** The e-mail and the keyed numbers (E.164) of a contact -- what PD-42 keys a parent by. */
  private keysOf(contact: ContactDto): LeadKeys {
    const email = contact.email ? normaliseEmailForKey(contact.email) : null;
    const keyed = (n: string | null): KeyedChannel | null => {
      if (!n) return null;
      const e164 = e164ForKey(n, contact.country);
      // Never the number in the message: say which kind of channel needs fixing.
      if (e164 === 'ambiguous') throw stateError('a phone or WhatsApp number needs its country code (+...) or the country chosen before the hand-over');
      if (!e164) throw stateError('a phone or WhatsApp number is not a number that can be matched; correct it before the hand-over');
      return { value: n, hash: contactKeyHash('phone', e164) };
    };
    const phone = keyed(contact.phone);
    const whatsapp = keyed(contact.whatsapp);
    const emailKey = email ? { value: email, hash: contactKeyHash('email', email) } : null;
    const hashes = [...new Set([emailKey?.hash, phone?.hash, whatsapp?.hash].filter((h): h is string => !!h))];
    return { email: emailKey, phone, whatsapp, hashes };
  }

  /**
   * The family that already holds this parent, by the same lookups as the intake's refusal: the sign-in
   * account of the e-mail, then the keyed e-mail / numbers. 'blocked' = the e-mail is a non-family account.
   */
  private async findFamily(tx: Tx, organizationId: string, email: string | null, hashes: string[]): Promise<string | 'blocked' | null> {
    let familyId: string | null = null;
    if (email) {
      const account = await tx.account.findUnique({ where: { subject: email }, select: { id: true, kind: true } });
      if (account && account.kind !== 'family') return 'blocked';
      if (account) {
        const contact = await tx.contact.findFirst({ where: { accountId: account.id, organizationId }, select: { familyId: true } });
        familyId = contact?.familyId ?? null;
        if (!familyId) return 'blocked';
      }
    }
    if (!familyId && hashes.length > 0) {
      const key = await tx.familyContactKey.findFirst({ where: { organizationId, keyHash: { in: hashes } }, select: { familyId: true } });
      familyId = key?.familyId ?? null;
    }
    return familyId;
  }

  private detail(f: Facts, d: DerivedStage, contact: ContactDto | null, today: string) {
    const latest = [...f.trials].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
    return {
      id: f.id,
      displayName: f.displayName,
      level: f.level,
      note: f.note,
      stage: d.stage,
      lostReason: d.lostReason,
      manualStage: d.manual,
      lastContactedAt: f.lastContactedAt?.toISOString() ?? null,
      nextFollowUpOn: f.nextFollowUpOn,
      followUpDue: followUpDue({ stage: d.stage, nextFollowUpOn: f.nextFollowUpOn }, today),
      followUpNote: f.followUpNote,
      createdAt: f.createdAt.toISOString(),
      convertedAt: f.convertedAt?.toISOString() ?? null,
      familyId: f.convertedFamilyId,
      canConvert: canConvert(d.stage, f.convertedAt !== null),
      trial: latest ? { startsAt: latest.startsAt.toISOString(), result: latest.result } : null,
      contact,
    };
  }
}

/** The stored stage as the database holds it (the CHECK keeps it to the three). */
function asStored(v: string | null): StoredStage | null {
  return v === 'new_lead' || v === 'contacted' || v === 'lost' ? v : null;
}

function trialFact(l: { startsAt: Date; outcome: string | null; trialOutcome: { result: string; reasonCode: string | null } | null }): TrialFact {
  const r = l.trialOutcome?.result;
  return {
    startsAt: l.startsAt,
    lessonOutcome: l.outcome,
    result: r === 'no_show' || r === 'subscribed' || r === 'not_subscribed' ? r : null,
    reasonCode: l.trialOutcome?.reasonCode ?? null,
  };
}

/**
 * A stored contact with a patch applied. A name and at least one channel must remain;
 * the messages name the field, never a value.
 */
export function mergeContact(
  existing: { parentName: string; phone: string | null; whatsapp: string | null; email: string | null; country: string | null } | null,
  patch: ParsedContact,
): { parentName: string; phone: string | null; whatsapp: string | null; email: string | null; country: string | null } {
  const pick = <K extends 'phone' | 'whatsapp' | 'email' | 'country'>(k: K): string | null =>
    patch[k] !== undefined ? (patch[k] as string | null) : (existing?.[k] ?? null);
  const parentName = patch.parentName !== undefined ? patch.parentName : (existing?.parentName ?? null);
  if (!parentName) throw invalid('contact.parentName: required');
  const out = { parentName, phone: pick('phone'), whatsapp: pick('whatsapp'), email: pick('email'), country: pick('country') };
  if (!out.phone && !out.whatsapp && !out.email) throw invalid('contact: a phone number, a WhatsApp number or an e-mail is required');
  return out;
}
