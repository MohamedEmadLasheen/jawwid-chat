import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from '../platform/errors';
import { lessonContentAccess, type LessonContentAccess, type ReviewStep } from '../platform/lesson-content-policy';
import { PermissionService } from '../platform/permissions/permission.service';
import type { Actor } from '../platform/types';
import { ApprovalsSigner, type ApprovalsPayload, type SignedApprovals } from './approvals-signer';
import type { LessonContentStore, ReviewRow } from './lesson-content.store';
import { SHA256, reviewScope, type Scope, type Step, type Subject } from './review-subjects';

export const LESSON_CONTENT_STORE = Symbol('LESSON_CONTENT_STORE');
/** The scopes as the API was built with them (review-subjects.ts); a token so a spec can supply its own. */
export const LESSON_CONTENT_SCOPES = Symbol('LESSON_CONTENT_SCOPES');
/** The approvals signer (approvals-signer.ts); a token so a spec can sign with its own key. */
export const LESSON_APPROVALS_SIGNER = Symbol('LESSON_APPROVALS_SIGNER');

export const REJECT_CATEGORIES = ['wrong_meaning', 'not_in_source', 'aqeedah', 'weak_report', 'too_hard_for_band', 'language', 'respect', 'other'] as const;
const ACTIONS = ['approve', 'reject', 'withdraw'] as const;
type Action = (typeof ACTIONS)[number];

/** Where one item's CURRENT text stands. */
export interface ItemStatus {
  /** open | rejected | withdrawn, for the current text. */
  state: 'open' | 'rejected' | 'withdrawn';
  /** The steps signed for the current text, in order. */
  signed: Step[];
  /** Signed every step its kind needs, and neither rejected nor withdrawn: it may show. */
  approved: boolean;
  /** Signatures exist for an earlier text of this item (it changed since). */
  stale: boolean;
}

const ORDER: readonly Step[] = ['check', 'teacher', 'scholar'];

/** Pure: an item's status from the reviews of its scope. */
export function itemStatus(subject: Pick<Subject, 'id' | 'approvalSha256' | 'requiredSteps'>, reviews: readonly Pick<ReviewRow, 'itemId' | 'approvalSha256' | 'step' | 'action'>[]): ItemStatus {
  const own = reviews.filter((r) => r.itemId === subject.id);
  const current = own.filter((r) => r.approvalSha256 === subject.approvalSha256);
  const state = current.some((r) => r.action === 'withdraw') ? 'withdrawn' : current.some((r) => r.action === 'reject') ? 'rejected' : 'open';
  const signed = ORDER.filter((s) => current.some((r) => r.action === 'approve' && r.step === s));
  return {
    state,
    signed,
    approved: state === 'open' && subject.requiredSteps.every((s) => signed.includes(s)),
    stale: own.some((r) => r.approvalSha256 !== subject.approvalSha256),
  };
}

/**
 * PD-49: the review of children's Quran content and of game mechanics
 * (docs/product/pd049-children-quran-experience-plan.md §F.2, §F.3).
 *
 * Reviewers see a scope's items with their status, and sign, reject or
 * withdraw ONE step of ONE item at a time, naming the hash of the text they
 * read: a signature is of that text, or nothing is recorded. The signer is the
 * authenticated actor; the database checks the step's key, the order, and that
 * one person signs one step of a text.
 *
 * export() is what reaches children: the items whose current text has every
 * required step signed and is neither rejected nor withdrawn, with who signed
 * each step, SIGNED with the API's Ed25519 key (approvals-signer.ts) in the
 * format of apps/lessons/src/content/approvals/. scripts/lessons/export-approvals.py
 * writes it into the repo; CI verifies the signature; the engine checks it again.
 * No signing key: the export refuses (503) -- nothing unsigned is ever handed out.
 */
@Injectable()
export class LessonContentService {
  constructor(
    @Inject(LESSON_CONTENT_STORE) private readonly store: LessonContentStore,
    private readonly permissions: PermissionService,
    @Optional() @Inject(LESSON_CONTENT_SCOPES) private readonly scopes: (scope: string) => Scope | null = reviewScope,
    @Optional() @Inject(LESSON_APPROVALS_SIGNER) private readonly signer: Pick<ApprovalsSigner, 'sign'> = new ApprovalsSigner(),
  ) {}

  async access(actor: Actor): Promise<LessonContentAccess> {
    const [profile, contentOrganizationId] = await Promise.all([this.permissions.profileOf(actor), this.store.contentOrganization()]);
    const scholarGranted = contentOrganizationId !== null && actor.organizationId === contentOrganizationId ? await this.store.scholarGranted(actor.actorId) : false;
    return lessonContentAccess(actor, profile.permissions, { contentOrganizationId, scholarGranted });
  }

  /** A scope's items, each with its status and its review history, for one reviewer. */
  async list(scope: string, actor: Actor) {
    const access = await this.require(actor);
    const s = this.scopeOf(scope);
    const reviews = await this.store.reviews(s.scope);
    const items = [...s.subjects.values()].map((subject) => {
      const own = reviews.filter((r) => r.itemId === subject.id && r.approvalSha256 === subject.approvalSha256);
      const status = itemStatus(subject, reviews);
      const next = ORDER.find((step) => subject.requiredSteps.includes(step) && !status.signed.includes(step)) ?? null;
      return {
        id: subject.id,
        kind: subject.kind,
        approvalSha256: subject.approvalSha256,
        item: subject.item,
        requiredSteps: subject.requiredSteps,
        ...status,
        next,
        // What this reviewer may do now (the database decides again).
        canSign:
          status.state === 'open' &&
          next !== null &&
          access.steps.includes(next) &&
          !own.some((r) => r.action === 'approve' && r.staffId === actor.actorId),
        history: own.map((r) => ({ step: r.step, action: r.action, by: r.staffName, category: r.category, reason: r.reason, at: r.at })),
      };
    });
    return { scope: s.scope, access, items };
  }

