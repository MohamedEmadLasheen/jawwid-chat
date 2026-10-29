import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { LessonContentController } from './lesson-content.controller';
import { LESSON_CONTENT_STORE, LessonContentService } from './lesson-content.service';
import { PrismaLessonContentStore } from './lesson-content.store';

/**
 * PD-49: the step-by-step review of children's Quran content and of game
 * mechanics. It reads and writes only chat.lesson_content_review; it never
 * touches the Quran text, recitation or any child's data. AuthModule gives
 * PermissionService (PD-40).
 */
@Module({
  imports: [AuthModule],
  controllers: [LessonContentController],
  providers: [LessonContentService, { provide: LESSON_CONTENT_STORE, useClass: PrismaLessonContentStore }],
})
export class LessonContentModule {}
