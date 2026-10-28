import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { TeacherScopeService, scopeCovers } from '../platform/teacher-scope';
import { AuthError } from '../platform/auth/auth.errors';
import { FIRST_LOGIN_CODE_HOURS, PasswordResetService } from '../platform/auth/password-reset.service';
import { isUuid } from '../communication/conversations/conversation.service';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { FIRST_LOGIN_MAILER, firstLoginMail, type MailSender } from '../account-recovery/recovery-delivery';
import { TeacherFileService } from './teacher-file.service';

/**
 * PD-43 (plan merged as #180, PR-1 #184): adding a teacher.
 *
 *   add()      one transaction: chat.create_teacher (the provisioned login, the
 *              teacher, the Teacher File, the supervisor assignment), the
 *              teacher's supervision chat (ensureInTx, gate P2-7) and the first
 *              sign-in code (issueInTx). After the commit the code is e-mailed
 *              to the sign-in address when the e-mail channel exists, and it is
 *              returned ONCE to the person who added the teacher either way.
 *   reissue()  a new code while the teacher has not signed in; the old one dies.
 *
 * WHO decides twice: decideTeacherOnboarding here, and chat.create_teacher /
 * chat.may_issue_teacher_first_login in the database. WHAT a refusal may tell
 * the caller is decided here, because only here is the caller's scope known:
 * a sign-in or contact already in use names the teacher ONLY when the caller
 * reaches that teacher; anything else -- another organization's account, a
 * parent, a teacher out of reach -- is one identical answer (gate P2-5).
 *
 * Lives in src/teacher-file: the contact lookup reads chat.teacher_file, which
 * only this module may name (teacher-file-confinement.spec).
 */
