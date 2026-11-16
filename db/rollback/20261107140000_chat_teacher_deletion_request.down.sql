-- Roll back 20261107140000_chat_teacher_deletion_request (PD-56 O-3: a
-- teacher's account deletion request, completed within 30 days).
--
-- Roll back the API first (TeacherDeletionRequestService writes and sweeps
-- these). chat.erase_account goes back to 20261104100000's text: a teacher with
-- anything open is refused again (TEACHER_DELETION_BLOCKED), with no request.
--
-- A request row is the record that a deletion was asked for and when. This file
-- REFUSES while any of its tables holds a row, unless the operator says, in the same
-- transaction, that the rows were exported and may go:
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261107140000_chat_teacher_deletion_request.down.sql
--
--   # only after exporting, and with the owner's authorization:
--   \copy chat.account_deletion_request to 'account-deletion-request.csv' csv header
--   \copy chat.erased_teacher_handover to 'erased-teacher-handover.csv' csv header
--   \copy (select p.* from chat.teacher_payout_account p join chat.teacher te on te.id = p.teacher_id join chat.account a on a.id = te.account_id where a.subject like 'erased:%') to 'erased-teacher-payout.csv' csv header
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" \
--     -c "select set_config('chat.rollback_discards_deletion_requests', 'on', true)" \
--     -f db/rollback/20261107140000_chat_teacher_deletion_request.down.sql
--
-- With that setting, before the tables go (B9, review of #498):
--   * every PENDING request is written to chat.audit_log
--     (account_deletion_request.discarded: account, teacher, requested and
--     deadline times, what was open). The audit log is never deleted, so the
--     teacher's ask outlives the table; its open task stays for staff to honour.
--   * an ERASED teacher's payout account, kept only while their payroll was open
--     (chat.erased_teacher_sweep deleted it later), is deleted now, one audit row
--     each: after this rollback nothing would ever delete it, and the restored
--     chat.erase_account deletes it at once. Export it first (above) if wages are
--     still owed.
--   * work tasks stay as they are: chat.work_task is never deleted (its guard
--     refuses), and the open ones are still real work -- a learner who needs a
--     teacher, payroll to pay, a deletion to honour. Staff complete them by hand;
--     nothing completes them automatically any more.
-- The last statement removes this migration from chat.schema_migrations, so
-- scripts/db/apply.sh applies it again on the next deploy (B9, P2-1).

set local lock_timeout = '5s';

do $$
declare
  v_tbl  text;
  v_rows boolean;
begin
  if coalesce(current_setting('chat.rollback_discards_deletion_requests', true), '') = 'on' then
    return;
  end if;
  foreach v_tbl in array array['account_deletion_request', 'account_deletion_reminder', 'erased_teacher_handover'] loop
    if to_regclass('chat.' || v_tbl) is not null then
      execute format('select exists (select 1 from chat.%I)', v_tbl) into v_rows;
      if v_rows then
        raise exception 'chat.% holds rows: export them and erased teachers'' payout accounts (this file''s header), then set chat.rollback_discards_deletion_requests', v_tbl;
      end if;
    end if;
  end loop;
end
$$;


-- With the discard setting: what the rows stood for is settled before they go (see the header).
do $$
declare
  r       record;
  v_req   integer := 0;
  v_pay   integer := 0;
begin
  if to_regclass('chat.account_deletion_request') is null then
    return;  -- already rolled back: nothing to settle
  end if;
  for r in execute 'select id, account_id, teacher_id, requested_at, deadline_at, open_items
                      from chat.account_deletion_request where state = ''pending'' order by requested_at, id' loop
    insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
    values (null, 'account_deletion_request.discarded', 'account_deletion_request', r.id,
            jsonb_build_object('state', 'pending'),
            jsonb_build_object('accountId', r.account_id, 'teacherId', r.teacher_id, 'requestedAt', r.requested_at,
                               'deadlineAt', r.deadline_at, 'openItems', to_jsonb(r.open_items)),
            'rollback of 20261107140000: the request is no longer tracked; its open task stays for staff to honour');
    v_req := v_req + 1;
  end loop;
  for r in
    select p.teacher_id
      from chat.teacher_payout_account p
      join chat.teacher te on te.id = p.teacher_id
      join chat.account a on a.id = te.account_id and a.subject like 'erased:%'
     order by p.teacher_id
  loop
    delete from chat.teacher_payout_account where teacher_id = r.teacher_id;
    insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
    values (null, 'teacher_payout_account.deleted', 'teacher', r.teacher_id, null, null,
            'rollback of 20261107140000: an erased teacher''s payout account is not kept without the sweep that deleted it');
    v_pay := v_pay + 1;
  end loop;
  raise notice 'rollback of 20261107140000: % pending request(s) recorded in the audit log, % erased teacher payout account(s) deleted', v_req, v_pay;
end
$$;

-- chat.erase_account as 20261104100000 defined it.
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
  -- PD-57: the principal kind of this account's people (blocks are by kind and id).
  v_kind     text;
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

  -- PD-57 (roadmap §5.5 rule 6, §6.2): the reports this person filed are kept
  -- and become anonymous; the blocks they made or received go. Evidence about
  -- them in other people's reports is kept, as the audit log is.
  v_kind := case v_account.kind when 'family' then 'contact' else 'teacher' end;
  perform set_config('chat.erasing_account', v_account.id::text, true);
  update chat.content_report set reporter_id = null, reporter_account_id = null
   where reporter_account_id = v_account.id;
  perform set_config('chat.erasing_account', '', true);
  delete from chat.actor_block
   where (blocker_kind = v_kind and blocker_id = any (v_ids))
      or (blocked_kind = v_kind and blocked_id = any (v_ids));

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
  'the photo object keys the caller deletes from storage, and the tasks raised. Idempotent. '
  'PD-57: the person''s reports are kept, anonymous; their blocks, made and received, are deleted.';
revoke all on function chat.erase_account(uuid, text, text[]) from public;

drop function if exists chat.erased_teacher_sweep(integer);
drop function if exists chat.complete_account_deletion_request(uuid, uuid, text);
drop function if exists chat.account_deletion_request_close(uuid, text, uuid, jsonb);
drop function if exists chat.cancel_account_deletion_request(uuid);
drop function if exists chat.request_account_deletion(uuid);
drop table if exists chat.account_deletion_reminder;
drop function if exists chat.guard_account_deletion_reminder();
drop function if exists chat.account_deletion_request_json(chat.account_deletion_request);
drop table if exists chat.account_deletion_request;
drop function if exists chat.guard_account_deletion_request();
drop function if exists chat.teacher_deletion_left_open(uuid);
drop function if exists chat.teacher_deletion_open_items(uuid);
drop function if exists chat.teacher_payroll_open(uuid);
drop table if exists chat.erased_teacher_handover;
drop function if exists chat.guard_erased_teacher_handover();
delete from chat.notification_template
 where key in ('teacher_deletion_day21', 'teacher_deletion_day28', 'inbox.teacher_deletion_day21', 'inbox.teacher_deletion_day28');
delete from chat.notification_rule r
 where r.key in ('teacher_deletion_day21', 'teacher_deletion_day28')
   and not exists (select 1 from chat.notification n where n.rule_key = r.key)
   and not exists (select 1 from chat.notification_item i where i.rule_key = r.key);

delete from chat.schema_migrations where version = '20261107140000_chat_teacher_deletion_request';
