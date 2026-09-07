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
   * Which platform this token belongs to.
   *
   * The routing provider dispatches on it. It comes from the `device_token`
   * row, which is written at registration by a client that knows what it is --
   * never inferred from the token's shape, which is a format that has changed
   * before and will again.
   */
  platform?: string;

  /**
   * Which notification THREAD this belongs to, on the device.
   *
   * One conversation, one stack. Both platforms group by an application-chosen
   * identifier -- `apns-thread-id` on iOS, the notification tag on Android --
   * and without one, ten messages from one parent arrive as ten separate
   * entries that bury everything else on the lock screen.
   */
  threadId?: string;

  /**
   * Which notification this REPLACES.
   *
   * Distinct from [threadId], and the distinction matters. A thread groups; a
   * collapse id supersedes. It is set to something derived from the
   * notification's identity, so the duplicate that at-least-once delivery
   * produces -- a worker that pushed successfully and died before recording it
   * -- replaces the first one on the lock screen instead of appearing beside
   * it. The delivery guarantee is honestly at-least-once; this is what stops
   * the user experiencing it as such.
   */
  collapseId?: string;

  /**
   * `critical` and `high` are delivered immediately; `normal` and `low` may be
   * batched by the platform to save the radio.
   */
  priority?: string;
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
 * Sends each push through the provider for ITS platform.
 *
 * `NotificationService` iterates a recipient's device tokens and hands each to
 * one PushProvider. That works for one platform and silently misroutes with
 * two: an APNs token posted to FCM is rejected as an invalid registration, and
 * this pipeline retires a token the provider calls invalid -- so a single
 * mis-wired provider would deactivate every iPhone in the tenant, one push at
 * a time, and look like users turning notifications off.
 *
 * Dispatching here rather than inside NotificationService keeps the domain free
 * of platform names: it still depends on one PushProvider, and which concrete
 * client answers is a composition decision.
 */
@Injectable()
export class PlatformRoutingPushProvider implements PushProvider {
  private readonly log = new Logger(PlatformRoutingPushProvider.name);

  constructor(
    private readonly providers: Record<string, PushProvider>,
    private readonly fallback: PushProvider,
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    const provider = this.providers[message.platform ?? ''] ?? this.fallback;
    if (provider === this.fallback && message.platform) {
      // Loud, because the alternative is a platform whose notifications quietly
      // never arrive in production while every test passes.
      this.log.warn(
        `no push provider configured for platform '${message.platform}'; ` +
          'this notification will not reach a device',
      );
    }
    return provider.send(message);
  }
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
