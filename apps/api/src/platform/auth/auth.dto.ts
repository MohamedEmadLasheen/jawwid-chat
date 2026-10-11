import type { Actor } from '../types';
import type { TokenPair } from './auth.service';

/**
 * The client-facing authentication shapes (API-CONTRACT §2, Phase 1 DTOs).
 *
 * EXPLICITLY CONSTRUCTED, NEVER SPREAD. Every field is named, so a field added
 * to `Actor`, to `chat.account` or to `chat.session` cannot reach a client by
 * accident. This is the same discipline the communication DTO mappers use, and
 * it is what the G-07 privacy test asserts structurally: no phone, no email, no
 * contact channel, no password material, no token hash.
 */
/**
 * The ONE address an account photo is published at (M1).
 *
 * Root-relative on purpose. The server does not know the URL a client reached it by --
 * behind a proxy or a LAN hostname it would guess wrong -- and the client already knows
 * its own API base, so it resolves this against that base in exactly one place. The
 * alternative, a server-side public-base variable, was rejected: the only one that exists
 * is `STORAGE_PUBLIC_BASE_URL`, which configures the local storage signer and is ignored
 * outright when S3 is selected.
 */
export const ACTOR_AVATAR_IMAGE_PATH = '/api/v1/me/avatar/image';

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

  /**
   * Where to fetch this account's photo, or null when it has none.
   *
   * A STABLE application path, never a presigned URL and never an object key. `/me` performs
   * NO signing: a session outlives any signature, so an identity carrying a signed URL would
   * render once and then rot — indistinguishable on screen from "the photo never changed".
   * The signature is minted per read, by the endpoint this points at.
   *
   * The same constant for every actor, so it reveals nothing about the key behind it.
   */
  readonly avatarUrl: string | null;
}

export interface TokenPairDto {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly session: { readonly id: string; readonly createdAt: string };
  readonly actor: ActorDto;
}

/**
 * `permissions` is UX only -- the client uses it to hide a button it would not
 * be allowed to press, and the server re-decides every action regardless.
 *
 * EMPTY BY DECISION, not by omission. `chat.role_permission` is deferred, and
 * the alternative -- mirroring AUTHORIZATION-MODEL §3's matrix into a
 * TypeScript constant -- would create a second source of truth that can drift
 * from `AuthorizationService` silently. An empty array is honest: the client
 * shows everything and the server refuses what it must. When the table lands,
 * this is the only line that changes.
 */
export const PERMISSIONS_DEFERRED: readonly string[] = Object.freeze([]);

export function toActorDto(actor: Actor): ActorDto {
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
    permissions: PERMISSIONS_DEFERRED,
    // The KEY decides whether there is a photo; the PATH is what we publish. No signing
    // here, and the key itself never leaves the server.
    avatarUrl: actor.avatarObjectKey ? ACTOR_AVATAR_IMAGE_PATH : null,
  };
}

export function toTokenPairDto(pair: TokenPair): TokenPairDto {
  return {
    tokenType: 'Bearer',
    accessToken: pair.accessToken,
    expiresIn: pair.expiresInSeconds,
    refreshToken: pair.refreshToken,
    session: { id: pair.sessionId, createdAt: pair.sessionCreatedAt.toISOString() },
    actor: toActorDto(pair.actor),
  };
}
