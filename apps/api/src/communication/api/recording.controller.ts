import { Body, Controller, Delete, Get, Param, Post, UseFilters } from '@nestjs/common';
import { RecordingService } from '../calls/recording.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * Call recordings.
 *
 * `GET /recordings/:id` returns METADATA and never a URL. Playback is its own
 * POST, so that minting a capability is a distinct, audited act rather than a
 * side effect of reading a list -- `GET /recording/:id` must never become an
 * authorization bypass.
 */
@Controller('recordings')
@UseFilters(CommErrorFilter)
export class RecordingController {
  constructor(private readonly recordings: RecordingService) {}

  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.recordings.get(id, actorId);
  }

  /** Mint a short-lived signed URL. Authorized and audited on every call. */
  @Post(':id/playback')
  async playback(@ActorId() actorId: string, @Param('id') id: string) {
    return this.recordings.playback(id, actorId);
  }

  @Delete(':id')
  async remove(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.recordings.delete(id, actorId, body?.reason ?? '');
  }
}
