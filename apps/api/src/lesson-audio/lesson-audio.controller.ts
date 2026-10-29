import { Body, Controller, Get, Header, Param, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { Requires, SelfService } from '../platform/permissions/route-access';
import type { Actor } from '../platform/types';
import { LessonAudioService } from './lesson-audio.service';

/**
 * PD-48: lesson voice-over (docs/product/pd048-lesson-voice-over-design.md §7.4, §9).
 * No route takes an object key: clips are named by id, strings by the lesson's
 * own ids, and every URL is signed by the service after its checks. POST for
 * every change: the shared Admin Web client has no PUT.
 */
@Controller('lesson-audio')
@UseFilters(CommErrorFilter)
export class LessonAudioController {
  constructor(private readonly audio: LessonAudioService) {}

  // -- the review page (Teachers department) ------------------------------------

  @Requires('lesson_audio.view', 'lesson_audio.review')
  @Get('access')
  access(@CurrentActor() actor: Actor) {
    return this.audio.access(actor);
  }

  @Requires('lesson_audio.view', 'lesson_audio.review')
  @Get('review/:lesson')
  summary(@Param('lesson') lesson: string, @CurrentActor() actor: Actor) {
    return this.audio.summary(lesson, actor);
  }

  @Requires('lesson_audio.view', 'lesson_audio.review')
  @Get('review/:lesson/units/:unit')
  // Signed URLs for this reviewer only: never cached or shared.
  @Header('Cache-Control', 'private, no-store')
  unit(@Param('lesson') lesson: string, @Param('unit') unit: string, @CurrentActor() actor: Actor) {
    return this.audio.unit(lesson, unit, actor);
  }

  @Requires('lesson_audio.review')
  @Post('clips/:clipId/approve')
  approve(@Param('clipId') clipId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.audio.reviewClip(clipId, 'approve', body ?? {}, actor);
  }

  @Requires('lesson_audio.review')
  @Post('clips/:clipId/reject')
  reject(@Param('clipId') clipId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.audio.reviewClip(clipId, 'reject', body ?? {}, actor);
  }

  @Requires('lesson_audio.review')
  @Post('clips/:clipId/withdraw')
  withdraw(@Param('clipId') clipId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.audio.reviewClip(clipId, 'withdraw', body ?? {}, actor);
  }

  @Requires('lesson_audio.review')
  @Post('strings/:lesson/:stringId/decision')
  decide(@Param('lesson') lesson: string, @Param('stringId') stringId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.audio.decide(lesson, stringId, body ?? {}, actor);
  }

  // -- the learner -------------------------------------------------------------

  /** A lesson's approved clips this account may hear, each a short-lived signed URL. */
  // PD-40: any signed-in account asks; the release gate decides -- self-service, as GET /quran/ayahs.
  @SelfService()
  @RateLimited(ActionScope.LESSON_AUDIO_READ)
  @Get(':lesson')
  @Header('Cache-Control', 'private, no-store')
  learner(@Param('lesson') lesson: string, @CurrentActor() actor: Actor) {
    return this.audio.learnerAudio(lesson, actor);
  }
}
