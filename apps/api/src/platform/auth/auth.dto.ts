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
