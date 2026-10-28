import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { CommError, CommErrorCode } from '../platform/errors';
import { lessonAudioAccess, type LessonAudioAccess } from '../platform/lesson-audio-policy';
import { PermissionService } from '../platform/permissions/permission.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { Actor } from '../platform/types';
import { lessonAudioAllowed, type LessonAudioViewer } from './lesson-audio-gate';
import { APPROVALS_REQUIRED, SHA256, STRING_ID, TRIES_PER_ROUND, lessonAudioKey } from './lesson-audio-key';
import type { ClipRow, LessonAudioStore, ReviewRow } from './lesson-audio.store';
import { lessonText, type LessonText } from './lesson-texts';
import { VOICE_SOURCES, familyLicence, lessonVoice, type VoiceSource } from './voice-sources';

export const LESSON_AUDIO_STORE = Symbol('LESSON_AUDIO_STORE');
/** The voices that may be served (voice-sources.ts); a token so a spec can record a licence. */
export const LESSON_VOICE_SOURCES = Symbol('LESSON_VOICE_SOURCES');
/** The lessons' approved text (lesson-texts.ts); a token so a spec can use an approved lesson. */
export const LESSON_TEXTS = Symbol('LESSON_TEXTS');
/** The ONE voice a lesson is served in (lesson-voices.json); a token so a spec can pin one. */
export const LESSON_VOICE_PINS = Symbol('LESSON_VOICE_PINS');
/** How long a signed clip URL stays valid: one sitting. */
export const LESSON_AUDIO_URL_TTL_SECONDS = 3600;
/** One unit is the review page's page; the biggest lesson-1 unit is well under this. */
const MAX_STRINGS_SIGNED = 200;

export const REJECT_CATEGORIES = ['vowel', 'final_sukun', 'shadda', 'hamza', 'letter_sound', 'stress', 'noise', 'wrong_word', 'other'] as const;

/** What the lesson engine receives (apps/lessons, message `jawwid:lesson-audio`). */
export interface LearnerClip {
  id: string;
  audio: { key: string; url: string; sha256: string; textSha256: string };
}

/**
 * The newest clip with its approvals complete, per string, among the clips of
 * its CURRENT text in the lesson's ONE voice -- unless a reviewer decided "no
 * audio" for that text, which wins over any clip (review of #254, P1).
 */
export function servedClip(clips: ReadonlyArray<ClipRow>, textSha256: string, voice: string | null, noAudio: boolean): ClipRow | null {
  if (noAudio || voice === null) return null;
  const ok = clips.filter((c) => c.textSha256 === textSha256 && c.state === 'approved' && `${c.vendor}:${c.voice}` === voice);
  return ok.length ? ok.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;
}

/**
 * PD-48: lesson voice-over (docs/product/pd048-lesson-voice-over-design.md §7, §9).
 *
 * learnerAudio -- what a signed-in account hears in a lesson. FAIL CLOSED: a
 *   string gets a clip only if (1) it is in the lesson's approved text as the
 *   API was built with it, (2) a clip of exactly that text has two approvals
 *   from two people and no rejection or withdrawal, in THIS account's
 *   organization, and no reviewer decided "no audio" for that text, (3) its
 *   voice is the lesson's one pinned voice (lesson-voices.json) and listed in
 *   voice-sources.ts, and (4) the release gate lets THIS account hear that
 *   voice. Every URL is signed here, after those checks, for a key derived from
 *   the row: no request field names a key or a clip.
 *
 * review page -- for holders of lesson_audio.view (listen) and
 *   lesson_audio.review (approve, reject, withdraw, decide). The reviewer's id
 *   is the authenticated actor's; the database checks the key, the hashes and
 *   the two-person rule again.
 */
@Injectable()
export class LessonAudioService {
  constructor(
    @Inject(LESSON_AUDIO_STORE) private readonly store: LessonAudioStore,
    private readonly permissions: PermissionService,
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage: Pick<ObjectStorage, 'signedReadUrl'> | null = null,
    @Optional() @Inject(LESSON_VOICE_SOURCES) private readonly voices: ReadonlyMap<string, VoiceSource> = VOICE_SOURCES,
    @Optional() @Inject(LESSON_TEXTS) private readonly texts: (lesson: string) => LessonText | null = lessonText,
    @Optional() @Inject(LESSON_VOICE_PINS) private readonly pin: (lesson: string) => string | null = lessonVoice,
  ) {}

