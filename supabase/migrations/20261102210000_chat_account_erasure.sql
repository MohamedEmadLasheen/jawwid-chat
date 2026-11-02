-- Store compliance PR-A (Apple 5.1.1(v), Google Play account deletion):
-- a parent or a teacher deletes their own account.
--
-- Retention (the department head's decision, 2026-11-02, delegated by the owner):
--   * Personal data goes now. The person's name becomes "Deleted user"; their
--     photo, about text, admin-only phone and e-mail, push tokens, sign-in
--     (password, sessions, reset codes) and their own notifications are
--     deleted. The login identifier is replaced, so the e-mail can sign up again.
--   * Kept: payments, invoices, receipts and the audit log (financial records,
--     7 years), attributed to the anonymised person. Messages the person sent
--     stay in their conversations, shown as "Deleted user": the other members
--     keep the history.
--   * A parent's children are the academy's records and are never deleted. The
--     parent is unlinked from the family; if the family is left with nobody who
--     can sign in, the Operations manager gets a task (family_without_account).
--     The family-contact keys (PD-42) made from THIS parent's e-mails and phone
--     are deleted -- the API computes them (the key is a server secret) and
--     passes them in -- so the same e-mail signing up again is a new person.
--   * A teacher cannot delete their account while anything is open on them:
--     a future lesson, an assigned student, or payroll of this month or last
--     (a held lesson or a pay adjustment; nothing in the schema marks a month
--     settled). TEACHER_DELETION_BLOCKED, before any write; the person is told
--     to ask the academy. After a deletion the Teachers manager is told
--     (teacher_account_deleted, to acknowledge), and the payout account and the
--     professional profile's certificate files go.
--
-- 0. chat.guard_family_contact_key: an erasure may remove the parent's own keys
-- 1. chat.erase_account: the whole erasure in one transaction
-- 2. chat.work_task_sweep_erasure: settles the family task once its work is done
--
-- Rollback: db/rollback/20261102210000_account_erasure.down.sql (the functions
-- only; an erasure already done is not undone).

-- ===========================================================================
-- 0. A contact key may go when its parent erases their account
-- ===========================================================================
-- PD-42's guard keeps a family's keys for as long as the family exists; PD-45
-- lets a re-keyed reading go within its own country change. An erasure is the
-- third way: chat.erase_account names the family it is erasing a parent of
-- (chat.erasing_family, transaction-local) and deletes only that parent's own
-- keys. Copied from 20261030050000 with that one branch added.

create or replace function chat.guard_family_contact_key()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from chat.family f where f.id = old.family_id) then
      return old;
    end if;
    -- PD-45: a re-keyed reading goes only within its own family's country change.
    if old.source = 'rekey' and current_setting('chat.rekeying_family', true) = old.family_id::text then
      return old;
    end if;
    -- PD-56: a parent's own keys go when they erase their account.
    if current_setting('chat.erasing_family', true) = old.family_id::text then
      return old;
    end if;
    raise exception 'a contact key is never removed while its family exists' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a contact key never changes' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.family where id = new.family_id;
  if v_org is null then
    raise exception 'a contact key is for a family' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  -- Said in words before the primary key would (Prisma drops 23505's message).
  if exists (select 1 from chat.family_contact_key k where k.organization_id = v_org and k.key_hash = new.key_hash) then
    raise exception 'this parent is already in Chat' using errcode = 'check_violation';
  end if;
  if new.created_by is not null and not chat.staff_of(new.created_by, v_org) then
    raise exception 'a contact key is added by staff of the family''s organization' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. The erasure
-- ===========================================================================

create function chat.erase_account(p_account uuid, p_reason text, p_contact_keys text[] default '{}') returns jsonb
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  c_name     constant text := 'Deleted user';
  v_account  chat.account%rowtype;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_ids      uuid[] := '{}';
  v_keys     text[] := '{}';
  v_tasks    text[] := '{}';
  v_task     uuid;
  v_blocked  text[] := '{}';
  r          record;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server erases an account' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) not between 1 and 200 then
    raise exception 'erasure requires a reason' using errcode = 'check_violation';
  end if;

  select * into v_account from chat.account where id = p_account for update;
  if v_account.id is null then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;
  if v_account.kind not in ('family', 'teacher') then
    raise exception 'a staff account is closed by an administrator' using errcode = 'insufficient_privilege';
  end if;
  if v_account.subject like 'erased:%' then
    return jsonb_build_object('kind', v_account.kind, 'alreadyErased', true, 'principalIds', '[]'::jsonb,
                              'avatarKeys', '[]'::jsonb, 'tasks', '[]'::jsonb);
  end if;

  -- A teacher with anything open is refused before anything is written.
  if v_account.kind = 'teacher' then
    for r in select * from chat.teacher where account_id = v_account.id for update loop
      if exists (select 1 from chat.lesson l where l.teacher_id = r.id and l.outcome is null and l.starts_at >= now()) then
        v_blocked := v_blocked || 'future_lessons'::text;
      end if;
      if exists (select 1 from chat.learner l where l.teacher_id = r.id) then
        v_blocked := v_blocked || 'assigned_learners'::text;
      end if;
      if exists (select 1 from chat.lesson l
                  where l.teacher_id = r.id and l.outcome is not null
                    and l.starts_at >= date_trunc('month', now()) - interval '1 month')
         or exists (select 1 from chat.teacher_pay_adjustment a
                     where a.teacher_id = r.id and a.month >= (date_trunc('month', now()) - interval '1 month')::date) then
        v_blocked := v_blocked || 'open_payroll'::text;
      end if;
    end loop;
    if cardinality(v_blocked) > 0 then
      raise exception 'TEACHER_DELETION_BLOCKED: %', array_to_string(v_blocked, ',') using errcode = 'check_violation';
    end if;
  end if;

  -- The login: out of service, its identifier freed, its secrets gone.
  if v_account.status = 'active' then
    perform chat.deactivate_principal('account', v_account.id, 'erased: ' || v_reason, null, 'deactivated');
  else
    update chat.account set status = 'deactivated', is_active = false, deactivated_at = coalesce(deactivated_at, now())
     where id = v_account.id;
  end if;
  update chat.account set subject = 'erased:' || id::text where id = v_account.id;
  delete from chat.account_credential where account_id = v_account.id;
  delete from chat.device where account_id = v_account.id;
  update chat.password_reset_code set superseded_at = now()
   where account_id = v_account.id and used_at is null and superseded_at is null;

  if v_account.kind = 'family' then
    for r in select * from chat.contact where account_id = v_account.id for update loop
      v_ids := v_ids || r.id;
      if r.avatar_object_key is not null then v_keys := v_keys || r.avatar_object_key; end if;
      if r.is_active then
        perform chat.deactivate_principal('contact', r.id, 'erased: ' || v_reason, null, 'deactivated');
      end if;
      update chat.contact set name = c_name, avatar_object_key = null where id = r.id;
      delete from chat.contact_profile where contact_id = r.id;
      delete from chat.parent_file where contact_id = r.id;
      delete from chat.contact_location_prompt where contact_id = r.id;
      update chat.family set primary_contact_id = null where primary_contact_id = r.id;
      -- This parent's own keys only: another parent of the family keeps theirs.
      perform set_config('chat.erasing_family', r.family_id::text, true);
      delete from chat.family_contact_key
       where family_id = r.family_id and key_hash = any (coalesce(p_contact_keys, '{}'::text[]));
      perform set_config('chat.erasing_family', '', true);

      -- Nobody left in the family who can sign in: the children are flagged.
      if not exists (select 1 from chat.contact c join chat.account a on a.id = c.account_id
                      where c.family_id = r.family_id and c.id <> r.id and c.is_active and a.is_active) then
        if exists (select 1 from chat.learner l where l.family_id = r.family_id) then
          v_task := chat.work_task_raise(r.organization_id, 'family_without_account', r.family_id,
                                         chat.work_task_operations_manager(r.organization_id), null,
                                         'high', 'operational', 'none', null);
          v_tasks := v_tasks || ('family_without_account:' || r.family_id::text);
        end if;
      end if;
    end loop;
  else
    for r in select * from chat.teacher where account_id = v_account.id for update loop
      v_ids := v_ids || r.id;
      if r.avatar_object_key is not null then v_keys := v_keys || r.avatar_object_key; end if;
      if r.is_active then
        perform chat.deactivate_principal('teacher', r.id, 'erased: ' || v_reason, null, 'deactivated');
      end if;
      update chat.teacher set name = c_name, avatar_object_key = null where id = r.id;
      -- The admin-only contact goes; the joining date stays with the file.
      update chat.teacher_file set phone = null, email = null where teacher_id = r.id;
      -- The profile's certificate files go from storage with it.
      v_keys := v_keys || coalesce((select array_agg(c.object_key)
                                      from chat.teacher_profile_certificate c
                                      join chat.teacher_professional_profile pp on pp.id = c.profile_id
                                     where pp.teacher_id = r.id), '{}'::text[]);
      delete from chat.teacher_professional_profile where teacher_id = r.id;
      delete from chat.teacher_supervisor_assignment where teacher_id = r.id;
      -- No payroll is open (the gate above), so how they were paid goes.
      delete from chat.teacher_payout_account where teacher_id = r.id;

      -- The department records the departure: a notice to acknowledge, nothing to do.
      v_task := chat.work_task_raise(r.organization_id, 'teacher_account_deleted', r.id,
                                     chat.work_task_teachers_manager(r.organization_id), null,
                                     'medium', 'operational', 'none', null);
      perform chat.work_task_withdraw(r.organization_id, 'teacher_account_deleted:' || r.id::text);
      v_tasks := v_tasks || ('teacher_account_deleted:' || r.id::text);
    end loop;
  end if;

  -- What only this person read or used: their inbox and their push tokens.
  -- Their seats close; what they wrote stays.
  delete from chat.device_token where actor_id = any (v_ids);
  delete from chat.notification_item where recipient_id = any (v_ids);
  delete from chat.notification where recipient_id = any (v_ids);
  update chat.conversation_member set left_at = now() where actor_id = any (v_ids) and left_at is null;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_ids[1], 'account.erased', 'account', v_account.id,
          jsonb_build_object('kind', v_account.kind, 'status', v_account.status),
          jsonb_build_object('principalIds', to_jsonb(v_ids), 'tasks', to_jsonb(v_tasks)),
          v_reason);

  return jsonb_build_object('kind', v_account.kind, 'alreadyErased', false, 'principalIds', to_jsonb(v_ids),
                            'avatarKeys', to_jsonb(v_keys), 'tasks', to_jsonb(v_tasks));
