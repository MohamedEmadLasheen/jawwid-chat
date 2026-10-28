-- =============================================================================
-- PD-43 PR-1 · adding a teacher: the data
--
-- Plan: docs/product/pd043-teacher-onboarding-plan.md (merged #180). Before
-- this, no route or SQL writer created a teacher; only the local QA seed did.
--
--   1. The catalogue (PD-40). teachers.create for the Teachers manager and
--      teacher supervisors, teachers.offboard for the Teachers manager, and
--      teacher_files.finance joins the Teachers manager's bundle (owner N2,
--      "Full teacher finance"). Rows only: 20261027190000 is applied and
--      frozen, so the rows are added here, in a generated block of their own
--      (test/unit/authorization/pd040-catalogue-seed.spec.ts).
--   2. The first sign-in code. PD-21's one-time code gains a purpose:
--      'reset' (as before) or 'first_login' (72 hours, only for an account
--      that has never signed in). Completing a first sign-in code is the ONE
--      way an account moves from provisioned to active:
--      chat.activate_account_with_code, guarded on chat.account. Kind-agnostic:
--      PD-40's staff accounts reuse it. PD-21's suspended -> active
--      (chat.reactivate_account) and every deactivation are untouched.
--   3. chat.create_teacher. One transaction: a provisioned login, the teacher,
--      the Teacher File and, when one is named, the supervisor assignment,
--      audited without the e-mail or phone. The Teachers manager and the super
--      admin name any primary teacher supervisor or none; a teacher supervisor
--      names themselves or none (owner N1). A sign-in already used by ANY
--      account, in any case, or a contact already on a teacher's file, is
--      refused WITHOUT naming anyone: what the caller may be told is decided
--      by the API, which knows their scope (plan §3.4).
--      Department head's review (#184): a code is a KEYED hash (the API's
--      RESET_CODE_HASH_SECRET), so every outstanding code, stored under the
--      old unkeyed hash, is retired here; a first sign-in code is issued only
--      by someone who may add that teacher; activation checks a code spent in
--      THIS transaction, never a setting alone.
--   4. Pay (owner N2). The Teachers manager may write pay terms, the payout
--      account and the default deduction amounts, as the super admin does;
--      nobody else may write pay terms or a payout account any more (before,
--      any active staff member could, below the API). Adjustments keep PD-18's
--      rule: PD-26 prices a deduction as the supervisor who decided it.
--
-- Not here (a later PD-43 PR, its own slot): offboarding and reactivating a
-- teacher, the set-up checklist, the is_active/left_at agreement on
-- chat.teacher, and auditing supervisor changes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------------
select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd043 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('teachers.create', 'teachers', 'create', 'Add teachers and give them a sign-in', 'إضافة المعلمين ومنحهم حساب الدخول', 'admin', false, 'PD-43'),
  ('teachers.offboard', 'teachers', 'offboard', 'Offboard teachers', 'إنهاء عمل المعلمين', 'admin', false, 'PD-43');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'teachers', 'teacher_files.finance'),
  ('manager', 'teachers', 'teachers.create'),
  ('manager', 'teachers', 'teachers.offboard'),
  ('supervisor', 'teachers', 'teachers.create');
-- END GENERATED pd043 catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- ---------------------------------------------------------------------------
-- 2. The first sign-in code
-- ---------------------------------------------------------------------------
alter table chat.password_reset_code
  add column purpose text not null default 'reset'
    constraint password_reset_code_purpose check (purpose in ('reset', 'first_login'));

comment on column chat.password_reset_code.purpose is
  'PD-43: reset = PD-21/PD-25, a new password for an account in use; first_login = the first password of an account '
  'that has never signed in (provisioned). Completing a first_login code activates the account '
  '(chat.activate_account_with_code).';

-- A first sign-in code spent in THIS transaction: its row version was written
-- by the current transaction (xmin), it is a first_login code, used, and not
-- superseded. A code spent earlier, or a setting written by hand, is not one.
create function chat.is_first_login_code_spent_now(p_code uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from chat.password_reset_code c
     where c.id = p_code and c.purpose = 'first_login' and c.used_at is not null and c.superseded_at is null
       and c.xmin = (txid_current() % 4294967296)::text::xid
  );