  // --- the learner ---------------------------------------------------------------

  async learnerAudio(lesson: string, actor: Actor): Promise<{ lesson: string; clips: LearnerClip[] }> {
    const text = this.textOf(lesson);
    if (!this.storage) return { lesson, clips: [] };
    const gate = await this.store.gate();
    const viewer: LessonAudioViewer = { kind: actor.kind, actorId: actor.actorId, staffRole: actor.staffRole };
    // Nobody at all: no query, no signing.
    if (!lessonAudioAllowed(gate, true, viewer)) return { lesson, clips: [] };
    // Testers hear an unapproved lesson file's clips (to check them in place); nobody else does.
    const tester = lessonAudioAllowed({ ...gate, audience: 'staff_test' }, false, viewer);
    if (!text.lessonApproved && !tester) return { lesson, clips: [] };
    // Organization-scoped: an account hears only its own organization's approved clips.
    const org = actor.organizationId;
    const voice = this.pin(lesson);
    if (!org || voice === null) return { lesson, clips: [] };
    const [all, decisions] = await Promise.all([this.store.clips(org, lesson), this.store.decisions(org, lesson)]);
    const silent = new Set(decisions.filter((d) => d.decision === 'no_audio').map((d) => `${d.stringId}:${d.textSha256}`));
    const byString = new Map<string, ClipRow[]>();
    for (const c of all) byString.set(c.stringId, [...(byString.get(c.stringId) ?? []), c]);
    const clips: LearnerClip[] = [];
    for (const s of text.strings.values()) {
      const c = servedClip(byString.get(s.id) ?? [], s.sha256, voice, silent.has(`${s.id}:${s.sha256}`));
      if (!c) continue;
      const source = this.voices.get(`${c.vendor}:${c.voice}`);
      if (!source) continue; // a voice taken out of voice-sources.ts is off for everyone
      if (!lessonAudioAllowed(gate, familyLicence(source) !== null, viewer)) continue;
      const key = lessonAudioKey(lesson, s.id, c.audioSha256);
      if (key !== c.objectKey) continue; // the stored key must be the derived one
      const url = await this.storage.signedReadUrl(key, LESSON_AUDIO_URL_TTL_SECONDS, { cacheControl: 'private, no-store' });
      clips.push({ id: s.id, audio: { key, url, sha256: c.audioSha256, textSha256: s.sha256 } });
    }
    return { lesson, clips };
  }

  // --- the review page ------------------------------------------------------------

  async access(actor: Actor): Promise<LessonAudioAccess> {
    return lessonAudioAccess(actor, (await this.permissions.profileOf(actor)).permissions);
  }

  /** Per unit of a lesson: how many strings have audio, wait for review, need a decision, or have none. */
  async summary(lesson: string, actor: Actor) {
    await this.require(actor, 'view');
    const text = this.textOf(lesson);
    const org = this.orgOf(actor);
    const [clips, decisions] = await Promise.all([this.store.clips(org, lesson), this.store.decisions(org, lesson)]);
    const units = new Map<string, { unit: string; strings: number; approved: number; pending: number; needsDecision: number; noAudio: number; none: number }>();
    for (const s of text.strings.values()) {
      const unit = unitOf(s.id);
      const u = units.get(unit) ?? { unit, strings: 0, approved: 0, pending: 0, needsDecision: 0, noAudio: 0, none: 0 };
      u.strings++;
      const st = stringStatus(s.sha256, clips.filter((c) => c.stringId === s.id), decisions.filter((d) => d.stringId === s.id));
      u[st]++;
      units.set(unit, u);
    }
    return { lesson, lessonApproved: text.lessonApproved, approvalsRequired: APPROVALS_REQUIRED, units: [...units.values()] };
  }

