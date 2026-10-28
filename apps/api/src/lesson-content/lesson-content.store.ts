import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

/** One signature, rejection or withdrawal of one step of one item's text. */
export interface ReviewRow {
  itemId: string;
  itemSha256: string;
  step: 'check' | 'teacher' | 'scholar';
  action: 'approve' | 'reject' | 'withdraw';
  staffId: string;
  staffName: string;
  category: string | null;
  reason: string | null;
  at: Date;
}

export interface LessonContentStore {
  /** Every review of a scope, oldest first. */
  reviews(scope: string): Promise<ReviewRow[]>;
  /** chat.review_lesson_content: the text's state and signed steps afterwards. */
  review(
    scope: string,
    itemId: string,
    itemSha256: string,
    step: string,
    action: string,
    category: string | null,
    reason: string | null,
    actorId: string,
  ): Promise<{ state: string; steps: string[] }>;
}

/** LessonContentStore over chat.lesson_content_review (migration 20261029235000). */
@Injectable()
export class PrismaLessonContentStore implements LessonContentStore {
  constructor(private readonly prisma: PrismaService) {}

  reviews(scope: string): Promise<ReviewRow[]> {
    return this.prisma.$queryRaw<ReviewRow[]>`
      SELECT r.item_id AS "itemId", r.item_sha256 AS "itemSha256", r.step, r.action, r.staff_id::text AS "staffId",
             s.name AS "staffName", r.category, r.reason, r.at
        FROM chat.lesson_content_review r JOIN chat.staff s ON s.id = r.staff_id
       WHERE r.scope = ${scope}
       ORDER BY r.at, r.id`;
  }

  async review(scope: string, itemId: string, itemSha256: string, step: string, action: string, category: string | null, reason: string | null, actorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ result: { state: string; steps: string[] } }>>`
      SELECT chat.review_lesson_content(${scope}, ${itemId}, ${itemSha256}, ${step}, ${action}, ${category}, ${reason}, ${actorId}::uuid) AS result`;
    return rows[0]!.result;
  }
}