$$;

-- Who may issue a teacher's first sign-in code: someone who may add teachers
-- (PD-40 teachers.create) and reaches this teacher -- the super admin, the
-- Teachers manager, or a teacher supervisor within their scope (every teacher
-- with PD-35's strict scope off; with it on, their own teachers). The
-- supervisor who added the teacher keeps it while the login waits, even when
-- they added it with no supervisor (owner N1).
create function chat.may_issue_teacher_first_login(p_staff uuid, p_teacher uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from chat.staff s
      join chat.teacher t on t.id = p_teacher and t.organization_id = s.organization_id
     where s.id = p_staff and s.is_active and s.left_at is null
       and chat.staff_has_permission(s.id, 'teachers.create')
       and (s.role = 'super_admin'
            or (s.role = 'manager' and chat.teachers_department_role(s.id) = 'manager')
            or (s.role in ('admin', 'coverage') and chat.teachers_department_role(s.id) = 'member'
                and (not chat.teacher_scope_strict()
                     or chat.staff_teacher_scope(s.id, t.id) in ('self', 'backup')
                     or exists (select 1 from chat.audit_log l
                                 where l.entity_id = t.id and l.action = 'teacher.created' and l.actor_id = s.id))))
  );
$$;

-- PD-25's guard, plus the purpose: a first sign-in code is issued by an
-- administrator, only to a provisioned account, and lives at most 72 hours
-- (five minutes' allowance for the API's clock); its purpose never changes.
create or replace function chat.guard_password_reset_code()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_target_kind   text;
  v_target_org    uuid;
  v_target_status text;
  v_target_role   text;
  v_issuer_role   text;
  v_issuer_acct   uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a password reset code is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select a.kind, a.organization_id, a.status into v_target_kind, v_target_org, v_target_status
      from chat.account a where a.id = new.account_id;
    if v_target_org is distinct from new.organization_id then
      raise exception 'a password reset code is for an account of its own organization' using errcode = 'check_violation';
    end if;

    if new.channel = 'admin' then
      select s.role, s.account_id into v_issuer_role, v_issuer_acct
        from chat.staff s
       where s.id = new.issued_by and s.organization_id = new.organization_id
         and s.is_active and s.left_at is null;
      if v_issuer_role is null then
        raise exception 'a password reset code is issued by active staff of the same organization' using errcode = 'check_violation';
      end if;
      if v_issuer_acct = new.account_id then
        raise exception 'nobody resets their own password this way' using errcode = 'check_violation';
      end if;

      if v_target_kind = 'staff' then
        select s.role into v_target_role from chat.staff s where s.account_id = new.account_id;
        if v_target_role = 'super_admin' then
          raise exception 'the super admin''s password is never reset by an administrator' using errcode = 'check_violation';
        end if;
        if v_issuer_role <> 'super_admin' then
          raise exception 'only the super admin resets a staff member''s password' using errcode = 'check_violation';
        end if;
      end if;
    elsif new.purpose = 'first_login' then
      raise exception 'a first sign-in code is issued by an administrator' using errcode = 'check_violation';
    elsif v_target_kind is distinct from 'family' then
      -- PD-25 is the parents' recovery: staff and teachers go through an administrator.
      raise exception 'only a parent account recovers itself' using errcode = 'check_violation';
    end if;

    if new.purpose = 'first_login' then
      if v_target_status is distinct from 'provisioned' then
        raise exception 'a first sign-in code is for an account that has not signed in yet' using errcode = 'check_violation';
      end if;
      if v_target_kind = 'teacher' then
        if not chat.may_issue_teacher_first_login(new.issued_by,
                 (select t.id from chat.teacher t where t.account_id = new.account_id)) then
          raise exception 'a first sign-in code is issued by someone who may add this teacher' using errcode = 'check_violation';
        end if;
      elsif v_target_kind is distinct from 'staff' then
        -- A parent's first password is PD-16's sign-up code.
        raise exception 'a first sign-in code is for a teacher or a staff account' using errcode = 'check_violation';
      end if;
    end if;

    new.created_at := now();
    new.attempts := 0;
    new.used_at := null;
    new.superseded_at := null;
    new.verified_at := null;
    if new.purpose = 'first_login' then
      if new.expires_at > now() + interval '72 hours 5 minutes' then
        raise exception 'a first sign-in code lives at most 72 hours' using errcode = 'check_violation';
      end if;
    elsif new.expires_at > now() + interval '1 day' then
      raise exception 'a password reset code lives at most a day' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.account_id, new.issued_by, new.channel, new.purpose, new.code_hash, new.reason, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.issued_by, old.channel, old.purpose, old.code_hash, old.reason, old.created_at, old.expires_at) then
    raise exception 'a password reset code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.verified_at is not null and new.verified_at is distinct from old.verified_at) then
    raise exception 'a password reset code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Every outstanding code was stored under the old, unkeyed hash, which the API
