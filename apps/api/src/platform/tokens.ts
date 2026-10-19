/** DI tokens for seams AI #1 (or an infrastructure choice) replaces. */
export const IDENTITY_SERVICE = Symbol('IdentityService');
export const COVERAGE_SERVICE = Symbol('CoverageService');
export const AUDIT_SERVICE = Symbol('AuditService');
export const OBJECT_STORAGE = Symbol('ObjectStorage');
export const PUSH_PROVIDER = Symbol('PushProvider');
export const MEDIA_TOKEN_ISSUER = Symbol('MediaTokenIssuer');
/** RT-037: server-side room membership control (LiveKit RoomService). */
export const MEDIA_ROOM_CONTROL = Symbol('MediaRoomControl');
export const REALTIME_PUBLISHER = Symbol('RealtimePublisher');
/** RT-009: the push half of realtime revocation (RealtimeRevocationHub). */
export const REALTIME_REVOCATION = Symbol('RealtimeRevocation');
/**
 * Resolves the teacher<->parent teaching relationship (introduced by PD-6). Since PD-7
 * it opens no channel -- direct teacher<->parent is refused whatever it says.
 */
export const RELATIONSHIP_SERVICE = Symbol('RelationshipService');
/** PD-8: the staff conversation scope (chat.staff_conversation_access). */
export const STAFF_SCOPE = Symbol('StaffScope');
