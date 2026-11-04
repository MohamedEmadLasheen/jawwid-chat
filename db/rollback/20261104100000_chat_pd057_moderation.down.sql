-- Roll back 20261104100000_chat_pd057_moderation (PD-57, ENG-01): Report and Block.
--
-- Roll back the API first: the PD-57 moderation module (ENG-02) reads and writes
-- these tables. DROPS chat.content_report, chat.actor_block and
-- chat.actor_block_manager_notice WITH THEIR ROWS: the reports, their evidence
-- and answers, every block and the record of which managers were told are lost. Take a
-- backup first if any exist (select count(*) from chat.content_report).
-- chat.erase_account returns to its 20261102210000 text (reports and blocks
-- no longer exist for it to touch).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261104100000_chat_pd057_moderation.down.sql

set local lock_timeout = '5s';

-- chat.erase_account exactly as 20261102210000_chat_account_erasure defined it.
create or replace function chat.erase_account(p_account uuid, p_reason text, p_contact_keys text[] default '{}') returns jsonb
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

drop table if exists chat.actor_block_manager_notice;
drop table if exists chat.actor_block;
drop table if exists chat.content_report;
drop function if exists chat.guard_actor_block_manager_notice();
drop function if exists chat.guard_actor_block();
drop function if exists chat.guard_content_report();

delete from chat.config where key = 'report.limit.per_reporter_hour';

delete from chat.schema_migrations where version = '20261104100000_chat_pd057_moderation';