end;
$$;
comment on function chat.erase_account(uuid, text, text[]) is
  'Store compliance: a parent or teacher deletes their own account. Personal data anonymised or deleted; '
  'payments, invoices, receipts, audit and sent messages kept (as "Deleted user"). Returns the principal ids, '
  'the photo object keys the caller deletes from storage, and the tasks raised. Idempotent.';
revoke all on function chat.erase_account(uuid, text, text[]) from public;

-- ===========================================================================
-- 2. The family task settles once its work is done
-- ===========================================================================
-- family_without_account:<family>   done when the family again has someone who
--                                   can sign in, or has no children left
-- (teacher_account_deleted is a notice, withdrawn when raised: the Teachers
-- manager acknowledges it.) A source names who did its work; here that is the
-- task's assignee, the manager whose team re-linked the family.

create function chat.work_task_sweep_erasure(p_batch integer default 50) returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_left    integer := least(greatest(coalesce(p_batch, 50), 1), 60);
  v_settled integer := 0;
  v_more    boolean := false;
  r         record;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_erasure')) then
    return jsonb_build_object('skipped', true);
  end if;
  for r in
    select t.organization_id, t.source_key, coalesce(t.assignee_staff_id, t.assignee_teacher_id) as actor
      from chat.work_task t
     where t.state in ('open', 'awaiting_decision')
       and t.source_type = 'family_without_account'
       and (exists (select 1 from chat.contact c join chat.account a on a.id = c.account_id
                     where c.family_id = t.source_id and c.is_active and a.is_active)
            or not exists (select 1 from chat.learner l where l.family_id = t.source_id))
     order by t.created_at, t.id
     limit v_left + 1
  loop
    if v_left = 0 then
      v_more := true;
      exit;
    end if;
    v_settled := v_settled + chat.work_task_settle(r.organization_id, r.source_key, r.actor);
    v_left := v_left - 1;
  end loop;
  return jsonb_build_object('settled', v_settled, 'more', v_more);
end;
$$;
revoke all on function chat.work_task_sweep_erasure(integer) from public;
