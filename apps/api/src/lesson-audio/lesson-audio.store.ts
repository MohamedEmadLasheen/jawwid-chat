import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { readLessonAudioGate, type LessonAudioGate } from './lesson-audio-gate';

/** One clip as the review page and the learner's list read it. */
export interface ClipRow {
  id: string;
  stringId: string;
  textSha256: string;
  renderSha256: string;
  audioSha256: string;
  objectKey: string;
  vendor: string;
  voice: string;
  attempt: number;
  createdAt: Date;
  /** pending | approved | rejected | withdrawn (chat.lesson_audio_clip_state). */
  state: string;
}

export interface ReviewRow {
  clipId: string;
  action: 'approve' | 'reject' | 'withdraw';
  staffId: string;
  staffName: string;
  category: string | null;
  reason: string | null;
  at: Date;
}

export interface DecisionRow {
  stringId: string;
  textSha256: string;
  decision: 'no_audio' | 'one_more_round';
  staffName: string;
  reason: string;
  at: Date;
}

export interface LessonAudioStore {
  gate(): Promise<LessonAudioGate>;
  /** Every clip of a lesson in ONE organization (optionally of some strings), with its derived state. */
  clips(organizationId: string, lesson: string, stringIds?: readonly string[]): Promise<ClipRow[]>;
  reviews(clipIds: readonly string[]): Promise<ReviewRow[]>;
  decisions(organizationId: string, lesson: string): Promise<DecisionRow[]>;
  /** chat.review_lesson_audio_clip: returns the clip's state afterwards. */
  review(clipId: string, action: string, textSha256: string, audioSha256: string, category: string | null, reason: string | null, actorId: string): Promise<string>;
  /** chat.decide_lesson_audio_string. */
  decide(lesson: string, stringId: string, textSha256: string, decision: string, reason: string, actorId: string): Promise<void>;
}

/** LessonAudioStore over chat.lesson_audio_* (migration 20261029230000) and chat.config. */
@Injectable()
export class PrismaLessonAudioStore implements LessonAudioStore {
  constructor(private readonly prisma: PrismaService) {}

  gate(): Promise<LessonAudioGate> {
    return readLessonAudioGate(this.prisma);
  }

  clips(organizationId: string, lesson: string, stringIds?: readonly string[]): Promise<ClipRow[]> {
    const ids = stringIds ? [...stringIds] : null;
    return this.prisma.$queryRaw<ClipRow[]>`
      SELECT c.id::text AS id, c.string_id AS "stringId", c.text_sha256 AS "textSha256", c.render_sha256 AS "renderSha256",
             c.audio_sha256 AS "audioSha256", c.object_key AS "objectKey", c.vendor, c.voice, c.attempt::int AS attempt,
             c.created_at AS "createdAt", chat.lesson_audio_clip_state(c.id) AS state
        FROM chat.lesson_audio_clip c
       WHERE c.organization_id = ${organizationId}::uuid AND c.lesson_key = ${lesson}
         AND (${ids}::text[] IS NULL OR c.string_id = ANY (${ids}::text[]))
       ORDER BY c.string_id, c.created_at`;
  }

  async reviews(clipIds: readonly string[]): Promise<ReviewRow[]> {
    if (clipIds.length === 0) return [];
    return this.prisma.$queryRaw<ReviewRow[]>`
      SELECT r.clip_id::text AS "clipId", r.action, r.staff_id::text AS "staffId", s.name AS "staffName", r.category, r.reason, r.at
        FROM chat.lesson_audio_review r JOIN chat.staff s ON s.id = r.staff_id
       WHERE r.clip_id = ANY (${[...clipIds]}::uuid[])
       ORDER BY r.at`;
  }

  decisions(organizationId: string, lesson: string): Promise<DecisionRow[]> {
    return this.prisma.$queryRaw<DecisionRow[]>`
      SELECT d.string_id AS "stringId", d.text_sha256 AS "textSha256", d.decision, s.name AS "staffName", d.reason, d.at
        FROM chat.lesson_audio_string_decision d JOIN chat.staff s ON s.id = d.staff_id
       WHERE d.organization_id = ${organizationId}::uuid AND d.lesson_key = ${lesson}
       ORDER BY d.at`;
  }

  async review(clipId: string, action: string, textSha256: string, audioSha256: string, category: string | null, reason: string | null, actorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ state: string }>>`
      SELECT chat.review_lesson_audio_clip(${clipId}::uuid, ${action}, ${textSha256}, ${audioSha256}, ${category}, ${reason}, ${actorId}::uuid) AS state`;
    return rows[0]!.state;
  }

  async decide(lesson: string, stringId: string, textSha256: string, decision: string, reason: string, actorId: string) {
    // A void function: $executeRaw, which does not read the (void) column back.
    await this.prisma.$executeRaw`
      SELECT chat.decide_lesson_audio_string(${lesson}, ${stringId}, ${textSha256}, ${decision}, ${reason}, ${actorId}::uuid)`;
  }
}
