import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { ScopeService } from '../../platform/scope.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { CallMode, CallStatus, RecordingStatus } from '../contracts/vocab';

export interface RecordingView {
  id: string;
  callId: string;
  status: string;
  durationSeconds: number | null;
  byteSize: string | null;
  startedAt: string;
  completedAt: string | null;
  retentionExpiresAt: string | null;
  /** Never a URL. Playback is a separate, audited request. */
}

/**
 * CALL RECORDING.
 *
 * A capability deliberately SEPARATE from ordinary calling, in every dimension:
 * a different permission to start one, a different permission to hear one, its
 * own table, its own retention clock, and its own audit trail.
 *
 * ## The four rules, and why each exists
 *
 * 1. ONLY A FOLLOW-UP CALL CAN BE RECORDED. `mode` is fixed when the call is
 *    created by an actor holding `calls.record`; a NORMAL call can never grow a
 *    recording, and a database trigger (chat.enforce_recording_mode) refuses
 *    the row rather than trusting this service to remember. Recording is never
 *    a per-request flag, because "record this call" must not be something a
 *    client can switch on mid-call or ask for on a call it merely joined.
 *
 * 2. THE AUDIO IS NEVER REACHABLE BY REFERENCE. The table stores an object key
 *    into private storage. No column holds a URL, and no read path returns one.
 *    A stored URL is a bearer credential that outlives every check that
 *    produced it -- put one in a call-history row and the authorization model
 *    for recordings becomes "whoever has ever seen the history".
 *
 * 3. PLAYBACK IS AUTHORIZED PER REQUEST, AND AUDITED. `GET /recordings/:id`
 *    resolves nothing on its own. Every playback re-runs the permission and the
 *    family-scope check against LIVE data, so a supervisor who lost the family
 *    yesterday cannot play the call today, and mints a URL that expires in
 *    minutes.
 *
 * 4. NOTHING IS KEPT FOREVER BY OMISSION. Every available recording carries
 *    `retention_expires_at` -- a CHECK constraint refuses one without it -- and
 *    a sweep deletes the object and tombstones the row.
 *
 * ## Who may hear a recording, stated plainly
 *
 * Holders of `recordings.read` (admin, coverage_admin, manager, super_admin)
 * for calls whose family is in their live scope. NOT the participants. Everyone
 * on a call heard it; the right to have been present is not the right to keep a
 * copy of somebody else's voice, and a parent with playback of a call is a
 * distribution surface for the teacher who was on it. This is enforced here and
 * again by the RLS policy on chat.call_recording, which gives a contact or a
 * teacher no read path at all -- so they cannot even discover that a recording
 * EXISTS by probing ids.
 */
