-- =============================================================================
-- PD-59 · Sales pipeline: leads with protected contact details
--
-- A lead is a chat.trial_prospect (no second lead system). This migration adds
--   1. nullable pipeline columns to chat.trial_prospect: the STORED stages
--      (new_lead, contacted, lost before any trial), the lost reason, when the
--      lead was last contacted, the next follow-up and its note, and the
--      hand-over made without a trial (converted_at / converted_family_id).
--      Trial Booked, Trial Completed, Converted-by-trial and Lost-by-trial are
--      DERIVED on read from the prospect's lessons and chat.trial_outcome and are
--      never stored.
--   2. chat.sales_lead_contact -- a CONFINED table (G-07, like
--      chat.trial_subscription, 20261021100000): the prospective parent's name,
--      phone, WhatsApp number and e-mail, kept apart from every parent and contact
--      table until conversion. THE CONTACT COLUMNS ARE DELIBERATE (owner decision
--      2026-11-21, PD-59). No request role has a grant; row-level security is on
--      with no policy; only src/sales-pipeline names it
--      (sales-pipeline-confinement.spec.ts fails the build otherwise).
--
-- Additive and backwards compatible: every new column is nullable, no existing
-- row or constraint changes. chat.guard_trial_prospect (the table's ONE guard
-- function, 20261019120000, never redefined since) is replaced with the same body
-- plus ONE rule: converted_family_id must be a family of the prospect's own
-- organization. The guard compares named columns on UPDATE, so the other new
-- columns are writable by the API exactly as before.
-- Idempotent: applying this file again changes nothing.
-- Rollback: db/rollback/20261121100000_chat_pd059_sales_pipeline.down.sql
-- =============================================================================

