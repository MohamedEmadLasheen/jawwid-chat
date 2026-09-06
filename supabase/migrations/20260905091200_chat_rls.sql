-- Jawwid Chat -- row level security.
--
-- Two populations reach this database, both resolving through chat.account:
--
--   staff          have a chat.staff row. They reach the tables directly, and
--                  every policy below narrows what they see.
--   family contacts have a chat.contact row and NO staff row. They get no grant
--                  on any base table at all. Everything they can see is a
--                  chat.my_* view, and the only thing they can write goes
--                  through chat.post_customer_message().
--
-- Splitting the two populations this way means a mistake in a staff policy can
-- never widen what a parent sees: parents are not reading those tables.

-- Audit and event writes must succeed regardless of the caller's grants -- an
-- action that cannot be recorded must not be performable.
alter function chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb) security definer;
alter function chat.log_event(text, uuid, uuid, text, uuid, jsonb) security definer;
alter function chat.recompute_family_state(uuid, timestamptz) security definer;

grant usage on schema chat to authenticated, service_role;

alter table chat.config             enable row level security;
alter table chat.staff              enable row level security;
alter table chat.shift              enable row level security;
alter table chat.coverage_rule      enable row level security;
alter table chat.absence            enable row level security;
alter table chat.family             enable row level security;
alter table chat.contact            enable row level security;
alter table chat.learner            enable row level security;
alter table chat.subscription       enable row level security;
alter table chat.family_note        enable row level security;
alter table chat.thread             enable row level security;
alter table chat.support_case       enable row level security;
alter table chat.message            enable row level security;
alter table chat.task               enable row level security;
alter table chat.handoff            enable row level security;
alter table chat.event_log          enable row level security;
alter table chat.audit_log          enable row level security;
alter table chat.family_state_cache enable row level security;
alter table chat.sync_state         enable row level security;
alter table chat.core_event         enable row level security;
alter table chat.schema_migrations  enable row level security;
alter table chat.account            enable row level security;
alter table chat.core_parent_inbox  enable row level security;

-- Roster and configuration --------------------------------------------------

grant select on chat.staff, chat.shift, chat.coverage_rule, chat.absence, chat.config
  to authenticated;
grant insert, update, delete on chat.shift, chat.coverage_rule, chat.absence, chat.config
  to authenticated;
grant update on chat.staff to authenticated;

create policy staff_readable_by_staff on chat.staff for select to authenticated
  using (chat.current_staff_id() is not null);

create policy staff_managed_by_manager on chat.staff for update to authenticated
  using (chat.is_manager() or id = chat.current_staff_id())
  with check (chat.is_manager() or id = chat.current_staff_id());

create policy shift_readable_by_staff on chat.shift for select to authenticated
  using (chat.current_staff_id() is not null);
create policy shift_managed_by_manager on chat.shift for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());

create policy coverage_rule_readable_by_staff on chat.coverage_rule for select to authenticated
  using (chat.current_staff_id() is not null);
create policy coverage_rule_managed_by_manager on chat.coverage_rule for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());

create policy absence_readable_by_staff on chat.absence for select to authenticated
  using (chat.current_staff_id() is not null);
create policy absence_managed_by_manager on chat.absence for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());

-- Brief SS12: all constants live in config, and only the manager edits them.
create policy config_readable_by_staff on chat.config for select to authenticated
  using (chat.current_staff_id() is not null);
create policy config_managed_by_manager on chat.config for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());

-- The family record ---------------------------------------------------------

grant select, insert, update on chat.family, chat.contact, chat.learner, chat.subscription,
  chat.family_note, chat.thread, chat.support_case, chat.task, chat.handoff to authenticated;
grant select, insert on chat.message, chat.event_log to authenticated;
grant select on chat.audit_log, chat.family_state_cache, chat.sync_state, chat.core_event,
  chat.core_parent_inbox to authenticated;

create policy family_visible_to_staff on chat.family for select to authenticated
  using (chat.staff_can_see_family(id));

create policy family_edited_by_admins on chat.family for update to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and chat.staff_can_see_family(id))
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

create policy family_created_by_manager on chat.family for insert to authenticated
  with check (chat.is_manager());

create policy contact_visible_to_staff on chat.contact for select to authenticated
  using (chat.staff_can_see_family(family_id));
create policy contact_edited_by_admins on chat.contact for all to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and chat.staff_can_see_family(family_id))
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

