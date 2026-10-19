-- PD-10 (closed 2026-10-18) -- the Teacher File, step 1. Reconciled with PD-11
-- T3 on 2026-10-19 (owner-approved plan): renumbered after 20261018160000, and
-- the supervision timeline is PD-11's chat.teacher_supervision_entry, EXTENDED
-- here rather than created a second time.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-10, and
-- docs/admin/teacher-file.md.
--
-- WHAT THIS ADDS
--
--   chat.teacher_file               a teacher's administration-only personal
--                                   record: phone, email, joining date. Full
--                                   name stays chat.teacher.name.
--   chat.teacher_supervision_entry  (PD-11's table) gains complaint resolutions:
--                                   kind 'complaint_resolution' + refers_to, one
--                                   per complaint, and a complaint's source
--                                   message (source_message_id, inside the
--                                   entry's conversation_id).
--
-- WHAT THIS DOES NOT ADD
--
--   Days off: PD-11's chat.teacher_day_off is the one record of days off (the
--   scheduler reads it); the Teacher File reads and writes that table. Salary,
--   bonuses' amounts, deductions: Core's, never stored (PD-10 §4).
--
-- THE PHONE COLUMN IS DELIBERATE. Phone privacy here is structural (G-07): no
-- actor or communication entity carries a phone, so the engine cannot leak one.
-- PD-10 decided that a teacher's phone lives in an administration-only record.
-- It is this table, and the structure stays intact because nothing in the
-- communication engine reads it: no request role has a grant on it, and
-- test/unit/privacy/teacher-file-confinement.spec.ts fails the build if any
-- source outside src/teacher-file names it. The G-07 tripwire's ALLOWED list
-- names exactly this one declaration.

-- ===========================================================================
-- 1. The administration-only personal record
-- ===========================================================================

create table chat.teacher_file (
  teacher_id      uuid primary key references chat.teacher (id) on delete cascade,
  organization_id uuid not null references chat.organization (id),
  phone text constraint teacher_file_phone_is_admin_only check (phone ~ '^\+?[0-9][0-9 ()-]{5,30}$'),
  email           text check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  joined_on       date,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references chat.staff (id)
);

comment on table chat.teacher_file is
  'PD-10: a teacher''s administration-only personal record. Never read by the communication engine; no request role has a grant.';

create trigger teacher_file_updated_at before update on chat.teacher_file
  for each row execute function chat.set_updated_at();

create or replace function chat.guard_teacher_file()
returns trigger
language plpgsql
as $$
declare
  v_teacher_org uuid;
begin
  select organization_id into v_teacher_org from chat.teacher where id = new.teacher_id;
  if v_teacher_org is distinct from new.organization_id then
    raise exception 'a teacher file belongs to the teacher''s organization'
      using errcode = 'insufficient_privilege';
  end if;
  if new.updated_by is not null and not exists (
    select 1 from chat.staff s where s.id = new.updated_by and s.organization_id = new.organization_id
  ) then
    raise exception 'a teacher file is edited by staff of its organization'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_file_is_coherent before insert or update on chat.teacher_file
  for each row execute function chat.guard_teacher_file();

-- ===========================================================================
-- 2. The supervision timeline (PD-11's table): complaint resolutions
-- ===========================================================================

alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_kind_check;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_kind_check
  check (kind in ('bonus', 'complaint', 'complaint_resolution', 'monthly_comment', 'note'));

alter table chat.teacher_supervision_entry
  add column refers_to uuid references chat.teacher_supervision_entry (id),
  add column source_message_id uuid references chat.message (id);

alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_followup_shape
  check ((kind = 'complaint_resolution') = (refers_to is not null)
     and (source_message_id is null or (kind = 'complaint' and conversation_id is not null)));

-- A complaint is resolved once.
create unique index teacher_supervision_entry_one_resolution
  on chat.teacher_supervision_entry (refers_to) where refers_to is not null;

create or replace function chat.guard_teacher_supervision_followup()
returns trigger
language plpgsql
as $$
declare
  v_target   chat.teacher_supervision_entry%rowtype;
  v_conv_org uuid;
begin
  if new.refers_to is not null then
    select * into v_target from chat.teacher_supervision_entry where id = new.refers_to;
    if v_target.id is null or v_target.teacher_id <> new.teacher_id or v_target.kind <> 'complaint' then
      raise exception 'a resolution refers to a complaint about the same teacher'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  if new.conversation_id is not null then
    select organization_id into v_conv_org from chat.conversation where id = new.conversation_id;
    if v_conv_org is distinct from new.organization_id then
      raise exception 'a supervision entry''s conversation belongs to its organization'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.source_message_id is not null and not exists (
    select 1 from chat.message m where m.id = new.source_message_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'a complaint''s source message belongs to its conversation'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_supervision_entry_followup_is_coherent
  before insert on chat.teacher_supervision_entry
  for each row execute function chat.guard_teacher_supervision_followup();

-- ===========================================================================
-- 3. Grants: none. Only the server reads or writes the Teacher File.
-- ===========================================================================

alter table chat.teacher_file enable row level security;
revoke all on chat.teacher_file from public, anon, authenticated, chat_app;

revoke all on function chat.guard_teacher_file() from public;
revoke all on function chat.guard_teacher_supervision_followup() from public;
