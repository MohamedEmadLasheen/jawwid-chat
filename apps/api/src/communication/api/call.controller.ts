import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { CallService } from '../calls/call.service';
import { RecordingService } from '../calls/recording.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActionScope } from '../../platform/auth/throttle.service';
import { CommErrorFilter } from './http-exception.filter';

@Controller('calls')
@UseFilters(CommErrorFilter)
export class CallController {
  constructor(
    private readonly calls: CallService,
    private readonly recordings: RecordingService,
  ) {}

  /**
   * Start a call. The participant set comes from conversation membership and
   * the room name is minted server-side; neither is client-supplied.
   *
   * `mode: 'follow_up'` asks for a RECORDABLE call and is refused unless the
   * caller holds `calls.record`. A missing or unrecognised mode yields a normal
   * call, so a bug that drops the field produces an unrecorded call rather than
   * a recorded one.
   */
  @RateLimited(ActionScope.CALL_START)
  @Post()
  async start(
    @ActorId() actorId: string,
    @Body() body: { conversationId: string; mode?: string; type?: string },
  ) {
    return this.calls.start(body.conversationId, actorId, { mode: body.mode, type: body.type });
  }

  /**
   * A teacher opens the class. The invitation text is rendered per recipient
   * from a template, in their own locale -- no sentence travels from here.
   */
  @RateLimited(ActionScope.CALL_START)
  @Post('class')
  async startClass(@ActorId() actorId: string, @Body() body: { conversationId: string }) {
    return this.calls.startClassCall(body.conversationId, actorId);
  }

  /**
   * Mint a short-lived media token. Re-runs the full authorization chain, so a
   * revoked permission takes effect on the next join even mid-call.
   */
  @Post(':id/token')
  async token(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.issueToken(id, actorId);
  }

  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.get(id, actorId);
  }

  // Every transition below returns the call's RESULTING state rather than
  // `{ ok: true }`. A client that has just acted on a call needs to know what
  // the server decided -- especially when its request was a no-op because
  // somebody else got there first.

  @Post(':id/accept')
  async accept(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.accept(id, actorId);
  }

  @Post(':id/decline')
  async decline(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.decline(id, actorId);
  }

  /** The caller hangs up before anybody answers. Initiator only. */
  @Post(':id/cancel')
  async cancel(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.cancel(id, actorId);
  }

  @Post(':id/end')
  async end(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { outcome?: string },
  ) {
    return this.calls.end(id, actorId, body?.outcome);
  }

  // --- Recording, on a follow-up call --------------------------------------

  @Post(':id/recording')
  async startRecording(@ActorId() actorId: string, @Param('id') id: string) {
    return this.recordings.start(id, actorId);
  }

  /** Called by the media pipeline once the file is written. Idempotent. */
  @Post(':id/recording/complete')
  async completeRecording(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { durationSeconds: number; byteSize: number },
  ) {
    return this.recordings.complete(id, {
      durationSeconds: body?.durationSeconds ?? 0,
      byteSize: body?.byteSize ?? 0,
      actorId,
    });
  }

  @Post(':id/recording/fail')
  async failRecording(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { failureCode?: string },
  ) {
    return this.recordings.fail(id, body?.failureCode ?? 'UNKNOWN', actorId);
  }

  @Get('history/:conversationId')
  async history(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { calls: await this.calls.history(conversationId, actorId) };
  }
}
