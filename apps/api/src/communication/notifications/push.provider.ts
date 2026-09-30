import { Injectable, Logger } from '@nestjs/common';

/**
 * PLATFORM SEAM for push delivery.
 *
 * The domain never imports an FCM/APNs client. Swap the implementation bound to
 * PUSH_PROVIDER to go live.
 */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Opaque routing data. Never a phone number. */
  data: Record<string, string>;
  /** VoIP pushes take the CallKit path on iOS. */
  isVoip: boolean;
  /**
   * The device's platform, from `chat.device_token.platform`.
   *
   * Added by W8-W1 so the selector can send each message through the transport
   * its destination actually uses -- APNs for iOS, FCM for the rest. A provider
   * cannot work this out from a token string, and guessing would put an Android
   * token on Apple's connection.
   */
  platform: string;
}

export interface PushResult {
  ok: boolean;
  /** Set when the token is permanently invalid, so it can be deactivated. */
  tokenInvalid?: boolean;
  failureCode?: string;
}

export interface PushProvider {
  send(message: PushMessage): Promise<PushResult>;
}

/**
 * Development provider. It reports "sent" and nothing more.
 *
 * It deliberately does NOT report delivery: no real acknowledgement exists, and
 * fabricating one would make the delivery metrics lie.
 */
@Injectable()
export class LoggingPushProvider implements PushProvider {
  private readonly log = new Logger(LoggingPushProvider.name);

  async send(message: PushMessage): Promise<PushResult> {
    // Titles and bodies can contain a parent's name; log only routing metadata.
    this.log.debug(`push -> token=${message.token.slice(0, 8)}... voip=${message.isVoip}`);
    return { ok: true };
  }
}