-- no longer computes. Retire them; the person asks again (a reset lives ten
-- minutes; no first sign-in code exists before this migration).
update chat.password_reset_code set superseded_at = now()
 where used_at is null and superseded_at is null;

-- The ONE way an account moves from provisioned to active: the person
-- completed a first sign-in code. PasswordResetService.complete() calls this
-- in the transaction that spends the code and sets the password.
create function chat.activate_account_with_code(p_code uuid)
returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code    chat.password_reset_code%rowtype;
  v_account chat.account%rowtype;
begin
  if not chat.caller_is_server_side() then
    raise exception 'PD-43: only a server-side writer activates an account (invoking role %)', chat.invoking_role()
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_code from chat.password_reset_code where id = p_code for update;
  if not chat.is_first_login_code_spent_now(p_code) then
    raise exception 'an account is activated only by a first sign-in code spent in this transaction' using errcode = 'check_violation';
  end if;
  select * into v_account from chat.account where id = v_code.account_id for update;
  if v_account.status is distinct from 'provisioned' then
    raise exception 'only a provisioned account is activated by a first sign-in code' using errcode = 'check_violation';
  end if;
  -- The bootstrap CLI is the super admin's only credential writer (PD-21).
  if exists (select 1 from chat.staff s where s.account_id = v_account.id and s.role = 'super_admin') then
    raise exception 'the super admin''s account is never activated by a code' using errcode = 'insufficient_privilege';
  end if;

  -- The guard re-checks the code itself: the setting only names it.
  perform set_config('chat.activating_code', v_code.id::text, true);
  update chat.account set status = 'active', is_active = true where id = v_account.id;
  perform set_config('chat.activating_code', '', true);

  -- The person is the actor, and has no staff id: no actor, the issuer in `after`.
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (null, 'account.activated', 'account', v_account.id, jsonb_build_object('status', 'provisioned'),
          jsonb_build_object('kind', v_account.kind, 'codeId', v_code.id, 'issuer', v_code.issued_by),
          'the account holder chose their first password with a first sign-in code');
  return v_account.id;
end;
$$;

create function chat.guard_account_first_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code uuid;
begin
  -- A setting anyone in the transaction could write only NAMES the code; the
  -- code itself must be this account's first sign-in code, spent in this very
  -- transaction and not superseded.
  begin
    v_code := nullif(current_setting('chat.activating_code', true), '')::uuid;
  exception when invalid_text_representation then
    v_code := null;
  end;
  if v_code is null
     or not exists (select 1 from chat.password_reset_code c where c.id = v_code and c.account_id = old.id)
     or not chat.is_first_login_code_spent_now(v_code) then
    raise exception 'an account becomes active from provisioned only with a first sign-in code (PD-43)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Scoped to provisioned -> active only: suspension, deactivation and PD-21's
-- reactivation (suspended -> active) never reach it.
create trigger account_activation_is_by_first_login
  before update of status on chat.account
  for each row when (old.status = 'provisioned' and new.status = 'active')
  execute function chat.guard_account_first_activation();

-- ---------------------------------------------------------------------------
-- 3. Adding a teacher
-- ---------------------------------------------------------------------------

-- A sign-in is compared without case (logins are trimmed, PD-43 stores them lower-cased).
create index account_subject_lower_idx on chat.account (lower(subject));

