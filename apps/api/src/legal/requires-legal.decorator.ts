import { SetMetadata } from '@nestjs/common';

export const REQUIRES_LEGAL = 'jawwid:requires-legal';

/**
 * PD-58 (A-3; roadmap §7.4): this route creates content other people see, so
 * the caller must have accepted the CURRENT version of its kind's terms and of
 * the Code of Conduct. LegalGuard (global, after AuthenticatedGuard and
 * PermissionGuard, before the action throttle) answers 403
 * COMM.TERMS_NOT_ACCEPTED otherwise -- the same for every way an account was
 * created, because every one of them reaches the API through a session.
 *
 * test/unit/legal/legal-coverage.spec.ts walks every route and fails when a write
 * route rate-limited as a content action (MESSAGE_SEND, ATTACHMENT_UPLOAD,
 * STORY_PUBLISH, WHITEBOARD_WRITE, CALL_START, REPORT_SUBMIT), or one on its
 * fixed list, lacks this decorator.
 *
 * NEVER on: reading, /auth/*, GET /me, /me/legal/accept, /me/account/delete,
 * the public /account-deletion, /parent-notices/*, logout -- nor on any
 * @Public() route, which has no account to check: PUT /storage/:objectKey is
 * authorized by its signed URL, and the gate is on the routes that mint one
 * for content (attachments/authorize, stories/media, the avatar, certificate
 * and receipt uploads, whiteboard assets).
 *
 * `POST /reports` and `POST /me/blocks` are gated (MG-1). LD-11 (the lead,
 * 2026-11-07): a CHILD-SAFETY report is always accepted, even from an account
 * that has not accepted the terms -- `@RequiresLegal({ except:
 * 'child_safety_report' })`. Every other reason is gated. The exemption is a
 * fixed name, not a callback, so the set of exceptions is reviewable here.
 *
 * A write that is not an HTTP route of its own -- a realtime handler, a job
 * acting for a person -- calls LegalService.assertAccountAccepted(accountId)
 * instead.
 */
export const REQUIRES_LEGAL_EXCEPT = 'jawwid:requires-legal-except';

/**
 * The only exemptions there are.
 *   child_safety_report: the request body's `reason` is exactly 'child_safety'
 *     (PD-57 REPORT_REASONS). The body is still validated in full by the
 *     service; only the gate steps aside.
 */
export type LegalExemption = 'child_safety_report';

export interface RequiresLegalOptions {
  readonly except?: LegalExemption;
}

export const RequiresLegal = (options: RequiresLegalOptions = {}): MethodDecorator & ClassDecorator => {
  const gate = SetMetadata(REQUIRES_LEGAL, true);
  if (!options.except) return gate;
  const except = SetMetadata(REQUIRES_LEGAL_EXCEPT, options.except);
  return ((target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    gate(target as never, key as never, descriptor as never);
    except(target as never, key as never, descriptor as never);
  }) as MethodDecorator & ClassDecorator;
};

/** Whether a gated request falls under its route's exemption. */
export function isExempt(exemption: LegalExemption | undefined, body: unknown): boolean {
  if (exemption === 'child_safety_report') {
    return body !== null && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).reason === 'child_safety';
  }
  return false;
}
