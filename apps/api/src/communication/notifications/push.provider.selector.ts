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
/**
 * THE NAMES COME FROM `infra/env/manifest.tsv`, the repository's single
 * machine-readable source of truth for configuration and what
 * `scripts/infra/check-env.sh` validates every deployment against.
 *
 * W8-W1 invented its own names instead of reading that file, and the two sets
 * disagreed: the manifest and `deploy-production.yml` supply
 * `FCM_SERVICE_ACCOUNT_JSON` and `APNS_PRIVATE_KEY`, while this selector looked
 * for `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY` and `APNS_KEY`. A real deployment
 * therefore presented 3 of 4 APNs variables and 1 of 3 FCM ones -- a PARTIAL
 * group -- and `readGroup` below would have refused to start the API at all.
 * The guard was right; the names were wrong.
 *
 * `APNS_PRODUCTION` belongs to the group rather than being a defaulted flag.
 * The manifest marks it `req` in production alongside the credentials, and
 * there is no safe default to pick: the sandbox silently DROPS production
 * device tokens and the production endpoint rejects sandbox ones, so a wrong
 * guess fails invisibly. Configuring APNs means saying which endpoint.
 */
const APNS_VARS = [
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_BUNDLE_ID',
  'APNS_PRIVATE_KEY',
  'APNS_PRODUCTION',
] as const;
const FCM_VARS = ['FCM_PROJECT_ID', 'FCM_SERVICE_ACCOUNT_JSON'] as const;

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
  const voipEnabled = isTrue(env[VOIP_GATE]);

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
        key: apnsConfig.APNS_PRIVATE_KEY,
        bundleId: apnsConfig.APNS_BUNDLE_ID,
        // The deployment's own word, not an inference from NODE_ENV. They are
        // two different questions -- a staging deployment can legitimately hold
        // production-issued device tokens -- and the manifest makes this the
        // variable that answers the second one.
        production: isTrue(apnsConfig.APNS_PRODUCTION),
      })
    : null;

  const fcm = fcmConfig
    ? new FcmPushProvider({
        projectId: fcmConfig.FCM_PROJECT_ID,
        ...serviceAccount(fcmConfig.FCM_SERVICE_ACCOUNT_JSON),
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
 * The word `true`, trimmed and case-insensitive. Nothing else is true.
 *
 * `1` and `yes` are NOT accepted, and that is the point: they are somebody's
 * assumption about what a flag takes, and a flag that guesses is how a sandbox
 * deployment quietly starts talking to Apple's production endpoint. Surrounding
 * whitespace and capitalisation are forgiven, because a secret store adds them
 * and an operator did not mean them.
 *
 * This is the VoIP gate's existing rule, unchanged, now shared with the APNs
 * endpoint so both flags answer to exactly the same word.
 */
function isTrue(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

/**
 * The two fields FCM signs with, read out of the service-account document that
 * `infra/env/manifest.tsv` declares.
 *
 * Google issues ONE document and that is what a secret store holds. Splitting
 * it into separate variables -- which W8-W1 did -- means transcribing a PEM by
 * hand into an environment variable, and is not the contract this repository
 * deploys with.
 *
 * NOTHING FROM THE DOCUMENT REACHES AN ERROR MESSAGE. A malformed value here is
 * a private key with a typo in it: the failure names which FIELD is missing and
 * never what was found, because a startup exception is the one place a
 * credential would be printed and then kept forever in a deployment log.
 */
function serviceAccount(raw: string): { clientEmail: string; privateKey: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'FCM_SERVICE_ACCOUNT_JSON is not valid JSON. It is the service-account ' +
        'document Google issues, stored verbatim.',
    );
  }

  const doc = parsed as { client_email?: unknown; private_key?: unknown };
  const clientEmail =
    typeof doc.client_email === 'string' ? doc.client_email.trim() : '';
  const privateKey = typeof doc.private_key === 'string' ? doc.private_key : '';

  if (!clientEmail || !privateKey) {
    const missing = [
      clientEmail ? null : 'client_email',
      privateKey ? null : 'private_key',
    ].filter(Boolean);
    throw new Error(
      `FCM_SERVICE_ACCOUNT_JSON is missing ${missing.join(' and ')}. Starting ` +
        'without it would report a healthy push pipeline that cannot ' +
        'authenticate to FCM.',
    );
  }

  return { clientEmail, privateKey };
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
