import { Module } from '@nestjs/common';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { AuthModule } from '../platform/auth/auth.module';
import { OBJECT_STORAGE } from '../platform/tokens';
import { LessonAudioController } from './lesson-audio.controller';
import { LESSON_AUDIO_STORE, LessonAudioService } from './lesson-audio.service';
import { PrismaLessonAudioStore } from './lesson-audio.store';
import { ParentNoticeController } from './parent-notice.controller';
import { ParentNoticeService } from './parent-notice.service';

/**
 * PD-48: computer-voice clips for the Arabic lessons, two teacher approvals
 * each. Separate from the Quran module on purpose: Quran recitation is never
 * TTS and never shares a table, a key prefix, a gate or a config key with this.
 * AuthModule gives PermissionService (PD-40).
 */
@Module({
  imports: [AuthModule],
  // ParentNotice*: the parents' lesson-audio notice (owner 2026-10-29).
  controllers: [LessonAudioController, ParentNoticeController],
  providers: [
    LessonAudioService,
    ParentNoticeService,
    { provide: LESSON_AUDIO_STORE, useClass: PrismaLessonAudioStore },
    // Clip URLs are short-lived signed reads, never a permanent public address.
    { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage },
  ],
})
export class LessonAudioModule {}