create function chat.create_teacher(
  p_id              uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_joined_on       date,
  p_teaching_market text,
  p_supervisor_id   uuid,
  p_reason          text,
  p_actor_id        uuid default null
) returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor     chat.staff%rowtype;
  v_dept_role text;
  v_name      text := btrim(coalesce(p_name, ''));
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits    text;
  v_market    text := nullif(btrim(coalesce(p_teaching_market, '')), '');
  v_reason    text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'teacher added');
  v_account   uuid;
begin
  select * into v_actor from chat.staff where id = chat.trusted_staff_actor(p_actor_id);
  if v_actor.id is null or not v_actor.is_active or v_actor.left_at is not null then
    raise exception 'only an active staff member adds a teacher' using errcode = 'insufficient_privilege';
  end if;

  -- PD-40's key, then the same rule as decideTeacherOnboarding
  -- (apps/api/src/platform/teacher-onboarding-policy.ts), the role re-checked.
  v_dept_role := chat.teachers_department_role(v_actor.id);
  if p_id is null
     or not chat.staff_has_permission(v_actor.id, 'teachers.create')
     or not (v_actor.role = 'super_admin'
             or (v_actor.role = 'manager' and v_dept_role = 'manager')
             or (v_actor.role in ('admin', 'coverage') and v_dept_role = 'member')) then
    raise exception 'only the Teachers department or the super admin adds a teacher' using errcode = 'insufficient_privilege';
  end if;
  if v_actor.role in ('admin', 'coverage') then
    if not exists (select 1 from chat.department_member dm join chat.department d on d.id = dm.department_id
                    where dm.staff_id = v_actor.id and dm.position = 'supervisor' and d.kind = 'teachers') then
      raise exception 'only a primary teacher supervisor adds a teacher' using errcode = 'insufficient_privilege';
    end if;
    if p_supervisor_id is not null and p_supervisor_id <> v_actor.id then
      raise exception 'a teacher supervisor adds a teacher for themselves or with no supervisor (PD-43 N1)'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'the sign-in e-mail is an e-mail address' using errcode = 'check_violation';
  end if;
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  end if;

  -- Two staff adding the same person at once: the second waits, then is refused.
  perform pg_advisory_xact_lock(hashtext('pd043:sign-in:' || v_email));
  if v_digits is not null then
    perform pg_advisory_xact_lock(hashtext('pd043:phone:' || v_digits));
  end if;

  -- The same request again (a double submit) is the teacher it already made --
  -- but only for the SAME adder, with the SAME arguments, while the login still
  -- waits for its first sign-in. Anything else is refused, so nobody can claim
  -- someone else's new teacher (and, in PR-2, its first sign-in code) by id.
  if exists (select 1 from chat.teacher t where t.id = p_id) then
    if exists (
      select 1
        from chat.teacher t
        join chat.account a on a.id = t.account_id
        join chat.teacher_file f on f.teacher_id = t.id
        join chat.audit_log l on l.entity_id = t.id and l.action = 'teacher.created'
       where t.id = p_id
         and t.organization_id = v_actor.organization_id
         and l.actor_id = v_actor.id
         and a.status = 'provisioned'
         and a.subject = v_email
         and t.name = v_name
         and f.phone is not distinct from v_phone
         and f.teaching_market is not distinct from v_market
         and (l.after ->> 'supervisorId') is not distinct from p_supervisor_id::text
         and (p_joined_on is null or f.joined_on = p_joined_on)
         and not exists (select 1 from chat.teacher_supervisor_assignment s
                          where s.teacher_id = t.id and s.supervisor_id is distinct from p_supervisor_id)
         and (p_supervisor_id is null
              or exists (select 1 from chat.teacher_supervisor_assignment s
                          where s.teacher_id = t.id and s.supervisor_id = p_supervisor_id))
    ) then
      return p_id;
    end if;
    raise exception 'this teacher id is already used' using errcode = 'check_violation';
  end if;

  if length(v_name) not between 1 and 120 then
    raise exception 'a teacher has a name (1 to 120 characters)' using errcode = 'check_violation';
  end if;

  -- Never a name, a kind or a family: the API decides what the caller may be told.
  -- check_violation, not unique_violation: Prisma turns 23505 into a bare
  -- "Unique constraint failed" and drops the message the API needs.
  if exists (select 1 from chat.account a where lower(a.subject) = v_email) then
    raise exception 'this e-mail already signs in to Chat' using errcode = 'check_violation';
  end if;
  if exists (select 1 from chat.teacher_file f
              where f.organization_id = v_actor.organization_id
                and (lower(f.email) = v_email
                     or (v_digits is not null and regexp_replace(coalesce(f.phone, ''), '[^0-9]', '', 'g') = v_digits))) then
    raise exception 'this contact is already on a teacher''s file' using errcode = 'check_violation';
  end if;

  insert into chat.account (organization_id, subject, kind, status, is_active)
  values (v_actor.organization_id, v_email, 'teacher', 'provisioned', false)
  returning id into v_account;
  insert into chat.teacher (id, organization_id, account_id, name, is_active)
  values (p_id, v_actor.organization_id, v_account, v_name, true);
  insert into chat.teacher_file (teacher_id, organization_id, phone, email, joined_on, teaching_market, updated_by)
  values (p_id, v_actor.organization_id, v_phone, v_email, coalesce(p_joined_on, current_date), v_market, v_actor.id);
  if p_supervisor_id is not null then
    -- chat.guard_teacher_supervisor_assignment: a live primary supervisor of the Teachers department.
    insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by, reason)
    values (p_id, v_actor.organization_id, p_supervisor_id, v_actor.id, v_reason);
  end if;

  -- The audit trail is read more widely than the Teacher File: no e-mail, no phone.
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'teacher.created', 'teacher', p_id, null,
          jsonb_build_object('accountId', v_account, 'supervisorId', p_supervisor_id, 'hasPhone', v_phone is not null,
                             'joinedOn', coalesce(p_joined_on, current_date), 'teachingMarket', v_market),
          v_reason);
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pay: the super admin and the Teachers manager (owner N2)
-- ---------------------------------------------------------------------------

