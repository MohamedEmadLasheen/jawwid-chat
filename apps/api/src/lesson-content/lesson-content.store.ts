import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

/** One signature, rejection or withdrawal of one step of one item's text. */
export interface ReviewRow {
  itemId: string;
  approvalSha256: string;
  step: 'check' | 'teacher' | 'scholar';
  action: 'approve' | 'reject' | 'withdraw';
  staffId: string;
  staffName: string;
  category: string | null;
  reason: string | null;
  at: Date;
}

export interface LessonContentStore {
  /** The content organization (chat.lesson_content_organization()), or null while unset. */
  contentOrganization(): Promise<string | null>;
  /** review_scholar through an explicitly granted role (chat.lesson_content_scholar_granted). */
  scholarGranted(staffId: string): Promise<boolean>;
  /** Every review of a scope by staff of the content organization, oldest first. */
  reviews(scope: string): Promise<ReviewRow[]>;
  /** chat.review_lesson_content: the text's state and signed steps afterwards. */
  review(
    scope: string,
    itemId: string,
    approvalSha256: string,
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

  async contentOrganization(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`SELECT chat.lesson_content_organization()::text AS id`;
    return rows[0]?.id ?? null;
  }

  async scholarGranted(staffId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.lesson_content_scholar_granted(${staffId}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  reviews(scope: string): Promise<ReviewRow[]> {
    // Names are the content organization's own staff (the database signs no one else).
    return this.prisma.$queryRaw<ReviewRow[]>`
      SELECT r.item_id AS "itemId", r.approval_sha256 AS "approvalSha256", r.step, r.action, r.staff_id::text AS "staffId",
             s.name AS "staffName", r.category, r.reason, r.at
        FROM chat.lesson_content_review r JOIN chat.staff s ON s.id = r.staff_id
       WHERE r.scope = ${scope} AND s.organization_id = chat.lesson_content_organization()
       ORDER BY r.at, r.id`;
  }

  async review(scope: string, itemId: string, approvalSha256: string, step: string, action: string, category: string | null, reason: string | null, actorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ result: { state: string; steps: string[] } }>>`
      SELECT chat.review_lesson_content(${scope}, ${itemId}, ${approvalSha256}, ${step}, ${action}, ${category}, ${reason}, ${actorId}::uuid) AS result`;
    return rows[0]!.result;
  }
}
