import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../prisma.service';
import { CommError, CommErrorCode } from '../errors';
import type { SupportSessionFacts } from './auth.service';

/**
 * PD-20: what a support session (an administrator acting as a parent or
 * teacher) may WRITE. Deny by default: anything not listed here is refused
 * with COMM.SUPPORT_SESSION_FORBIDDEN before its handler runs. Reads are all
 * allowed -- seeing what the person sees is the point -- and no read route
 * changes state (receipts and story views are writes, and are not listed).
 *
 * WHY EACH GROUP IS ALLOWED
 *   the account itself   the person's own profile, name, photo and children's
 *                        photos; a teacher's own professional profile and
 *                        leave requests -- "make changes to the account";
 *   sending a message    labelled to every recipient as sent by support
 *                        (chat.message.impersonation_id), owner decision;
 *   private state        a star, a delete-for-me, a chat's mute: nobody else
 *                        sees them.
 *
 * WHY EVERYTHING ELSE IS REFUSED (each would act in the person's name where
 * others see it, unlabelled, or would speak for the device): read and
 * delivery receipts, reactions, pins, edits, deletes for everyone, forwards,
 * calls of any kind, story views and taps, push devices, notification acks,
 * lesson reports / apologies / bookings (they post cards in the person's name),
 * creating chats or changing members, logging out (the administrator ends the
 * session from their own account).
 *
 * Paths are Nest route templates without the global prefix.
 */
export const SUPPORT_SESSION_WRITES: ReadonlyArray<readonly [method: string, route: string]> = [
  // The account itself.
  ['PATCH', '/me/profile'],
  ['PATCH', '/me/children/:learnerId'],
  ['POST', '/me/avatar/upload'],
  ['POST', '/me/avatar'],
  ['DELETE', '/me/avatar'],
  ['POST', '/me/children/:learnerId/avatar/upload'],
  ['POST', '/me/children/:learnerId/avatar'],
  ['DELETE', '/me/children/:learnerId/avatar'],
  ['PUT', '/storage/:objectKey'],
  ['POST', '/me/teacher-profile'],
  ['PATCH', '/me/teacher-profile/name'],
  ['POST', '/me/teacher-profile/certificates/upload'],
  ['POST', '/me/teacher-profile/certificates'],
  ['PATCH', '/me/teacher-profile/certificates/:id'],
  ['DELETE', '/me/teacher-profile/certificates/:id'],
  ['POST', '/me/leave-requests'],
  ['POST', '/me/leave-requests/:id/withdraw'],
  // Sending a message: labelled.
  ['POST', '/conversations/:conversationId/messages'],
  ['POST', '/conversations/:conversationId/messages/attachments/authorize'],
  // Private state.
  ['POST', '/conversations/:conversationId/messages/:messageId/star'],
  ['DELETE', '/conversations/:conversationId/messages/:messageId/star'],
  ['DELETE', '/conversations/:conversationId/messages/:messageId/me'],
  ['POST', '/conversations/:id/preferences'],
];

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED = new Set(SUPPORT_SESSION_WRITES.map(([m, r]) => `${m} ${r}`));
const GLOBAL_PREFIX = /^\/api\/v1(?=\/)/;

export function supportSessionMayCall(method: string, routeTemplate: string): boolean {
  const m = method.toUpperCase();
  return READS.has(m) || ALLOWED.has(`${m} ${routeTemplate.replace(GLOBAL_PREFIX, '')}`);
}

interface SupportRequest {
  method: string;
  route?: { path?: string };
  originalUrl?: string;
  impersonation?: SupportSessionFacts;
}

/**
 * Global (AuthModule). On a support session, refuses what the list above does
 * not allow, and records EVERY request -- method, route template, status, never
 * a body -- in chat.impersonation_action before the response leaves. A request
 * that is not on a support session passes through untouched.
 *
 * The record is written before the response is sent, so the administrator
 * cannot see a result the trail does not hold. If the record cannot be
 * written the request fails: an unrecorded act on someone else's account is
 * the one outcome this exists to prevent.
 */
@Injectable()
export class SupportSessionInterceptor implements NestInterceptor {
  private readonly log = new Logger('SupportSession');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<SupportRequest>();
    const support = request.impersonation;
    if (!support) return next.handle();

    const route = (request.route?.path ?? request.originalUrl ?? '?').replace(GLOBAL_PREFIX, '').slice(0, 300);
    const method = request.method.toUpperCase();
    const record = (status: number) =>
      this.prisma.impersonationAction.create({ data: { impersonationId: support.id, method, route, status } });

    if (!supportSessionMayCall(method, route)) {
      const refusal = new CommError(
        CommErrorCode.SUPPORT_SESSION_FORBIDDEN,
        'not allowed in a support session: it would act in the person\'s name where others see it',
      );
      return from(record(refusal.status)).pipe(mergeMap(() => throwError(() => refusal)));
    }

    return next.handle().pipe(
      mergeMap(async (value) => {
        await record(http.getResponse<{ statusCode?: number }>().statusCode ?? 200);
        return value;
      }),
      catchError((error: unknown) =>
        from(
          record(statusOf(error)).catch((e: unknown) => {
            this.log.error(`support session ${support.id}: action not recorded: ${e instanceof Error ? e.name : 'error'}`);
          }),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown; getStatus?: () => number })?.getStatus?.() ?? (error as { status?: unknown })?.status;
  return typeof status === 'number' && status >= 100 && status <= 599 ? status : 500;
}
