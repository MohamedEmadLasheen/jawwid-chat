/**
 * A lesson for a spec, at any time -- also one that has already started.
 *
 * PD-46 PR-2c (TEACHER-API-002) refuses a start in the past from "Add lesson":
 * nobody adds a lesson that is already over. A spec that needs a lesson to
 * report, close, excuse or count was, in its story, added before it began; this
 * writes it as LessonService.schedule did then -- the same LessonWriter create
 * (announced), the same `lesson_scheduled` card, the same DTO. A future start
 * goes through LessonService.schedule itself, checks included.
 *
 * Test code only: the API has no way to add a past lesson.
 */
import { CardKind, LessonKind } from '@communication/contracts/vocab';
import type { ConversationService } from '@communication/conversations/conversation.service';
import type { PrismaService } from '@platform/prisma.service';
import { cardKey, LESSON_INCLUDE, learnerLesson, type LessonService } from '../../src/lessons/lesson.service';

export type LessonBody = { learnerId: string; startsAt: string; endsAt: string; makeupFor?: string };

export async function addLesson(
  deps: { prisma: PrismaService; conversations: ConversationService },
  lessons: LessonService,
  actorId: string,
  body: LessonBody,
): Promise<Awaited<ReturnType<LessonService['schedule']>>> {
  if (new Date(body.startsAt).getTime() > Date.now()) return lessons.schedule(actorId, body);
  const actor = await deps.conversations.requireActor(actorId);
  await lessons.requireManager(actor);
  const learner = await deps.prisma.learner.findUniqueOrThrow({
    where: { id: body.learnerId }, select: { teacherId: true, familyId: true },
  });
  if (!learner.teacherId) throw new Error('addLesson: the learner has no teacher');
  await lessons.assertMayBook(body.learnerId);
  const lang = await lessons.languageOf({ learner: { familyId: learner.familyId } });
  const lesson = await lessons.write(() =>
    deps.prisma.$transaction(async (tx) => {
      const created = await lessons.writer.create(tx, 'created', {
        organizationId: actor.organizationId as string,
        learnerId: body.learnerId,
        teacherId: learner.teacherId as string,
        kind: body.makeupFor ? LessonKind.MAKEUP : LessonKind.REGULAR,
        makeupFor: body.makeupFor ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        createdBy: actor.actorId,
      }, LESSON_INCLUDE).then(learnerLesson);
      await lessons.postCard(tx, created, actor, CardKind.LESSON_SCHEDULED, lessons.cardBase(created), lang, {
        idempotencyKey: cardKey(created, 'created'),
      });
      return created;
    }),
  );
  return lessons.toDto(lesson, 'manager', new Date(), await lessons.escalationMs());
}
