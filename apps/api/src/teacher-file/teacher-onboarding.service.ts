import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { TeacherScopeService, scopeCovers } from '../platform/teacher-scope';
import { AuthError } from '../platform/auth/auth.errors';
import { AuthService } from '../platform/auth/auth.service';
import { FIRST_LOGIN_CODE_HOURS, PasswordResetService } from '../platform/auth/password-reset.service';
import { isUuid } from '../communication/conversations/conversation.service';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { LessonService } from '../lessons/lesson.service';
import { TrialService } from '../lessons/trial.service';
import { FIRST_LOGIN_MAILER, firstLoginMail, type MailSender } from '../account-recovery/recovery-delivery';
import { NotificationService } from '../communication/notifications/notification.service';
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
 *   giveSignIn()  a teacher who exists but has no login (inserted before PD-43;
 *              the Core-migration intake) gets one in place, and its FIRST code
 *              in the same transaction (chat.give_teacher_sign_in). The reissue
 *              rule, not creation's (department head on #198): an existing
 *              teacher is a live identity, so the code is always e-mailed and
 *              only the manager and the super admin see it.
 *   changeSignIn() a new sign-in e-mail: while the login waits, the reissue
 *              rule and a new code to the new address; once used, the super
 *              admin only, and every session ends.
 *   reissue()  a new code while the teacher has not signed in; the old one dies.
 *              Owner, 2026-10-28, "E-mail only; managers can see": only the super
 *              admin, the Teachers manager and the teacher's CURRENT supervisor
 *              may (chat.may_issue_teacher_first_login); the code is always
 *              e-mailed, and only the manager and the super admin see it.
 *   offboard() PR-1b: the Teachers manager or the super admin, never while a
 *              student remains. The lessons ahead are cancelled first, on the
 *              actor's confirmation, while the teacher is still live; any
 *              failure stops the offboarding. Then one transaction:
 *              chat.offboard_teacher (the teacher and the login closed, any
 *              waiting code dead, the supervisor link ended, the cancelled
 *              lessons named on the audit row) and every session revoked; then
 *              the realtime barrier.
 *   reactivate() the super admin only (owner Q6): the same teacher, the login
 *              waiting again, a new first sign-in code shown to them and e-mailed.
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
    private readonly auth: AuthService,
    private readonly lessons: LessonService,
    private readonly trials: TrialService,
    @Inject(FIRST_LOGIN_MAILER) private readonly mailer: MailSender,
    private readonly notifications: NotificationService,
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
    if (body.confirmSimilarName !== undefined && typeof body.confirmSimilarName !== 'boolean') {
      throw invalid('confirmSimilarName', 'must be true or false');
    }

    let supervisorId: string | null;
    if (body.supervisorId === undefined || body.supervisorId === null) supervisorId = null;
    else if (body.supervisorId === 'self') supervisorId = actor.actorId;
    else supervisorId = requireUuid('supervisorId', body.supervisorId);
    if (onboarding.supervisorChoice === 'self_or_none' && supervisorId !== null && supervisorId !== actor.actorId) {
      throw new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, 'a teacher supervisor adds a teacher for themselves or with no supervisor');
    }

    if (body.confirmSimilarName !== true) await this.warnOnSimilarName(actor, id, name);

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
      throw await this.refusal(e, actor, email, phone, name);
    }
    // Plan §3.7: an unsupervised teacher is the Teachers manager's. PD-47 PR-6b:
    // the manager's teacher_unsupervised task replaces the notice (owner 2026-10-29).
    const emailed = await this.deliver(email, created.issued);
    return {
      teacher: { id, name: created.name, supervisorId },
      signIn: email,
      firstLogin: { code: created.issued.code, expiresAt: created.issued.expiresAt.toISOString(), emailed },
    };
  }

  async giveSignIn(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor, onboarding } = await this.files.onboardingGate(actorId);
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const email = requireEmail(body.email);
    const reason = optionalText('reason', body.reason, 500) ?? 'sign-in given to an existing teacher';
    const issuer = await this.issuerAccount(actor);
    let issued: { id: string; code: string; expiresAt: Date };
    try {
      issued = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ account: string }>>`
          SELECT chat.give_teacher_sign_in(${teacherId}::uuid, ${email}::text, ${reason}::text, ${actor.actorId}::uuid)::text AS account`;
        return this.resets.issueInTx(tx, {
          accountId: row!.account,
          organizationId: actor.organizationId as string,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: issuer,
          reason: 'a first sign-in for an existing teacher',
          signOutEverywhere: false,
          purpose: 'first_login',
        });
      });
    } catch (e) {
      const text = errorText(e);
      if (/no such teacher for you to give a sign-in/.test(text)) throw notFound;
      if (/an inactive teacher gets no sign-in/.test(text)) {
        throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher is no longer active', 409);
      }
      if (/this teacher already has a sign-in/.test(text)) {
        throw new CommError(CommErrorCode.TEACHER_HAS_SIGN_IN, 'this teacher already has a sign-in; send a new first sign-in code or reset it', 409);
      }
      throw await this.refusal(e, actor, email, null);
    }
    const emailed = await this.deliver(email, issued);
    const seesCode = onboarding.supervisorChoice === 'any';
    return {
      teacherId,
      signIn: email,
      firstLogin: seesCode
        ? { code: issued.code, expiresAt: issued.expiresAt.toISOString(), emailed }
        : { expiresAt: issued.expiresAt.toISOString(), emailed },
    };
  }

  /**
   * PD-43 §3.3: a new sign-in e-mail (PATCH /teachers/:id/sign-in, { email, reason? }).
   * While the login waits: the reissue rule (chat.change_teacher_sign_in), the
   * old code dies and a new one goes to the NEW address in the same
   * transaction -- seen only by the manager and the super admin, as on a
   * reissue. Once the login has been used: the super admin only, and every
   * session ends; the teacher signs in again with the new address.
   */
  async changeSignIn(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor, onboarding } = await this.files.onboardingGate(actorId);
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const email = requireEmail(body.email);
    const reason = optionalText('reason', body.reason, 500) ?? 'sign-in e-mail changed';
    const issuer = await this.issuerAccount(actor);
    let done: { accountId: string; issued: { id: string; code: string; expiresAt: Date } | null; revoked: number };
    try {
      done = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ changed: { accountId: string; status: string } }>>`
          SELECT chat.change_teacher_sign_in(${teacherId}::uuid, ${email}::text, ${reason}::text, ${actor.actorId}::uuid) AS changed`;
        const { accountId, status } = row!.changed;
        if (status === 'provisioned') {
          const issued = await this.resets.issueInTx(tx, {
            accountId,
            organizationId: actor.organizationId as string,
            issuedByStaffId: actor.actorId,
            issuedByAccountId: issuer,
            reason: 'a first sign-in at a new address',
            signOutEverywhere: false,
            purpose: 'first_login',
          });
          return { accountId, issued, revoked: 0 };
        }
        const revoked = await this.auth.revokeAccountSessionsInTx(tx, accountId, 'sign-in e-mail changed', {
          revokedBy: issuer,
          actorId: actor.actorId,
        });
        return { accountId, issued: null, revoked };
      });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      const text = errorText(e);
      if (/no such teacher for you to change the sign-in of/.test(text)) throw notFound;
      if (/only the super admin changes a sign-in that has been used/.test(text)) {
        throw new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, 'only the super admin changes a sign-in that has been used');
      }
      if (/this sign-in is suspended/.test(text)) {
        throw new CommError(CommErrorCode.TEACHER_SIGN_IN_SUSPENDED, 'this teacher’s sign-in is suspended; reactivate it first', 409);
      }
      const conflict = /an inactive teacher's sign-in is not changed|this teacher has no sign-in to change|this sign-in is closed|this is already the sign-in/.exec(text);
      if (conflict) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, conflict[0], 409);
      throw await this.refusal(e, actor, email, null);
    }
    if (!done.issued) {
      await this.auth.enforceAccountRevocation(done.accountId, done.revoked > 0);
      return { teacherId, signIn: email, firstLogin: null };
    }
    const emailed = await this.deliver(email, done.issued);
    const seesCode = onboarding.supervisorChoice === 'any';
    return {
      teacherId,
      signIn: email,
      firstLogin: seesCode
        ? { code: done.issued.code, expiresAt: done.issued.expiresAt.toISOString(), emailed }
        : { expiresAt: done.issued.expiresAt.toISOString(), emailed },
    };
  }

  async reissue(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor, onboarding } = await this.files.onboardingGate(actorId);
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: actor.organizationId ?? '' },
      select: { id: true, account: { select: { id: true, subject: true, status: true } } },
    });
    // Reach FIRST: a teacher this caller may not send a code for is not found,
    // whatever state its sign-in is in -- a 409 would tell them it exists.
    if (!teacher || !(await this.maySendCode(actor.actorId, teacher.id))) throw notFound;
    const account = teacher.account;
    if (!account) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher has no sign-in yet', 409);
    if (account.status === 'suspended') {
      throw new CommError(CommErrorCode.TEACHER_SIGN_IN_SUSPENDED, 'this teacher’s sign-in is suspended; reactivate it first', 409);
    }
    if (account.status === 'deactivated') throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher’s sign-in is closed', 409);
    if (account.status !== 'provisioned') {
      throw new CommError(CommErrorCode.TEACHER_ALREADY_SIGNED_IN, 'this teacher has signed in; reset their password instead', 409);
    }
    const reason = optionalText('reason', body.reason, 500) ?? 'a new first sign-in code';
    const issuer = await this.issuerAccount(actor);
    let issued: { id: string; code: string; expiresAt: Date };
    try {
      issued = await this.prisma.$transaction((tx) =>
        this.resets.issueInTx(tx, {
          accountId: account.id,
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
      if (/a first sign-in code is issued by someone who may add this teacher/.test(errorText(e))) throw notFound;
      if (/a first sign-in code is for an account that has not signed in yet/.test(errorText(e))) {
        throw new CommError(CommErrorCode.TEACHER_ALREADY_SIGNED_IN, 'this teacher has signed in; reset their password instead', 409);
      }
      throw busy(e) ?? e;
    }
    const emailed = await this.deliver(account.subject, issued);
    // Only the Teachers manager and the super admin see a reissued code.
    const seesCode = onboarding.supervisorChoice === 'any';
    return {
      teacherId: teacher.id,
      signIn: account.subject,
      firstLogin: seesCode
        ? { code: issued.code, expiresAt: issued.expiresAt.toISOString(), emailed }
        : { expiresAt: issued.expiresAt.toISOString(), emailed },
    };
  }

  /**
   * What offboarding would meet: the students still assigned, and each lesson
   * ahead. With no student left those are trials and the like; they are
   * cancelled only when the actor confirms it (cancelOpenLessons), audited.
   */
  async offboardPreview(actorId: string, teacherId: string) {
    const { actor } = await this.files.onboardingGate(actorId, (o) => o.canOffboard, OFFBOARD_REFUSAL);
    const teacher = await this.teacherOf(actor, teacherId);
    const [students, openLessons] = await Promise.all([
      this.prisma.learner.findMany({ where: { teacherId: teacher.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.openLessons(teacher.id),
    ]);
    const isActive = teacher.isActive && teacher.leftAt === null;
    return { teacherId: teacher.id, isActive, students, openLessons, canOffboard: isActive && students.length === 0 };
  }

  /**
   * { reason, cancelOpenLessons? }. The lessons ahead are cancelled FIRST, on
   * the actor's confirmation and while the teacher is still live (a trial's
   * cancellation card goes to the teacher's trial group, which needs one).
   * If any cannot be cancelled nothing is offboarded. Then one transaction:
   * chat.offboard_teacher, which refuses over any lesson still open and names
   * the cancelled ones on its audit row, and every session revoked.
   */
  async offboard(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.onboardingGate(actorId, (o) => o.canOffboard, OFFBOARD_REFUSAL);
    const reason = requireText('reason', body.reason, 500);
    if (body.cancelOpenLessons !== undefined && typeof body.cancelOpenLessons !== 'boolean') {
      throw invalid('cancelOpenLessons', 'must be true or false');
    }
    const cancelOpenLessons = body.cancelOpenLessons === true;
    const teacher = await this.teacherOf(actor, teacherId);

    // The database's refusals, checked first so no lesson is cancelled for an
    // offboarding that cannot happen. chat.offboard_teacher checks them again.
    if (!teacher.isActive || teacher.leftAt !== null) {
      throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher has already left', 409);
    }
    const students = await this.prisma.learner.findMany({ where: { teacherId: teacher.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    if (students.length > 0) {
      throw new CommError(CommErrorCode.TEACHER_HAS_STUDENTS, 'move this teacher’s students to other teachers first', 409, { students });
    }
    const open = await this.openLessons(teacher.id);
    if (open.length > 0 && !cancelOpenLessons) {
      throw new CommError(CommErrorCode.TEACHER_HAS_OPEN_LESSONS, 'this teacher has lessons ahead; confirm their cancellation', 409, { openLessons: open });
    }

    const cancelledLessons: string[] = [];
    const notCancelled: Array<{ lessonId: string; reason: string }> = [];
    for (const lesson of open) {
      try {
        // A trial (PD-11 T4) is cancelled as a trial: LessonService never sees one.
        if (lesson.kind === 'trial') await this.trials.cancel(actor.actorId, lesson.id, { reason: LESSON_CANCEL_REASON });
        else await this.lessons.cancel(actor.actorId, lesson.id, { reason: LESSON_CANCEL_REASON });
        cancelledLessons.push(lesson.id);
      } catch (e) {
        const why = errorText(e);
        this.log.warn(`lesson ${lesson.id} of teacher ${teacher.id} was not cancelled for offboarding: ${why}`);
        notCancelled.push({ lessonId: lesson.id, reason: why });
      }
    }
    if (notCancelled.length > 0) {
      throw new CommError(CommErrorCode.TEACHER_HAS_OPEN_LESSONS, 'some lessons could not be cancelled; the teacher is not offboarded', 409, {
        cancelledLessons,
        notCancelled,
      });
    }

    const issuer = await this.issuerAccount(actor);
    let closed: { accountId: string | null; revoked: number };
    try {
      closed = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT chat.offboard_teacher(${teacher.id}::uuid, ${reason}::text, ${cancelledLessons}::uuid[], ${actor.actorId}::uuid)::text`;
        if (!teacher.accountId) return { accountId: null, revoked: 0 };
        await tx.account.update({ where: { id: teacher.accountId }, data: { deactivatedBy: issuer } });
        const revoked = await this.auth.revokeAccountSessionsInTx(tx, teacher.accountId, 'teacher offboarded', {
          revokedBy: issuer,
          actorId: actor.actorId,
        });
        return { accountId: teacher.accountId, revoked };
      });
    } catch (e) {
      throw (await this.offboardRefusal(e, teacher.id)) ?? e;
    }
    if (closed.accountId) await this.auth.enforceAccountRevocation(closed.accountId, closed.revoked > 0);
    this.log.log(`teacher ${teacher.id} offboarded by staff ${actor.actorId}`);
    return { teacherId: teacher.id, cancelledLessons, notCancelled };
  }

  /** { reason } */
  async reactivate(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.onboardingGate(actorId, (o) => o.canReactivate, 'only the super admin reactivates a former teacher');
    const reason = requireText('reason', body.reason, 500);
    const teacher = await this.teacherOf(actor, teacherId);
    const issuer = await this.issuerAccount(actor);

    let done: { accountId: string | null; subject: string | null; issued: { id: string; code: string; expiresAt: Date } | null };
    try {
      done = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ account_id: string | null }>>`
          SELECT chat.reactivate_teacher(${teacher.id}::uuid, ${reason}::text, ${actor.actorId}::uuid)::text AS account_id`;
        const accountId = row?.account_id ?? null;
        if (!accountId) return { accountId: null, subject: null, issued: null };
        const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { subject: true } });
        const issued = await this.resets.issueInTx(tx, {
          accountId,
          organizationId: actor.organizationId as string,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: issuer,
          reason: 'a returning teacher’s first sign-in',
          signOutEverywhere: false,
          purpose: 'first_login',
        });
        return { accountId, subject: account.subject, issued };
      });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      const text = errorText(e);
      if (/only the super admin reactivates/.test(text)) throw new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, 'only the super admin reactivates a former teacher');
      if (/no such teacher to reactivate/.test(text)) throw new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
      if (/this teacher is active/.test(text)) throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher is active', 409);
      throw busy(e) ?? e;
    }
    this.log.log(`teacher ${teacher.id} reactivated by staff ${actor.actorId}`);
    if (!done.issued || !done.subject) return { teacherId: teacher.id, signIn: null, firstLogin: null };
    const emailed = await this.deliver(done.subject, done.issued);
    return {
      teacherId: teacher.id,
      signIn: done.subject,
      firstLogin: { code: done.issued.code, expiresAt: done.issued.expiresAt.toISOString(), emailed },
    };
  }

  /** The database's own rule (chat.may_issue_teacher_first_login): asked, never re-derived. */
  async maySendCode(staffId: string, teacherId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.may_issue_teacher_first_login(${staffId}::uuid, ${teacherId}::uuid) AS ok`;
    return row?.ok === true;
  }

  // ------------------------------------------------------------------

  /**
   * Plan §3.4: the same name as an ACTIVE teacher the caller reaches is a
   * warning, never a refusal -- a name alone is too weak, and naming one out of
   * reach would disclose it, so such a match says nothing at all. Names compare
   * folded the PD-42 way (chat.search_fold: case, diacritics, tatweel,
   * alef/yeh/heh variants) with runs of spaces collapsed. The id being added is
   * left out, so a replayed request is not its own match.
   */
  private async warnOnSimilarName(actor: Actor, id: string, name: string): Promise<void> {
    const scope = await this.teacherScope.scopeOf(actor);
    const matches = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name
        FROM chat.teacher t
       WHERE t.organization_id = ${actor.organizationId}::uuid
         AND t.is_active AND t.left_at IS NULL
         AND t.id <> ${id}::uuid
         AND chat.search_fold(regexp_replace(btrim(t.name), '[[:space:]]+', ' ', 'g'))
             = chat.search_fold(regexp_replace(btrim(${name}::text), '[[:space:]]+', ' ', 'g'))
       ORDER BY t.name, t.id`;
    const seen = matches.filter((t) => scopeCovers(scope, t.id));
    if (seen.length > 0) {
      throw new CommError(CommErrorCode.TEACHER_SIMILAR_NAME, 'a teacher with this name is already here; confirm to add another', 409, {
        teachers: seen,
      });
    }
  }

  /** A teacher of the caller's organization; anything else is the same 404. */
  private async teacherOf(actor: Actor, teacherId: string) {
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: actor.organizationId ?? '' },
      select: { id: true, accountId: true, isActive: true, leftAt: true },
    });
    if (!teacher) throw notFound;
    return teacher;
  }

  /** The lessons ahead of a teacher, as chat.offboard_teacher counts them. */
  private openLessons(teacherId: string) {
    return this.prisma.lesson.findMany({
      where: { teacherId, outcome: null, startsAt: { gte: new Date() } },
      select: { id: true, kind: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** chat.offboard_teacher's refusals, as the API answers them; null for anything else. */
  private async offboardRefusal(e: unknown, teacherId: string): Promise<unknown> {
    if (e instanceof CommError || e instanceof AuthError) return e;
    const text = errorText(e);
    if (/only the Teachers manager or the super admin offboards/.test(text)) return new CommError(CommErrorCode.TEACHER_ONBOARDING_DENIED, OFFBOARD_REFUSAL);
    if (/no such teacher to offboard/.test(text)) return new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (/this teacher has already left/.test(text)) return new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher has already left', 409);
    if (/move this teacher's students to other teachers first/.test(text)) {
      const students = await this.prisma.learner.findMany({ where: { teacherId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
      return new CommError(CommErrorCode.TEACHER_HAS_STUDENTS, 'move this teacher’s students to other teachers first', 409, { students });
    }
    if (/this teacher has open lessons/.test(text)) {
      return new CommError(CommErrorCode.TEACHER_HAS_OPEN_LESSONS, 'this teacher has lessons ahead; confirm their cancellation', 409);
    }
    if (/offboarding requires a reason/.test(text)) return invalid('reason', 'must be 1 to 500 characters');
    return busy(e);
  }

  private async issuerAccount(actor: Actor): Promise<string> {
    const staff = await this.prisma.staff.findUnique({ where: { id: actor.actorId }, select: { accountId: true } });
    // A signed-in staff member always has an account; never stand a staff id in for one.
    if (!staff?.accountId) throw new Error(`staff ${actor.actorId} has no account`);
    return staff.accountId;
  }

  /**
   * After the commit, on the sign-in address. The person who added the teacher
   * holds the code anyway; a failure is logged with the code's id only -- never
   * the code, the address or the provider's text (it quotes the recipient).
   */
  private async deliver(to: string, issued: { id: string; code: string }): Promise<boolean> {
    if (!this.mailer.available) return false;
    // A slow provider must not hold the answer that shows the code: at most
    // MAIL_TIMEOUT_MS, then emailed false (the send may still finish later).
    const sending = this.mailer.send(to, firstLoginMail(issued.code, FIRST_LOGIN_CODE_HOURS, to));
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'MailTimeout' })), MAIL_TIMEOUT_MS);
    });
    try {
      await Promise.race([sending, late]);
      return true;
    } catch (e) {
      sending.catch(() => undefined);
      this.log.error(`first sign-in code ${issued.id} not e-mailed: ${failureKind(e)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * PD-34: a notification for the Teachers manager (the super admin when the
   * department has none), never for the actor themselves. A side effect: a
   * failure is logged, never thrown. The dedupe key makes a retry one.
   */
  private tellTeachersManager(actor: Actor, templateKey: string, dedupeKey: string, variables: Record<string, string>): Promise<void> {
    return (async () => {
      const recipients = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH manager AS (
          SELECT s.id FROM chat.department d JOIN chat.staff s ON s.id = d.manager_id
           WHERE d.organization_id = ${actor.organizationId}::uuid AND d.kind = 'teachers' AND s.is_active AND s.left_at IS NULL)
        SELECT id::text AS id FROM manager
        UNION ALL
        SELECT s.id::text FROM chat.staff s
         WHERE NOT EXISTS (SELECT 1 FROM manager)
           AND s.organization_id = ${actor.organizationId}::uuid AND s.role = 'super_admin' AND s.is_active AND s.left_at IS NULL`;
      for (const r of recipients) {
        if (r.id === actor.actorId) continue;
        await this.notifications.schedule({
          dedupeKey: `${dedupeKey}:${r.id}`,
          templateKey,
          eventType: templateKey,
          recipientId: r.id,
          priority: 'normal',
          variables,
          scheduledAt: new Date(),
        });
      }
    })().catch((e) => this.log.error(`${templateKey} not scheduled: ${failureKind(e)}`));
  }

  /** chat.create_teacher's refusals, as the API answers them. `attemptedName`: the teacher being added, when it is an add. */
  private async refusal(e: unknown, actor: Actor, email: string, phone: string | null, attemptedName?: string): Promise<unknown> {
    if (e instanceof CommError || e instanceof AuthError) return e;
    const tooBusy = busy(e);
    if (tooBusy) return tooBusy;
    const text = errorText(e);
    if (/adds a teacher|only an active staff member (adds a teacher|gives a teacher a sign-in)/.test(text)) {
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
    if (/this e-mail already signs in to Chat/.test(text)) return this.signInTaken(actor, email, attemptedName);
    if (/this contact is already on a teacher's file/.test(text)) return this.contactTaken(actor, email, phone, attemptedName);
    return e;
  }

  /**
   * Gate P2-5: a teacher the caller reaches is named; anything else is one
   * identical answer. The caller's scope is read on EVERY path, first, so the
   * time taken tells nothing either.
   */
  private async signInTaken(actor: Actor, email: string, attemptedName?: string): Promise<CommError> {
    const scope = await this.teacherScope.scopeOf(actor);
    const [holder] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name
        FROM chat.account a JOIN chat.teacher t ON t.account_id = a.id
       WHERE lower(a.subject) = ${email} AND a.kind = 'teacher' AND t.organization_id = ${actor.organizationId}::uuid`;
    if (holder && scopeCovers(scope, holder.id)) {
      return new CommError(CommErrorCode.TEACHER_ALREADY_ADDED, 'this person is already a teacher here', 409, { teacher: holder });
    }
    if (holder && attemptedName) this.tellHidden(actor, holder, attemptedName);
    return unavailable();
  }

  /** As signInTaken: a contact on the file of a teacher out of reach is the SAME answer as an e-mail out of reach. */
  private async contactTaken(actor: Actor, email: string, phone: string | null, attemptedName?: string): Promise<CommError> {
    const scope = await this.teacherScope.scopeOf(actor);
    const digits = phone ? phone.replace(/[^0-9]/g, '') : null;
    const [holder] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name
        FROM chat.teacher_file f JOIN chat.teacher t ON t.id = f.teacher_id
       WHERE f.organization_id = ${actor.organizationId}::uuid
         AND (lower(f.email) = ${email}
              OR (${digits}::text IS NOT NULL AND regexp_replace(coalesce(f.phone, ''), '[^0-9]', '', 'g') = ${digits}::text))
       LIMIT 1`;
    if (holder && scopeCovers(scope, holder.id)) {
      return new CommError(CommErrorCode.TEACHER_CONTACT_TAKEN, 'this phone or e-mail is already on a teacher’s file', 409, { teacher: holder });
    }
    if (holder && attemptedName) this.tellHidden(actor, holder, attemptedName);
    return unavailable();
  }

  /**
   * Plan §3.4: the adder was refused for details on a teacher out of their
   * reach and was told nothing; someone who may see both is told. Never the
   * e-mail or the phone: names only.
   */
  private tellHidden(actor: Actor, holder: { id: string; name: string }, attemptedName: string): void {
    // Not awaited: on a refusal the write must not change how long the answer takes.
    void this.tellTeachersManager(actor, 'teacher_duplicate_hidden', `teacher_duplicate_hidden:${holder.id}:${actor.actorId}`, {
      holder: holder.name,
      addedBy: actor.displayName,
      name: attemptedName,
    });
  }
}

/** The one answer for details someone else holds (gate P2-5): never a name, a kind or an organization. */
function unavailable(): CommError {
  return new CommError(
    CommErrorCode.TEACHER_EMAIL_UNAVAILABLE,
    'These details can’t be used for a new teacher. Use another e-mail or phone, or ask the Teachers Manager.',
    409,
  );
}

/** Prisma gave up on the transaction (P2028, P2034): nothing was written; say so cleanly. */
function busy(e: unknown): CommError | null {
  const code = (e as { code?: unknown })?.code;
  if (code === 'P2028' || code === 'P2034') {
    return new CommError(CommErrorCode.TEACHER_ONBOARDING_BUSY, 'the database was busy and nothing was written; try again', 503);
  }
  return null;
}

const OFFBOARD_REFUSAL = 'only the Teachers manager or the super admin offboards a teacher';

/** What each family's cancellation card says. Never the offboarding reason: that is the staff's. */
const LESSON_CANCEL_REASON = 'انتهى عمل المعلم في الأكاديمية';

/** How long the answer that shows a code waits for the e-mail provider. */
const MAIL_TIMEOUT_MS = 10_000;

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
