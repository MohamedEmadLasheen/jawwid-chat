import { Module } from '@nestjs/common';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { AuthModule } from '../platform/auth/auth.module';
import { OBJECT_STORAGE } from '../platform/tokens';
import { LessonAudioController } from './lesson-audio.controller';
import { LESSON_AUDIO_STORE, LessonAudioService } from './lesson-audio.service';
import { PrismaLessonAudioStore } from './lesson-audio.store';

/**
 * PD-48: computer-voice clips for the Arabic lessons, two teacher approvals
 * each. Separate from the Quran module on purpose: Quran recitation is never
 * TTS and never shares a table, a key prefix, a gate or a config key with this.
 * AuthModule gives PermissionService (PD-40).
 */
@Module({
  imports: [AuthModule],
  controllers: [LessonAudioController],
  providers: [
    LessonAudioService,
    { provide: LESSON_AUDIO_STORE, useClass: PrismaLessonAudioStore },
    // Clip URLs are short-lived signed reads, never a permanent public address.
    { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage },
  ],
})
export class LessonAudioModule {}