  /** One unit's strings, each with the clips of its current text, their reviews and (to listen) signed URLs. */
  async unit(lesson: string, unit: string, actor: Actor) {
    const access = await this.require(actor, 'view');
    const text = this.textOf(lesson);
    const strings = [...text.strings.values()].filter((s) => unitOf(s.id) === unit);
    if (strings.length === 0) throw new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, `no unit ${unit} with approved text in ${lesson}`);
    if (strings.length > MAX_STRINGS_SIGNED) throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, 'this unit is too large for one page', 422);
    const org = this.orgOf(actor);
    const [clips, decisions] = await Promise.all([this.store.clips(org, lesson, strings.map((s) => s.id)), this.store.decisions(org, lesson)]);
    const current = clips.filter((c) => strings.some((s) => s.id === c.stringId && s.sha256 === c.textSha256));
    const reviews = await this.store.reviews(current.map((c) => c.id));
    const out = [];
    for (const s of strings) {
      const own = current.filter((c) => c.stringId === s.id);
      const ds = decisions.filter((d) => d.stringId === s.id && d.textSha256 === s.sha256);
      out.push({
        id: s.id,
        kind: s.kind,
        text: s.text,
        textSha256: s.sha256,
        status: stringStatus(s.sha256, own, ds),
        decisions: ds.map((d) => ({ decision: d.decision, by: d.staffName, reason: d.reason, at: d.at })),
        clips: await Promise.all(own.map((c) => this.clipView(lesson, c, reviews.filter((r) => r.clipId === c.id), actor, access))),
      });
    }
    return { lesson, unit, approvalsRequired: APPROVALS_REQUIRED, strings: out };
  }

  private async clipView(lesson: string, c: ClipRow, reviews: ReviewRow[], actor: Actor, access: LessonAudioAccess) {
    // Reviewers listen to what is still being decided and to what plays; a
    // rejected or withdrawn clip stays in the history without a URL.
    const listenable = (c.state === 'pending' || c.state === 'approved') && !!this.storage;
    const key = lessonAudioKey(lesson, c.stringId, c.audioSha256);
    return {
      clipId: c.id,
      state: c.state,
      attempt: c.attempt,
      vendor: c.vendor,
      voice: c.voice,
      renderSha256: c.renderSha256,
      audioSha256: c.audioSha256,
      createdAt: c.createdAt,
      approvals: reviews.filter((r) => r.action === 'approve').map((r) => ({ by: r.staffName, at: r.at })),
      rejections: reviews.filter((r) => r.action !== 'approve').map((r) => ({ action: r.action, by: r.staffName, category: r.category, reason: r.reason, at: r.at })),
      approvedByMe: reviews.some((r) => r.action === 'approve' && r.staffId === actor.actorId),
      canReview: access.review && c.state === 'pending' && !reviews.some((r) => r.action === 'approve' && r.staffId === actor.actorId),
      url: listenable && key === c.objectKey ? await this.storage!.signedReadUrl(key, LESSON_AUDIO_URL_TTL_SECONDS, { cacheControl: 'private, no-store' }) : null,
    };
  }

  async reviewClip(clipId: string, action: 'approve' | 'reject' | 'withdraw', body: Record<string, unknown>, actor: Actor) {
    await this.require(actor, 'review');
    if (!/^[0-9a-f-]{36}$/.test(clipId)) throw new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, 'no such clip');
    const textSha256 = body.textSha256;
    const audioSha256 = body.audioSha256;
    if (typeof textSha256 !== 'string' || !SHA256.test(textSha256) || typeof audioSha256 !== 'string' || !SHA256.test(audioSha256)) {
      throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, 'textSha256 and audioSha256: what your browser heard, as SHA-256 hex', 422);
    }
    let category: string | null = null;
    let reason: string | null = null;
    if (action !== 'approve') {
      if (typeof body.category !== 'string' || !(REJECT_CATEGORIES as readonly string[]).includes(body.category)) {
        throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, `category: one of ${REJECT_CATEGORIES.join(', ')}`, 422);
      }
      if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) {
        throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, 'reason: what is wrong, in up to 500 characters', 422);
      }
      category = body.category;
      reason = body.reason.trim();
    }
    try {
      const state = await this.store.review(clipId, action, textSha256, audioSha256, category, reason, actor.actorId);
      return { clipId, state };
    } catch (e) {
      throw refusal(e);
    }
  }

  async decide(lesson: string, stringId: string, body: Record<string, unknown>, actor: Actor) {
    await this.require(actor, 'review');
    const text = this.textOf(lesson);
    const s = STRING_ID.test(stringId) ? text.strings.get(stringId) : undefined;
    if (!s) throw new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, `no string ${stringId} with approved text in ${lesson}`);
    if (body.decision !== 'no_audio' && body.decision !== 'one_more_round') throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, 'decision: no_audio or one_more_round', 422);
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) {
      throw new CommError(CommErrorCode.LESSON_AUDIO_INVALID, 'reason: why, in up to 500 characters', 422);
    }
    try {
      // The text is the one the API was built with: a decision is bound to it.
      await this.store.decide(lesson, s.id, s.sha256, body.decision, body.reason.trim(), actor.actorId);
      return { lesson, stringId: s.id, decision: body.decision };
    } catch (e) {
      throw refusal(e);
    }
  }

  private orgOf(actor: Actor): string {
    if (!actor.organizationId) throw new CommError(CommErrorCode.LESSON_AUDIO_DENIED, 'lesson audio belongs to an organization');
    return actor.organizationId;
  }

  private textOf(lesson: string): LessonText {
    const text = this.texts(lesson);
    if (!text) throw new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, `no lesson ${lesson} with voice-over`);
    return text;
  }

  private async require(actor: Actor, what: 'view' | 'review'): Promise<LessonAudioAccess> {
    const access = await this.access(actor);
    if (!access[what]) throw new CommError(CommErrorCode.LESSON_AUDIO_DENIED, what === 'view' ? 'listening needs lesson_audio.view' : 'reviewing needs lesson_audio.review');
    return access;
  }
}