  async review(scope: string, itemId: string, action: string, body: Record<string, unknown>, actor: Actor) {
    const access = await this.require(actor);
    if (!(ACTIONS as readonly string[]).includes(action)) throw new CommError(CommErrorCode.LESSON_CONTENT_INVALID, 'action: approve, reject or withdraw', 422);
    const s = this.scopeOf(scope);
    const subject = s.subjects.get(itemId);
    if (!subject) throw new CommError(CommErrorCode.LESSON_CONTENT_NOT_FOUND, `no item ${itemId} in ${scope}`);
    const step = body.step;
    if (typeof step !== 'string' || !ORDER.includes(step as Step) || (s.scope === 'play' && step === 'check')) {
      throw new CommError(CommErrorCode.LESSON_CONTENT_INVALID, s.scope === 'play' ? 'step: teacher or scholar' : 'step: check, teacher or scholar', 422);
    }
    if (!access.steps.includes(step as ReviewStep)) {
      throw new CommError(
        CommErrorCode.LESSON_CONTENT_DENIED,
        step === 'scholar' ? 'the scholar step needs the Scholar reviewer role, granted explicitly' : `the ${step} step needs its own key`,
      );
    }
    if (typeof body.approvalSha256 !== 'string' || !SHA256.test(body.approvalSha256)) {
      throw new CommError(CommErrorCode.LESSON_CONTENT_INVALID, 'approvalSha256: the hash of the text you reviewed, as SHA-256 hex', 422);
    }
    if (body.approvalSha256 !== subject.approvalSha256) {
      throw new CommError(CommErrorCode.LESSON_CONTENT_STATE, 'this item changed since you opened it: read it again', 409);
    }
    let category: string | null = null;
    let reason: string | null = null;
    if (action !== 'approve') {
      if (typeof body.category !== 'string' || !(REJECT_CATEGORIES as readonly string[]).includes(body.category)) {
        throw new CommError(CommErrorCode.LESSON_CONTENT_INVALID, `category: one of ${REJECT_CATEGORIES.join(', ')}`, 422);
      }
      if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) {
        throw new CommError(CommErrorCode.LESSON_CONTENT_INVALID, 'reason: what is wrong, in up to 500 characters', 422);
      }
      category = body.category;
      reason = body.reason.trim();
    }
    try {
      const result = await this.store.review(s.scope, subject.id, subject.approvalSha256, step, action as Action, category, reason, actor.actorId);
      return { scope: s.scope, itemId: subject.id, approvalSha256: subject.approvalSha256, ...result };
    } catch (e) {
      throw refusal(e);
    }
  }

  /** The approvals that may reach children, signed: the apps/lessons approvals file. */
  async export(scope: string, actor: Actor): Promise<SignedApprovals> {
    await this.require(actor);
    const s = this.scopeOf(scope);
    const reviews = await this.store.reviews(s.scope);
    const approvals = [...s.subjects.values()]
      .map((subject) => ({ subject, status: itemStatus(subject, reviews) }))
      .filter(({ status }) => status.approved)
      .map(({ subject, status }) => ({
        id: subject.id,
        approvalSha256: subject.approvalSha256,
        steps: status.signed,
        // Who signed each step of THIS text, as the database recorded it.
        signers: status.signed.map((step) => {
          const r = reviews.find((x) => x.itemId === subject.id && x.approvalSha256 === subject.approvalSha256 && x.action === 'approve' && x.step === step)!;
          return { step, staffId: r.staffId, at: new Date(r.at).toISOString() };
        }),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const payload: ApprovalsPayload = { v: 1, datasetId: s.datasetId, lessonKey: s.scope, approvals };
    const signed = this.signer.sign(payload);
    if (!signed) {
      throw new CommError(CommErrorCode.LESSON_CONTENT_SIGNING_UNAVAILABLE, 'approvals are exported only signed, and the API has no signing key (LESSON_APPROVALS_SIGNING_KEY)', 503);
    }
    return signed;
  }

  private scopeOf(scope: string): Scope {
    const s = this.scopes(scope);
    if (!s) throw new CommError(CommErrorCode.LESSON_CONTENT_NOT_FOUND, `no content under review in ${scope}`);
    return s;
  }

  private async require(actor: Actor): Promise<LessonContentAccess> {
    const access = await this.access(actor);
    if (!access.view) {
      throw new CommError(CommErrorCode.LESSON_CONTENT_DENIED, 'lesson content is reviewed by the content organization, with lesson_content.view or a review key');
    }
    return access;
  }
}

/** A refusal raised by the database becomes an answer with its words; anything else is rethrown. */
export function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && !(e instanceof Prisma.PrismaClientUnknownRequestError)) return e;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  const raw = String(meta?.message ?? e.message);
  const sqlstate = meta?.code ?? (/\b(42501|23514|23505|22023)\b/.exec(raw)?.[1] ?? '');
  const words = (/ERROR:\s*([^\n`]+)/.exec(raw)?.[1] ?? raw).trim();
  if (sqlstate === '42501' || /insufficient_privilege/.test(raw)) return new CommError(CommErrorCode.LESSON_CONTENT_DENIED, words);
  if (sqlstate === '23505') return new CommError(CommErrorCode.LESSON_CONTENT_STATE, 'that step is already signed for this text', 409);
  if (sqlstate === '23514' || /check_violation/.test(raw)) return new CommError(CommErrorCode.LESSON_CONTENT_STATE, words, 409);
  if (sqlstate === '22023') return new CommError(CommErrorCode.LESSON_CONTENT_INVALID, words, 422);
  return e;
}
