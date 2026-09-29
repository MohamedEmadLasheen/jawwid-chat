import { Logger } from '@nestjs/common';
import { ApnsPushProvider, type ApnsConfig } from './apns.provider';
import { FcmPushProvider, type FcmConfig } from './fcm.provider';
import { LoggingPushProvider, type PushMessage, type PushProvider, type PushResult } from './push.provider';

/**
 * Which push transport this process runs. Configured, not compiled.
 *
 * Same shape as `storage.provider.ts`, and for the same reasons: no provider is
 * named in application code, pointing staging at one set of credentials and
 * production at another is a configuration decision, and a **partial**
 * configuration refuses to start rather than booting into a half-working
 * pipeline that every dashboard reports as healthy.
 *
 * ## Absent configuration is a laptop, not a failure
 *
 * With no APNs and no FCM variables set, delivery falls back to
 * [LoggingPushProvider] — which is exactly the behaviour before W8-W1. A
 * developer machine keeps working and no notification is silently lost, because
 * `NotificationService` still records every scheduled row.
 */
const APNS_VARS = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_KEY', 'APNS_BUNDLE_ID'] as const;
const FCM_VARS = ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'] as const;

/**
 * THE iOS VoIP ACTIVATION GATE. Default OFF, and it must stay off until W8-W3.
 *
 * A PushKit delivery obliges the app to report an incoming call to CallKit
 * almost immediately; an app that does not is terminated, and repeated offences
 * cost the VoIP entitlement. W8-W1 builds the transport, the routing and the
 * token plumbing — it does NOT build the CallKit reporting path, which is
 * W8-W3's.
 *
 * So VoIP pushes are constructed, routed and testable here, and are not
 * delivered to Apple until `APNS_VOIP_ENABLED=true` is set. Turning it on is the
 * single, deliberate act that makes iOS calls live, and it belongs to whoever
 * ships W8-W3.
 *
 * This is a gate, not a stub: nothing here fakes CallKit, and nothing invents a
 * second call lifecycle to work around it.
 */
const VOIP_GATE = 'APNS_VOIP_ENABLED';

export interface PushSelection {
  provider: PushProvider;
  /** For the startup log and for tests to assert on. */
  kind: 'logging' | 'apns' | 'fcm' | 'apns+fcm';
  voipEnabled: boolean;
}

export function selectPushProvider(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('PushProvider'),
): PushSelection {
  const apnsConfig = readGroup('APNs', APNS_VARS, env);
  const fcmConfig = readGroup('FCM', FCM_VARS, env);
  const voipEnabled = (env[VOIP_GATE] ?? '').trim().toLowerCase() === 'true';

  if (!apnsConfig && !fcmConfig) {
    logger.warn(
      'push delivery is the logging provider: notifications are scheduled and ' +
        'recorded but never leave this process. Set ' +
        APNS_VARS.join(', ') +
        ' and/or ' +
        FCM_VARS.join(', ') +
        ' to deliver for real.',
    );
    return { provider: new LoggingPushProvider(), kind: 'logging', voipEnabled: false };
  }

  const apns = apnsConfig
    ? new ApnsPushProvider({
        keyId: apnsConfig.APNS_KEY_ID,
        teamId: apnsConfig.APNS_TEAM_ID,
        key: apnsConfig.APNS_KEY,
        bundleId: apnsConfig.APNS_BUNDLE_ID,
        production: (env.NODE_ENV ?? '') === 'production',
      })
    : null;

  const fcm = fcmConfig
    ? new FcmPushProvider({
        projectId: fcmConfig.FCM_PROJECT_ID,
        clientEmail: fcmConfig.FCM_CLIENT_EMAIL,
        privateKey: fcmConfig.FCM_PRIVATE_KEY,
      })
    : null;

  const kind = apns && fcm ? 'apns+fcm' : apns ? 'apns' : 'fcm';
  logger.log(
    `push delivery: ${kind}; iOS VoIP ${voipEnabled ? 'ENABLED' : 'gated off'}`,
  );
  if (apns && !voipEnabled) {
    logger.warn(
      `APNs is configured but iOS VoIP delivery is gated off. Calls will not ` +
        `ring on iOS until ${VOIP_GATE}=true, which must not be set before the ` +
        'native CallKit path exists (W8-W3).',
    );
  }

  return {
    provider: new PlatformRoutedPushProvider({ apns, fcm, voipEnabled }),
    kind,
    voipEnabled,
  };
}

/**
 * Sends each message through the transport its destination actually uses.
 *
 * It routes by PLATFORM, which the notification layer knows and a provider does
 * not. It decides nothing about WHO may be notified or WHICH devices are
 * eligible — `call-push-routing.ts` settled that before this is reached.
 *
 *   VoIP token      -> APNs, push-type `voip`   (behind the activation gate)
 *   iOS token       -> APNs, push-type `alert`
 *   anything else   -> FCM
 */
export class PlatformRoutedPushProvider implements PushProvider {
  private readonly log = new Logger(PlatformRoutedPushProvider.name);

  constructor(
    private readonly transports: {
      apns: PushProvider | null;
      fcm: PushProvider | null;
      voipEnabled: boolean;
    },
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    if (message.isVoip) {
      if (!this.transports.voipEnabled) {
        // NOT DELIVERED, and not pretended otherwise. Reported as a failure so
        // the notification is retried later rather than recorded as sent: when
        // the gate opens, the call that was not delivered is long over, but the
        // metrics will not claim it rang.
        this.log.warn('push: a VoIP message was not delivered; the iOS VoIP gate is closed');
        return { ok: false, failureCode: 'VOIP_GATED' };
      }
      return this.viaOr(this.transports.apns, 'APNS_UNCONFIGURED', message);
    }

    if (message.platform === 'ios') {
      return this.viaOr(this.transports.apns, 'APNS_UNCONFIGURED', message);
    }

    return this.viaOr(this.transports.fcm, 'FCM_UNCONFIGURED', message);
  }

  /**
   * A message with no transport is a failure, never a silent success.
   *
   * `tokenInvalid` is deliberately NOT set: the device is fine, our deployment
   * is not, and deactivating a working phone because a credential is missing
   * would be the worst possible response.
   */
  private async viaOr(
    provider: PushProvider | null,
    failureCode: string,
    message: PushMessage,
  ): Promise<PushResult> {
    if (!provider) {
      this.log.warn(`push: no transport for platform "${message.platform}" (${failureCode})`);
      return { ok: false, failureCode };
    }
    return provider.send(message);
  }
}

/**
 * All of a credential group, or none of it.
 *
 * A half-set group throws at startup with the names of what is missing, for the
 * reason the storage selector gives: the dangerous state is not "unconfigured",
 * it is "configured enough to look configured".
 */
function readGroup<const T extends readonly string[]>(
  label: string,
  names: T,
  env: NodeJS.ProcessEnv,
): Record<T[number], string> | null {
  const present = names.filter((name) => (env[name] ?? '').trim().length > 0);
  if (present.length === 0) return null;

  if (present.length !== names.length) {
    const missing = names.filter((name) => !present.includes(name));
    throw new Error(
      `${label} push is partially configured: ${present.join(', ')} set, ` +
        `${missing.join(', ')} missing. Set all of ${names.join(', ')} or none of ` +
        'them. Starting with a partial configuration would report a healthy push ' +
        'pipeline that silently delivers nothing.',
    );
  }

  return Object.fromEntries(
    names.map((name) => [name, (env[name] ?? '').trim()]),
  ) as Record<T[number], string>;
}