-- The payroll author: the super admin, or the manager of the Teachers department.
create function chat.is_teacher_payroll_author(p_staff uuid, p_organization uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_organization and s.is_active and s.left_at is null
       and (s.role = 'super_admin' or (s.role = 'manager' and chat.teachers_department_role(s.id) = 'manager'))
  );
$$;

-- Its own trigger beside PD-18's chat.guard_teacher_payroll_row, which stays
-- as it is (adjustments keep its rule). Both tables name their author through
-- to_jsonb, so one function serves both without reading a missing NEW field.
create function chat.guard_teacher_pay_author()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_author uuid := coalesce(to_jsonb(new) ->> 'created_by', to_jsonb(new) ->> 'updated_by')::uuid;
begin
  if not chat.is_teacher_payroll_author(v_author, new.organization_id) then
    raise exception 'pay terms and the payout account are written by the super admin or the Teachers manager (PD-43)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_pay_terms_author_is_payroll before insert on chat.teacher_pay_terms
  for each row execute function chat.guard_teacher_pay_author();
create trigger teacher_payout_account_author_is_payroll before insert or update on chat.teacher_payout_account
  for each row execute function chat.guard_teacher_pay_author();

-- PD-26's guard, widened from the super admin to the Teachers manager.
create or replace function chat.guard_teacher_pay_default()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if not chat.is_teacher_payroll_author(new.created_by, new.organization_id) then
    raise exception 'default deduction amounts are set by the super admin or the Teachers manager (PD-43)'
      using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

comment on table chat.teacher_pay_default is
  'PD-26: the default amount of a first or second deduction in one currency; the newest row wins. Append-only. '
  'The super admin and the Teachers manager (PD-43).';

-- ---------------------------------------------------------------------------
-- 5. Server-only
-- ---------------------------------------------------------------------------
revoke all on function chat.activate_account_with_code(uuid) from public;
revoke all on function chat.is_first_login_code_spent_now(uuid) from public;
revoke all on function chat.may_issue_teacher_first_login(uuid, uuid) from public;
revoke all on function chat.guard_account_first_activation() from public;
revoke all on function chat.create_teacher(uuid, text, text, text, date, text, uuid, text, uuid) from public;
revoke all on function chat.is_teacher_payroll_author(uuid, uuid) from public;
revoke all on function chat.guard_teacher_pay_author() from public;
revoke all on function chat.guard_password_reset_code() from public;
revoke all on function chat.guard_teacher_pay_default() from public;