alter table chat.trial_prospect
  add column if not exists pipeline_stage      text,
  add column if not exists lost_reason         text,
  add column if not exists last_contacted_at   timestamptz,
  add column if not exists next_follow_up_on   date,
  add column if not exists follow_up_note      text,
  add column if not exists converted_at        timestamptz,
  add column if not exists converted_family_id uuid references chat.family (id),
  -- Ownership: the Sales representative a lead is assigned to (a rep reaches only their own leads;
  -- the Sales manager and the super admin reach all). Null on a prospect that existed before PD-59.
  add column if not exists owner_staff_id      uuid references chat.staff (id),
  -- The retention clock: the last MEANINGFUL activity on the lead (created, contacted, stage change,
  -- follow-up change, contact edit, reassignment). Written by the API; a read never moves it.
  add column if not exists last_activity_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_pipeline_stage_known') then
    alter table chat.trial_prospect add constraint trial_prospect_pipeline_stage_known
      check (pipeline_stage is null or pipeline_stage in ('new_lead', 'contacted', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_lost_reason_coherent') then
    alter table chat.trial_prospect add constraint trial_prospect_lost_reason_coherent
      check (coalesce(pipeline_stage = 'lost', false) = (lost_reason is not null)
             and (lost_reason is null or lost_reason in ('price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_follow_up_note_length') then
    alter table chat.trial_prospect add constraint trial_prospect_follow_up_note_length
      check (follow_up_note is null or length(btrim(follow_up_note)) between 1 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_conversion_coherent') then
    alter table chat.trial_prospect add constraint trial_prospect_conversion_coherent
      check ((converted_at is null) = (converted_family_id is null));
  end if;
end
$$;

create index if not exists trial_prospect_owner_idx
  on chat.trial_prospect (organization_id, owner_staff_id)
  where owner_staff_id is not null;

create index if not exists trial_prospect_follow_up_idx
  on chat.trial_prospect (organization_id, next_follow_up_on)
  where next_follow_up_on is not null;

-- ---------------------------------------------------------------------------
-- Who may own a lead
-- ---------------------------------------------------------------------------

-- A live member or manager of the organization's Sales department, or its super admin.
create or replace function chat.sales_lead_owner_eligible(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null
       and (s.role = 'super_admin' or chat.sales_department_role(s.id) is not null));
$$;

-- True only inside chat.purge_expired_sales_leads (a transaction-local setting, and only for a server-side caller).
create or replace function chat.sales_lead_purging()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('chat.sales_lead_purge', true), '') = 'on' and chat.caller_is_server_side();
$$;

-- ---------------------------------------------------------------------------
-- The hand-over stays inside the organization
-- ---------------------------------------------------------------------------

create or replace function chat.guard_trial_prospect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a prospect is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    if new.learner_id is not null then
      raise exception 'a prospect is linked to a learner only when Core confirms it' using errcode = 'check_violation';
    end if;
    if new.converted_family_id is not null then
      raise exception 'a prospect is linked to a family only by its hand-over' using errcode = 'check_violation';
    end if;
    if new.owner_staff_id is not null and not chat.sales_lead_owner_eligible(new.owner_staff_id, new.organization_id) then
      raise exception 'a lead is owned by live Sales staff of its organization' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- UPDATE: the one change is the link to the learner Core created, made once,
  -- by the confirmation (server side).
  -- The retention purge (chat.purge_expired_sales_leads) may clear the free-text note, and nothing else of these.
  if (new.id, new.organization_id, new.display_name, new.level, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.display_name, old.level, old.created_by, old.created_at)
     or (new.note is distinct from old.note and not (chat.sales_lead_purging() and new.note is null)) then
    raise exception 'a prospect is not rewritten' using errcode = 'check_violation';
  end if;
  if new.learner_id is distinct from old.learner_id then
    if old.learner_id is not null or not chat.caller_is_server_side()
       or coalesce(current_setting('chat.confirming_trial', true), '') <> 'on' then
      raise exception 'a prospect is linked to its learner only by the confirmation' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id) then
      raise exception 'a prospect is linked to a learner of its organization' using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- PD-59: the family a lead was handed over to belongs to the lead's organization.
  if new.converted_family_id is distinct from old.converted_family_id and new.converted_family_id is not null then
    if not exists (select 1 from chat.family f where f.id = new.converted_family_id and f.organization_id = new.organization_id) then
      raise exception 'a lead is handed over to a family of its organization' using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- PD-59: an owner, once set, is changed to another owner and never cleared (a reassignment names the new one).
  if old.owner_staff_id is not null and new.owner_staff_id is null then
    raise exception 'a lead''s owner is reassigned, never cleared' using errcode = 'check_violation';
  end if;
  -- PD-59: an owner is live Sales staff of the lead's organization (checked when it is set or changed).
  if new.owner_staff_id is distinct from old.owner_staff_id and new.owner_staff_id is not null
     and not chat.sales_lead_owner_eligible(new.owner_staff_id, new.organization_id) then
    raise exception 'a lead is owned by live Sales staff of its organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The confined contact
-- ---------------------------------------------------------------------------

create table if not exists chat.sales_lead_contact (
  prospect_id      uuid primary key references chat.trial_prospect (id),
  organization_id  uuid not null references chat.organization (id),
  parent_name      text not null check (length(btrim(parent_name)) between 1 and 120),
  phone            text constraint sales_lead_contact_phone_is_confined check (phone is null or length(btrim(phone)) between 5 and 32),
  whatsapp         text constraint sales_lead_contact_whatsapp_is_confined check (whatsapp is null or length(btrim(whatsapp)) between 5 and 32),
  email            text check (email is null or (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  -- The number's country (ISO 3166-1 alpha-2), to read a local number when the lead is converted.
  country_code     text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references chat.staff (id),
  updated_at       timestamptz,
  -- A lead with no way to reach the parent is not a lead.
  constraint sales_lead_contact_has_channel check (num_nonnulls(phone, whatsapp, email) > 0)
);

comment on table chat.sales_lead_contact is
  'PD-59: a prospective parent''s contact, kept apart from every parent record until conversion. CONFINED: no request-role grant; only src/sales-pipeline reads or writes it. Never in a message, card, event, search, log or export. Deleted when the lead is linked to an existing family.';

create or replace function chat.guard_sales_lead_contact()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- After the hand-over (the family's own record holds the contact now), or by the retention purge.
    if not exists (select 1 from chat.trial_prospect p where p.id = old.prospect_id and p.converted_at is not null)
       and not chat.sales_lead_purging() then
      raise exception 'a lead''s contact is deleted only when the lead is converted or its retention has run out' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if not exists (select 1 from chat.trial_prospect p where p.id = new.prospect_id and p.organization_id = new.organization_id) then
    raise exception 'a lead''s contact belongs to its prospect''s organization' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a lead''s contact is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := now();
    new.updated_at := null;
    new.updated_by := null;
  else
    if (new.prospect_id, new.organization_id, new.created_by, new.created_at)
       is distinct from (old.prospect_id, old.organization_id, old.created_by, old.created_at) then
      raise exception 'a lead''s contact keeps its prospect, who recorded it and when' using errcode = 'check_violation';
    end if;
    if new.updated_by is null or not exists (
      select 1 from chat.staff s where s.id = new.updated_by and s.organization_id = new.organization_id
    ) then
      raise exception 'a change to a lead''s contact names who made it' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists sales_lead_contact_is_coherent on chat.sales_lead_contact;
create trigger sales_lead_contact_is_coherent
  before insert or update or delete on chat.sales_lead_contact
  for each row execute function chat.guard_sales_lead_contact();

-- ---------------------------------------------------------------------------
-- Access: only the API's service
-- ---------------------------------------------------------------------------

alter table chat.sales_lead_contact enable row level security;
revoke all on chat.sales_lead_contact from public, anon, authenticated, chat_app;
revoke all on function chat.guard_sales_lead_contact() from public;

-- ---------------------------------------------------------------------------
-- Backfill: the owner of a prospect recorded before PD-59 is its creator, where the creator is (still) live
-- Sales staff of the same organization -- so a representative keeps sight of what they recorded. The super
-- admin, Operations and the Teachers department as creators leave it unassigned (NULL: reached by the Sales
-- manager and the super admin until assigned). Idempotent: only unowned prospects are touched.
-- ---------------------------------------------------------------------------

update chat.trial_prospect p
   set owner_staff_id = p.created_by
 where p.owner_staff_id is null
   and exists (select 1 from chat.staff s
                where s.id = p.created_by and s.organization_id = p.organization_id
                  and s.is_active and s.left_at is null and s.role <> 'super_admin'
                  and chat.sales_department_role(s.id) is not null);

-- ---------------------------------------------------------------------------
-- Retention: 12 months after the last meaningful activity
-- ---------------------------------------------------------------------------

-- chat.trial_student is "never changed" (20261021130000). The retention purge may clear a student's
-- free-text note, and nothing else; every other rule of the guard is kept.
create or replace function chat.guard_trial_student()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and chat.sales_lead_purging() and new.note is null
     and (new.id, new.prospect_id, new.organization_id, new.position, new.display_name, new.level, new.created_at)
         is not distinct from (old.id, old.prospect_id, old.organization_id, old.position, old.display_name, old.level, old.created_at) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'a trial''s students are written with the booking and never changed' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from chat.trial_prospect p where p.id = new.prospect_id and p.organization_id = new.organization_id
  ) then
    raise exception 'a trial student belongs to its booking''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Whether ONE lead's personal data has outlived its purpose. Never a customer: a lead is kept while it is
-- converted (converted_at), linked to a learner, has a subscribed trial, or has any enrolment / hand-over
-- record (the PD-45 booking-location retention keeps a subscribed prospect the same way). Otherwise it must
-- have had no meaningful activity for 12 months (the later of the lead's own last activity and its latest
-- trial; a pre-PD-59 prospect falls back to created_at), and still hold a contact row or a free-text note.
-- Reads, views and analytics never count as activity.
create or replace function chat.sales_lead_expired(p_prospect uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1 from chat.trial_prospect p
     where p.id = p_prospect
       and p.converted_at is null
       and p.converted_family_id is null
       and p.learner_id is null
       and not exists (select 1 from chat.lesson l join chat.trial_outcome o on o.lesson_id = l.id
                        where l.prospect_id = p.id and o.result = 'subscribed')
       and not exists (select 1 from chat.lesson l join chat.student_enrolment e on e.lesson_id = l.id
                        where l.prospect_id = p.id)
       and greatest(
             coalesce(p.last_activity_at, p.created_at),
             (select max(l.created_at) from chat.lesson l where l.prospect_id = p.id),
             (select max(l.ends_at) from chat.lesson l where l.prospect_id = p.id)
           ) < now() - interval '12 months'
       and (exists (select 1 from chat.sales_lead_contact c where c.prospect_id = p.id)
            or p.note is not null or p.follow_up_note is not null
            or exists (select 1 from chat.trial_student t where t.prospect_id = p.id and t.note is not null)));
$$;

create or replace function chat.expired_sales_leads(p_limit integer)
returns table (prospect_id uuid, organization_id uuid)
language sql
stable
set search_path = chat, pg_temp
as $$
  select p.id, p.organization_id
    from chat.trial_prospect p
   where chat.sales_lead_expired(p.id)
   order by p.created_at, p.id
   limit greatest(p_limit, 0);
$$;

-- Deletes the confined contact of every expired lead and clears its free-text notes (the lead's own, its
-- follow-up note, its students' notes); the stage, the lost reason code, the timestamps and the counts
-- stay, as analytics. One audit row per lead: its id and what was cleared, never a value. NEVER touches
-- a family, a parent record, a contact or a learner. Dry-run (the default) only lists. Idempotent: a
-- purged lead no longer qualifies.
--
-- Concurrency: one run at a time (a transaction-level advisory lock: a second worker, or a restart in the
-- middle of a run, gets nothing back), the candidate rows are locked FOR UPDATE SKIP LOCKED (a lead being
-- changed right now is left for the next run), and the expiry is checked AGAIN after the lock, so a lead
-- touched between selection and deletion is not purged. Returns the lead ids.
create or replace function chat.purge_expired_sales_leads(p_limit integer default 200, p_dry_run boolean default true)
returns setof uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r record;
  v_contact integer;
  v_notes boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.purge_expired_sales_leads')) then
    return;
  end if;
  for r in
    select p.id as prospect_id
      from chat.trial_prospect p
     where chat.sales_lead_expired(p.id)
     order by p.created_at, p.id
     limit greatest(p_limit, 0)
       for update of p skip locked
  loop
    -- Re-check under the row lock, on a fresh snapshot.
    if not chat.sales_lead_expired(r.prospect_id) then
      continue;
    end if;
    if p_dry_run then
      return next r.prospect_id;
      continue;
    end if;
    perform set_config('chat.sales_lead_purge', 'on', true);
    delete from chat.sales_lead_contact c where c.prospect_id = r.prospect_id;
    get diagnostics v_contact = row_count;
    select (p.note is not null or p.follow_up_note is not null
            or exists (select 1 from chat.trial_student t where t.prospect_id = p.id and t.note is not null))
      into v_notes from chat.trial_prospect p where p.id = r.prospect_id;
    update chat.trial_student t set note = null where t.prospect_id = r.prospect_id and t.note is not null;
    update chat.trial_prospect p set note = null, follow_up_note = null where p.id = r.prospect_id;
    perform set_config('chat.sales_lead_purge', 'off', true);
    insert into chat.audit_log (actor_id, action, entity, entity_id, after, reason)
    values (null, 'sales_lead.retention_purged', 'trial_prospect', r.prospect_id,
            jsonb_build_object('contactDeleted', v_contact > 0, 'notesCleared', coalesce(v_notes, false)),
            'retention: 12 months without meaningful activity (PD-59)');
    return next r.prospect_id;
  end loop;
end;
$$;

revoke all on function chat.sales_lead_owner_eligible(uuid, uuid) from public, anon, authenticated, chat_app;
revoke all on function chat.sales_lead_purging() from public, anon, authenticated, chat_app;
revoke all on function chat.sales_lead_expired(uuid) from public, anon, authenticated, chat_app;
revoke all on function chat.expired_sales_leads(integer) from public, anon, authenticated, chat_app;
revoke all on function chat.purge_expired_sales_leads(integer, boolean) from public, anon, authenticated, chat_app;
