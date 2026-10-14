import { Injectable } from '@nestjs/common';
import { RoomServiceClient } from 'livekit-server-sdk';

/**
 * RT-037 -- server-side control of who is IN a media room.
 *
 * A LiveKit join token is a bearer credential: once issued it admits its
 * holder until it expires (and LiveKit 1.8 accepts it ~60 s past `exp`, its
 * JWT clock-skew leeway -- measured), and a participant already in a room stays
 * connected whatever happens to their account. Neither can be recalled through
 * the token. What CAN be done is to take the person out of the room, through
 * LiveKit's control plane (RoomService.RemoveParticipant), at two moments:
 *
 *   - when a deactivation is confirmed (RevocationConfirmer): every live call
 *     room the person is a participant of;
 *   - whenever LiveKit reports them joining a room (participant_joined
 *     webhook) while they are no longer live -- the rejoin with a token issued
 *     earlier, or with one LiveKit itself refreshed for them.
 */
export interface MediaRoomControl {
  /** False when no media server is configured: then nobody can be in a room. */
  readonly configured: boolean;
  /**
   * Take `identity` out of `roomName`. 'removed' once LiveKit confirmed it;
   * 'absent' when LiveKit says there is no such participant or room. Any other
   * outcome THROWS -- an unreachable or misconfigured control plane is never
   * reported as a removal.
   */
  removeParticipant(roomName: string, identity: string): Promise<'removed' | 'absent'>;
}

/** The control-plane URL for a LiveKit project, from its client (WebSocket) URL. */
export function livekitControlUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://');
}

@Injectable()
export class LiveKitRoomControl implements MediaRoomControl {
  private readonly url = process.env.LIVEKIT_URL ?? '';
  private readonly apiKey = process.env.LIVEKIT_API_KEY ?? '';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  private client?: RoomServiceClient;

  get configured(): boolean {
    return Boolean(this.url && this.apiKey && this.apiSecret);
  }

  async removeParticipant(roomName: string, identity: string): Promise<'removed' | 'absent'> {
    if (!this.configured) {
      // No media server: no token was ever issued (LiveKitTokenIssuer refuses
      // without the same three settings), so nobody can be in a room.
      return 'absent';
    }
    this.client ??= new RoomServiceClient(livekitControlUrl(this.url), this.apiKey, this.apiSecret);
    try {
      await this.client.removeParticipant(roomName, identity);
      return 'removed';
    } catch (e) {
      // Twirp `not_found` (404): the participant -- or the whole room -- is not
      // there. Anything else (401 bad credentials, 5xx, a network error) is a
      // failure and propagates: the caller must not count it as done.
      const err = e as { code?: string; status?: number };
      if (err?.code === 'not_found' || err?.status === 404) return 'absent';
      throw e;
    }
  }
}