@Injectable()
export class TeacherOnboardingService {
  private readonly log = new Logger('TeacherOnboarding');
  private readonly teacherScope: TeacherScopeService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: TeacherFileService,
    private readonly supervision: SupervisionConversationService,
    private readonly resets: PasswordResetService,
    @Inject(FIRST_LOGIN_MAILER) private readonly mailer: MailSender,
    @Optional() teacherScope?: TeacherScopeService,
  ) {
    this.teacherScope = teacherScope ?? new TeacherScopeService(prisma);
  }

  async add(actorId: string, body: Record<string, unknown>) {
    const { actor, onboarding } = await this.files.onboardingGate(actorId);
    const org = actor.organizationId as string;
    const id = requireUuid('id', body.id);
    const name = requireText('name', body.name, 120);
    const email = requireEmail(body.email);
    const phone = optionalPhone(body.phone);
    const joinedOn = optionalDate('joinedOn', body.joinedOn);
    const teachingMarket = optionalText('teachingMarket', body.teachingMarket, 80);
    const note = optionalText('note', body.note, 500);

    let supervisorId: string | null;
    if (body.supervisorId === undefined || body.supervisorId === null) supervisorId = null;
    else if (body.supervisorId === 'self') supervisorId = actor.actorId;
    else supervisorId = requireUuid('supervisorId', body.supervisorId);
    if (onboarding.supervisorChoice === 'self_or_none' && supervisorId !== null && supervisorId !== actor.actorId) {
      throw new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, 'a teacher supervisor adds a teacher for themselves or with no supervisor');
    }

    const issuer = await this.issuerAccount(actor);
    let created: { name: string; issued: { id: string; code: string; expiresAt: Date } };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT chat.create_teacher(${id}::uuid, ${name}::text, ${email}::text, ${phone}::text, ${joinedOn}::date,
                                     ${teachingMarket}::text, ${supervisorId}::uuid, ${note ?? 'teacher added'}::text,
                                     ${actor.actorId}::uuid)::text AS id`;
        await this.supervision.ensureInTx(tx, id, org, actor.actorId);
        const teacher = await tx.teacher.findUniqueOrThrow({ where: { id }, select: { name: true, accountId: true } });
        const issued = await this.resets.issueInTx(tx, {
          accountId: teacher.accountId as string,
          organizationId: org,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: issuer,
          reason: 'a new teacher’s first sign-in',
          signOutEverywhere: false,
          purpose: 'first_login',
        });
        return { name: teacher.name, issued };
      });
    } catch (e) {
      throw await this.refusal(e, actor, email, phone);
    }
    const emailed = await this.deliver(email, created.issued);
    return {
      teacher: { id, name: created.name, supervisorId },
      signIn: email,
      firstLogin: { code: created.issued.code, expiresAt: created.issued.expiresAt.toISOString(), emailed },
    };
  }

  async reissue(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.onboardingGate(actorId);
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: actor.organizationId ?? '' },
      select: { id: true, account: { select: { id: true, subject: true, status: true } } },
    });
    if (!teacher) throw notFound;
    if (!teacher.account) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher has no sign-in yet', 409);
    if (teacher.account.status !== 'provisioned') {
      throw new CommError(CommErrorCode.TEACHER_ALREADY_SIGNED_IN, 'this teacher has signed in; reset their password instead', 409);
    }
    const reason = optionalText('reason', body.reason, 500) ?? 'a new first sign-in code';
    const issuer = await this.issuerAccount(actor);
    let issued: { id: string; code: string; expiresAt: Date };
    try {
      issued = await this.prisma.$transaction((tx) =>
        this.resets.issueInTx(tx, {
          accountId: teacher.account!.id,
          organizationId: actor.organizationId as string,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: issuer,
          reason,
          signOutEverywhere: false,
          purpose: 'first_login',
        }),
      );
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // chat.may_issue_teacher_first_login: a teacher out of the caller's reach is
      // answered as one that does not exist.
      if (/a first sign-in code is issued by someone who may add this teacher/.test(errorText(e))) throw notFound;
      if (/a first sign-in code is for an account that has not signed in yet/.test(errorText(e))) {
        throw new CommError(CommErrorCode.TEACHER_ALREADY_SIGNED_IN, 'this teacher has signed in; reset their password instead', 409);
      }
      throw e;
    }
    const emailed = await this.deliver(teacher.account.subject, issued);
    return {
      teacherId: teacher.id,
      signIn: teacher.account.subject,
      firstLogin: { code: issued.code, expiresAt: issued.expiresAt.toISOString(), emailed },
    };
  }

  // ------------------------------------------------------------------

  private async issuerAccount(actor: Actor): Promise<string> {
    const staff = await this.prisma.staff.findUnique({ where: { id: actor.actorId }, select: { accountId: true } });
    return staff?.accountId ?? actor.actorId;
  }

  /**
   * After the commit, on the sign-in address. The person who added the teacher
   * holds the code anyway; a failure is logged with the code's id only -- never
   * the code, the address or the provider's text (it quotes the recipient).
   */
  private async deliver(to: string, issued: { id: string; code: string }): Promise<boolean> {
    if (!this.mailer.available) return false;
    try {
      await this.mailer.send(to, firstLoginMail(issued.code, FIRST_LOGIN_CODE_HOURS, to));
      return true;
    } catch (e) {
      this.log.error(`first sign-in code ${issued.id} not e-mailed: ${failureKind(e)}`);
      return false;
    }
  }

  /** chat.create_teacher's refusals, as the API answers them. */
  private async refusal(e: unknown, actor: Actor, email: string, phone: string | null): Promise<unknown> {
    if (e instanceof CommError || e instanceof AuthError) return e;
    const text = errorText(e);
    if (/adds a teacher|only an active staff member adds a teacher/.test(text)) {
      return new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, 'only the Teachers department or the super admin adds a teacher');
    }
    if (/the sign-in e-mail is an e-mail address/.test(text)) return invalid('email', 'must be an e-mail address');
    if (/a teacher has a name/.test(text)) return invalid('name', 'must be 1 to 120 characters');
    if (/teacher_file_phone_is_admin_only/.test(text)) return invalid('phone', 'must be a phone number');
    if (/teacher_file_teaching_market_shape/.test(text)) return invalid('teachingMarket', 'must be 1 to 80 characters');
    if (/supervised by a primary supervisor|belong to one organization|cannot supervise a teacher|teacher assignment references/.test(text)) {
      return invalid('supervisorId', 'must be a primary teacher supervisor of your organization');
    }
    if (/this teacher id is already used/.test(text)) {
      return new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'id: this teacher id is already used', 409);
    }
    if (/this e-mail already signs in to Chat/.test(text)) return this.signInTaken(actor, email);
    if (/this contact is already on a teacher's file/.test(text)) return this.contactTaken(actor, email, phone);
    return e;
  }

  /** Gate P2-5: a teacher the caller reaches is named; anything else is one identical answer. */
  private async signInTaken(actor: Actor, email: string): Promise<CommError> {
    const [holder] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name
        FROM chat.account a JOIN chat.teacher t ON t.account_id = a.id
       WHERE lower(a.subject) = ${email} AND a.kind = 'teacher' AND t.organization_id = ${actor.organizationId}::uuid`;
    if (holder && scopeCovers(await this.teacherScope.scopeOf(actor), holder.id)) {
      return new CommError(CommErrorCode.TEACHER_ALREADY_ADDED, 'this person is already a teacher here', 409, { teacher: holder });
    }
    return new CommError(
      CommErrorCode.TEACHER_EMAIL_UNAVAILABLE,
      'This e-mail can’t be used for a new teacher. Use another e-mail, or ask the Teachers Manager.',
      409,
    );
  }

  private async contactTaken(actor: Actor, email: string, phone: string | null): Promise<CommError> {
    const digits = phone ? phone.replace(/[^0-9]/g, '') : null;
    const [holder] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name
        FROM chat.teacher_file f JOIN chat.teacher t ON t.id = f.teacher_id
       WHERE f.organization_id = ${actor.organizationId}::uuid
         AND (lower(f.email) = ${email}
              OR (${digits}::text IS NOT NULL AND regexp_replace(coalesce(f.phone, ''), '[^0-9]', '', 'g') = ${digits}::text))
       LIMIT 1`;
    const named = holder && scopeCovers(await this.teacherScope.scopeOf(actor), holder.id);
    return new CommError(
      CommErrorCode.TEACHER_CONTACT_TAKEN,
      'this phone or e-mail is already on a teacher’s file',
      409,
      named ? { teacher: holder } : undefined,
    );
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,30}$/;

const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(field, 'must be a uuid');
  return (value as string).toLowerCase();
}

function requireText(field: string, value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || text.length > max) throw invalid(field, `must be 1 to ${max} characters`);
  return text;
}

function optionalText(field: string, value: unknown, max: number): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  return requireText(field, value, max);
}

function requireEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw invalid('email', 'must be an e-mail address');
  return email;
}

function optionalPhone(value: unknown): string | null {
  const phone = optionalText('phone', value, 40);
  if (phone !== null && !PHONE.test(phone)) throw invalid('phone', 'must be a phone number');
  return phone;
}

function optionalDate(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw invalid(field, 'must be a date, YYYY-MM-DD');
  }
  return value;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function failureKind(e: unknown): string {
  const x = e as { name?: unknown; code?: unknown; responseCode?: unknown };
  return [x?.name, x?.code, x?.responseCode].filter((v) => typeof v === 'string' || typeof v === 'number').join(' ') || 'error';
}