@Injectable()
export class RecordingService {
  private readonly log = new Logger(RecordingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    private readonly conversations: ConversationService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Begin recording a follow-up call, and authorize the upload of the audio.
   *
   * Returns an upload authorization for the media pipeline (the LiveKit egress
   * worker, or whatever writes the file) rather than accepting bytes here: the
   * API never proxies media, exactly as it never proxies an attachment.
   */
  async start(
    callId: string,
    actorId: string,
  ): Promise<{ recording: RecordingView; upload: UploadAuthorization }> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.CALLS_RECORD);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { recording: true },
    });
    if (!call) throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);

    // Scope, live. Holding calls.record says nothing about WHICH families.
    await this.requireCallInScope(actor, call.familyId);

    if (call.mode !== CallMode.FOLLOW_UP) {
      throw new CommError(
        CommErrorCode.RECORDING_NOT_PERMITTED_FOR_MODE,
        'only a follow-up call may be recorded; this call is a normal call',
        409,
      );
    }
    if (call.status === CallStatus.ENDED) {
      throw new CommError(CommErrorCode.CALL_ALREADY_ENDED, 'this call has ended', 409);
    }
    if (call.recording) {
      throw new CommError(
        CommErrorCode.RECORDING_ALREADY_EXISTS,
        'this call is already being recorded',
        409,
      );
    }

    // A key under the CALL, not under the conversation: an object key is a
    // capability shape, and keeping recordings out of the attachment prefix
    // means a signing bug in one cannot mint a URL into the other.
    const upload = await this.storage.authorizeUpload({
      prefix: `recordings/${callId}`,
      mimeType: 'audio/mp4',
      byteSize: 0,
    });

    const recording = await this.prisma.$transaction(async (tx) => {
      const created = await tx.callRecording.create({
        data: {
          callId,
          objectKey: upload.objectKey,
          status: RecordingStatus.PENDING,
          mimeType: 'audio/mp4',
          startedBy: actor.actorId,
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'recording.started',
        entity: 'call_recording',
        entityId: created.id,
        after: { callId, status: RecordingStatus.PENDING },
        reason: 'recording started on a follow-up call',
      });
      await this.audit.event(tx, {
        familyId: call.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'recording_started',
        payload: { callId, recordingId: created.id },
      });

      return created;
    });

    return { recording: this.toView(recording), upload };
  }

  /**
   * The media pipeline reports that the file is written.
   *
   * This is where retention starts, and where the recording becomes playable.
   * Both in one step so that no recording can exist in an available state
   * without an expiry -- the CHECK constraint refuses that row, which is the
   * point.
   */
  async complete(
    callId: string,
    input: { durationSeconds: number; byteSize: number; actorId: string },
  ): Promise<RecordingView> {
    const actor = await this.conversations.requireActor(input.actorId);
    const decision = this.authz.can(actor, Permission.CALLS_RECORD);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const recording = await this.requireRecordingByCall(callId);
    await this.requireCallInScopeById(actor, callId);

    if (recording.status !== RecordingStatus.PENDING) {
      // Idempotent: a media pipeline that retries its callback finds the
      // recording already complete and is told so, not told off.
      return this.toView(recording);
    }

    const retentionDays = await this.config.get('recording.retention_days');
    const now = new Date();
    const expires = new Date(now.getTime() + Number(retentionDays) * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.callRecording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.AVAILABLE,
          durationSeconds: input.durationSeconds,
          byteSize: BigInt(input.byteSize),
          completedAt: now,
          retentionExpiresAt: expires,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'recording.completed',
        entity: 'call_recording',
        entityId: row.id,
        after: {
          status: RecordingStatus.AVAILABLE,
          durationSeconds: input.durationSeconds,
          retentionExpiresAt: expires.toISOString(),
        },
        reason: 'recording written to storage and retention started',
      });
      return row;
    });

    return this.toView(updated);
  }

  /** The media pipeline reports that it could not produce a file. */
  async fail(callId: string, failureCode: string, actorId: string): Promise<RecordingView> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.CALLS_RECORD);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const recording = await this.requireRecordingByCall(callId);
    await this.requireCallInScopeById(actor, callId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.callRecording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.FAILED,
          // Never a provider message: it can echo a key or a URL.
          failureCode: failureCode.slice(0, 64),
          completedAt: new Date(),
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'recording.failed',
        entity: 'call_recording',
        entityId: row.id,
        after: { status: RecordingStatus.FAILED, failureCode: row.failureCode },
        reason: 'the media pipeline could not produce a recording',
      });
      return row;
    });

    return this.toView(updated);
  }

  /**
   * Mint a short-lived playback URL.
   *
   * The order of the checks is the security property, and it is the order
   * written here: authenticate, authorize the PERMISSION, authorize the SCOPE,
   * confirm the recording exists, confirm it is still within retention, and
   * only then sign. Nothing before the last line produces a capability, so
   * failing any check produces no URL rather than a URL nobody looked at.
   *
   * Every one of these is audited, including the refusals, because "who tried
   * to listen to this call" is exactly the question an audit trail on
   * recordings exists to answer.
   */
  async playback(
    recordingId: string,
    actorId: string,
  ): Promise<{ url: string; expiresAt: string; durationSeconds: number | null }> {
    const actor = await this.conversations.requireActor(actorId);

    const decision = this.authz.can(actor, Permission.RECORDINGS_READ);
    if (!decision.allowed) {
      await this.auditRefusal(actor, recordingId, 'permission');
      throw new CommError(decision.code, decision.reason);
    }

    const recording = await this.prisma.callRecording.findUnique({
      where: { id: recordingId },
      include: { call: { select: { id: true, familyId: true } } },
    });
    // A recording the caller may not reach is NOT FOUND, never FORBIDDEN.
    // Distinguishing them turns this route into an oracle: probe ids, and the
    // ones that answer "forbidden" are the calls that were recorded.
    if (!recording) {
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }

    if (!(await this.familyInScope(actor, recording.call.familyId))) {
      await this.auditRefusal(actor, recordingId, 'scope');
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }

    if (recording.status === RecordingStatus.DELETED) {
      throw new CommError(
        CommErrorCode.RECORDING_EXPIRED,
        'this recording has been deleted under the retention policy',
        410,
      );
    }
    if (recording.status !== RecordingStatus.AVAILABLE || !recording.objectKey) {
      throw new CommError(
        CommErrorCode.RECORDING_NOT_AVAILABLE,
        `this recording is ${recording.status}`,
        409,
      );
    }
    // Retention is checked against the CLOCK as well as the sweep, so a
    // recording whose expiry has passed is unplayable in the window before the
    // sweeper reaches it. A retention policy enforced only by a cron job is a
    // retention policy with a gap the length of the cron interval.
    if (recording.retentionExpiresAt && recording.retentionExpiresAt <= new Date()) {
      throw new CommError(
        CommErrorCode.RECORDING_EXPIRED,
        'this recording has passed its retention period',
        410,
      );
    }

    const ttl = Number(await this.config.get('recording.playback_url_ttl_seconds'));
    const url = await this.storage.signedReadUrl(recording.objectKey, ttl);

    await this.prisma.$transaction(async (tx) => {
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'recording.playback',
        entity: 'call_recording',
        entityId: recording.id,
        // The URL is deliberately NOT recorded. An audit log that stores the
        // capability it is auditing hands a copy to everyone who may read it.
        after: { callId: recording.callId, ttlSeconds: ttl },
        reason: 'authorized playback of a follow-up call recording',
      });
      await this.audit.event(tx, {
        familyId: recording.call.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'recording_accessed',
        payload: { recordingId: recording.id, callId: recording.callId },
      });
    });

    return {
      url,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      durationSeconds: recording.durationSeconds,
    };
  }

  /** Recording metadata for an authorized reader. Never a URL. */
  async get(recordingId: string, actorId: string): Promise<RecordingView> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.RECORDINGS_READ);
    if (!decision.allowed) {
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }
    const recording = await this.prisma.callRecording.findUnique({
      where: { id: recordingId },
      include: { call: { select: { familyId: true } } },
    });
    if (!recording || !(await this.familyInScope(actor, recording.call.familyId))) {
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }
    return this.toView(recording);
  }

  /**
   * Delete a recording ahead of its retention date.
   *
   * A reason is required and is not optional prose: deleting evidence of a
   * conversation is exactly the act an audit trail has to be able to explain.
   */
  async delete(recordingId: string, actorId: string, reason: string): Promise<RecordingView> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.RECORDINGS_READ);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    if (!reason || reason.trim().length === 0) {
      throw new CommError(
        CommErrorCode.APPROVAL_REASON_REQUIRED,
        'deleting a recording requires a reason',
        400,
      );
    }

    const recording = await this.prisma.callRecording.findUnique({
      where: { id: recordingId },
      include: { call: { select: { familyId: true } } },
    });
    if (!recording || !(await this.familyInScope(actor, recording.call.familyId))) {
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }
    if (recording.status === RecordingStatus.DELETED) return this.toView(recording);

    return this.tombstone(recording.id, actor.actorId, reason.trim());
  }

  /**
   * Retention sweep. Deletes every recording past its expiry.
   *
   * The row is TOMBSTONED rather than removed: "there was a recording of this
   * call and it was deleted on this date under retention" is a fact the academy
   * needs to be able to state, and a deleted row states nothing. What goes away
   * is the audio and the object key -- which is what retention is about.
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const batch = Number(await this.config.get('recording.retention_sweep_batch'));
    const due = await this.prisma.callRecording.findMany({
      where: {
        status: RecordingStatus.AVAILABLE,
        retentionExpiresAt: { not: null, lte: now },
      },
      orderBy: { retentionExpiresAt: 'asc' },
      take: Number.isFinite(batch) ? batch : 100,
      select: { id: true },
    });

    let deleted = 0;
    for (const row of due) {
      try {
        await this.tombstone(row.id, null, 'retention period elapsed');
        deleted += 1;
      } catch (err) {
        // One failure must not stop the sweep, or a single wedged row keeps
        // every later recording past its retention date indefinitely.
        this.log.warn(
          `retention sweep could not delete recording ${row.id}: ` +
            (err instanceof Error ? err.message : 'unknown'),
        );
      }
    }
    return deleted;
  }

  private async tombstone(
    recordingId: string,
    actorId: string | null,
    reason: string,
  ): Promise<RecordingView> {
    const now = new Date();

    // THE AUDIO GOES FIRST, and the row is only tombstoned once it is gone.
    //
    // The other order looks equivalent and is not: clearing the key first and
    // then deleting means a failure between the two leaves a row that says
    // "deleted under retention" pointing at an object still sitting in the
    // bucket, with nothing left in the database that knows where it is. That is
    // a retention policy that reports compliance it did not achieve, and it is
    // unrecoverable because the key was the only reference.
    //
    // This way round, a failed delete throws before anything is written, the
    // row keeps its key, and the next sweep tries again.
    const current = await this.prisma.callRecording.findUnique({
      where: { id: recordingId },
      select: { objectKey: true },
    });
    if (current?.objectKey) {
      await this.storage.delete(current.objectKey);
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.callRecording.update({
        where: { id: recordingId },
        data: {
          status: RecordingStatus.DELETED,
          // The key goes with the audio. Leaving it behind would keep the
          // object addressable by anyone who can read this table.
          objectKey: null,
          deletedAt: now,
          deletedReason: reason,
        },
      });
      await this.audit.audit(tx, {
        actorId,
        action: 'recording.deleted',
        entity: 'call_recording',
        entityId: recordingId,
        after: { status: RecordingStatus.DELETED, deletedAt: now.toISOString() },
        reason,
      });
      return this.toView(row);
    });
  }

  private async requireRecordingByCall(callId: string) {
    const recording = await this.prisma.callRecording.findUnique({ where: { callId } });
    if (!recording) {
      throw new CommError(CommErrorCode.RECORDING_NOT_FOUND, 'recording not found', 404);
    }
    return recording;
  }

  private async requireCallInScopeById(actor: Actor, callId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { familyId: true },
    });
    if (!call) throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);
    await this.requireCallInScope(actor, call.familyId);
  }

  private async requireCallInScope(actor: Actor, familyId: string | null): Promise<void> {
    if (!(await this.familyInScope(actor, familyId))) {
      throw new CommError(CommErrorCode.OUT_OF_SCOPE, 'this call is outside your scope', 404);
    }
  }

  private async familyInScope(actor: Actor, familyId: string | null): Promise<boolean> {
    // A call with no family is a staff-to-staff or staff-to-teacher call. Scope
    // is a statement about families, so it cannot narrow this one; the
    // permission check already did the work.
    if (!familyId) return true;
    return this.scope.canAccessFamily(actor, familyId);
  }

  private async auditRefusal(actor: Actor, recordingId: string, cause: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'recording.playback_refused',
        entity: 'call_recording',
        entityId: recordingId,
        after: { cause },
        reason: `playback refused: ${cause}`,
      });
    });
  }

  private toView(r: {
    id: string;
    callId: string;
    status: string;
    durationSeconds: number | null;
    byteSize: bigint | null;
    startedAt: Date;
    completedAt: Date | null;
    retentionExpiresAt: Date | null;
  }): RecordingView {
    return {
      id: r.id,
      callId: r.callId,
      status: r.status,
      durationSeconds: r.durationSeconds,
      // A bigint would not survive JSON.stringify.
      byteSize: r.byteSize == null ? null : r.byteSize.toString(),
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      retentionExpiresAt: r.retentionExpiresAt?.toISOString() ?? null,
    };
  }
}
