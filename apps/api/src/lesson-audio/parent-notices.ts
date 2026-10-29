/**
 * PD-48: the notices a parent acknowledges, each at its CURRENT version
 * (docs/product/pd048-lesson-voice-over-design.md §17 Q7, owner 2026-10-29).
 *
 *   lesson_audio  "lesson pronunciation audio is computer-generated and checked by
 *                 the academy's teachers before use" -- at sign-up, or once at the
 *                 next sign-in for families already enrolled.
 *
 * Bumping a version is the ONLY way to ask every parent again; the approved
 * wording itself lives in the app (lib/l10n) and the design doc, word for word.
 */
export const PARENT_NOTICES = { lesson_audio: 1 } as const;
export type ParentNoticeKey = keyof typeof PARENT_NOTICES;

export function isParentNoticeKey(key: string): key is ParentNoticeKey {
  return Object.prototype.hasOwnProperty.call(PARENT_NOTICES, key);
}

type Raw = { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> };

/**
 * Record that this parent contact acknowledged the notice's version
 * (chat.acknowledge_parent_notice: idempotent). The contact is ALWAYS the
 * authenticated one -- the token's actor, or the account sign-up just finished --
 * never an id from a request body. True when this call recorded it.
 */
export async function acknowledgeParentNotice(db: Raw, contactId: string, key: ParentNoticeKey, version: number): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ added: boolean }>>`
    SELECT chat.acknowledge_parent_notice(${contactId}::uuid, ${key}, ${version}::int) AS added`;
  return rows[0]?.added === true;
}

/** The versions of each notice this contact has acknowledged. */
export async function acknowledgedParentNotices(db: Raw, contactId: string): Promise<Array<{ key: string; version: number }>> {
  return db.$queryRaw<Array<{ key: string; version: number }>>`
    SELECT notice_key AS key, notice_version AS version FROM chat.parent_notice_ack WHERE contact_id = ${contactId}::uuid`;
}
