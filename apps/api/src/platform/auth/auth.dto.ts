import type { Actor } from '../types';
import type { LiveSession, TokenPair } from './auth.service';

/**
 * The client-facing authentication shapes (API-CONTRACT §2, Phase 1 DTOs).
 *
 * EXPLICITLY CONSTRUCTED, NEVER SPREAD. Every field is named, so a field added
 * to `Actor`, to `chat.account` or to `chat.session` cannot reach a client by
 * accident. This is the same discipline the communication DTO mappers use, and
 * it is what the G-07 privacy test asserts structurally: no phone, no email, no
 * contact channel, no password material, no token hash.
 */
export interface ActorDto {
  readonly actorId: string;
  readonly kind: string;
  readonly displayName: string;
  readonly locale: string;
  readonly isActive: boolean;
  readonly staffRole: string | null;
  readonly familyId: string | null;
  readonly canMessage: boolean | null;
  readonly organizationId: string | null;
  readonly permissions: readonly string[];
}

export interface TokenPairDto {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly session: {
    readonly id: string;
    readonly createdAt: string;
    /** PD-23: "keep me signed in" is in effect. Admin Web stores the refresh token by this. */
    readonly remembered: boolean;
    /** PD-23: the refresh token must be used before this, or the session ends. */
    readonly expiresAt: string;
    /** PD-23: the session ends at this time regardless; null = no absolute limit. */
    readonly absoluteExpiresAt: string | null;
  };
  readonly actor: ActorDto;
}

/**
 * PD-23: one row of Devices & sessions. Named fields only: no ip hash, no user
 * agent, no token material -- a label and the times are all a person needs to
 * recognise a device.
 */
export interface SessionDto {
  readonly id: string;
  /** The session this request is made with. Always false in the admin view. */
  readonly current: boolean;
  readonly platform: string | null;
  readonly deviceName: string | null;
  readonly appVersion: string | null;
  readonly signedInAt: string;
  readonly lastSeenAt: string | null;
  readonly expiresAt: string;
  readonly remembered: boolean;
}

/** Current first, then most recently active -- the order a person reads it in. */
export function toSessionListDto(rows: readonly LiveSession[], currentSessionId: string | null): { sessions: SessionDto[] } {
  const sessions = rows.map((row) => ({
    id: row.id,
    current: row.id === currentSessionId,
    platform: row.platform,
    deviceName: row.deviceName,
    appVersion: row.appVersion,
    signedInAt: row.signedInAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    remembered: row.remembered,
  }));
  sessions.sort((a, b) => Number(b.current) - Number(a.current));
  return { sessions };
}

/**
 * `permissions` is UX only -- the client uses it to hide a page or a button it
 * would not be allowed to use, and the server re-decides every action
 * regardless.
 *
 * PD-40: GET /me fills it from chat.staff_access_profile (PermissionService),
 * the same answer PermissionGuard checks. Other responses that carry an actor
 * (login, refresh) send none: the client reads them from /me.
 */
export const NO_PERMISSIONS: readonly string[] = Object.freeze([]);

export function toActorDto(actor: Actor, permissions: readonly string[] = NO_PERMISSIONS): ActorDto {
  return {
    actorId: actor.actorId,
    kind: actor.kind,
    displayName: actor.displayName,
    locale: actor.locale,
    isActive: actor.isActive,
    staffRole: actor.staffRole ?? null,
    familyId: actor.familyId ?? null,
    canMessage: actor.canMessage ?? null,
    organizationId: actor.organizationId ?? null,
    permissions,
  };
}

export function toTokenPairDto(pair: TokenPair): TokenPairDto {
  return {
    tokenType: 'Bearer',
    accessToken: pair.accessToken,
    expiresIn: pair.expiresInSeconds,
    refreshToken: pair.refreshToken,
    session: {
      id: pair.sessionId,
      createdAt: pair.sessionCreatedAt.toISOString(),
      remembered: pair.remembered,
      expiresAt: pair.expiresAt.toISOString(),
      absoluteExpiresAt: pair.absoluteExpiresAt?.toISOString() ?? null,
    },
    actor: toActorDto(pair.actor),
  };
}
