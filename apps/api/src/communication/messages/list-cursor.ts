import { CommError, CommErrorCode } from '../../platform/errors';

/**
 * LR-38 (RT-017/RT-018): the `before` / `after` cursors of the message list,
 * checked where they enter, before anything reaches `BigInt(...)` or the query.
 *
 * - A cursor is a whole-number string of a message `seq`. Anything else
 *   ("abc", "1.5", "-3", "1e3", a repeated query parameter) is a 400, where it
 *   used to be a `BigInt` SyntaxError and a 500.
 * - `before` is a seq, so it is at least 1. `after` may be 0: the mobile
 *   client asks for `seq - 1` to fetch a just-approved message from just
 *   below its own seq (messages_controller.dart `onMessageCreated`), which is
 *   0 for the conversation's first message.
 * - Sending both is a 400. They select opposite directions, and the old code
 *   let `after` silently overwrite `before`.
 * - At most 18 digits, so a value always fits the int8 column (the same bound
 *   message search already applies to its own `before`).
 * - An empty value (`?before=`) is treated as absent, as it always was.
 */
const BEFORE_PATTERN = /^[1-9]\d{0,17}$/;
const AFTER_PATTERN = /^(0|[1-9]\d{0,17})$/;

export interface ListCursor {
  before?: bigint;
  after?: bigint;
}

const invalid = (message: string) => new CommError(CommErrorCode.VALIDATION, message, 400);

const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

export function parseListCursor(before: unknown, after: unknown): ListCursor {
  const hasBefore = present(before);
  const hasAfter = present(after);

  if (hasBefore && hasAfter) {
    throw invalid('send either before or after, not both');
  }
  if (hasBefore) {
    if (typeof before !== 'string' || !BEFORE_PATTERN.test(before)) {
      throw invalid('before must be a positive whole number');
    }
    return { before: BigInt(before) };
  }
  if (hasAfter) {
    if (typeof after !== 'string' || !AFTER_PATTERN.test(after)) {
      throw invalid('after must be a whole number, 0 or more');
    }
    return { after: BigInt(after) };
  }
  return {};
}