create policy learner_visible_to_staff on chat.learner for select to authenticated
  using (chat.staff_can_see_family(family_id));
create policy learner_edited_by_admins on chat.learner for all to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and chat.staff_can_see_family(family_id))
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

create policy subscription_visible_to_staff on chat.subscription for select to authenticated
  using (chat.staff_can_see_family(family_id));

-- Brief SS5: any admin may write an internal note on any family at any time.
create policy family_note_visible_to_staff on chat.family_note for select to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager'));
create policy family_note_written_by_admins on chat.family_note for insert to authenticated
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager')
              and author_id = chat.current_staff_id());

create policy thread_visible_to_staff on chat.thread for select to authenticated
  using (chat.staff_can_see_family(family_id));
create policy thread_edited_by_admins on chat.thread for update to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and chat.staff_can_see_family(family_id))
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

create policy case_visible_to_staff on chat.support_case for select to authenticated
  using (chat.staff_can_see_family(family_id));
create policy case_edited_by_admins on chat.support_case for all to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and chat.staff_can_see_family(family_id))
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

-- Messages ------------------------------------------------------------------
-- The whole of brief SS5's "who may act" lands in this one WITH CHECK.

create policy message_visible_to_staff on chat.message for select to authenticated
  using (exists (select 1 from chat.thread t
                 where t.id = thread_id and chat.staff_can_see_family(t.family_id)));

create policy message_written_by_staff on chat.message for insert to authenticated
  with check (
    author_type = 'staff'
    and author_id = chat.current_staff_id()
    and (
      -- An internal note is always allowed to an admin, coverage or manager.
      (visibility = 'internal'
       and chat.current_staff_role() in ('admin', 'coverage', 'manager'))
      or
      -- Speaking to the family is gated on the mode and the roster.
      (visibility = 'customer'
       and chat.staff_may_send(
             chat.current_staff_id(),
             (select t.family_id from chat.thread t where t.id = thread_id),
             on_behalf_mode))
    ));

-- Tasks ---------------------------------------------------------------------
-- Brief SS2: department staff see and complete only the tasks assigned to them.

create policy task_visible_to_assignee_or_admins on chat.task for select to authenticated
  using (owner_id = chat.current_staff_id() or chat.staff_can_see_family(family_id));

create policy task_created_by_admins on chat.task for insert to authenticated
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager')
              and chat.staff_can_see_family(family_id));

create policy task_updated_by_assignee_or_admins on chat.task for update to authenticated
  using (owner_id = chat.current_staff_id()
         or (chat.current_staff_role() in ('admin', 'coverage', 'manager')
             and chat.staff_can_see_family(family_id)))
  with check (owner_id = chat.current_staff_id()
              or chat.current_staff_role() in ('admin', 'coverage', 'manager'));

create policy handoff_visible_to_staff on chat.handoff for select to authenticated
  using (exists (select 1 from chat.thread t
                 where t.id = thread_id and chat.staff_can_see_family(t.family_id)));
create policy handoff_written_by_admins on chat.handoff for insert to authenticated
  with check (chat.current_staff_role() in ('admin', 'coverage', 'manager'));

-- Logs ----------------------------------------------------------------------

create policy event_log_visible_to_staff on chat.event_log for select to authenticated
  using (chat.current_staff_role() in ('admin', 'coverage', 'manager')
         and (family_id is null or chat.staff_can_see_family(family_id)));

create policy event_log_written_by_staff on chat.event_log for insert to authenticated
  with check (chat.current_staff_id() is not null);

-- Brief SS3: the audit log is manager-only read.
create policy audit_log_manager_only on chat.audit_log for select to authenticated
  using (chat.is_manager());

create policy family_state_visible_to_staff on chat.family_state_cache for select to authenticated
  using (chat.staff_can_see_family(family_id));

create policy sync_state_manager_only on chat.sync_state for select to authenticated
  using (chat.is_manager());
create policy core_event_manager_only on chat.core_event for select to authenticated
  using (chat.is_manager());
create policy core_parent_inbox_manager_only on chat.core_parent_inbox for select to authenticated
  using (chat.is_manager());

-- chat.account is never readable through the API. Identity is resolved by
-- SECURITY DEFINER helpers; nothing needs to enumerate accounts, and no policy
-- grants it.