/** A string's unit: the id before "-NNN", ".name" or ".note". */
export function unitOf(stringId: string): string {
  return stringId.replace(/(-[0-9]{3}|\.(name|note))$/, '');
}

type StringStatus = 'approved' | 'pending' | 'needsDecision' | 'noAudio' | 'none';

/** Where a string stands, for its current text only. */
export function stringStatus(
  textSha256: string,
  clips: ReadonlyArray<Pick<ClipRow, 'textSha256' | 'state'>>,
  decisions: ReadonlyArray<{ textSha256: string; decision: string }>,
): StringStatus {
  const own = clips.filter((c) => c.textSha256 === textSha256);
  const ds = decisions.filter((d) => d.textSha256 === textSha256);
  // "No audio" first: it is final, whatever clip exists (review of #254, P1).
  if (ds.some((d) => d.decision === 'no_audio')) return 'noAudio';
  if (own.some((c) => c.state === 'approved')) return 'approved';
  if (own.some((c) => c.state === 'pending')) return 'pending';
  const failed = own.filter((c) => c.state === 'rejected' || c.state === 'withdrawn').length;
  const rounds = ds.filter((d) => d.decision === 'one_more_round').length;
  if (failed >= TRIES_PER_ROUND * (rounds + 1)) return 'needsDecision';
  return 'none';
}

/** A refusal raised by the database becomes an answer with its words; anything else is rethrown. */
export function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && !(e instanceof Prisma.PrismaClientUnknownRequestError)) return e;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  const raw = String(meta?.message ?? e.message);
  const sqlstate = meta?.code ?? (/\b(42501|23514|23505|P0002)\b/.exec(raw)?.[1] ?? '');
  const words = (/ERROR:\s*([^\n`]+)/.exec(raw)?.[1] ?? raw).trim();
  if (sqlstate === 'P0002' || /no such lesson audio clip/.test(raw)) return new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, 'no such clip');
  if (sqlstate === '42501' || /insufficient_privilege/.test(raw)) return new CommError(CommErrorCode.LESSON_AUDIO_DENIED, words);
  if (sqlstate === '23505') return new CommError(CommErrorCode.LESSON_AUDIO_DENIED, 'you have already approved this clip: a second approval is someone else\'s', 403);
  if (sqlstate === '23514' || /check_violation/.test(raw)) return new CommError(CommErrorCode.LESSON_AUDIO_STATE, words, 409);
  return e;
}
