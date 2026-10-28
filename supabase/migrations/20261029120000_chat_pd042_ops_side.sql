-- PD-42 PR-3 (2026-10-29) -- the Operations side: a Sales owner's suggestion
-- of the Operations supervisor for a family that is waiting for one (D1).
--
-- Record: docs/product/pd042-direct-enrolment-plan.md §4.2, §13 D1.
--
-- A Sales-entered family has no Operations supervisor until the Operations
-- manager places it ("Needs an Operations supervisor"). Its Sales owner may
-- suggest a name; the manager sees it and decides. A suggestion places
-- nothing: chat.learner_supervision stays the Operations manager's
-- (guard_learner_supervision_assigner, 20261028110000).
--
-- WHAT IS NEW
--
--   chat.family_supervisor_suggestion
--       one per family: the suggested Operations supervisor (a live
--       supervisor of an Operations department of the family's academy), who
--       suggested it (someone who owns the family, chat.staff_owns_family)
--       and when. Replaced by a new suggestion; never edited in place
--       otherwise; removed only with the family. Server-side only.
--
-- Everything else PR-3 does (placing the family, the Sales owner change, the
-- trial sibling's Assign, joining the family group) uses rules that already
-- exist: no other table changes.
--
-- Down: drop table chat.family_supervisor_suggestion; drop function
-- chat.guard_family_supervisor_suggestion.

create table chat.family_supervisor_suggestion (
  family_id        uuid primary key references chat.family (id) on delete cascade,
  organization_id  uuid not null references chat.organization (id),
  supervisor_id    uuid not null references chat.staff (id),
  suggested_by     uuid not null references chat.staff (id),
  suggested_at     timestamptz not null default now()
);

comment on table chat.family_supervisor_suggestion is
  'PD-42 D1: the Operations supervisor a family''s Sales owner suggests while the family waits for one. Advisory: the Operations manager places the family (chat.learner_supervision).';

create or replace function chat.guard_family_supervisor_suggestion()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' and new.family_id is distinct from old.family_id then
    raise exception 'a suggestion stays with its family' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.family where id = new.family_id;
  if v_org is null then
    raise exception 'a suggestion is for a family' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  if not exists (select 1
                   from chat.staff s
                   join chat.department_member m on m.staff_id = s.id and m.position = 'supervisor'
                   join chat.department d on d.id = m.department_id and d.kind = 'operations'
                  where s.id = new.supervisor_id and s.organization_id = v_org and s.is_active and s.left_at is null) then
    raise exception 'the suggested name is a live Operations supervisor of the family''s academy'
      using errcode = 'check_violation';
  end if;
  if not chat.staff_owns_family(new.suggested_by, new.family_id) then
    raise exception 'a supervisor is suggested by someone who owns the family'
      using errcode = 'insufficient_privilege';
  end if;
  new.suggested_at := now();
  return new;
end;
$$;

create trigger family_supervisor_suggestion_is_coherent
  before insert or update on chat.family_supervisor_suggestion
  for each row execute function chat.guard_family_supervisor_suggestion();

-- ---------------------------------------------------------------------------
-- Fail closed: server-side only, like every PD-42 table.
-- ---------------------------------------------------------------------------

alter table chat.family_supervisor_suggestion enable row level security;
revoke all on chat.family_supervisor_suggestion from public, anon, authenticated, chat_app;
revoke all on function chat.guard_family_supervisor_suggestion() from public;