-- ---------------------------------------------------------------------------
-- The family-side surface
-- ---------------------------------------------------------------------------
-- These views are owned by the migration role and run with its rights, so they
-- do not depend on any grant to the tables underneath. Their WHERE clauses on
-- chat.current_account_id() are therefore the entire access control -- keep
-- them airtight.
-- Brief SS8: the customer screen shows the owner, plain topic status, and an
-- honest reply time. No internal labels, no staff ids, no attention scores.

create or replace view chat.my_family as
  select f.id            as family_id,
         f.display_name,
         f.language,
         owner.name      as owner_name,
         on_duty.name    as replying_now,
         chat.next_on_duty_at(f.id) as next_reply_expected_at
  from chat.family f
  join chat.contact c on c.family_id = f.id and c.account_id = chat.current_account_id() and c.is_active
  left join chat.staff owner on owner.id = f.owner_id
  left join chat.staff on_duty on on_duty.id = chat.effective_handler(f.id);

create or replace view chat.my_permissions as
  select c.family_id, c.name, c.role_preset,
         c.can_message, c.can_view_progress, c.can_manage_schedule,
         c.can_manage_billing, c.can_manage_contacts, c.can_cancel
  from chat.contact c
  where c.account_id = chat.current_account_id() and c.is_active;

create or replace view chat.my_topics as
  select sc.id as topic_id,
         sc.type,
         case sc.status
           when 'waiting_customer' then 'waiting_for_you'
           when 'resolved'         then 'done'
           when 'closed'           then 'done'
           when 'scheduled'        then 'scheduled'
           else 'in_progress'
         end as status,
         sc.created_at,
         sc.resolved_at
  from chat.support_case sc
  where sc.family_id in (select family_id from chat.contact
                         where account_id = chat.current_account_id() and is_active);

comment on view chat.my_topics is
  'Plain status only. waiting_internal and open both read as in_progress: the '
  'family is never shown Jawwid''s internal workflow.';

create or replace view chat.my_messages as
  select m.id,
         m.thread_id,
         m.case_id as topic_id,
         m.body,
         m.attachments,
         m.created_at,
         m.client_id,
         case m.author_type when 'contact' then 'family'
                            when 'staff'   then 'jawwid'
                            else 'system' end as sender_kind,
         case m.author_type
           when 'contact' then (select c2.name from chat.contact c2 where c2.id = m.author_id)
           when 'staff'   then (select s.name from chat.staff s where s.id = m.author_id)
           else null
         end as sender_name
  from chat.message m
  join chat.thread t on t.id = m.thread_id
  where m.visibility = 'customer'
    and t.family_id in (select family_id from chat.contact
                        where account_id = chat.current_account_id() and is_active);

comment on view chat.my_messages is
  'Filtered on visibility = customer. Internal notes are not merely hidden by '
  'the client; they are not in this view at all.';

grant select on chat.my_family, chat.my_permissions, chat.my_topics, chat.my_messages
  to authenticated;

-- The only write a family-side user can perform.
create or replace function chat.post_customer_message(
  p_body        text,
  p_client_id   text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_family_id   uuid default null
) returns uuid
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_contact   chat.contact%rowtype;
  v_thread_id uuid;
  v_message   uuid;
begin
  select * into v_contact
  from chat.contact
  where account_id = chat.current_account_id() and is_active
    and (p_family_id is null or family_id = p_family_id)
  order by (family_id = p_family_id) desc
  limit 1;

  if not found then
    raise exception 'no active Jawwid Chat contact for this account'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_contact.can_message then
    raise exception 'this contact is not permitted to send messages'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_thread_id from chat.thread where family_id = v_contact.family_id;
  if v_thread_id is null then
    raise exception 'this family has no thread' using errcode = 'no_data_found';
  end if;

  insert into chat.message (thread_id, author_type, author_id, body, attachments,
                            visibility, client_id)
  values (v_thread_id, 'contact', v_contact.id, p_body,
          coalesce(p_attachments, '[]'::jsonb), 'customer', p_client_id)
  returning id into v_message;

  perform chat.log_event('message_received', v_contact.family_id, null,
                         'contact', v_contact.id,
                         jsonb_build_object('message_id', v_message));
  return v_message;
end;
$$;

revoke all on function chat.post_customer_message(text, text, jsonb, uuid) from public;
grant execute on function chat.post_customer_message(text, text, jsonb, uuid) to authenticated;
